use super::Server;
use crate::registry::load_registry;
use crate::state::ProjectCache;
use jeff_project::ProjectRecord;
use notify::{RecursiveMode, Watcher};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::time::Duration;
const WATCH_RETRY_INTERVAL: Duration = Duration::from_millis(25);
pub(super) const REGISTRY_POLL_INTERVAL: Duration = Duration::from_millis(500);

impl Server {
    pub(super) fn handle_notify(&mut self, event: notify::Result<notify::Event>) {
        let Ok(event) = event else {
            eprintln!("jeffd: filesystem watcher error");
            return;
        };
        for path in event.paths {
            if path == self.config.registry {
                self.registry_due = Some(self.now() + Duration::from_millis(25));
                continue;
            }
            for project in self.projects.iter().filter(|project| project.enabled) {
                if path.starts_with(project.path.join(".jeff")) {
                    self.dirty.mark_dirty(&project.id, self.now());
                    break;
                }
            }
        }
    }

    pub(super) fn recover_notify_overflow(&mut self) {
        if !self.notify_overflow.swap(false, Ordering::AcqRel) {
            return;
        }
        if let Ok(projects) = load_registry(&self.config.registry) {
            if projects != self.projects {
                self.replace_registry(projects);
            }
        }
        let now = self.now();
        let enabled: Vec<_> = self
            .projects
            .iter()
            .filter(|project| project.enabled)
            .map(|project| project.id.clone())
            .collect();
        for project_id in enabled {
            self.dirty.mark_dirty(&project_id, now);
        }
        super::signal_test_fifo("_JEFFD_TEST_NOTIFY_OVERFLOW_RECOVERED");
    }

    pub(super) fn reload_registry_if_due(&mut self) {
        let Some(deadline) = self.registry_due else {
            return;
        };
        if self.now() < deadline {
            return;
        }
        self.registry_due = None;
        match load_registry(&self.config.registry) {
            Ok(projects) => self.replace_registry(projects),
            Err(error) => eprintln!("jeffd: registry reload ignored: {error}"),
        }
    }
    pub(super) fn poll_registry(&mut self) {
        let now = self.now();
        if now < self.registry_poll_due {
            return;
        }
        self.registry_poll_due = now + REGISTRY_POLL_INTERVAL;
        if let Ok(projects) = load_registry(&self.config.registry) {
            if projects != self.projects {
                self.replace_registry(projects);
            }
        }
    }

    pub(super) fn retry_pending_watches(&mut self) {
        if self.pending_watches.is_empty() {
            self.watch_retry_due = None;
            return;
        }
        let now = self.now();
        if self.watch_retry_due.is_some_and(|deadline| now < deadline) {
            return;
        }
        let pending: Vec<_> = self
            .projects
            .iter()
            .filter(|project| project.enabled && self.pending_watches.contains(&project.id))
            .cloned()
            .collect();
        let mut installed = Vec::new();
        for project in pending {
            if self
                .watcher
                .watch(&project.path.join(".jeff"), RecursiveMode::Recursive)
                .is_ok()
            {
                self.pending_watches.remove(&project.id);
                installed.push(project);
            }
        }
        self.watch_retry_due =
            (!self.pending_watches.is_empty()).then_some(now + WATCH_RETRY_INTERVAL);
        for project in installed {
            self.broadcast_event(
                "project.updated",
                json!({
                    "projectId": project.id,
                    "path": project.path,
                    "enabled": true
                }),
            );
        }
    }

    fn replace_registry(&mut self, projects: Vec<ProjectRecord>) {
        let old: HashMap<_, _> = self
            .projects
            .iter()
            .map(|project| (project.id.clone(), project.clone()))
            .collect();
        let new: HashMap<_, _> = projects
            .iter()
            .map(|project| (project.id.clone(), project.clone()))
            .collect();

        let mut watch_retried = HashSet::new();
        let mut restart_deferred = Vec::new();
        for previous in old.values() {
            let changed = new.get(&previous.id);
            if previous.enabled
                && changed.is_none_or(|next| !next.enabled || next.path != previous.path)
            {
                let _ = self.watcher.unwatch(&previous.path.join(".jeff"));
                self.pending_watches.remove(&previous.id);
            }
        }
        for next in new.values() {
            let previous = old.get(&next.id);
            let was_pending = self.pending_watches.contains(&next.id);
            let changed =
                previous.is_none_or(|previous| !previous.enabled || previous.path != next.path);
            if next.enabled && (changed || was_pending) {
                match self
                    .watcher
                    .watch(&next.path.join(".jeff"), RecursiveMode::Recursive)
                {
                    Ok(()) => {
                        self.pending_watches.remove(&next.id);
                        if was_pending {
                            watch_retried.insert(next.id.clone());
                        }
                    }
                    Err(error) => {
                        self.pending_watches.insert(next.id.clone());
                        eprintln!("jeffd: cannot watch project {}: {error}", next.id);
                    }
                }
            } else if !next.enabled {
                self.pending_watches.remove(&next.id);
            }
        }

        let ids: HashSet<_> = old
            .keys()
            .chain(new.keys())
            .chain(watch_retried.iter())
            .cloned()
            .collect();
        for id in ids {
            let previous = old.get(&id);
            let next = new.get(&id);
            if previous != next {
                if next.is_some() {
                    self.registry_generations
                        .insert(id.clone(), self.next_registry_generation);
                    self.next_registry_generation += 1;
                } else {
                    self.registry_generations.remove(&id);
                }
            }
            if previous == next && !watch_retried.contains(&id) {
                continue;
            }
            let preserve = matches!((previous, next), (Some(a), Some(b)) if a.path == b.path);
            if preserve {
                if let (Some(cache), Some(record)) = (self.caches.get_mut(&id), next) {
                    cache.update_record(record.clone());
                }
            } else if let Some(record) = next {
                if let Some(cache) = self
                    .caches
                    .insert(id.clone(), ProjectCache::new(record.clone()))
                {
                    self.retained_cache_bytes = self
                        .retained_cache_bytes
                        .saturating_sub(cache.retained_bytes());
                }
            } else if let Some(cache) = self.caches.remove(&id) {
                self.retained_cache_bytes = self
                    .retained_cache_bytes
                    .saturating_sub(cache.retained_bytes());
            }
            let ends_subscription = match (previous, next) {
                (Some(a), Some(b)) => a.path != b.path || (a.enabled && !b.enabled),
                (Some(_), None) => true,
                _ => false,
            };
            if ends_subscription {
                let restart_gets = matches!(
                    (previous, next),
                    (Some(a), Some(b)) if a.path != b.path && b.enabled
                );
                let was_deferred = self
                    .deferred_snapshots
                    .iter()
                    .any(|project_id| project_id == &id);
                self.deferred_snapshots
                    .retain(|project_id| project_id != &id);
                self.end_project_subscriptions(&id, "project_removed", restart_gets);
                if let Some(active) = self.active.get(&id) {
                    active.cancelled.store(true, Ordering::Release);
                }
                self.dirty.remove(&id);
                if restart_gets
                    && was_deferred
                    && self
                        .waiters
                        .get(&id)
                        .is_some_and(|waiters| !waiters.is_empty())
                {
                    restart_deferred.push(id.clone());
                }
            }
            let event_record = next.or(previous).expect("changed registry id exists");
            self.broadcast_event(
                "project.updated",
                json!({
                    "projectId": id,
                    "path": event_record.path,
                    "enabled": next.is_some_and(|record| record.enabled)
                }),
            );
        }
        self.projects = projects;
        for project_id in restart_deferred {
            self.start_snapshot(&project_id);
        }
        self.watch_retry_due =
            (!self.pending_watches.is_empty()).then_some(self.now() + WATCH_RETRY_INTERVAL);
    }
}
