use super::{Server, WaitKind};
use crate::config::PROTOCOL_VERSION;
use crate::protocol::{reserve_outbound, ConnectionId, WriterMessage};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, Write};
use std::net::Shutdown;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, TrySendError};
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
        for waiter in self.take_waiters(project_id) {
            if matches!(&waiter.kind, WaitKind::Subscribe(_)) {
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
            self.waiter_count += remaining.len();
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

    pub(super) fn send_result(&self, connection: ConnectionId, id: &str, result: Value) -> bool {
        self.send_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "res", "id": id, "ok": true, "result": result}),
        )
    }

    pub(super) fn send_error(
        &self,
        connection: ConnectionId,
        id: &str,
        code: &str,
        message: &str,
    ) -> bool {
        self.send_frame(
            connection,
            json!({
                "v": PROTOCOL_VERSION,
                "kind": "res",
                "id": id,
                "ok": false,
                "error": {"code": code, "message": message}
            }),
        )
    }

    pub(super) fn send_event(&self, connection: ConnectionId, name: &str, payload: Value) -> bool {
        self.send_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "event", "name": name, "payload": payload}),
        )
    }

    pub(super) fn send_frame(&self, connection: ConnectionId, frame: Value) -> bool {
        let Some(connection) = self.connections.get(&connection) else {
            return false;
        };
        let Some(bytes) = serialize_bounded(&frame, self.limits.frame_bytes) else {
            let _ = connection.control_stream.shutdown(Shutdown::Both);
            return false;
        };
        let Some(frame) = reserve_outbound(
            bytes,
            connection.writer_bytes.clone(),
            self.global_writer_bytes.clone(),
            self.limits,
        ) else {
            let _ = connection.control_stream.shutdown(Shutdown::Both);
            return false;
        };
        match connection.writer.try_send(WriterMessage::Frame(frame)) {
            Ok(()) => true,
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                let _ = connection.control_stream.shutdown(Shutdown::Both);
                false
            }
        }
    }

    pub(super) fn close_connection(&mut self, connection: ConnectionId) {
        let Some(client) = self.connections.remove(&connection) else {
            return;
        };
        client.closed.store(true, Ordering::Release);
        for subscription in &client.subscriptions {
            self.subscriptions.remove(subscription);
        }
        self.remove_connection_waiters(connection);
        let (closed_tx, closed_rx) = mpsc::sync_channel(0);
        if client
            .writer
            .try_send(WriterMessage::Close(closed_tx))
            .is_ok()
        {
            let _ = closed_rx.recv_timeout(Duration::from_millis(100));
        }
        let _ = client.control_stream.shutdown(Shutdown::Both);
        let _ = client.writer_handle.join();
        let _ = client.reader_handle.join();
    }

    pub(super) fn drop_connection(&mut self, connection: ConnectionId) {
        let Some(client) = self.connections.remove(&connection) else {
            return;
        };
        client.closed.store(true, Ordering::Release);
        for subscription in &client.subscriptions {
            self.subscriptions.remove(subscription);
        }
        self.remove_connection_waiters(connection);
        let _ = client.control_stream.shutdown(Shutdown::Both);
        drop(client.writer);
        let _ = client.reader_handle.join();
        let _ = client.writer_handle.join();
    }

    fn remove_connection_waiters(&mut self, connection: ConnectionId) {
        let mut removed = 0;
        self.waiters.retain(|_, waiters| {
            let before = waiters.len();
            waiters.retain(|waiter| waiter.connection != connection);
            removed += before - waiters.len();
            !waiters.is_empty()
        });
        self.waiter_count = self.waiter_count.saturating_sub(removed);
    }
}

struct BoundedBuffer {
    bytes: Vec<u8>,
    limit: usize,
}

impl Write for BoundedBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.bytes.len().saturating_add(bytes.len()) > self.limit {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "frame too large",
            ));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn serialize_bounded(frame: &Value, limit: usize) -> Option<Vec<u8>> {
    let mut output = BoundedBuffer {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut output, frame).ok()?;
    Some(output.bytes)
}
