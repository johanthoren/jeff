use super::Server;
use crate::registry::load_registry;
use crate::state::ProjectCache;
use jeff_project::ProjectRecord;
use notify::{RecursiveMode, Watcher};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::time::Duration;

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

        for previous in old.values() {
            let changed = new.get(&previous.id);
            if previous.enabled
                && changed.is_none_or(|next| !next.enabled || next.path != previous.path)
            {
                let _ = self.watcher.unwatch(&previous.path.join(".jeff"));
            }
        }
        for next in new.values() {
            let changed = old.get(&next.id);
            if next.enabled
                && changed.is_none_or(|previous| !previous.enabled || previous.path != next.path)
            {
                if let Err(error) = self
                    .watcher
                    .watch(&next.path.join(".jeff"), RecursiveMode::Recursive)
                {
                    eprintln!("jeffd: cannot watch project {}: {error}", next.id);
                }
            }
        }

        let ids: HashSet<_> = old.keys().chain(new.keys()).cloned().collect();
        for id in ids {
            let previous = old.get(&id);
            let next = new.get(&id);
            if previous == next {
                continue;
            }
            let preserve = matches!((previous, next), (Some(a), Some(b)) if a.path == b.path);
            if preserve {
                if let (Some(cache), Some(record)) = (self.caches.get_mut(&id), next) {
                    cache.update_record(record.clone());
                }
            } else if let Some(record) = next {
                self.caches
                    .insert(id.clone(), ProjectCache::new(record.clone()));
            } else {
                self.caches.remove(&id);
            }
            let ends_subscription = match (previous, next) {
                (Some(a), Some(b)) => a.path != b.path || (a.enabled && !b.enabled),
                (Some(_), None) => true,
                _ => false,
            };
            if ends_subscription {
                self.end_project_subscriptions(&id, "project_removed");
                if let Some(cancelled) = self.active.get(&id) {
                    cancelled.store(true, Ordering::Release);
                }
                self.dirty.remove(&id);
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
    }
}
