mod client;
mod registry_watch;
mod request;
mod snapshots;

use crate::config::DaemonConfig;
use crate::lifecycle::OwnedSocket;
use crate::protocol::{
    spawn_connection, ConnectionId, ConnectionParts, OwnerMessage, SnapshotRun, WriterMessage,
};
use crate::registry::load_registry;
use crate::state::{DirtyTracker, ProjectCache};
use jeff_project::ProjectRecord;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::collections::{HashMap, HashSet};
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
    pub(crate) cold_waiters: usize,
    pub(crate) egress_frames: usize,
    pub(crate) egress_bytes: usize,
    pub(crate) global_egress_bytes: usize,
}

impl Limits {
    pub(crate) const RESPONSE_ID_BYTES: usize = 4 * 1024;

    fn new(frame_bytes: usize) -> Self {
        let mut limits = Self {
            connections: 64,
            frame_bytes,
            ingress: 256,
            in_flight: 32,
            cold_waiters: 512,
            egress_frames: 64,
            egress_bytes: 32 * 1024 * 1024,
            global_egress_bytes: 256 * 1024 * 1024,
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
                "egress_frames" => self.egress_frames = value,
                "egress_bytes" => {
                    self.egress_bytes = value;
                    self.global_egress_bytes = value;
                }
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
    writer_bytes: Arc<AtomicUsize>,
    writer_frames: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
}

struct Subscription {
    connection: ConnectionId,
    project_id: String,
    returned: bool,
}

enum WaitKind {
    Get,
    Subscribe(String),
}

struct Waiter {
    connection: ConnectionId,
    request_id: String,
    kind: WaitKind,
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
    let notify_tx = messages_tx.clone();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = notify_tx.send(OwnerMessage::Notify(event));
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
        connections: HashMap::new(),
        subscriptions: HashMap::new(),
        waiters: HashMap::new(),
        waiter_count: 0,
        active: HashMap::new(),
        pending_watches: HashSet::new(),
        watch_retry_due: None,
        next_connection: 1,
        next_subscription: 1,
        next_registry_generation,
        global_writer_bytes: Arc::new(AtomicUsize::new(0)),
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
    connections: HashMap<ConnectionId, Connection>,
    subscriptions: HashMap<String, Subscription>,
    waiters: HashMap<String, Vec<Waiter>>,
    waiter_count: usize,
    active: HashMap<String, ActiveSnapshot>,
    pending_watches: HashSet<String>,
    watch_retry_due: Option<Duration>,
    next_connection: ConnectionId,
    next_subscription: u64,
    next_registry_generation: u64,
    global_writer_bytes: Arc<AtomicUsize>,
    started: Instant,
    registry_due: Option<Duration>,
    registry_poll_due: Duration,
}

impl Server {
    fn event_loop(&mut self, shutdown: Arc<AtomicBool>) -> Result<(), ServerError> {
        while !shutdown.load(Ordering::Acquire) {
            self.accept_connections()?;
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
        loop {
            match self.socket.listener.accept() {
                Ok((stream, _)) => self.add_connection(stream)?,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) => return Err(error.into()),
            }
        }
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
            closed,
        } = spawn_connection(id, stream, self.limits, self.messages_tx.clone())?;
        self.connections.insert(
            id,
            Connection {
                writer,
                control_stream,
                reader_handle,
                writer_handle,
                subscriptions: HashSet::new(),
                writer_bytes,
                writer_frames,
                closed,
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
            } => {
                pending.fetch_sub(1, Ordering::AcqRel);
                if self.connections.contains_key(&connection) {
                    self.handle_request(connection, frame);
                }
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
            OwnerMessage::Disconnected(connection) => self.drop_connection(connection),
            OwnerMessage::SnapshotDone { run, result } => self.finish_snapshot(run, result),
            OwnerMessage::Notify(event) => self.handle_notify(event),
        }
    }

    fn shutdown(&mut self) {
        for active in self.active.values() {
            active.cancelled.store(true, Ordering::Release);
        }
        let waiters = std::mem::take(&mut self.waiters);
        self.waiter_count = 0;
        for waiter in waiters.into_values().flatten() {
            self.send_shutdown_error(
                waiter.connection,
                &waiter.request_id,
                "unavailable",
                "snapshot unavailable because the daemon is shutting down",
            );
        }

        let subscriptions: Vec<_> = self
            .subscriptions
            .iter()
            .filter(|(_, subscription)| subscription.returned)
            .map(|(id, subscription)| (id.clone(), subscription.connection))
            .collect();
        for (subscription_id, connection) in subscriptions {
            self.send_event(
                connection,
                "subscription.ended",
                json!({"subscriptionId": subscription_id, "reason": "shutdown"}),
            );
        }
        self.subscriptions.clear();

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
                Ok(OwnerMessage::Disconnected(connection)) => self.drop_connection(connection),
                Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let connections: Vec<_> = self.connections.keys().copied().collect();
        for connection in connections {
            self.close_connection(connection);
        }
    }

    pub(super) fn try_add_waiter(&mut self, project_id: String, waiter: Waiter) -> bool {
        if self.waiter_count >= self.limits.cold_waiters
            || self
                .waiters
                .get(&project_id)
                .is_some_and(|waiters| waiters.len() >= self.limits.cold_waiters)
        {
            return false;
        }
        self.waiters.entry(project_id).or_default().push(waiter);
        self.waiter_count += 1;
        true
    }

    pub(super) fn take_waiters(&mut self, project_id: &str) -> Vec<Waiter> {
        let waiters = self.waiters.remove(project_id).unwrap_or_default();
        self.waiter_count = self.waiter_count.saturating_sub(waiters.len());
        waiters
    }

    pub(super) fn register_subscription(
        &mut self,
        connection: ConnectionId,
        project_id: String,
        subscription_id: String,
    ) {
        self.subscriptions.insert(
            subscription_id.clone(),
            Subscription {
                connection,
                project_id,
                returned: false,
            },
        );
        if let Some(client) = self.connections.get_mut(&connection) {
            client.subscriptions.insert(subscription_id);
        }
    }

    pub(super) fn mark_subscription_returned(&mut self, subscription_id: &str) {
        if let Some(subscription) = self.subscriptions.get_mut(subscription_id) {
            subscription.returned = true;
        }
    }
}
