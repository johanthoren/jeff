use super::{Server, WaitKind};
use crate::config::PROTOCOL_VERSION;
use crate::protocol::{ConnectionId, WriterMessage};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::net::Shutdown;
use std::sync::mpsc;
use std::time::Duration;

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
        let subscriptions: HashSet<_> = self
            .subscriptions
            .iter()
            .filter(|(_, subscription)| subscription.project_id == project_id)
            .map(|(id, _)| id.clone())
            .collect();
        for subscription_id in &subscriptions {
            if let Some(subscription) = self.subscriptions.get(subscription_id) {
                self.send_event(
                    subscription.connection,
                    "subscription.ended",
                    json!({"subscriptionId": subscription_id, "reason": reason}),
                );
            }
            self.remove_subscription(subscription_id);
        }
        let mut remaining = Vec::new();
        for waiter in self.waiters.remove(project_id).unwrap_or_default() {
            if matches!(
                &waiter.kind,
                WaitKind::Subscribe(subscription_id) if subscriptions.contains(subscription_id)
            ) {
                self.send_error(
                    waiter.connection,
                    &waiter.request_id,
                    "unavailable",
                    "subscription ended because the project was replaced",
                );
            } else {
                remaining.push(waiter);
            }
        }
        if !remaining.is_empty() {
            self.waiters.insert(project_id.to_owned(), remaining);
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
        let (closed_tx, closed_rx) = mpsc::sync_channel(0);
        let _ = client.writer.send(WriterMessage::Close(closed_tx));
        let _ = closed_rx.recv_timeout(Duration::from_millis(100));
        let _ = client.control_stream.shutdown(Shutdown::Both);
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
        let _ = client.control_stream.shutdown(Shutdown::Both);
        drop(client.writer);
        let _ = client.reader_handle.join();
        let _ = client.writer_handle.join();
    }
}
