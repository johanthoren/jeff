mod config;
mod lifecycle;
mod protocol;
mod registry;
mod server;
mod snapshot;
mod state;

pub use config::DaemonConfig;
pub use registry::load_registry;
pub use snapshot::{parse_snapshot_output, run_snapshot, SnapshotFailure, SnapshotInvocation};
pub use state::{DirtyTracker, ProjectCache};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DaemonError {
    #[error("configuration error: {0}")]
    Config(#[from] config::ConfigError),
    #[error("lifecycle error: {0}")]
    Lifecycle(#[from] lifecycle::LifecycleError),
    #[error("daemon error: {0}")]
    Server(#[from] server::ServerError),
}

pub fn start() -> Result<(), DaemonError> {
    let config = DaemonConfig::resolve()?;
    let socket = lifecycle::OwnedSocket::bind(&config)?;
    server::run(config, socket)?;
    Ok(())
}

pub fn status() -> Result<(), DaemonError> {
    let config = DaemonConfig::resolve()?;
    lifecycle::probe(&config.socket)?;
    Ok(())
}

pub fn stop() -> Result<(), DaemonError> {
    let config = DaemonConfig::resolve()?;
    lifecycle::stop(&config)?;
    Ok(())
}

#[cfg(test)]
mod tests;
