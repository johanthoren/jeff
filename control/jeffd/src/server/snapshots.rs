use super::{ActiveSnapshot, Limits, Server, WaitKind, Waiter};
use crate::config::PROTOCOL_VERSION;
use crate::protocol::{OwnerMessage, SnapshotRun};
use crate::snapshot::{injected_thread_failure, run_snapshot_with_cancel, SnapshotFailure};
use crate::state::{retained_projection_bytes, ProjectCache, SNAPSHOT_STALE};
use jeff_project::{GraphProjection, ProjectRecord, Snapshot};
use serde_json::json;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;

impl Server {
    pub(super) fn start_snapshot(&mut self, project_id: &str) {
        if self.active.contains_key(project_id)
            || self
                .deferred_snapshots
                .iter()
                .any(|queued| queued == project_id)
            || !self.dirty.start_now(project_id)
        {
            return;
        }
        self.defer_snapshot(project_id.to_owned());
        self.launch_deferred_snapshots();
    }

    pub(super) fn run_due_snapshots(&mut self) {
        for project_id in self.dirty.due(self.now()) {
            if self.active.contains_key(&project_id)
                || self
                    .deferred_snapshots
                    .iter()
                    .any(|queued| queued == &project_id)
            {
                continue;
            }
            self.defer_snapshot(project_id);
        }
        self.launch_deferred_snapshots();
    }

    pub(super) fn launch_deferred_snapshots(&mut self) {
        while self.active.len() < self.limits.active_snapshots {
            let Some(project_id) = self.deferred_snapshots.pop_front() else {
                break;
            };
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

    fn defer_snapshot(&mut self, project_id: String) {
        if self.active.len() >= self.limits.active_snapshots {
            super::signal_test_fifo("_JEFFD_TEST_ACTIVE_SNAPSHOTS_SATURATED");
        }
        self.deferred_snapshots.push_back(project_id);
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
        if injected_thread_failure(&run.record.id, "supervisor") {
            self.finish_snapshot(
                run,
                Err(SnapshotFailure::Launch(
                    "snapshot supervisor thread: injected launch failure".to_owned(),
                )),
            );
            return;
        }
        let sender = self.messages_tx.clone();
        let timeout = self.config.snapshot_timeout();
        let output_limit = self.limits.snapshot_bytes;
        let worker_run = run.clone();
        if let Err(error) = thread::Builder::new()
            .name("jeffd-snapshot-supervisor".to_owned())
            .spawn(move || {
                let result =
                    run_snapshot_with_cancel(&worker_run.record, timeout, cancelled, output_limit);
                let _ = sender.send(OwnerMessage::SnapshotDone {
                    run: worker_run,
                    result,
                });
            })
        {
            self.finish_snapshot(
                run,
                Err(SnapshotFailure::Launch(format!(
                    "snapshot supervisor thread: {error}"
                ))),
            );
        }
    }

    pub(super) fn finish_snapshot(
        &mut self,
        run: SnapshotRun,
        result: Result<jeff_project::Snapshot, SnapshotFailure>,
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
        super::signal_test_fifo("_JEFFD_TEST_SNAPSHOT_DONE");
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
                self.answer_waiters(&project_id, false);
            }
            return;
        }
        let retained_limit = self.limits.snapshot_bytes.min(self.limits.frame_bytes);
        let old_retained_bytes = self
            .caches
            .get(&project_id)
            .map_or(0, ProjectCache::retained_bytes);
        let result = result.and_then(|snapshot| {
            if !retained_snapshot_fits(&run.record, &snapshot, retained_limit) {
                return Err(SnapshotFailure::OutputTooLarge(format!(
                    "retained snapshot exceeds {retained_limit} bytes"
                )));
            }
            let retained_bytes =
                retained_projection_bytes(&run.record, &snapshot).ok_or_else(|| {
                    SnapshotFailure::Output("cannot measure retained snapshot".to_owned())
                })?;
            let total_bytes = self
                .retained_cache_bytes
                .checked_sub(old_retained_bytes)
                .and_then(|bytes| bytes.checked_add(retained_bytes))
                .filter(|bytes| *bytes <= self.limits.cache_bytes)
                .ok_or_else(|| {
                    SnapshotFailure::CacheFull(format!(
                        "aggregate retained cache exceeds {} bytes",
                        self.limits.cache_bytes
                    ))
                })?;
            Ok((snapshot, retained_bytes, total_bytes))
        });

        let had_good = self
            .caches
            .get(&project_id)
            .and_then(ProjectCache::projection)
            .is_some();
        let output_too_large = matches!(&result, Err(SnapshotFailure::OutputTooLarge(_)));
        if let Ok((_, _, total_bytes)) = &result {
            self.retained_cache_bytes = *total_bytes;
        }
        if let Some(cache) = self.caches.get_mut(&project_id) {
            match &result {
                Ok((snapshot, retained_bytes, _)) => {
                    cache.replace_accounted(snapshot.clone(), *retained_bytes)
                }
                Err(error) => cache.fail(error.to_string(), error.exit_code()),
            }
        }
        self.answer_waiters(&project_id, output_too_large);
        match result {
            Ok((_, _, _)) if had_good => {
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
            Ok((_, _, _)) => {}
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

    fn answer_waiters(&mut self, project_id: &str, output_too_large: bool) {
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
            let Waiter {
                connection,
                request_id,
                kind,
                permit,
            } = waiter;
            if !self.connections.contains_key(&connection) {
                continue;
            }
            if let Some(projection) = &projection {
                match kind {
                    WaitKind::Get => {
                        self.send_waiter_result(connection, &request_id, json!(projection), permit);
                    }
                    WaitKind::Subscribe(subscription_id) => {
                        if self.send_waiter_result(
                            connection,
                            &request_id,
                            json!({
                                "subscriptionId": subscription_id,
                                "snapshot": projection
                            }),
                            permit,
                        ) {
                            self.mark_subscription_returned(&subscription_id);
                        } else {
                            let _ = self.remove_subscription(&subscription_id);
                        }
                    }
                }
            } else {
                if let WaitKind::Subscribe(subscription_id) = &kind {
                    let _ = self.remove_subscription(subscription_id);
                }
                if output_too_large {
                    self.close_connection(connection);
                    continue;
                }
                let message = failure
                    .as_ref()
                    .map_or("snapshot unavailable", |failure| failure.message.as_str());
                self.send_shutdown_error(connection, &request_id, "unavailable", message, permit);
            }
        }
    }
}

fn retained_snapshot_fits(record: &ProjectRecord, snapshot: &Snapshot, limit: usize) -> bool {
    let projection = GraphProjection {
        project_id: record.id.clone(),
        path: record.path.clone(),
        snapshot: snapshot.clone(),
        degraded: vec![SNAPSHOT_STALE.to_owned()],
    };
    let fits = |frame| super::client::serialize_bounded(&frame, limit).is_some();
    let response_limit = limit
        .checked_sub(Limits::MAX_SERIALIZED_RESPONSE_ID_BYTES)
        .unwrap_or(limit);
    let response_fits = |frame| super::client::serialize_bounded(&frame, response_limit).is_some();
    response_fits(json!({
        "v": PROTOCOL_VERSION,
        "kind": "res",
        "id": "",
        "ok": true,
        "result": &projection
    })) && response_fits(json!({
        "v": PROTOCOL_VERSION,
        "kind": "res",
        "id": "",
        "ok": true,
        "result": {
            "subscriptionId": format!("s-{}-{}", usize::MAX, u64::MAX),
            "snapshot": &projection
        }
    })) && fits(json!({
        "v": PROTOCOL_VERSION,
        "kind": "event",
        "name": "snapshot.replaced",
        "payload": {"projectId": record.id, "snapshot": &projection}
    }))
}
