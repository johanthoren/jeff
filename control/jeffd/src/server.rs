mod client;
mod registry_watch;
mod request;
mod snapshots;

use crate::config::DaemonConfig;
use crate::lifecycle::OwnedSocket;
use crate::protocol::{
    spawn_connection, CapacityPermit, ConnectionId, ConnectionParts, OwnerMessage, SnapshotRun,
    WriterMessage,
};
use crate::registry::load_registry;
use crate::state::{DirtyTracker, ProjectCache};
use jeff_project::ProjectRecord;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Clone, Copy)]
pub(crate) struct Limits {
    connections: usize,
    pub(crate) frame_bytes: usize,
    ingress: usize,
    pub(crate) in_flight: usize,
    pub(crate) connection_ingress_bytes: usize,
    pub(crate) global_ingress_bytes: usize,
    pub(crate) cold_waiters: usize,
    pub(crate) egress_frames: usize,
    pub(crate) egress_bytes: usize,
    pub(crate) global_egress_bytes: usize,
    pub(crate) snapshot_bytes: usize,
    pub(crate) connection_subscriptions: usize,
    global_subscriptions: usize,
    accepts_per_turn: usize,
    active_snapshots: usize,
    cache_bytes: usize,
}

impl Limits {
    pub(crate) const RESPONSE_ID_BYTES: usize = 4 * 1024;
    pub(crate) const MAX_SERIALIZED_RESPONSE_ID_BYTES: usize = Self::RESPONSE_ID_BYTES * 6;

    fn new(frame_bytes: usize) -> Self {
        let mut limits = Self {
            connections: 64,
            frame_bytes,
            ingress: 256,
            in_flight: 32,
            connection_ingress_bytes: 32 * 1024 * 1024,
            global_ingress_bytes: 256 * 1024 * 1024,
            cold_waiters: 512,
            egress_frames: 64,
            egress_bytes: 32 * 1024 * 1024,
            global_egress_bytes: 256 * 1024 * 1024,
            snapshot_bytes: frame_bytes,
            connection_subscriptions: 64,
            global_subscriptions: 512,
            accepts_per_turn: 64,
            active_snapshots: 16,
            cache_bytes: 256 * 1024 * 1024,
        };
        #[cfg(debug_assertions)]
        limits.apply_test_overrides();
        limits
    }

    #[cfg(debug_assertions)]
    fn apply_test_overrides(&mut self) {
        let Ok(encoded) = std::env::var("_JEFFD_TEST_LIMITS") else {
            return;
        };
        for item in encoded.split(',') {
            let Some((name, value)) = item.split_once('=') else {
                continue;
            };
            let Ok(value) = value.parse::<usize>() else {
                continue;
            };
            if value == 0 {
                continue;
            }
            match name {
                "connections" => self.connections = value,
                "frame_bytes" => self.frame_bytes = value,
                "ingress" => self.ingress = value,
                "in_flight" => self.in_flight = value,
                "cold_waiters" => self.cold_waiters = value,
                "connection_ingress_bytes" => self.connection_ingress_bytes = value,
                "global_ingress_bytes" => self.global_ingress_bytes = value,
                "egress_frames" => self.egress_frames = value,
                "egress_bytes" => {
                    self.egress_bytes = value;
                    self.global_egress_bytes = value;
                }
                "global_egress_bytes" => self.global_egress_bytes = value,
                "snapshot_bytes" => self.snapshot_bytes = value,
                "connection_subscriptions" => self.connection_subscriptions = value,
                "global_subscriptions" => self.global_subscriptions = value,
                "accepts_per_turn" => self.accepts_per_turn = value,
                "active_snapshots" => self.active_snapshots = value,
                "cache_bytes" => self.cache_bytes = value,
                _ => {}
            }
        }
    }
}

#[derive(Debug, Error)]
pub enum ServerError {
    #[error("project registry failed: {0}")]
    Registry(String),
    #[error("filesystem watcher failed: {0}")]
    Watch(#[from] notify::Error),
    #[error("socket server failed: {0}")]
    Io(#[from] io::Error),
}

struct Connection {
    writer: SyncSender<WriterMessage>,
    control_stream: UnixStream,
    reader_handle: thread::JoinHandle<()>,
    writer_handle: thread::JoinHandle<()>,
    subscriptions: HashSet<String>,
    subscription_count: Arc<AtomicUsize>,
    writer_bytes: Arc<AtomicUsize>,
    writer_frames: Arc<AtomicUsize>,
    required_deliveries: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
    pending: Arc<AtomicUsize>,
    reader_done: Arc<AtomicBool>,
}

struct Subscription {
    connection: ConnectionId,
    project_id: String,
    returned: bool,
    permit: CapacityPermit,
}

enum WaitKind {
    Get,
    Subscribe(String),
}

struct Waiter {
    connection: ConnectionId,
    request_id: String,
    kind: WaitKind,
    permit: CapacityPermit,
}
struct ActiveSnapshot {
    run: SnapshotRun,
    cancelled: Arc<AtomicBool>,
}

pub fn run(config: DaemonConfig, socket: OwnedSocket) -> Result<(), ServerError> {
    let projects = load_registry(&config.registry)
        .map_err(|error| ServerError::Registry(error.to_string()))?;
    let limits = Limits::new(config.frame_limit());
    let (messages_tx, messages_rx) = mpsc::sync_channel(limits.ingress);
    let (notify_tx, notify_rx) = mpsc::sync_channel(limits.ingress);
    let notify_overflow = Arc::new(AtomicBool::new(false));
    let callback_overflow = notify_overflow.clone();
    let callback_registry = config.registry.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        match notify_tx.try_send(event) {
            Ok(()) | Err(mpsc::TrySendError::Disconnected(_)) => {}
            Err(mpsc::TrySendError::Full(event)) => {
                callback_overflow.store(true, Ordering::Release);
                if event
                    .as_ref()
                    .is_ok_and(|event| event.paths.iter().any(|path| path == &callback_registry))
                {
                    signal_test_fifo("_JEFFD_TEST_NOTIFY_REGISTRY_FULL");
                }
            }
        }
        signal_test_fifo("_JEFFD_TEST_NOTIFY_RETURNED");
    })?;
    watcher.watch(
        config
            .registry
            .parent()
            .ok_or_else(|| ServerError::Registry("registry has no parent".to_owned()))?,
        RecursiveMode::NonRecursive,
    )?;
    for project in projects.iter().filter(|project| project.enabled) {
        watcher.watch(&project.path.join(".jeff"), RecursiveMode::Recursive)?;
    }

    let shutdown = Arc::new(AtomicBool::new(false));
    signal_hook::flag::register(signal_hook::consts::SIGTERM, shutdown.clone())?;
    signal_hook::flag::register(signal_hook::consts::SIGINT, shutdown.clone())?;
    let dirty = DirtyTracker::new(config.debounce_window());
    let mut next_registry_generation = 1;
    let registry_generations = projects
        .iter()
        .map(|project| {
            let generation = next_registry_generation;
            next_registry_generation += 1;
            (project.id.clone(), generation)
        })
        .collect();

    let mut server = Server {
        config,
        limits,
        socket,
        watcher,
        projects,
        registry_generations,
        caches: HashMap::new(),
        dirty,
        messages_tx,
        messages_rx,
        notify_rx,
        connections: HashMap::new(),
        subscriptions: HashMap::new(),
        global_subscription_count: Arc::new(AtomicUsize::new(0)),
        waiters: HashMap::new(),
        active: HashMap::new(),
        waiter_count: Arc::new(AtomicUsize::new(0)),
        deferred_snapshots: VecDeque::new(),
        retained_cache_bytes: 0,
        pending_watches: HashSet::new(),
        notify_overflow,
        watch_retry_due: None,
        next_connection: 1,
        next_subscription: 1,
        next_registry_generation,
        global_writer_bytes: Arc::new(AtomicUsize::new(0)),
        global_ingress_bytes: Arc::new(AtomicUsize::new(0)),
        started: Instant::now(),
        registry_due: None,
        registry_poll_due: registry_watch::REGISTRY_POLL_INTERVAL,
    };
    for project in &server.projects {
        server
            .caches
            .insert(project.id.clone(), ProjectCache::new(project.clone()));
    }
    server.event_loop(shutdown)
}

struct Server {
    config: DaemonConfig,
    limits: Limits,
    socket: OwnedSocket,
    watcher: RecommendedWatcher,
    projects: Vec<ProjectRecord>,
    caches: HashMap<String, ProjectCache>,
    registry_generations: HashMap<String, u64>,
    dirty: DirtyTracker,
    messages_tx: SyncSender<OwnerMessage>,
    messages_rx: Receiver<OwnerMessage>,
    notify_rx: Receiver<notify::Result<notify::Event>>,
    connections: HashMap<ConnectionId, Connection>,
    subscriptions: HashMap<String, Subscription>,
    global_subscription_count: Arc<AtomicUsize>,
    waiters: HashMap<String, Vec<Waiter>>,
    active: HashMap<String, ActiveSnapshot>,
    waiter_count: Arc<AtomicUsize>,
    deferred_snapshots: VecDeque<String>,
    retained_cache_bytes: usize,
    pending_watches: HashSet<String>,
    notify_overflow: Arc<AtomicBool>,
    watch_retry_due: Option<Duration>,
    next_connection: ConnectionId,
    next_subscription: u64,
    next_registry_generation: u64,
    global_writer_bytes: Arc<AtomicUsize>,
    global_ingress_bytes: Arc<AtomicUsize>,
    started: Instant,
    registry_due: Option<Duration>,
    registry_poll_due: Duration,
}

impl Server {
    fn event_loop(&mut self, shutdown: Arc<AtomicBool>) -> Result<(), ServerError> {
        loop {
            if shutdown.load(Ordering::Acquire) {
                break;
            }
            self.accept_connections()?;
            self.drop_disconnected_connections();
            self.pause_owner_if_armed();
            if shutdown.load(Ordering::Acquire) {
                break;
            }
            if let Ok(event) = self.notify_rx.try_recv() {
                self.handle_notify(event);
            }
            self.recover_notify_overflow();
            self.run_due_snapshots();
            self.poll_registry();
            self.reload_registry_if_due();
            self.retry_pending_watches();
            match self.messages_rx.recv_timeout(Duration::from_millis(10)) {
                Ok(message) => self.handle_message(message),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        self.shutdown();
        self.socket
            .cleanup()
            .map_err(|error| ServerError::Io(io::Error::other(error)))
    }

    fn now(&self) -> Duration {
        self.started.elapsed()
    }

    fn accept_connections(&mut self) -> Result<(), ServerError> {
        for _ in 0..self.limits.accepts_per_turn {
            match self.socket.listener.accept() {
                Ok((stream, _)) => self.add_connection(stream)?,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) => return Err(error.into()),
            }
        }
        self.signal_accept_yield_if_armed();
        Ok(())
    }

    fn add_connection(&mut self, stream: UnixStream) -> Result<(), ServerError> {
        stream.set_nonblocking(false)?;
        if self.connections.len() >= self.limits.connections {
            let _ = stream.shutdown(std::net::Shutdown::Both);
            return Ok(());
        }
        let id = self.next_connection;
        self.next_connection += 1;
        let ConnectionParts {
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
        } = spawn_connection(
            id,
            stream,
            self.limits,
            self.messages_tx.clone(),
            self.global_ingress_bytes.clone(),
        )?;
        self.connections.insert(
            id,
            Connection {
                writer,
                control_stream,
                reader_handle,
                writer_handle,
                subscriptions: HashSet::new(),
                subscription_count: Arc::new(AtomicUsize::new(0)),
                writer_bytes,
                writer_frames,
                required_deliveries,
                closed,
                pending,
                reader_done,
            },
        );
        Ok(())
    }

    fn handle_message(&mut self, message: OwnerMessage) {
        match message {
            OwnerMessage::Request {
                connection,
                frame,
                pending,
                ingress,
            } => {
                pending.fetch_sub(1, Ordering::AcqRel);
                if self.connections.contains_key(&connection) {
                    self.handle_request(connection, frame);
                }
                drop(ingress);
            }
            OwnerMessage::FrameTooLarge {
                connection,
                request_id,
            } => {
                if let Some(request_id) = request_id {
                    self.send_error(
                        connection,
                        &request_id,
                        "frame_too_large",
                        "frame exceeds maximum size",
                    );
                }
                self.close_connection(connection);
            }
            OwnerMessage::SnapshotDone { run, result } => {
                self.finish_snapshot(run, result);
                self.launch_deferred_snapshots();
            }
        }
    }

    fn drop_disconnected_connections(&mut self) {
        let disconnected: Vec<_> = self
            .connections
            .iter()
            .filter(|(_, connection)| {
                connection.reader_done.load(Ordering::Acquire)
                    && connection.pending.load(Ordering::Acquire) == 0
            })
            .map(|(id, _)| *id)
            .collect();
        for connection in disconnected {
            self.drop_connection(connection);
        }
    }

    fn shutdown(&mut self) {
        for active in self.active.values() {
            active.cancelled.store(true, Ordering::Release);
        }
        let waiters = std::mem::take(&mut self.waiters);
        for waiter in waiters.into_values().flatten() {
            let permit = waiter.permit;
            self.send_shutdown_error(
                waiter.connection,
                &waiter.request_id,
                "unavailable",
                "snapshot unavailable because the daemon is shutting down",
                permit,
            );
        }

        let subscriptions = std::mem::take(&mut self.subscriptions);
        for (subscription_id, subscription) in subscriptions {
            if subscription.returned {
                self.send_shutdown_event(
                    subscription.connection,
                    "subscription.ended",
                    json!({"subscriptionId": subscription_id, "reason": "shutdown"}),
                    subscription.permit,
                );
            }
        }
        signal_test_fifo("_JEFFD_TEST_SHUTDOWN_TERMINALS_DONE");

        while !self.active.is_empty() {
            match self.messages_rx.recv_timeout(Duration::from_millis(50)) {
                Ok(OwnerMessage::SnapshotDone { run, .. }) => {
                    let project_id = &run.record.id;
                    if self
                        .active
                        .get(project_id)
                        .is_some_and(|active| active.run == run)
                    {
                        self.active.remove(project_id);
                    }
                }
                Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let connections: Vec<_> = self.connections.keys().copied().collect();
        for connection in connections {
            self.close_connection(connection);
        }
    }

    pub(super) fn try_add_waiter(
        &mut self,
        project_id: String,
        connection: ConnectionId,
        request_id: String,
        kind: WaitKind,
    ) -> bool {
        if self
            .waiters
            .get(&project_id)
            .is_some_and(|waiters| waiters.len() >= self.limits.cold_waiters)
        {
            return false;
        }
        let Some(permit) =
            CapacityPermit::try_acquire(self.waiter_count.clone(), self.limits.cold_waiters)
        else {
            return false;
        };
        self.waiters.entry(project_id).or_default().push(Waiter {
            connection,
            request_id,
            kind,
            permit,
        });
        true
    }

    pub(super) fn take_waiters(&mut self, project_id: &str) -> Vec<Waiter> {
        self.waiters.remove(project_id).unwrap_or_default()
    }

    pub(super) fn try_register_subscription(
        &mut self,
        connection: ConnectionId,
        project_id: String,
        subscription_id: String,
    ) -> bool {
        let Some(connection_count) = self
            .connections
            .get(&connection)
            .map(|client| client.subscription_count.clone())
        else {
            return false;
        };
        let Some(permit) = CapacityPermit::try_acquire_pair(
            connection_count,
            self.limits.connection_subscriptions,
            self.global_subscription_count.clone(),
            self.limits.global_subscriptions,
        ) else {
            return false;
        };
        let client = self
            .connections
            .get_mut(&connection)
            .expect("connection retained while registering subscription");
        client.subscriptions.insert(subscription_id.clone());
        self.subscriptions.insert(
            subscription_id,
            Subscription {
                connection,
                project_id,
                returned: false,
                permit,
            },
        );
        true
    }

    pub(super) fn mark_subscription_returned(&mut self, subscription_id: &str) {
        if let Some(subscription) = self.subscriptions.get_mut(subscription_id) {
            subscription.returned = true;
        }
    }

    #[cfg(debug_assertions)]
    fn signal_accept_yield_if_armed(&self) {
        let Ok(arm) = std::env::var("_JEFFD_TEST_ACCEPT_YIELD_ARM") else {
            return;
        };
        if std::fs::remove_file(arm).is_ok() {
            signal_test_fifo("_JEFFD_TEST_ACCEPT_YIELDED");
        }
    }

    #[cfg(not(debug_assertions))]
    fn signal_accept_yield_if_armed(&self) {}

    #[cfg(debug_assertions)]
    fn pause_owner_if_armed(&self) {
        use std::io::BufRead as _;

        let Ok(arm) = std::env::var("_JEFFD_TEST_OWNER_ARM") else {
            return;
        };
        if std::fs::remove_file(arm).is_err() {
            return;
        }
        signal_test_fifo("_JEFFD_TEST_OWNER_READY");
        let Ok(release) = std::env::var("_JEFFD_TEST_OWNER_RELEASE") else {
            return;
        };
        let Ok(file) = std::fs::OpenOptions::new().read(true).open(release) else {
            return;
        };
        let _ = std::io::BufReader::new(file).read_line(&mut String::new());
    }

    #[cfg(not(debug_assertions))]
    fn pause_owner_if_armed(&self) {}
}

#[cfg(debug_assertions)]
pub(crate) fn signal_test_fifo(name: &str) {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;

    let Ok(path) = std::env::var(name) else {
        return;
    };
    if let Ok(mut fifo) = std::fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
    {
        let _ = fifo.write_all(b"run\n");
    }
}

#[cfg(not(debug_assertions))]
pub(crate) fn signal_test_fifo(_: &str) {}
