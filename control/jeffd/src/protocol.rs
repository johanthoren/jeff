use crate::server::Limits;
use crate::snapshot::SnapshotFailure;
use jeff_project::{ProjectRecord, Snapshot};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

pub type ConnectionId = u64;
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotRun {
    pub record: ProjectRecord,
    pub generation: u64,
}

pub enum OwnerMessage {
    Request {
        connection: ConnectionId,
        frame: Value,
        pending: Arc<AtomicUsize>,
    },
    FrameTooLarge {
        connection: ConnectionId,
        request_id: Option<String>,
    },
    Disconnected(ConnectionId),
    SnapshotDone {
        run: SnapshotRun,
        result: Result<Snapshot, SnapshotFailure>,
    },
    Notify(notify::Result<notify::Event>),
}

pub struct OutboundFrame {
    pub bytes: Vec<u8>,
    connection_bytes: Arc<AtomicUsize>,
    global_bytes: Arc<AtomicUsize>,
}

impl Drop for OutboundFrame {
    fn drop(&mut self) {
        self.connection_bytes
            .fetch_sub(self.bytes.len(), Ordering::AcqRel);
        self.global_bytes
            .fetch_sub(self.bytes.len(), Ordering::AcqRel);
    }
}

pub enum WriterMessage {
    Frame(OutboundFrame),
    Close(mpsc::SyncSender<()>),
}

pub struct ConnectionParts {
    pub writer: SyncSender<WriterMessage>,
    pub control_stream: UnixStream,
    pub reader_handle: JoinHandle<()>,
    pub writer_handle: JoinHandle<()>,
    pub writer_bytes: Arc<AtomicUsize>,
    pub closed: Arc<AtomicBool>,
}

pub fn spawn_connection(
    id: ConnectionId,
    stream: UnixStream,
    limits: Limits,
    owner: SyncSender<OwnerMessage>,
) -> std::io::Result<ConnectionParts> {
    let control_stream = stream.try_clone()?;
    let writer_stream = stream.try_clone()?;
    let pending = Arc::new(AtomicUsize::new(0));
    let writer_bytes = Arc::new(AtomicUsize::new(0));
    let closed = Arc::new(AtomicBool::new(false));
    let (writer, writer_rx) = mpsc::sync_channel(limits.egress_frames);
    let writer_handle = thread::spawn(move || write_frames(writer_stream, writer_rx));
    let reader_pending = pending.clone();
    let reader_closed = closed.clone();
    let reader_handle = thread::spawn(move || {
        read_frames(id, stream, limits, owner, reader_pending, reader_closed)
    });
    Ok(ConnectionParts {
        writer,
        control_stream,
        reader_handle,
        writer_handle,
        writer_bytes,
        closed,
    })
}

fn read_frames(
    id: ConnectionId,
    mut stream: UnixStream,
    limits: Limits,
    owner: SyncSender<OwnerMessage>,
    pending: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
) {
    let mut frame = Vec::new();
    let mut chunk = [0_u8; 8192];
    'read: loop {
        let count = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        let mut offset = 0;
        while offset < count {
            let rest = &chunk[offset..count];
            if let Some(newline) = rest.iter().position(|byte| *byte == b'\n') {
                if frame.len() + newline > limits.frame_bytes {
                    frame
                        .extend_from_slice(&rest[..limits.frame_bytes.saturating_sub(frame.len())]);
                    report_oversized(id, &frame, &owner);
                    return;
                }
                frame.extend_from_slice(&rest[..newline]);
                let decoded = serde_json::from_slice::<Value>(&frame);
                frame.clear();
                let Ok(value) = decoded else {
                    break 'read;
                };
                if value
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|request_id| request_id.len() > Limits::RESPONSE_ID_BYTES)
                    || !try_reserve(&pending, 1, limits.in_flight)
                {
                    break 'read;
                }
                match owner.try_send(OwnerMessage::Request {
                    connection: id,
                    frame: value,
                    pending: pending.clone(),
                }) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                        pending.fetch_sub(1, Ordering::AcqRel);
                        break 'read;
                    }
                }
                offset += newline + 1;
            } else {
                if frame.len() + rest.len() > limits.frame_bytes {
                    frame
                        .extend_from_slice(&rest[..limits.frame_bytes.saturating_sub(frame.len())]);
                    report_oversized(id, &frame, &owner);
                    return;
                }
                frame.extend_from_slice(rest);
                break;
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    if !closed.load(Ordering::Acquire) {
        let _ = owner.send(OwnerMessage::Disconnected(id));
    }
}

fn report_oversized(id: ConnectionId, frame: &[u8], owner: &SyncSender<OwnerMessage>) {
    let request_id = (top_level_string_field(frame, b"kind", 16).as_deref() == Some("req"))
        .then(|| top_level_string_field(frame, b"id", Limits::RESPONSE_ID_BYTES))
        .flatten();
    let _ = owner.send(OwnerMessage::FrameTooLarge {
        connection: id,
        request_id,
    });
}

fn top_level_string_field(bytes: &[u8], wanted: &[u8], limit: usize) -> Option<String> {
    let mut object_depth = 0_usize;
    let mut array_depth = 0_usize;
    let mut index = 0;
    if bytes
        .iter()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
        != Some(b'{')
    {
        return None;
    }
    while index < bytes.len() {
        match bytes[index] {
            b'{' => object_depth += 1,
            b'}' => object_depth = object_depth.saturating_sub(1),
            b'[' => array_depth += 1,
            b']' => array_depth = array_depth.saturating_sub(1),
            b'"' => {
                let end = string_end(bytes, index)?;
                let previous = bytes[..index]
                    .iter()
                    .rfind(|byte| !byte.is_ascii_whitespace())
                    .copied();
                if object_depth == 1
                    && array_depth == 0
                    && matches!(previous, Some(b'{' | b','))
                    && &bytes[index + 1..end - 1] == wanted
                {
                    let colon = bytes[end..]
                        .iter()
                        .position(|byte| !byte.is_ascii_whitespace())
                        .map(|offset| end + offset)?;
                    if bytes[colon] != b':' {
                        return None;
                    }
                    let value = bytes[colon + 1..]
                        .iter()
                        .position(|byte| !byte.is_ascii_whitespace())
                        .map(|offset| colon + 1 + offset)?;
                    let value_end = string_end(bytes, value)?;
                    if value_end.saturating_sub(value + 2) > limit {
                        return None;
                    }
                    return serde_json::from_slice(&bytes[value..value_end]).ok();
                }
                index = end;
                continue;
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn string_end(bytes: &[u8], start: usize) -> Option<usize> {
    if bytes.get(start) != Some(&b'"') {
        return None;
    }
    let mut escaped = false;
    for (offset, byte) in bytes[start + 1..].iter().enumerate() {
        if escaped {
            escaped = false;
        } else if *byte == b'\\' {
            escaped = true;
        } else if *byte == b'"' {
            return Some(start + offset + 2);
        }
    }
    None
}

pub fn reserve_outbound(
    bytes: Vec<u8>,
    connection_bytes: Arc<AtomicUsize>,
    global_bytes: Arc<AtomicUsize>,
    limits: Limits,
) -> Option<OutboundFrame> {
    let count = bytes.len();
    if !try_reserve(&connection_bytes, count, limits.egress_bytes) {
        return None;
    }
    if !try_reserve(&global_bytes, count, limits.global_egress_bytes) {
        connection_bytes.fetch_sub(count, Ordering::AcqRel);
        return None;
    }
    Some(OutboundFrame {
        bytes,
        connection_bytes,
        global_bytes,
    })
}

fn try_reserve(counter: &AtomicUsize, count: usize, limit: usize) -> bool {
    counter
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current.checked_add(count).filter(|next| *next <= limit)
        })
        .is_ok()
}

fn write_frames(mut stream: UnixStream, messages: Receiver<WriterMessage>) {
    for message in messages {
        match message {
            WriterMessage::Frame(frame) => {
                if stream.write_all(&frame.bytes).is_err()
                    || stream.write_all(b"\n").is_err()
                    || stream.flush().is_err()
                {
                    break;
                }
            }
            WriterMessage::Close(closed) => {
                let _ = closed.send(());
                break;
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}
