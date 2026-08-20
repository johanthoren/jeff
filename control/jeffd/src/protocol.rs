use crate::server::Limits;
use crate::snapshot::SnapshotFailure;
use jeff_project::{ProjectRecord, Snapshot};
use serde_json::Value;
use std::io::{ErrorKind, Read, Write};
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

pub type ConnectionId = u64;
const READ_CHUNK_BYTES: usize = 8192;
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotRun {
    pub record: ProjectRecord,
    pub generation: u64,
}

pub enum OwnerMessage {
    Request {
        connection: ConnectionId,
        frame: Vec<u8>,
        pending: Arc<AtomicUsize>,
        ingress: IngressPermit,
    },
    FrameTooLarge {
        connection: ConnectionId,
        request_id: Option<String>,
    },
    SnapshotDone {
        run: SnapshotRun,
        result: Result<Snapshot, SnapshotFailure>,
    },
}

pub(crate) struct IngressPermit {
    connection_bytes: Arc<AtomicUsize>,
    global_bytes: Arc<AtomicUsize>,
    bytes: usize,
}

impl IngressPermit {
    fn new(connection_bytes: Arc<AtomicUsize>, global_bytes: Arc<AtomicUsize>) -> Self {
        Self {
            connection_bytes,
            global_bytes,
            bytes: 0,
        }
    }

    fn try_grow(&mut self, count: usize, limits: Limits) -> bool {
        if !try_reserve(
            &self.connection_bytes,
            count,
            limits.connection_ingress_bytes,
        ) {
            return false;
        }
        if !try_reserve(&self.global_bytes, count, limits.global_ingress_bytes) {
            self.connection_bytes.fetch_sub(count, Ordering::AcqRel);
            return false;
        }
        self.bytes += count;
        true
    }
}

impl Drop for IngressPermit {
    fn drop(&mut self) {
        self.connection_bytes
            .fetch_sub(self.bytes, Ordering::AcqRel);
        self.global_bytes.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}
pub(crate) struct CapacityPermit {
    primary: Arc<AtomicUsize>,
    secondary: Option<Arc<AtomicUsize>>,
}

impl CapacityPermit {
    pub(crate) fn try_acquire(counter: Arc<AtomicUsize>, limit: usize) -> Option<Self> {
        try_reserve(&counter, 1, limit).then_some(Self {
            primary: counter,
            secondary: None,
        })
    }

    pub(crate) fn try_acquire_pair(
        primary: Arc<AtomicUsize>,
        primary_limit: usize,
        secondary: Arc<AtomicUsize>,
        secondary_limit: usize,
    ) -> Option<Self> {
        let mut permit = Self::try_acquire(primary, primary_limit)?;
        if !try_reserve(&secondary, 1, secondary_limit) {
            return None;
        }
        permit.secondary = Some(secondary);
        Some(permit)
    }
}

impl Drop for CapacityPermit {
    fn drop(&mut self) {
        self.primary.fetch_sub(1, Ordering::AcqRel);
        if let Some(secondary) = &self.secondary {
            secondary.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

pub struct OutboundFrame {
    pub bytes: Vec<u8>,
    connection_bytes: Arc<AtomicUsize>,
    global_bytes: Arc<AtomicUsize>,
    writer_slot: Option<CapacityPermit>,
}

impl Drop for OutboundFrame {
    fn drop(&mut self) {
        drop(self.writer_slot.take());
        self.connection_bytes
            .fetch_sub(self.bytes.len(), Ordering::AcqRel);
        self.global_bytes
            .fetch_sub(self.bytes.len(), Ordering::AcqRel);
    }
}

impl OutboundFrame {
    pub(crate) fn reserve_writer_slot(
        mut self,
        writer_frames: Arc<AtomicUsize>,
        limit: usize,
    ) -> Option<Self> {
        self.writer_slot = Some(CapacityPermit::try_acquire(writer_frames, limit)?);
        Some(self)
    }

    fn begin_write(&mut self) {
        drop(self.writer_slot.take());
    }
}

enum TerminalBytes {
    Required(Vec<u8>),
    Accounted(OutboundFrame),
}

pub struct TerminalFrame {
    bytes: TerminalBytes,
    _capacity: CapacityPermit,
    required_deliveries: Option<Arc<AtomicUsize>>,
}

impl TerminalFrame {
    pub(crate) fn new(
        bytes: Vec<u8>,
        capacity: CapacityPermit,
        required_deliveries: Arc<AtomicUsize>,
    ) -> Self {
        Self::with_bytes(
            TerminalBytes::Required(bytes),
            capacity,
            required_deliveries,
        )
    }

    pub(crate) fn from_outbound(frame: OutboundFrame, capacity: CapacityPermit) -> Self {
        Self {
            bytes: TerminalBytes::Accounted(frame),
            _capacity: capacity,
            required_deliveries: None,
        }
    }

    fn with_bytes(
        bytes: TerminalBytes,
        capacity: CapacityPermit,
        required_deliveries: Arc<AtomicUsize>,
    ) -> Self {
        required_deliveries.fetch_add(1, Ordering::AcqRel);
        Self {
            bytes,
            _capacity: capacity,
            required_deliveries: Some(required_deliveries),
        }
    }

    fn bytes(&self) -> &[u8] {
        match &self.bytes {
            TerminalBytes::Required(bytes) => bytes,
            TerminalBytes::Accounted(frame) => &frame.bytes,
        }
    }
}

impl Drop for TerminalFrame {
    fn drop(&mut self) {
        if let Some(required_deliveries) = &self.required_deliveries {
            required_deliveries.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

pub enum WriterMessage {
    Frame(OutboundFrame),
    Terminal(TerminalFrame),
    Close(mpsc::SyncSender<()>),
}

pub struct ConnectionParts {
    pub writer: SyncSender<WriterMessage>,
    pub control_stream: UnixStream,
    pub reader_handle: JoinHandle<()>,
    pub writer_handle: JoinHandle<()>,
    pub writer_bytes: Arc<AtomicUsize>,
    pub writer_frames: Arc<AtomicUsize>,
    pub required_deliveries: Arc<AtomicUsize>,
    pub closed: Arc<AtomicBool>,
    pub pending: Arc<AtomicUsize>,
    pub reader_done: Arc<AtomicBool>,
}

struct ReaderOwnership {
    pending: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    connection_bytes: Arc<AtomicUsize>,
    global_bytes: Arc<AtomicUsize>,
}

pub fn spawn_connection(
    id: ConnectionId,
    stream: UnixStream,
    limits: Limits,
    owner: SyncSender<OwnerMessage>,
    global_ingress_bytes: Arc<AtomicUsize>,
) -> std::io::Result<ConnectionParts> {
    stream.set_nonblocking(true)?;
    let control_stream = stream.try_clone()?;
    let writer_stream = stream.try_clone()?;
    let pending = Arc::new(AtomicUsize::new(0));
    let writer_bytes = Arc::new(AtomicUsize::new(0));
    let writer_frames = Arc::new(AtomicUsize::new(0));
    let required_deliveries = Arc::new(AtomicUsize::new(0));
    let closed = Arc::new(AtomicBool::new(false));
    let reader_done = Arc::new(AtomicBool::new(false));
    let reader_ownership = ReaderOwnership {
        pending: pending.clone(),
        closed: closed.clone(),
        done: reader_done.clone(),
        connection_bytes: Arc::new(AtomicUsize::new(0)),
        global_bytes: global_ingress_bytes,
    };
    let writer_capacity = limits
        .egress_frames
        .saturating_add(limits.cold_waiters)
        .saturating_add(limits.connection_subscriptions)
        .saturating_add(1);
    let (writer, writer_rx) = mpsc::sync_channel(writer_capacity);
    let writer_closed = closed.clone();
    let writer_handle =
        thread::spawn(move || write_frames(writer_stream, writer_rx, writer_closed));
    let reader_handle =
        thread::spawn(move || read_frames(id, stream, limits, owner, reader_ownership));
    Ok(ConnectionParts {
        writer,
        control_stream,
        reader_handle,
        writer_handle,
        writer_bytes,
        writer_frames,
        required_deliveries,
        closed,
        pending,
        reader_done,
    })
}

fn read_frames(
    id: ConnectionId,
    mut stream: UnixStream,
    limits: Limits,
    owner: SyncSender<OwnerMessage>,
    ownership: ReaderOwnership,
) {
    let ReaderOwnership {
        pending,
        closed,
        done: reader_done,
        connection_bytes,
        global_bytes,
    } = ownership;
    let mut frame = Vec::new();
    let mut ingress = IngressPermit::new(connection_bytes.clone(), global_bytes.clone());
    let mut chunk = [0_u8; READ_CHUNK_BYTES];
    'read: loop {
        let count = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if !wait_for_socket(&stream, &closed, libc::POLLIN | libc::POLLHUP) {
                    break;
                }
                continue;
            }
            Err(_) => break,
        };
        let mut offset = 0;
        while offset < count {
            let rest = &chunk[offset..count];
            if let Some(newline) = rest.iter().position(|byte| *byte == b'\n') {
                if frame.len() + newline > limits.frame_bytes {
                    let retained = limits.frame_bytes.saturating_sub(frame.len());
                    if !ingress.try_grow(retained, limits) {
                        crate::server::signal_test_fifo("_JEFFD_TEST_INGRESS_BYTES_FULL");
                        break 'read;
                    }
                    frame.extend_from_slice(&rest[..retained]);
                    report_oversized(id, &frame, &owner, &closed);
                    return;
                }
                if !ingress.try_grow(newline, limits) {
                    crate::server::signal_test_fifo("_JEFFD_TEST_INGRESS_BYTES_FULL");
                    break 'read;
                }
                frame.extend_from_slice(&rest[..newline]);
                let request_frame = std::mem::take(&mut frame);
                let request_ingress = std::mem::replace(
                    &mut ingress,
                    IngressPermit::new(connection_bytes.clone(), global_bytes.clone()),
                );
                if !try_reserve(&pending, 1, limits.in_flight) {
                    break 'read;
                }
                match owner.try_send(OwnerMessage::Request {
                    connection: id,
                    frame: request_frame,
                    pending: pending.clone(),
                    ingress: request_ingress,
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
                    let retained = limits.frame_bytes.saturating_sub(frame.len());
                    if !ingress.try_grow(retained, limits) {
                        crate::server::signal_test_fifo("_JEFFD_TEST_INGRESS_BYTES_FULL");
                        break 'read;
                    }
                    frame.extend_from_slice(&rest[..retained]);
                    report_oversized(id, &frame, &owner, &closed);
                    return;
                }
                if !ingress.try_grow(rest.len(), limits) {
                    crate::server::signal_test_fifo("_JEFFD_TEST_INGRESS_BYTES_FULL");
                    break 'read;
                }
                frame.extend_from_slice(rest);
                break;
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    reader_done.store(true, Ordering::Release);
}

fn wait_for_socket(stream: &UnixStream, closed: &AtomicBool, events: libc::c_short) -> bool {
    let mut descriptor = libc::pollfd {
        fd: stream.as_raw_fd(),
        events,
        revents: 0,
    };
    loop {
        if closed.load(Ordering::Acquire) {
            return false;
        }
        descriptor.revents = 0;
        let ready = unsafe { libc::poll(&mut descriptor, 1, 5) };
        if ready > 0 {
            return true;
        }
        if ready == 0 {
            continue;
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != ErrorKind::Interrupted {
            return false;
        }
    }
}

pub(crate) fn decode_request_frame(frame: Vec<u8>) -> serde_json::Result<Value> {
    let decoded = serde_json::from_slice(&frame);
    let released_large_buffer = frame.capacity() > READ_CHUNK_BYTES;
    drop(frame);
    if released_large_buffer {
        crate::server::signal_test_fifo("_JEFFD_TEST_FRAME_BUFFER_RELEASED");
    }
    decoded
}

fn report_oversized(
    id: ConnectionId,
    frame: &[u8],
    owner: &SyncSender<OwnerMessage>,
    closed: &AtomicBool,
) {
    crate::server::signal_test_fifo("_JEFFD_TEST_OVERSIZED_READY");
    let request_id = (top_level_string_field(frame, b"kind", 16).as_deref() == Some("req"))
        .then(|| top_level_string_field(frame, b"id", Limits::RESPONSE_ID_BYTES))
        .flatten();
    let mut oversized = OwnerMessage::FrameTooLarge {
        connection: id,
        request_id,
    };
    while !closed.load(Ordering::Acquire) {
        match owner.try_send(oversized) {
            Ok(()) | Err(TrySendError::Disconnected(_)) => break,
            Err(TrySendError::Full(message)) => {
                oversized = message;
                thread::yield_now();
            }
        }
    }
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
        writer_slot: None,
    })
}

fn try_reserve(counter: &AtomicUsize, count: usize, limit: usize) -> bool {
    counter
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current.checked_add(count).filter(|next| *next <= limit)
        })
        .is_ok()
}

fn write_frames(
    mut stream: UnixStream,
    messages: Receiver<WriterMessage>,
    closed: Arc<AtomicBool>,
) {
    for message in messages {
        let wrote = match message {
            WriterMessage::Frame(mut frame) => {
                frame.begin_write();
                write_all_interruptible(&mut stream, &frame.bytes, &closed)
                    && write_all_interruptible(&mut stream, b"\n", &closed)
                    && stream.flush().is_ok()
            }
            WriterMessage::Terminal(frame) => {
                write_all_interruptible(&mut stream, frame.bytes(), &closed)
                    && write_all_interruptible(&mut stream, b"\n", &closed)
                    && stream.flush().is_ok()
            }
            WriterMessage::Close(done) => {
                let _ = done.send(());
                break;
            }
        };
        if !wrote {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}

fn write_all_interruptible(stream: &mut UnixStream, mut bytes: &[u8], closed: &AtomicBool) -> bool {
    while !bytes.is_empty() {
        match stream.write(bytes) {
            Ok(0) => return false,
            Ok(written) => bytes = &bytes[written..],
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(error)
                if error.kind() == ErrorKind::WouldBlock || error.kind() == ErrorKind::TimedOut =>
            {
                if !wait_for_socket(stream, closed, libc::POLLOUT | libc::POLLHUP) {
                    return false;
                }
            }
            Err(_) => return false,
        }
    }
    true
}
