use jeff_project::{parse_snapshot, ProjectRecord, Snapshot};
use std::io::{self, Read};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;

const STDERR_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct SnapshotInvocation {
    program: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
}

impl SnapshotInvocation {
    pub fn for_project(project: &ProjectRecord) -> Result<Self, SnapshotFailure> {
        if !project.path.is_absolute() {
            return Err(SnapshotFailure::InvalidInvocation(
                "project path must be absolute".to_owned(),
            ));
        }
        let (program, mut args) = match &project.cook {
            None => (PathBuf::from("cook"), Vec::new()),
            Some(command) if command.is_empty() => {
                return Err(SnapshotFailure::InvalidInvocation(
                    "cook command must not be empty".to_owned(),
                ));
            }
            Some(command) => {
                let program = PathBuf::from(&command[0]);
                if !program.is_absolute() {
                    return Err(SnapshotFailure::InvalidInvocation(
                        "explicit cook executable must be absolute".to_owned(),
                    ));
                }
                (program, command[1..].to_vec())
            }
        };
        args.extend(["snapshot".to_owned(), "--json".to_owned()]);
        Ok(Self {
            program,
            args,
            cwd: project.path.clone(),
        })
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }
}

#[derive(Clone, Debug, Error)]
pub enum SnapshotFailure {
    #[error("invalid snapshot: {0}")]
    Invalid(String),
    #[error("invalid snapshot invocation: {0}")]
    InvalidInvocation(String),
    #[error("failed to start snapshot command: {0}")]
    Spawn(String),
    #[error("snapshot command timed out")]
    Timeout,
    #[error("snapshot command cancelled")]
    Cancelled,
    #[error("{message}")]
    Exit { message: String, code: Option<i32> },
    #[error("failed to read snapshot output: {0}")]
    Output(String),
}

impl SnapshotFailure {
    pub fn exit_code(&self) -> Option<i32> {
        match self {
            Self::Exit { code, .. } => *code,
            _ => None,
        }
    }
}

pub fn parse_snapshot_output(output: &[u8]) -> Result<Snapshot, SnapshotFailure> {
    let text =
        std::str::from_utf8(output).map_err(|error| SnapshotFailure::Invalid(error.to_string()))?;
    parse_snapshot(text).map_err(|error| SnapshotFailure::Invalid(error.to_string()))
}

pub fn run_snapshot(
    project: &ProjectRecord,
    timeout: Duration,
) -> Result<Snapshot, SnapshotFailure> {
    run_snapshot_with_cancel(project, timeout, Arc::new(AtomicBool::new(false)))
}

pub(crate) fn run_snapshot_with_cancel(
    project: &ProjectRecord,
    timeout: Duration,
    cancelled: Arc<AtomicBool>,
) -> Result<Snapshot, SnapshotFailure> {
    let invocation = SnapshotInvocation::for_project(project)?;
    let mut command = Command::new(invocation.program());
    command
        .args(invocation.args())
        .current_dir(invocation.cwd())
        .env("PWD", invocation.cwd())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command
        .spawn()
        .map_err(|error| SnapshotFailure::Spawn(error.to_string()))?;
    let process_group = child.id() as i32;
    let stdout = child.stdout.take().expect("captured stdout");
    let stderr = child.stderr.take().expect("captured stderr");
    let (stdout_tx, stdout_rx) = mpsc::sync_channel(1);
    let (stderr_tx, stderr_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = stdout_tx.send(read_all(stdout));
    });
    thread::spawn(move || {
        let _ = stderr_tx.send(read_bounded(stderr, STDERR_LIMIT));
    });
    let started = Instant::now();
    let mut status = None;
    let mut stdout = None;
    let mut stderr = None;

    loop {
        if cancelled.load(Ordering::Acquire) {
            terminate_group(process_group, &mut child);
            return Err(SnapshotFailure::Cancelled);
        }
        if started.elapsed() >= timeout {
            terminate_group(process_group, &mut child);
            return Err(SnapshotFailure::Timeout);
        }
        if status.is_none() {
            status = child
                .try_wait()
                .map_err(|error| SnapshotFailure::Output(error.to_string()))?;
        }
        if stdout.is_none() {
            stdout = receive_output(&stdout_rx, "stdout")?;
        }
        if stderr.is_none() {
            stderr = receive_output(&stderr_rx, "stderr")?;
        }
        if status.is_some() && stdout.is_some() && stderr.is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let status =
        status.ok_or_else(|| SnapshotFailure::Output("missing child status".to_owned()))?;
    let stdout =
        stdout.ok_or_else(|| SnapshotFailure::Output("missing stdout output".to_owned()))?;
    let stderr =
        stderr.ok_or_else(|| SnapshotFailure::Output("missing stderr output".to_owned()))?;
    if status.success() {
        parse_snapshot_output(&stdout)
    } else {
        let code = status.code();
        let diagnostic = String::from_utf8_lossy(&stderr).trim().to_owned();
        let lower = diagnostic.to_ascii_lowercase();
        let message = if lower.contains("unknown command") || lower.contains("usage:") {
            format!("older jeff missing snapshot: {diagnostic}")
        } else if diagnostic.is_empty() {
            format!(
                "cook exited {}",
                code.map_or_else(|| "without a code".to_owned(), |v| v.to_string())
            )
        } else {
            diagnostic
        };
        Err(SnapshotFailure::Exit { message, code })
    }
}

fn terminate_group(process_group: i32, child: &mut std::process::Child) {
    unsafe {
        libc::kill(-process_group, libc::SIGKILL);
    }
    let _ = child.wait();
}

fn read_all(mut reader: impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn read_bounded(mut reader: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut kept = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            return Ok(kept);
        }
        let remaining = limit.saturating_sub(kept.len());
        kept.extend_from_slice(&chunk[..read.min(remaining)]);
    }
}

fn receive_output(
    receiver: &Receiver<io::Result<Vec<u8>>>,
    name: &str,
) -> Result<Option<Vec<u8>>, SnapshotFailure> {
    match receiver.try_recv() {
        Ok(Ok(bytes)) => Ok(Some(bytes)),
        Ok(Err(error)) => Err(SnapshotFailure::Output(error.to_string())),
        Err(TryRecvError::Empty) => Ok(None),
        Err(TryRecvError::Disconnected) => Err(SnapshotFailure::Output(format!(
            "{name} reader stopped before returning output"
        ))),
    }
}
