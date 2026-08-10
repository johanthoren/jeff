use std::env;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

pub const PROTOCOL_VERSION: u64 = 1;
pub const SNAPSHOT_SCHEMA_MIN: u64 = 1;
pub const SNAPSHOT_SCHEMA_MAX: u64 = 1;

#[derive(Clone, Debug)]
pub struct DaemonConfig {
    pub home: PathBuf,
    pub socket: PathBuf,
    pub registry: PathBuf,
    snapshot_timeout: Duration,
    debounce_window: Duration,
    frame_limit: usize,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("HOME is not set")]
    MissingHome,
    #[error("JEFFD_SOCK must be an absolute path")]
    RelativeSocket,
    #[error("socket path has no parent")]
    MissingSocketParent,
    #[error("unsafe socket directory {0}")]
    UnsafeDirectory(PathBuf),
    #[error("cannot prepare socket directory: {0}")]
    Io(#[from] std::io::Error),
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        let socket = home.join(".jeff/jeffd.sock");
        Self {
            registry: home.join(".jeff/projects.json"),
            home,
            socket,
            snapshot_timeout: Duration::from_secs(30),
            debounce_window: Duration::from_millis(150),
            frame_limit: 16 * 1024 * 1024,
        }
    }
}

impl DaemonConfig {
    pub fn resolve() -> Result<Self, ConfigError> {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or(ConfigError::MissingHome)?;
        let default_parent = home.join(".jeff");
        let socket = match env::var_os("JEFFD_SOCK") {
            Some(value) => {
                let path = PathBuf::from(value);
                if !path.is_absolute() {
                    return Err(ConfigError::RelativeSocket);
                }
                path
            }
            None => default_parent.join("jeffd.sock"),
        };
        Ok(Self {
            registry: default_parent.join("projects.json"),
            home,
            socket,
            snapshot_timeout: Duration::from_secs(30),
            debounce_window: Duration::from_millis(150),
            frame_limit: 16 * 1024 * 1024,
        })
    }

    pub fn prepare_socket_directory(&self) -> Result<(), ConfigError> {
        let parent = self
            .socket
            .parent()
            .ok_or(ConfigError::MissingSocketParent)?;
        let default_parent = self.home.join(".jeff");
        if !parent.exists() {
            fs::create_dir_all(parent)?;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        } else if parent == default_parent {
            validate_owned_directory(parent)?;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
        validate_private_directory(parent)
    }

    pub fn snapshot_timeout(&self) -> Duration {
        self.snapshot_timeout
    }

    pub fn debounce_window(&self) -> Duration {
        self.debounce_window
    }

    pub fn frame_limit(&self) -> usize {
        self.frame_limit
    }
}

fn validate_private_directory(path: &Path) -> Result<(), ConfigError> {
    let metadata = fs::symlink_metadata(path)?;
    let safe = metadata.file_type().is_dir()
        && metadata.uid() == unsafe { libc::geteuid() }
        && metadata.permissions().mode() & 0o077 == 0;
    if safe {
        Ok(())
    } else {
        Err(ConfigError::UnsafeDirectory(path.to_path_buf()))
    }
}

fn validate_owned_directory(path: &Path) -> Result<(), ConfigError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_dir() && metadata.uid() == unsafe { libc::geteuid() } {
        Ok(())
    } else {
        Err(ConfigError::UnsafeDirectory(path.to_path_buf()))
    }
}
