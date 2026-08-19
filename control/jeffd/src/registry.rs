use jeff_project::ProjectRecord;
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;
use thiserror::Error;
const REGISTRY_LIMIT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("cannot read project registry: {0}")]
    Read(#[from] std::io::Error),
    #[error("invalid project registry: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("invalid project registry: {0}")]
    Validation(String),
}

pub fn load_registry(path: &Path) -> Result<Vec<ProjectRecord>, RegistryError> {
    let before = fs::symlink_metadata(path)?;
    if !before.file_type().is_file() {
        return Err(RegistryError::Validation(
            "project registry must be a regular file".to_owned(),
        ));
    }
    reject_oversized(before.len())?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let after = file.metadata()?;
    if !after.file_type().is_file() || before.dev() != after.dev() || before.ino() != after.ino() {
        return Err(RegistryError::Validation(
            "project registry must be the same regular file opened without symlinks".to_owned(),
        ));
    }
    reject_oversized(after.len())?;
    let mut bytes = Vec::with_capacity(after.len() as usize);
    file.take((REGISTRY_LIMIT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > REGISTRY_LIMIT_BYTES {
        return Err(RegistryError::Validation(format!(
            "project registry exceeds {REGISTRY_LIMIT_BYTES} bytes"
        )));
    }
    let records: Vec<ProjectRecord> = serde_json::from_slice(&bytes)?;
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    for record in &records {
        if record.id.is_empty() {
            return Err(RegistryError::Validation(
                "project id must not be empty".to_owned(),
            ));
        }
        if !record.path.is_absolute() {
            return Err(RegistryError::Validation(format!(
                "project {} path must be absolute",
                record.id
            )));
        }
        if !ids.insert(record.id.clone()) {
            return Err(RegistryError::Validation(format!(
                "duplicate project id {}",
                record.id
            )));
        }
        if !paths.insert(record.path.clone()) {
            return Err(RegistryError::Validation(format!(
                "duplicate project path {}",
                record.path.display()
            )));
        }
        if let Some(command) = &record.cook {
            if command.is_empty() {
                return Err(RegistryError::Validation(format!(
                    "project {} cook command must not be empty",
                    record.id
                )));
            }
            if !Path::new(&command[0]).is_absolute() {
                return Err(RegistryError::Validation(format!(
                    "project {} cook executable must be absolute",
                    record.id
                )));
            }
        }
    }
    Ok(records)
}

fn reject_oversized(size: u64) -> Result<(), RegistryError> {
    if size > REGISTRY_LIMIT_BYTES as u64 {
        Err(RegistryError::Validation(format!(
            "project registry exceeds {REGISTRY_LIMIT_BYTES} bytes"
        )))
    } else {
        Ok(())
    }
}
