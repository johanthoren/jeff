use super::{Server, Subscription, WaitKind, Waiter};
use crate::config::{PROTOCOL_VERSION, SNAPSHOT_SCHEMA_MAX, SNAPSHOT_SCHEMA_MIN};
use crate::protocol::ConnectionId;
use crate::state::ProjectCache;
use jeff_project::{Envelope, Method};
use serde_json::{json, Value};

impl Server {
    pub(super) fn handle_request(&mut self, connection: ConnectionId, frame: Value) {
        let safe_id = frame
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let request = serde_json::from_value::<Envelope>(frame);
        let (version, id, method, params) = match request {
            Ok(Envelope::Request {
                version,
                id,
                method,
                params,
            }) => (version, id, method, params),
            _ => {
                self.send_error(
                    connection,
                    &safe_id,
                    "invalid_request",
                    "expected request envelope",
                );
                return;
            }
        };
        if version != PROTOCOL_VERSION {
            self.send_error(
                connection,
                &id,
                "unsupported_version",
                "unsupported protocol major version",
            );
            self.close_connection(connection);
            return;
        }
        if matches!(&method, Method::ServerHello | Method::ProjectList) && !params.is_object() {
            self.send_error(
                connection,
                &id,
                "invalid_params",
                "params must be an object",
            );
            return;
        }
        match method {
            Method::ServerHello => self.send_result(
                connection,
                &id,
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "serverVersion": env!("CARGO_PKG_VERSION"),
                    "snapshotSchemaMin": SNAPSHOT_SCHEMA_MIN,
                    "snapshotSchemaMax": SNAPSHOT_SCHEMA_MAX
                }),
            ),
            Method::ProjectList => self.list_projects(connection, &id),
            Method::SnapshotGet => self.snapshot_get(connection, id, &params),
            Method::SnapshotSubscribe => self.snapshot_subscribe(connection, id, &params),
            Method::SnapshotUnsubscribe => self.snapshot_unsubscribe(connection, &id, &params),
            Method::Unknown(_) => {
                self.send_error(connection, &id, "unknown_method", "unknown request method")
            }
        }
    }

    fn list_projects(&self, connection: ConnectionId, request_id: &str) {
        let projects: Vec<_> = self
            .projects
            .iter()
            .map(|project| {
                json!({
                    "id": project.id,
                    "path": project.path,
                    "name": project.name,
                    "enabled": project.enabled
                })
            })
            .collect();
        self.send_result(connection, request_id, json!({"projects": projects}));
    }

    fn snapshot_get(&mut self, connection: ConnectionId, request_id: String, params: &Value) {
        let project_id = match self.select_project(params) {
            Ok(project_id) => project_id,
            Err((code, message)) => {
                self.send_error(connection, &request_id, code, message);
                return;
            }
        };
        if let Some(projection) = self
            .caches
            .get(&project_id)
            .and_then(ProjectCache::projection)
        {
            self.send_result(connection, &request_id, json!(projection));
            return;
        }
        self.waiters
            .entry(project_id.clone())
            .or_default()
            .push(Waiter {
                connection,
                request_id,
                kind: WaitKind::Get,
            });
        self.start_snapshot(&project_id);
    }

    fn snapshot_subscribe(&mut self, connection: ConnectionId, request_id: String, params: &Value) {
        let project_id = match self.select_project(params) {
            Ok(project_id) => project_id,
            Err((code, message)) => {
                self.send_error(connection, &request_id, code, message);
                return;
            }
        };
        let subscription_id = format!("s-{}-{}", connection, self.next_subscription);
        self.next_subscription += 1;
        self.subscriptions.insert(
            subscription_id.clone(),
            Subscription {
                connection,
                project_id: project_id.clone(),
            },
        );
        if let Some(client) = self.connections.get_mut(&connection) {
            client.subscriptions.insert(subscription_id.clone());
        }
        if let Some(projection) = self
            .caches
            .get(&project_id)
            .and_then(ProjectCache::projection)
        {
            self.send_result(
                connection,
                &request_id,
                json!({"subscriptionId": subscription_id, "snapshot": projection}),
            );
            return;
        }
        self.waiters
            .entry(project_id.clone())
            .or_default()
            .push(Waiter {
                connection,
                request_id,
                kind: WaitKind::Subscribe(subscription_id),
            });
        self.start_snapshot(&project_id);
    }

    fn snapshot_unsubscribe(&mut self, connection: ConnectionId, request_id: &str, params: &Value) {
        let subscription_id = params
            .as_object()
            .and_then(|object| object.get("subscriptionId"))
            .and_then(Value::as_str);
        let Some(subscription_id) = subscription_id else {
            self.send_error(
                connection,
                request_id,
                "invalid_params",
                "subscriptionId is required",
            );
            return;
        };
        let owned = self
            .subscriptions
            .get(subscription_id)
            .is_some_and(|subscription| subscription.connection == connection);
        if !owned {
            self.send_error(
                connection,
                request_id,
                "unknown_subscription",
                "subscription is not owned by this connection",
            );
            return;
        }
        self.remove_subscription(subscription_id);
        self.send_result(connection, request_id, json!({"ok": true}));
    }

    fn select_project(&self, params: &Value) -> Result<String, (&'static str, &'static str)> {
        let object = params
            .as_object()
            .ok_or(("invalid_params", "params must be an object"))?;
        let by_id = object.get("projectId").and_then(Value::as_str);
        let by_path = object.get("path").and_then(Value::as_str);
        let project = match (by_id, by_path) {
            (Some(id), None) => self.projects.iter().find(|project| project.id == id),
            (None, Some(path)) if std::path::Path::new(path).is_absolute() => self
                .projects
                .iter()
                .find(|project| project.path == std::path::Path::new(path)),
            _ => {
                return Err((
                    "invalid_selector",
                    "select exactly one projectId or absolute path",
                ))
            }
        }
        .ok_or(("unknown_project", "project is not registered"))?;
        if !project.enabled {
            return Err(("unavailable", "project is disabled"));
        }
        Ok(project.id.clone())
    }
}
