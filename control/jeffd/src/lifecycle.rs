use crate::config::{DaemonConfig, PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LifecycleError {
    #[error("daemon is already running")]
    AlreadyRunning,
    #[error("unsafe existing socket path {0}")]
    UnsafeSocket(PathBuf),
    #[error("cannot prove existing socket is stale: {0}")]
    AmbiguousSocket(io::Error),
    #[error("daemon lock is not held")]
    LockNotHeld,
    #[error("invalid daemon PID file")]
    InvalidPid,
    #[error("daemon did not answer the P1a hello")]
    InvalidHello,
    #[error("daemon is not running: {0}")]
    NotRunning(io::Error),
    #[error("lifecycle operation failed: {0}")]
    Io(#[from] io::Error),
}

pub struct OwnedSocket {
    pub listener: UnixListener,
    socket_path: PathBuf,
    device: u64,
    inode: u64,
    _lock: File,
}

impl OwnedSocket {
    pub fn bind(config: &DaemonConfig) -> Result<Self, LifecycleError> {
        config
            .prepare_socket_directory()
            .map_err(|error| io::Error::new(io::ErrorKind::PermissionDenied, error))?;
        let lock_path = lock_path(&config.socket);
        let mut lock = open_lock(&lock_path, true)?;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == -1 {
            return Err(LifecycleError::AlreadyRunning);
        }
        validate_lock_file(&lock)?;
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600))?;
        lock.set_len(0)?;
        writeln!(lock, "{}", std::process::id())?;
        lock.sync_data()?;

        remove_stale_socket(&config.socket)?;
        let listener = UnixListener::bind(&config.socket)?;
        fs::set_permissions(&config.socket, fs::Permissions::from_mode(0o600))?;
        listener.set_nonblocking(true)?;
        let metadata = fs::symlink_metadata(&config.socket)?;
        Ok(Self {
            listener,
            socket_path: config.socket.clone(),
            device: metadata.dev(),
            inode: metadata.ino(),
            _lock: lock,
        })
    }

    pub fn cleanup(&self) -> Result<(), LifecycleError> {
        match fs::symlink_metadata(&self.socket_path) {
            Ok(metadata)
                if metadata.file_type().is_socket()
                    && metadata.dev() == self.device
                    && metadata.ino() == self.inode =>
            {
                match remove_validated_socket(&self.socket_path, self.device, self.inode) {
                    Ok(_) => {}
                    Err(LifecycleError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(())
    }
}

impl Drop for OwnedSocket {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

pub fn probe(socket: &Path) -> Result<(), LifecycleError> {
    let mut stream = UnixStream::connect(socket).map_err(LifecycleError::NotRunning)?;
    let timeout = Duration::from_secs(2);
    let deadline = Instant::now() + timeout;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let request = json!({
        "v": PROTOCOL_VERSION,
        "kind": "req",
        "id": "lifecycle",
        "method": "server.hello",
        "params": {}
    });
    serde_json::to_writer(&mut stream, &request)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(LifecycleError::InvalidHello)?;
        stream.set_read_timeout(Some(remaining))?;
        let frame = read_bounded_frame(&mut stream, 64 * 1024)?;
        let response: Value =
            serde_json::from_slice(&frame).map_err(|_| LifecycleError::InvalidHello)?;
        if response["kind"] == "event"
            && response["v"] == PROTOCOL_VERSION
            && response["name"].is_string()
            && response.get("payload").is_some()
        {
            continue;
        }
        if response["kind"] == "res" && response["id"] != "lifecycle" {
            continue;
        }
        if response["kind"] == "res"
            && response["id"] == "lifecycle"
            && response["ok"] == true
            && response["result"]["protocolVersion"] == PROTOCOL_VERSION
        {
            return Ok(());
        }
        return Err(LifecycleError::InvalidHello);
    }
}

pub fn stop(config: &DaemonConfig) -> Result<(), LifecycleError> {
    probe(&config.socket)?;
    let mut lock = open_lock(&lock_path(&config.socket), false)?;
    validate_lock_file(&lock)?;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        unsafe {
            libc::flock(lock.as_raw_fd(), libc::LOCK_UN);
        }
        return Err(LifecycleError::LockNotHeld);
    }
    let mut pid_text = String::new();
    lock.read_to_string(&mut pid_text)?;
    let pid: i32 = pid_text
        .trim()
        .parse()
        .ok()
        .filter(|pid| *pid > 1)
        .ok_or(LifecycleError::InvalidPid)?;
    if unsafe { libc::kill(pid, 0) } == -1 {
        return Err(LifecycleError::InvalidPid);
    }
    if unsafe { libc::kill(pid, libc::SIGTERM) } == -1 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}

fn lock_path(socket: &Path) -> PathBuf {
    let mut name: OsString = socket.as_os_str().to_owned();
    name.push(".lock");
    PathBuf::from(name)
}

fn open_lock(path: &Path, create: bool) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

fn validate_lock_file(file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "lock file is not an owner-controlled regular file",
        ));
    }
    Ok(())
}

fn remove_stale_socket(path: &Path) -> Result<(), LifecycleError> {
    let before = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !before.file_type().is_socket() || before.uid() != unsafe { libc::geteuid() } {
        return Err(LifecycleError::UnsafeSocket(path.to_path_buf()));
    }
    match UnixStream::connect(path) {
        Ok(_) => return Err(LifecycleError::AlreadyRunning),
        Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {}
        Err(error) => return Err(LifecycleError::AmbiguousSocket(error)),
    }
    let after = fs::symlink_metadata(path)?;
    if !after.file_type().is_socket()
        || after.uid() != unsafe { libc::geteuid() }
        || before.dev() != after.dev()
        || before.ino() != after.ino()
    {
        return Err(LifecycleError::UnsafeSocket(path.to_path_buf()));
    }
    if !remove_validated_socket(path, after.dev(), after.ino())? {
        return Err(LifecycleError::UnsafeSocket(path.to_path_buf()));
    }
    Ok(())
}
static NEXT_QUARANTINE: AtomicU64 = AtomicU64::new(0);

fn remove_validated_socket(
    path: &Path,
    expected_device: u64,
    expected_inode: u64,
) -> Result<bool, LifecycleError> {
    let quarantine = quarantine_path(path)?;
    fs::rename(path, &quarantine)?;
    let metadata = fs::symlink_metadata(&quarantine)?;
    if metadata.file_type().is_socket()
        && metadata.dev() == expected_device
        && metadata.ino() == expected_inode
    {
        fs::remove_file(quarantine)?;
        return Ok(true);
    }

    fs::hard_link(&quarantine, path)?;
    fs::remove_file(quarantine)?;
    Ok(false)
}

fn quarantine_path(path: &Path) -> Result<PathBuf, LifecycleError> {
    let parent = path
        .parent()
        .ok_or_else(|| LifecycleError::UnsafeSocket(path.to_path_buf()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| LifecycleError::UnsafeSocket(path.to_path_buf()))?;
    for _ in 0..16 {
        let sequence = NEXT_QUARANTINE.fetch_add(1, Ordering::Relaxed);
        let mut name = file_name.to_os_string();
        name.push(format!(".jeffd-remove-{}-{sequence}", std::process::id()));
        let candidate = parent.join(name);
        match fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(candidate),
            Ok(_) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Err(LifecycleError::UnsafeSocket(path.to_path_buf()))
}

fn read_bounded_frame(stream: &mut UnixStream, limit: usize) -> io::Result<Vec<u8>> {
    let mut frame = Vec::new();
    let mut byte = [0_u8; 1];
    while frame.len() <= limit {
        let count = stream.read(&mut byte)?;
        if count == 0 || byte[0] == b'\n' {
            return Ok(frame);
        }
        frame.push(byte[0]);
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "frame too large",
    ))
}
