use crate::snapshot::SnapshotFailure;
use jeff_project::Snapshot;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

pub type ConnectionId = u64;

pub enum OwnerMessage {
    Request {
        connection: ConnectionId,
        frame: Value,
    },
    Disconnected(ConnectionId),
    SnapshotDone {
        project_id: String,
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
    'connection: loop {
        let count = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        let mut offset = 0;
        while offset < count {
            let rest = &chunk[offset..count];
            if let Some(newline) = rest.iter().position(|byte| *byte == b'\n') {
                if frame.len() + newline > limit {
                    break 'connection;
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
                    break 'connection;
                }
                offset += newline + 1;
            } else {
                if frame.len() + rest.len() > limit {
                    break 'connection;
                }
                frame.extend_from_slice(rest);
                break;
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    let _ = owner.send(OwnerMessage::Disconnected(id));
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
