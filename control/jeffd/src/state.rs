use jeff_project::{GraphProjection, ProjectRecord, Snapshot};
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheFailure {
    pub message: String,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct ProjectCache {
    record: ProjectRecord,
    projection: Option<GraphProjection>,
    last_error: Option<CacheFailure>,
    last_successful_generation: Option<String>,
}

impl ProjectCache {
    pub fn new(record: ProjectRecord) -> Self {
        Self {
            record,
            projection: None,
            last_error: None,
            last_successful_generation: None,
        }
    }

    pub fn record(&self) -> &ProjectRecord {
        &self.record
    }

    pub fn update_record(&mut self, record: ProjectRecord) {
        self.record = record;
    }

    pub fn replace(&mut self, snapshot: Snapshot) {
        self.last_successful_generation = Some(snapshot.generated_at.clone());
        self.projection = Some(GraphProjection {
            project_id: self.record.id.clone(),
            path: self.record.path.clone(),
            snapshot,
            degraded: Vec::new(),
        });
        self.last_error = None;
    }

    pub fn fail(&mut self, message: String, exit_code: Option<i32>) {
        if let Some(projection) = self.projection.as_mut() {
            projection.degraded = vec!["snapshot_stale".to_owned()];
        }
        self.last_error = Some(CacheFailure { message, exit_code });
    }

    pub fn projection(&self) -> Option<&GraphProjection> {
        self.projection.as_ref()
    }

    pub fn last_error(&self) -> Option<&CacheFailure> {
        self.last_error.as_ref()
    }

    pub fn last_successful_generation(&self) -> Option<&str> {
        self.last_successful_generation.as_deref()
    }
}

#[derive(Clone, Debug)]
enum DirtyState {
    Debouncing(Duration),
    Running { dirty_again: bool },
}

#[derive(Clone, Debug)]
pub struct DirtyTracker {
    window: Duration,
    projects: BTreeMap<String, DirtyState>,
}

impl DirtyTracker {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            projects: BTreeMap::new(),
        }
    }

    pub fn mark_dirty(&mut self, project_id: &str, now: Duration) {
        match self.projects.get_mut(project_id) {
            Some(DirtyState::Running { dirty_again }) => *dirty_again = true,
            Some(state @ DirtyState::Debouncing(_)) => {
                *state = DirtyState::Debouncing(now + self.window)
            }
            None => {
                self.projects.insert(
                    project_id.to_owned(),
                    DirtyState::Debouncing(now + self.window),
                );
            }
        }
    }

    pub fn due(&mut self, now: Duration) -> Vec<String> {
        let due: Vec<_> = self
            .projects
            .iter()
            .filter_map(|(id, state)| match state {
                DirtyState::Debouncing(deadline) if *deadline <= now => Some(id.clone()),
                _ => None,
            })
            .collect();
        for id in &due {
            self.projects
                .insert(id.clone(), DirtyState::Running { dirty_again: false });
        }
        due
    }

    pub fn start_now(&mut self, project_id: &str) -> bool {
        match self.projects.get(project_id) {
            Some(DirtyState::Running { .. }) => false,
            _ => {
                self.projects.insert(
                    project_id.to_owned(),
                    DirtyState::Running { dirty_again: false },
                );
                true
            }
        }
    }

    pub fn is_running(&self, project_id: &str) -> bool {
        matches!(
            self.projects.get(project_id),
            Some(DirtyState::Running { .. })
        )
    }

    pub fn finished(&mut self, project_id: &str, now: Duration) {
        match self.projects.remove(project_id) {
            Some(DirtyState::Running { dirty_again: true }) => {
                self.projects.insert(
                    project_id.to_owned(),
                    DirtyState::Debouncing(now + self.window),
                );
            }
            Some(DirtyState::Running { dirty_again: false }) | None => {}
            Some(DirtyState::Debouncing(deadline)) => {
                self.projects
                    .insert(project_id.to_owned(), DirtyState::Debouncing(deadline));
            }
        }
    }

    pub fn remove(&mut self, project_id: &str) {
        self.projects.remove(project_id);
    }
}
