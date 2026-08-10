use super::Server;
use crate::config::PROTOCOL_VERSION;
use crate::protocol::{ConnectionId, WriterMessage};
use serde_json::{json, Value};
use std::collections::HashSet;

impl Server {
    pub(super) fn send_project_event(&self, project_id: &str, name: &str, payload: Value) {
        let connections: HashSet<_> = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.project_id == project_id)
            .map(|subscription| subscription.connection)
            .collect();
        for connection in connections {
            self.send_event(connection, name, payload.clone());
        }
    }

    pub(super) fn broadcast_event(&self, name: &str, payload: Value) {
        for connection in self.connections.keys().copied() {
            self.send_event(connection, name, payload.clone());
        }
    }

    pub(super) fn end_project_subscriptions(&mut self, project_id: &str, reason: &str) {
        let subscriptions: Vec<_> = self
            .subscriptions
            .iter()
            .filter(|(_, subscription)| subscription.project_id == project_id)
            .map(|(id, _)| id.clone())
            .collect();
        for subscription_id in subscriptions {
            if let Some(subscription) = self.subscriptions.get(&subscription_id) {
                self.send_event(
                    subscription.connection,
                    "subscription.ended",
                    json!({"subscriptionId": subscription_id, "reason": reason}),
                );
            }
            self.remove_subscription(&subscription_id);
        }
    }

    pub(super) fn remove_subscription(&mut self, subscription_id: &str) {
        if let Some(subscription) = self.subscriptions.remove(subscription_id) {
            if let Some(connection) = self.connections.get_mut(&subscription.connection) {
                connection.subscriptions.remove(subscription_id);
            }
        }
    }

    pub(super) fn send_result(&self, connection: ConnectionId, id: &str, result: Value) {
        self.send_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "res", "id": id, "ok": true, "result": result}),
        );
    }

    pub(super) fn send_error(&self, connection: ConnectionId, id: &str, code: &str, message: &str) {
        self.send_frame(
            connection,
            json!({
                "v": PROTOCOL_VERSION,
                "kind": "res",
                "id": id,
                "ok": false,
                "error": {"code": code, "message": message}
            }),
        );
    }

    pub(super) fn send_event(&self, connection: ConnectionId, name: &str, payload: Value) {
        self.send_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "event", "name": name, "payload": payload}),
        );
    }

    pub(super) fn send_frame(&self, connection: ConnectionId, frame: Value) {
        if let Some(connection) = self.connections.get(&connection) {
            let _ = connection.writer.send(WriterMessage::Frame(frame));
        }
    }

    pub(super) fn close_connection(&mut self, connection: ConnectionId) {
        let Some(client) = self.connections.remove(&connection) else {
            return;
        };
        for subscription in &client.subscriptions {
            self.subscriptions.remove(subscription);
        }
        let _ = client.writer.send(WriterMessage::Close);
        let _ = client.writer_handle.join();
        let _ = client.reader_handle.join();
    }

    pub(super) fn drop_connection(&mut self, connection: ConnectionId) {
        let Some(client) = self.connections.remove(&connection) else {
            return;
        };
        for subscription in &client.subscriptions {
            self.subscriptions.remove(subscription);
        }
        drop(client.writer);
        let _ = client.reader_handle.join();
        let _ = client.writer_handle.join();
    }
}
