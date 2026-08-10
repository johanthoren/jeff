use jeff_project::ProjectRecord;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use thiserror::Error;

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
    let records: Vec<ProjectRecord> = serde_json::from_slice(&fs::read(path)?)?;
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
