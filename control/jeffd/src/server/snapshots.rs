use super::{ActiveSnapshot, Server, WaitKind};
use crate::protocol::{OwnerMessage, SnapshotRun};
use crate::snapshot::run_snapshot_with_cancel;
use crate::state::ProjectCache;
use jeff_project::ProjectRecord;
use serde_json::json;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;

impl Server {
    pub(super) fn start_snapshot(&mut self, project_id: &str) {
        if self.active.contains_key(project_id) || !self.dirty.start_now(project_id) {
            return;
        }
        let Some(record) = self
            .projects
            .iter()
            .find(|project| project.id == project_id && project.enabled)
            .cloned()
        else {
            self.dirty.finished(project_id, self.now());
            return;
        };
        self.launch_snapshot(record);
    }

    pub(super) fn run_due_snapshots(&mut self) {
        for project_id in self.dirty.due(self.now()) {
            if self.active.contains_key(&project_id) {
                continue;
            }
            let Some(record) = self
                .projects
                .iter()
                .find(|project| project.id == project_id && project.enabled)
                .cloned()
            else {
                self.dirty.finished(&project_id, self.now());
                continue;
            };
            self.launch_snapshot(record);
        }
    }

    fn launch_snapshot(&mut self, record: ProjectRecord) {
        let project_id = record.id.clone();
        let Some(&generation) = self.registry_generations.get(&project_id) else {
            self.dirty.finished(&project_id, self.now());
            return;
        };
        let run = SnapshotRun { record, generation };
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active.insert(
            project_id,
            ActiveSnapshot {
                run: run.clone(),
                cancelled: cancelled.clone(),
            },
        );
        let sender = self.messages_tx.clone();
        let timeout = self.config.snapshot_timeout();
        thread::spawn(move || {
            let result = run_snapshot_with_cancel(&run.record, timeout, cancelled);
            let _ = sender.send(OwnerMessage::SnapshotDone { run, result });
        });
    }

    pub(super) fn finish_snapshot(
        &mut self,
        run: SnapshotRun,
        result: Result<jeff_project::Snapshot, crate::snapshot::SnapshotFailure>,
    ) {
        let project_id = run.record.id.clone();
        if !self
            .active
            .get(&project_id)
            .is_some_and(|active| active.run == run)
        {
            return;
        }
        self.active.remove(&project_id);
        let is_current = self.registry_generations.get(&project_id) == Some(&run.generation)
            && self
                .projects
                .iter()
                .any(|record| record.enabled && *record == run.record);
        if !is_current {
            self.dirty.finished(&project_id, self.now());
            if self
                .waiters
                .get(&project_id)
                .is_some_and(|waiters| !waiters.is_empty())
                && self
                    .projects
                    .iter()
                    .any(|record| record.id == project_id && record.enabled)
            {
                self.start_snapshot(&project_id);
            } else {
                self.answer_waiters(&project_id);
            }
            return;
        }

        let had_good = self
            .caches
            .get(&project_id)
            .and_then(ProjectCache::projection)
            .is_some();
        if let Some(cache) = self.caches.get_mut(&project_id) {
            match &result {
                Ok(snapshot) => cache.replace(snapshot.clone()),
                Err(error) => cache.fail(error.to_string(), error.exit_code()),
            }
        }
        self.answer_waiters(&project_id);
        match result {
            Ok(_) if had_good => {
                if let Some(projection) = self
                    .caches
                    .get(&project_id)
                    .and_then(ProjectCache::projection)
                {
                    self.send_project_event(
                        &project_id,
                        "snapshot.replaced",
                        json!({"projectId": project_id, "snapshot": projection}),
                    );
                }
            }
            Ok(_) => {}
            Err(error) if had_good => self.send_project_event(
                &project_id,
                "snapshot.failed",
                json!({
                    "projectId": project_id,
                    "message": error.to_string(),
                    "exitCode": error.exit_code()
                }),
            ),
            Err(_) => {}
        }
        self.dirty.finished(&project_id, self.now());
    }

    fn answer_waiters(&mut self, project_id: &str) {
        let waiters = self.take_waiters(project_id);
        let projection = self
            .caches
            .get(project_id)
            .and_then(ProjectCache::projection)
            .cloned();
        let failure = self
            .caches
            .get(project_id)
            .and_then(ProjectCache::last_error)
            .cloned();
        for waiter in waiters {
            if !self.connections.contains_key(&waiter.connection) {
                continue;
            }
            if let Some(projection) = &projection {
                match waiter.kind {
                    WaitKind::Get => {
                        self.send_result(waiter.connection, &waiter.request_id, json!(projection));
                    }
                    WaitKind::Subscribe(subscription_id) => {
                        if self.send_result(
                            waiter.connection,
                            &waiter.request_id,
                            json!({
                                "subscriptionId": subscription_id,
                                "snapshot": projection
                            }),
                        ) {
                            self.register_subscription(
                                waiter.connection,
                                project_id.to_owned(),
                                subscription_id.clone(),
                            );
                            self.mark_subscription_returned(&subscription_id);
                        }
                    }
                }
            } else {
                if let WaitKind::Subscribe(subscription_id) = &waiter.kind {
                    self.remove_subscription(subscription_id);
                }
                let message = failure
                    .as_ref()
                    .map_or("snapshot unavailable", |failure| failure.message.as_str());
                self.send_error(
                    waiter.connection,
                    &waiter.request_id,
                    "unavailable",
                    message,
                );
            }
        }
    }
}
