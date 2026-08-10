use crate::snapshot::SnapshotFailure;
use jeff_project::{ProjectRecord, Snapshot};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

pub type ConnectionId = u64;
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotRun {
    pub record: ProjectRecord,
}

pub enum OwnerMessage {
    Request {
        connection: ConnectionId,
        frame: Value,
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

pub enum WriterMessage {
    Frame(Value),
    Close,
}

pub struct ConnectionParts {
    pub writer: Sender<WriterMessage>,
    pub reader_handle: JoinHandle<()>,
    pub writer_handle: JoinHandle<()>,
}

pub fn spawn_connection(
    id: ConnectionId,
    stream: UnixStream,
    frame_limit: usize,
    owner: Sender<OwnerMessage>,
) -> std::io::Result<ConnectionParts> {
    let writer_stream = stream.try_clone()?;
    let (writer, writer_rx) = mpsc::channel();
    let writer_handle = thread::spawn(move || write_frames(writer_stream, writer_rx));
    let reader_handle = thread::spawn(move || read_frames(id, stream, frame_limit, owner));
    Ok(ConnectionParts {
        writer,
        reader_handle,
        writer_handle,
    })
}

fn read_frames(
    id: ConnectionId,
    mut stream: UnixStream,
    limit: usize,
    owner: Sender<OwnerMessage>,
) {
    let mut frame = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let count = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        let mut offset = 0;
        while offset < count {
            let rest = &chunk[offset..count];
            if let Some(newline) = rest.iter().position(|byte| *byte == b'\n') {
                if frame.len() + newline > limit {
                    frame.extend_from_slice(&rest[..limit.saturating_sub(frame.len())]);
                    report_oversized(id, &frame, &owner);
                    return;
                }
                frame.extend_from_slice(&rest[..newline]);
                let decoded = serde_json::from_slice::<Value>(&frame);
                frame.clear();
                if let Ok(value) = decoded {
                    if owner
                        .send(OwnerMessage::Request {
                            connection: id,
                            frame: value,
                        })
                        .is_err()
                    {
                        return;
                    }
                } else {
                    break;
                }
                offset += newline + 1;
            } else {
                if frame.len() + rest.len() > limit {
                    frame.extend_from_slice(&rest[..limit.saturating_sub(frame.len())]);
                    report_oversized(id, &frame, &owner);
                    return;
                }
                frame.extend_from_slice(rest);
                break;
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    let _ = owner.send(OwnerMessage::Disconnected(id));
}

fn report_oversized(id: ConnectionId, frame: &[u8], owner: &Sender<OwnerMessage>) {
    let request_id = (top_level_string_field(frame, b"kind").as_deref() == Some("req"))
        .then(|| top_level_string_field(frame, b"id"))
        .flatten();
    let _ = owner.send(OwnerMessage::FrameTooLarge {
        connection: id,
        request_id,
    });
}

fn top_level_string_field(bytes: &[u8], wanted: &[u8]) -> Option<String> {
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

fn write_frames(mut stream: UnixStream, messages: Receiver<WriterMessage>) {
    for message in messages {
        match message {
            WriterMessage::Frame(frame) => {
                if serde_json::to_writer(&mut stream, &frame).is_err()
                    || stream.write_all(b"\n").is_err()
                    || stream.flush().is_err()
                {
                    break;
                }
            }
            WriterMessage::Close => break,
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}
