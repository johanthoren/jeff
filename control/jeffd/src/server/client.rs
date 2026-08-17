use super::{Server, Subscription, WaitKind};
use crate::config::PROTOCOL_VERSION;
use crate::protocol::{
    reserve_outbound, CapacityPermit, ConnectionId, TerminalFrame, WriterMessage,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, Write};
use std::net::Shutdown;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, TrySendError};
use std::time::Duration;

#[derive(Clone, Copy)]
enum TerminalAccounting {
    Required,
    Egress,
}

impl Server {
    pub(super) fn send_project_event(&self, project_id: &str, name: &str, payload: Value) {
        let connections: HashSet<_> = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.returned && subscription.project_id == project_id)
            .map(|subscription| subscription.connection)
            .collect();
        for connection in connections {
            self.send_event(connection, name, payload.clone());
        }
    }

    pub(super) fn broadcast_lifecycle_event(&self, name: &str, payload: Value) {
        for connection in self.connections.keys().copied() {
            self.send_lifecycle_event(connection, name, payload.clone());
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
            if let Some(subscription) = self.remove_subscription(subscription_id) {
                if subscription.returned {
                    self.send_shutdown_event(
                        subscription.connection,
                        "subscription.ended",
                        json!({"subscriptionId": subscription_id, "reason": reason}),
                        subscription.permit,
                    );
                }
            }
        }
        for waiter in self.take_waiters(project_id) {
            match &waiter.kind {
                WaitKind::Subscribe(_) => {
                    self.send_shutdown_error(
                        waiter.connection,
                        &waiter.request_id,
                        "unavailable",
                        "subscription ended because the project was replaced",
                        waiter.permit,
                    );
                }
                WaitKind::Get => {
                    self.send_shutdown_error(
                        waiter.connection,
                        &waiter.request_id,
                        "unavailable",
                        "snapshot unavailable because the project was removed, disabled, or replaced",
                        waiter.permit,
                    );
                }
            }
        }
    }

    pub(super) fn remove_subscription(&mut self, subscription_id: &str) -> Option<Subscription> {
        let subscription = self.subscriptions.remove(subscription_id)?;
        if let Some(connection) = self.connections.get_mut(&subscription.connection) {
            connection.subscriptions.remove(subscription_id);
        }
        Some(subscription)
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
    pub(super) fn send_shutdown_error(
        &self,
        connection: ConnectionId,
        id: &str,
        code: &str,
        message: &str,
        capacity: CapacityPermit,
    ) -> bool {
        self.send_terminal_frame(
            connection,
            json!({
                "v": PROTOCOL_VERSION,
                "kind": "res",
                "id": id,
                "ok": false,
                "error": {"code": code, "message": message}
            }),
            capacity,
            TerminalAccounting::Required,
        )
    }

    pub(super) fn send_shutdown_event(
        &self,
        connection: ConnectionId,
        name: &str,
        payload: Value,
        capacity: CapacityPermit,
    ) -> bool {
        self.send_terminal_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "event", "name": name, "payload": payload}),
            capacity,
            TerminalAccounting::Required,
        )
    }

    pub(super) fn send_waiter_result(
        &self,
        connection: ConnectionId,
        id: &str,
        result: Value,
        capacity: CapacityPermit,
    ) -> bool {
        self.send_terminal_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "res", "id": id, "ok": true, "result": result}),
            capacity,
            TerminalAccounting::Egress,
        )
    }

    pub(super) fn send_event(&self, connection: ConnectionId, name: &str, payload: Value) -> bool {
        self.send_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "event", "name": name, "payload": payload}),
        )
    }

    fn send_lifecycle_event(&self, connection: ConnectionId, name: &str, payload: Value) -> bool {
        let protected = self.connection_has_required_delivery(connection);
        if protected && !self.connection_has_lifecycle_headroom(connection) {
            return false;
        }
        self.send_queued_frame(
            connection,
            json!({"v": PROTOCOL_VERSION, "kind": "event", "name": name, "payload": payload}),
            !protected,
        )
    }

    pub(super) fn send_frame(&self, connection: ConnectionId, frame: Value) -> bool {
        self.send_queued_frame(connection, frame, true)
    }

    fn send_queued_frame(
        &self,
        connection_id: ConnectionId,
        frame: Value,
        close_on_failure: bool,
    ) -> bool {
        let Some(connection) = self.connections.get(&connection_id) else {
            return false;
        };
        let Some(bytes) = serialize_bounded(&frame, self.limits.frame_bytes) else {
            if close_on_failure {
                let _ = connection.control_stream.shutdown(Shutdown::Both);
            }
            return false;
        };
        let Some(frame) = reserve_outbound(
            bytes,
            connection.writer_bytes.clone(),
            self.global_writer_bytes.clone(),
            self.limits,
        ) else {
            if close_on_failure {
                let _ = connection.control_stream.shutdown(Shutdown::Both);
            }
            return false;
        };
        let Some(frame) =
            frame.reserve_writer_slot(connection.writer_frames.clone(), self.limits.egress_frames)
        else {
            if close_on_failure {
                let _ = connection.control_stream.shutdown(Shutdown::Both);
            }
            return false;
        };
        match connection.writer.try_send(WriterMessage::Frame(frame)) {
            Ok(()) => true,
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                if close_on_failure {
                    let _ = connection.control_stream.shutdown(Shutdown::Both);
                }
                false
            }
        }
    }

    fn send_terminal_frame(
        &self,
        connection_id: ConnectionId,
        frame: Value,
        owner_capacity: CapacityPermit,
        accounting: TerminalAccounting,
    ) -> bool {
        let Some(connection) = self.connections.get(&connection_id) else {
            return false;
        };
        let Some(bytes) = serialize_bounded(&frame, self.limits.frame_bytes) else {
            let _ = connection.control_stream.shutdown(Shutdown::Both);
            return false;
        };
        let capacity = CapacityPermit::try_acquire(
            connection.writer_frames.clone(),
            self.limits.egress_frames,
        )
        .unwrap_or(owner_capacity);
        let frame = match accounting {
            TerminalAccounting::Required => {
                TerminalFrame::new(bytes, capacity, connection.required_deliveries.clone())
            }
            TerminalAccounting::Egress => {
                let Some(frame) = reserve_outbound(
                    bytes,
                    connection.writer_bytes.clone(),
                    self.global_writer_bytes.clone(),
                    self.limits,
                ) else {
                    let _ = connection.control_stream.shutdown(Shutdown::Both);
                    return false;
                };
                TerminalFrame::from_outbound(frame, capacity)
            }
        };
        match connection.writer.try_send(WriterMessage::Terminal(frame)) {
            Ok(()) => true,
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                let _ = connection.control_stream.shutdown(Shutdown::Both);
                false
            }
        }
    }

    fn connection_has_required_delivery(&self, connection_id: ConnectionId) -> bool {
        self.connections
            .get(&connection_id)
            .is_some_and(|connection| connection.required_deliveries.load(Ordering::Acquire) > 0)
            || self
                .waiters
                .values()
                .flatten()
                .any(|waiter| waiter.connection == connection_id)
    }

    fn connection_has_lifecycle_headroom(&self, connection_id: ConnectionId) -> bool {
        self.connections
            .get(&connection_id)
            .is_some_and(|connection| {
                connection
                    .writer_frames
                    .load(Ordering::Acquire)
                    .saturating_add(connection.required_deliveries.load(Ordering::Acquire))
                    < self.limits.egress_frames
            })
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
            super::signal_test_fifo("_JEFFD_TEST_CLOSE_ADMITTED");
            if client.required_deliveries.load(Ordering::Acquire) == 0 {
                let _ = closed_rx.recv_timeout(Duration::from_millis(100));
            } else {
                let _ = closed_rx.recv();
            }
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
        self.waiters.retain(|_, waiters| {
            waiters.retain(|waiter| waiter.connection != connection);
            !waiters.is_empty()
        });
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

pub(super) fn serialize_bounded(frame: &Value, limit: usize) -> Option<Vec<u8>> {
    let mut output = BoundedBuffer {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut output, frame).ok()?;
    Some(output.bytes)
}
