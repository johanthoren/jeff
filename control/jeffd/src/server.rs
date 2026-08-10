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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;

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
    writer: Sender<WriterMessage>,
    control_stream: UnixStream,
    reader_handle: thread::JoinHandle<()>,
    writer_handle: thread::JoinHandle<()>,
    subscriptions: HashSet<String>,
}

struct Subscription {
    connection: ConnectionId,
    project_id: String,
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
    let (messages_tx, messages_rx) = mpsc::channel();
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
        active: HashMap::new(),
        pending_watches: HashSet::new(),
        watch_retry_due: None,
        next_connection: 1,
        next_subscription: 1,
        next_registry_generation,
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
    socket: OwnedSocket,
    watcher: RecommendedWatcher,
    projects: Vec<ProjectRecord>,
    caches: HashMap<String, ProjectCache>,
    registry_generations: HashMap<String, u64>,
    dirty: DirtyTracker,
    messages_tx: Sender<OwnerMessage>,
    messages_rx: Receiver<OwnerMessage>,
    connections: HashMap<ConnectionId, Connection>,
    subscriptions: HashMap<String, Subscription>,
    waiters: HashMap<String, Vec<Waiter>>,
    active: HashMap<String, ActiveSnapshot>,
    pending_watches: HashSet<String>,
    watch_retry_due: Option<Duration>,
    next_connection: ConnectionId,
    next_subscription: u64,
    next_registry_generation: u64,
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
        let id = self.next_connection;
        self.next_connection += 1;
        let ConnectionParts {
            writer,
            control_stream,
            reader_handle,
            writer_handle,
        } = spawn_connection(
            id,
            stream,
            self.config.frame_limit(),
            self.messages_tx.clone(),
        )?;
        self.connections.insert(
            id,
            Connection {
                writer,
                control_stream,
                reader_handle,
                writer_handle,
                subscriptions: HashSet::new(),
            },
        );
        Ok(())
    }

    fn handle_message(&mut self, message: OwnerMessage) {
        match message {
            OwnerMessage::Request { connection, frame } => self.handle_request(connection, frame),
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
        let subscriptions: Vec<_> = self
            .subscriptions
            .iter()
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
}
