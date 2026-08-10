#![cfg(unix)]

mod support;

use jeff_project::ProjectRecord;
use jeffd::{run_snapshot, SnapshotFailure};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::env;
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use support::{assert_ok, wait_for_log_lines, FifoPair, Fixture, MAX_FRAME_BYTES};

#[test]
fn foreground_lifecycle_owns_the_default_private_socket_and_cleans_up() {
    let mut fixture = Fixture::new(false);
    fixture.write_registry(json!([]));

    fixture.start();
    fixture.assert_start_is_foreground();

    assert_eq!(
        fs::metadata(fixture.home.join(".jeff"))
            .expect("read private HOME directory")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(&fixture.socket)
            .expect("read daemon socket")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );

    let status = fixture.run(&["status"]);
    assert!(status.status.success(), "live status failed: {status:?}");
    assert!(
        String::from_utf8_lossy(&status.stdout).contains("running"),
        "live status did not report running: {status:?}"
    );

    let duplicate = fixture.run(&["start"]);
    assert!(
        !duplicate.status.success(),
        "a second start must not steal a live listener"
    );
    let hello = fixture.client().request("hello", "server.hello", json!({}));
    assert_eq!(assert_ok(&hello)["protocolVersion"], 1);

    let stop = fixture.stop_and_wait();
    assert!(stop.status.success(), "stop failed: {stop:?}");
    assert!(
        !fixture.socket.exists(),
        "clean shutdown must remove the socket inode"
    );
    let stopped = fixture.run(&["status"]);
    assert!(
        !stopped.status.success(),
        "status must be nonzero when no listener is live"
    );
}

#[test]
fn socket_override_replaces_only_a_proven_stale_socket() {
    let mut stale = Fixture::new(true);
    stale.write_registry(json!([]));
    let listener = UnixListener::bind(&stale.socket).expect("bind stale socket fixture");
    drop(listener);
    assert!(
        stale.socket.exists(),
        "dropped listener leaves a socket inode"
    );

    stale.start();
    assert_eq!(
        assert_ok(&stale.client().request("hello", "server.hello", json!({})))["protocolVersion"],
        1
    );
    assert!(stale.stop_and_wait().status.success());

    let unsafe_path = Fixture::new(true);
    unsafe_path.write_registry(json!([]));
    fs::write(&unsafe_path.socket, "operator data").expect("write non-socket fixture");
    let refused = unsafe_path.run(&["start"]);
    assert!(
        !refused.status.success(),
        "start must refuse a non-socket path"
    );
    assert_eq!(
        fs::read_to_string(&unsafe_path.socket).expect("non-socket file remains"),
        "operator data"
    );

    let relative = unsafe_path
        .command()
        .env("JEFFD_SOCK", "relative/jeffd.sock")
        .arg("start")
        .output()
        .expect("run relative socket rejection");
    assert!(
        !relative.status.success(),
        "relative JEFFD_SOCK must fail closed"
    );
}

#[test]
fn registry_invocation_cache_failures_and_ledger_independence_are_observable() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fs::write(fixture.project.join(".jeff/task.json"), "not task JSON")
        .expect("write invalid ledger decoy");
    fs::write(
        fixture.project.join(".jeff/journal.jsonl"),
        "not journal JSON",
    )
    .expect("write invalid journal decoy");
    fs::create_dir_all(fixture.project.join(".jeff/tasks/one/.claim"))
        .expect("create claim decoy directory");
    fs::write(
        fixture.project.join(".jeff/tasks/one/.claim/claim.json"),
        "not claim JSON",
    )
    .expect("write invalid claim decoy");
    fixture.start();

    let mut client = fixture.client();
    let first = client.request("get-1", "snapshot.get", json!({"projectId": "project-a"}));
    let first_projection = assert_ok(&first);
    assert_eq!(first_projection["generatedAt"], "2026-08-10T10:00:00Z");
    assert_eq!(first_projection["tasks"][0]["title"], "first");
    assert_eq!(first_projection["degraded"], json!([]));
    assert_eq!(
        fixture.invocations(),
        [format!(
            "{}|--fixture snapshot --json",
            fixture.project.display()
        )],
        "snapshot data must come only from the registered command and cwd"
    );

    let subscribed = client.request(
        "sub-1",
        "snapshot.subscribe",
        json!({"path": fixture.project}),
    );
    let subscription_id = assert_ok(&subscribed)["subscriptionId"]
        .as_str()
        .expect("subscription id string")
        .to_owned();

    fixture.set_snapshot("2026-08-10T10:01:00Z", "replacement");
    fixture.touch_project(&fixture.project, "replace-trigger");
    let replaced = client.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(replaced["payload"]["projectId"], "project-a");
    assert_eq!(
        replaced["payload"]["snapshot"]["generatedAt"],
        "2026-08-10T10:01:00Z"
    );
    assert_eq!(
        replaced["payload"]["snapshot"]["tasks"][0]["title"],
        "replacement"
    );

    let supported = support::snapshot("2026-08-10T10:02:00Z", "rejected");
    fixture.set_raw_snapshot(&supported.replace("\"schemaVersion\":1", "\"schemaVersion\":0"));
    fixture.touch_project(&fixture.project, "old-schema-trigger");
    let old_failure = client.recv_until(|frame| frame["name"] == "snapshot.failed");
    assert!(old_failure["payload"]["message"]
        .as_str()
        .expect("failure message")
        .contains("older than supported minimum"));

    let retained = client.request(
        "get-retained",
        "snapshot.get",
        json!({"projectId": "project-a"}),
    );
    let retained_projection = assert_ok(&retained);
    assert_eq!(retained_projection["generatedAt"], "2026-08-10T10:01:00Z");
    assert_eq!(retained_projection["tasks"][0]["title"], "replacement");
    assert_eq!(retained_projection["degraded"], json!(["snapshot_stale"]));

    fixture.set_raw_snapshot(&format!("{supported}\n{supported}\n"));
    fixture.touch_project(&fixture.project, "two-documents-trigger");
    let parse_failure = client.recv_until(|frame| frame["name"] == "snapshot.failed");
    assert!(parse_failure["payload"]["message"]
        .as_str()
        .expect("parse failure message")
        .contains("invalid snapshot"));

    fixture.set_failure(64, "cook: unknown command: snapshot\n");
    fixture.touch_project(&fixture.project, "older-cook-trigger");
    let older_cook = client.recv_until(|frame| frame["name"] == "snapshot.failed");
    assert_eq!(older_cook["payload"]["exitCode"], 64);
    assert!(older_cook["payload"]["message"]
        .as_str()
        .expect("older-cook failure message")
        .contains("older jeff missing snapshot"));

    let unsubscribed = client.request(
        "unsub-1",
        "snapshot.unsubscribe",
        json!({"subscriptionId": subscription_id}),
    );
    assert_eq!(assert_ok(&unsubscribed), &json!({"ok": true}));
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn protocol_methods_events_and_sixteen_mibibyte_framing_are_enforced() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start();

    let mut client = fixture.client();
    let hello = client.request(
        "hello",
        "server.hello",
        json!({"client": "contract-test", "clientVersion": "1"}),
    );
    assert_eq!(
        assert_ok(&hello),
        &json!({
            "protocolVersion": 1,
            "serverVersion": env!("CARGO_PKG_VERSION"),
            "snapshotSchemaMin": 1,
            "snapshotSchemaMax": 1
        })
    );

    let listed = client.request("list", "project.list", json!({}));
    let projects = &assert_ok(&listed)["projects"];
    assert_eq!(projects.as_array().expect("project list array").len(), 1);
    assert_eq!(projects[0]["id"], "project-a");
    assert_eq!(projects[0]["path"], json!(fixture.project));
    assert_eq!(projects[0]["name"], "Project A");
    assert_eq!(projects[0]["enabled"], true);
    assert!(
        projects[0].get("cook").is_none(),
        "project.list must not expose commands"
    );

    let by_path = client.request("get-path", "snapshot.get", json!({"path": fixture.project}));
    assert_eq!(assert_ok(&by_path)["projectId"], "project-a");

    let unknown = client.request("unknown", "project.mutate", json!({}));
    assert_eq!(unknown["ok"], false);
    assert_eq!(unknown["error"]["code"], "unknown_method");

    let subscribed = client.request(
        "sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert!(assert_ok(&subscribed)["subscriptionId"].is_string());

    fixture.write_registry(json!([]));
    let mut observed = BTreeSet::new();
    for _ in 0..4 {
        let event = client.recv();
        if event["kind"] == "event" {
            observed.insert(
                event["name"]
                    .as_str()
                    .expect("event name string")
                    .to_owned(),
            );
        }
        if observed.contains("project.updated") && observed.contains("subscription.ended") {
            break;
        }
    }
    assert!(
        observed.contains("project.updated"),
        "registry edit event missing"
    );
    assert!(
        observed.contains("subscription.ended"),
        "removed-project subscription event missing"
    );

    let mut exact_limit = fixture.client();
    let request = serde_json::to_vec(&json!({
        "v": 1,
        "kind": "req",
        "id": "max",
        "method": "server.hello",
        "params": {}
    }))
    .expect("serialize maximum-frame request");
    let mut frame = vec![b' '; MAX_FRAME_BYTES - request.len()];
    frame.extend_from_slice(&request);
    frame.push(b'\n');
    exact_limit.write_raw(&frame);
    assert_eq!(assert_ok(&exact_limit.recv())["protocolVersion"], 1);

    let mut oversized = fixture.client();
    let mut too_large = vec![b' '; MAX_FRAME_BYTES + 1];
    too_large.push(b'\n');
    oversized.write_raw(&too_large);
    oversized.read_eof();

    let mut wrong_version = fixture.client();
    wrong_version.send(&json!({
        "v": 2,
        "kind": "req",
        "id": "wrong-version",
        "method": "server.hello",
        "params": {}
    }));
    let version_error = wrong_version.recv();
    assert_eq!(version_error["id"], "wrong-version");
    assert_eq!(version_error["ok"], false);
    assert_eq!(version_error["error"]["code"], "unsupported_version");
    wrong_version.read_eof();

    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn notify_coalesces_dirty_again_for_only_the_changed_project() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([
        fixture.default_record(),
        fixture.path_cook_record()
    ]));
    let fifo_root = fixture
        .home
        .parent()
        .expect("fixture HOME has root")
        .to_path_buf();
    let mut gates = FifoPair::new(&fifo_root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", &gates.ready_path),
        ("FAKE_RELEASE_FIFO", &gates.release_path),
    ]);

    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();

    fixture.touch_project(&fixture.project, "burst-a");
    fixture.touch_project(&fixture.project, "burst-b");
    fixture.touch_project(&fixture.project, "burst-c");
    gates.release();
    let subscribed = client.recv_until(|frame| frame["id"] == "sub");
    assert!(assert_ok(&subscribed)["subscriptionId"].is_string());

    gates.wait_for_run();
    let invocations = wait_for_log_lines(&fixture.log, 2);
    assert_eq!(invocations.len(), 2);
    assert!(invocations.iter().all(|line| {
        line == &format!("{}|--fixture snapshot --json", fixture.project.display())
    }));
    gates.release();

    let replaced = client.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(replaced["payload"]["projectId"], "project-a");
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn shutdown_ends_subscriptions_and_terminates_an_active_snapshot_process_group() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let fifo_root = fixture
        .home
        .parent()
        .expect("fixture HOME has root")
        .to_path_buf();
    let mut gates = FifoPair::new(&fifo_root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", &gates.ready_path),
        ("FAKE_RELEASE_FIFO", &gates.release_path),
    ]);

    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();

    let stop = fixture.run(&["stop"]);
    assert!(stop.status.success(), "stop failed: {stop:?}");
    let ended = client.recv_until(|frame| frame["name"] == "subscription.ended");
    assert_eq!(ended["payload"]["reason"], "shutdown");
    fixture.wait_for_exit();
    assert!(!fixture.socket.exists());
}

struct RaceGate {
    ready_path: PathBuf,
    release_path: PathBuf,
    ready: mpsc::Receiver<String>,
    release: File,
}

impl RaceGate {
    fn new(root: &Path) -> Self {
        let ready_path = root.join("unlink-ready.fifo");
        let release_path = root.join("unlink-release.fifo");
        make_race_fifo(&ready_path);
        make_race_fifo(&release_path);
        let ready_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ready_path)
            .expect("open unlink ready FIFO");
        let release = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&release_path)
            .expect("open unlink release FIFO");
        let (ready_tx, ready) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(ready_file);
            for _ in 0..3 {
                let mut line = String::new();
                reader
                    .read_line(&mut line)
                    .expect("read unlink interposer readiness");
                ready_tx.send(line).expect("send unlink readiness");
            }
        });
        Self {
            ready_path,
            release_path,
            ready,
            release,
        }
    }

    fn wait_for_run(&self) {
        let first = self
            .ready
            .recv_timeout(Duration::from_secs(10))
            .expect("unlink interposer library loads");
        let signal = if first == "loaded\n" {
            self.ready
                .recv_timeout(Duration::from_secs(10))
                .expect("unlink interposer reaches the replacement boundary")
        } else {
            first
        };
        assert_eq!(signal, "run\n");
    }

    fn release(&mut self) {
        self.release
            .write_all(b"x")
            .expect("release unlink interposer");
        self.release.flush().expect("flush unlink release");
    }
}

fn make_race_fifo(path: &Path) {
    let path = CString::new(path.as_os_str().as_encoded_bytes()).expect("FIFO path has no NUL");
    assert_eq!(
        unsafe { libc::mkfifo(path.as_ptr(), 0o600) },
        0,
        "create unlink interposer FIFO: {}",
        std::io::Error::last_os_error()
    );
}

struct UnlinkBarrier {
    library: PathBuf,
    gates: RaceGate,
}

impl UnlinkBarrier {
    fn new(root: &Path) -> Self {
        let source = root.join("socket-race-interpose.c");
        let library = root.join(if cfg!(target_os = "macos") {
            "socket-race-interpose.dylib"
        } else {
            "socket-race-interpose.so"
        });
        fs::write(&source, SOCKET_RACE_INTERPOSER).expect("write socket race interposer");
        let compiler = env::var_os("CC").unwrap_or_else(|| "cc".into());
        let mut command = Command::new(compiler);
        if cfg!(target_os = "macos") {
            command.arg("-dynamiclib");
        } else {
            command.args(["-shared", "-fPIC"]);
        }
        let output = command
            .arg(&source)
            .arg("-o")
            .arg(&library)
            .output()
            .expect("compile socket race interposer");
        assert!(
            output.status.success(),
            "socket race interposer failed to compile: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        Self {
            library,
            gates: RaceGate::new(root),
        }
    }

    fn install(&self, command: &mut Command, target: &Path) {
        command
            .env("JEFFD_TEST_RACE_TARGET", target)
            .env("JEFFD_TEST_RACE_READY", &self.gates.ready_path)
            .env("JEFFD_TEST_RACE_RELEASE", &self.gates.release_path);
        if cfg!(target_os = "macos") {
            command
                .env("DYLD_INSERT_LIBRARIES", &self.library)
                .env("DYLD_FORCE_FLAT_NAMESPACE", "1");
        } else {
            command.env("LD_PRELOAD", &self.library);
        }
    }
}

fn write_executable(path: &Path, contents: &str) {
    fs::write(path, contents).expect("write executable fixture");
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .expect("make executable fixture runnable");
}

fn pipe_holder_script(path: &Path) {
    write_executable(
        path,
        r#"#!/bin/sh
response=$1
ready=$2
release=$3
parent=$$
(
  while kill -0 "$parent" 2>/dev/null; do :; done
  printf 'run\n' > "$ready"
  IFS= read -r _release < "$release"
) &
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line"
done < "$response"
exit 0
"#,
    );
}

fn raw_send(stream: &mut UnixStream, frame: &Value) {
    serde_json::to_writer(&mut *stream, frame).expect("serialize raw client frame");
    stream.write_all(b"\n").expect("terminate raw client frame");
    stream.flush().expect("flush raw client frame");
}

fn raw_recv(reader: &mut BufReader<UnixStream>) -> Value {
    let mut line = String::new();
    let count = reader.read_line(&mut line).expect("read raw client frame");
    assert_ne!(count, 0, "connection closed before expected raw frame");
    serde_json::from_str(&line).expect("decode raw client frame")
}

fn raw_recv_until(reader: &mut BufReader<UnixStream>, predicate: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..32 {
        let frame = raw_recv(reader);
        if predicate(&frame) {
            return frame;
        }
    }
    panic!("expected raw client frame was not observed");
}

const SOCKET_RACE_INTERPOSER: &str = r#"
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/syscall.h>

static int claimed = 0;

static int is_target(const char *path) {
    const char *target = getenv("JEFFD_TEST_RACE_TARGET");
    if (path == NULL || target == NULL) return 0;
    const char *basename = strrchr(target, '/');
    return strcmp(path, target) == 0 || (basename != NULL && strcmp(path, basename + 1) == 0);
}

static int claim_target(const char *path) {
    return is_target(path) && __sync_bool_compare_and_swap(&claimed, 0, 1);
}

__attribute__((constructor))
static void report_loaded(void) {
    int ready = open(getenv("JEFFD_TEST_RACE_READY"), O_WRONLY);
    if (ready >= 0) {
        write(ready, "loaded\n", 7);
        close(ready);
    }
}

static void rendezvous(void) {
    char byte;
    int ready = open(getenv("JEFFD_TEST_RACE_READY"), O_WRONLY);
    if (ready >= 0) {
        write(ready, "run\n", 4);
        close(ready);
    }
    int release = open(getenv("JEFFD_TEST_RACE_RELEASE"), O_RDONLY);
    if (release >= 0) {
        read(release, &byte, 1);
        close(release);
    }
}
static int next_unlink(const char *path) {
#ifdef __APPLE__
    return (int)syscall(SYS_unlink, path);
#else
    int (*next)(const char *) = dlsym(RTLD_NEXT, "unlink");
    return next(path);
#endif
}

static int next_unlinkat(int directory, const char *path, int flags) {
#ifdef __APPLE__
    return (int)syscall(SYS_unlinkat, directory, path, flags);
#else
    int (*next)(int, const char *, int) = dlsym(RTLD_NEXT, "unlinkat");
    return next(directory, path, flags);
#endif
}

static int next_rename(const char *from, const char *to) {
#ifdef __APPLE__
    return (int)syscall(SYS_rename, from, to);
#else
    int (*next)(const char *, const char *) = dlsym(RTLD_NEXT, "rename");
    return next(from, to);
#endif
}

static int next_renameat(int from_directory, const char *from, int to_directory, const char *to) {
#ifdef __APPLE__
    return (int)syscall(SYS_renameat, from_directory, from, to_directory, to);
#else
    int (*next)(int, const char *, int, const char *) = dlsym(RTLD_NEXT, "renameat");
    return next(from_directory, from, to_directory, to);
#endif
}

static int hook_unlink(const char *path) {
    if (!claim_target(path)) return next_unlink(path);
    rendezvous();
    int result = next_unlink(path);
    rendezvous();
    return result;
}

static int hook_unlinkat(int directory, const char *path, int flags) {
    if (!claim_target(path)) return next_unlinkat(directory, path, flags);
    rendezvous();
    int result = next_unlinkat(directory, path, flags);
    rendezvous();
    return result;
}

static int hook_rename(const char *from, const char *to) {
    if (!claim_target(from)) return next_rename(from, to);
    rendezvous();
    int result = next_rename(from, to);
    rendezvous();
    return result;
}

static int hook_renameat(int from_directory, const char *from, int to_directory, const char *to) {
    if (!claim_target(from)) return next_renameat(from_directory, from, to_directory, to);
    rendezvous();
    int result = next_renameat(from_directory, from, to_directory, to);
    rendezvous();
    return result;
}

#ifdef __APPLE__
#define DYLD_INTERPOSE(replacement, replacee) \
    __attribute__((used)) static struct { const void *replacement; const void *replacee; } \
    _interpose_##replacee __attribute__((section("__DATA,__interpose"))) = { \
        (const void *)(unsigned long)&replacement, (const void *)(unsigned long)&replacee \
    }
DYLD_INTERPOSE(hook_unlink, unlink);
DYLD_INTERPOSE(hook_unlinkat, unlinkat);
DYLD_INTERPOSE(hook_rename, rename);
DYLD_INTERPOSE(hook_renameat, renameat);
#else
int unlink(const char *path) {
    return hook_unlink(path);
}

int unlinkat(int directory, const char *path, int flags) {
    return hook_unlinkat(directory, path, flags);
}

int rename(const char *from, const char *to) {
    return hook_rename(from, to);
}

int renameat(int from_directory, const char *from, int to_directory, const char *to) {
    return hook_renameat(from_directory, from, to_directory, to);
}
#endif
"#;

#[test]
fn review_contract_socket_replacement_survives_stale_start_and_shutdown_cleanup() {
    let stale_preserved = {
        let fixture = Fixture::new(true);
        fixture.write_registry(json!([]));
        let listener = UnixListener::bind(&fixture.socket).expect("bind stale socket");
        drop(listener);
        let root = fixture.home.parent().expect("fixture root");
        let mut barrier = UnlinkBarrier::new(root);
        let backup = root.join("validated-stale.sock");

        let (events_tx, events_rx) = mpsc::channel();
        let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |event| {
            events_tx.send(event).expect("forward socket event");
        })
        .expect("create stale-start socket watcher");
        watcher
            .watch(
                fixture.socket.parent().expect("socket parent"),
                RecursiveMode::NonRecursive,
            )
            .expect("watch stale-start socket parent");

        let mut command = fixture.command();
        command.arg("start");
        barrier.install(&mut command, &fixture.socket);
        let mut child = command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn stale-start daemon");

        barrier.gates.wait_for_run();
        fs::rename(&fixture.socket, &backup).expect("replace validated stale inode");
        fs::write(&fixture.socket, "operator replacement").expect("write replacement data");
        barrier.gates.release();
        barrier.gates.wait_for_run();
        barrier.gates.release();

        loop {
            if child
                .try_wait()
                .expect("inspect stale-start process")
                .is_some()
            {
                break;
            }
            if UnixStream::connect(&fixture.socket).is_ok() {
                child.kill().expect("terminate unsafe stale-start daemon");
                child.wait().expect("reap unsafe stale-start daemon");
                break;
            }
            events_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("stale-start path changes or process exits")
                .expect("stale-start socket event succeeds");
        }
        fs::read_to_string(&fixture.socket).ok().as_deref() == Some("operator replacement")
    };

    let shutdown_preserved = {
        let mut fixture = Fixture::new(true);
        fixture.write_registry(json!([]));
        let root = fixture.home.parent().expect("fixture root").to_path_buf();
        let mut barrier = UnlinkBarrier::new(&root);
        let socket = fixture.socket.clone();
        let preload = if cfg!(target_os = "macos") {
            "DYLD_INSERT_LIBRARIES"
        } else {
            "LD_PRELOAD"
        };
        let one = Path::new("1");
        let mut extra_env = vec![
            ("JEFFD_TEST_RACE_TARGET", socket.as_path()),
            ("JEFFD_TEST_RACE_READY", barrier.gates.ready_path.as_path()),
            (
                "JEFFD_TEST_RACE_RELEASE",
                barrier.gates.release_path.as_path(),
            ),
            (preload, barrier.library.as_path()),
        ];
        if cfg!(target_os = "macos") {
            extra_env.push(("DYLD_FORCE_FLAT_NAMESPACE", one));
        }
        fixture.start_with_env(&extra_env);

        let stop = fixture.run(&["stop"]);
        assert!(stop.status.success(), "stop failed: {stop:?}");
        barrier.gates.wait_for_run();
        let backup = root.join("owned-listener.sock");
        fs::rename(&fixture.socket, &backup).expect("replace owned listener inode");
        fs::write(&fixture.socket, "operator replacement").expect("write replacement data");
        barrier.gates.release();
        barrier.gates.wait_for_run();
        barrier.gates.release();
        fixture.wait_for_exit();
        fs::read_to_string(&fixture.socket).ok().as_deref() == Some("operator replacement")
    };

    assert!(
        stale_preserved,
        "stale-start cleanup removed or replaced the pathname's new inode"
    );
    assert!(
        shutdown_preserved,
        "shutdown cleanup removed the pathname's new inode"
    );
}

#[test]
fn review_contract_inherited_capture_pipes_remain_timeout_and_shutdown_bounded() {
    let timeout_enforced = {
        let root = tempfile::tempdir().expect("create timeout fixture");
        let project = root.path().join("project");
        fs::create_dir_all(project.join(".jeff")).expect("create timeout project");
        let response = root.path().join("snapshot.json");
        fs::write(
            &response,
            support::snapshot("2026-08-10T12:00:00Z", "pipe holder"),
        )
        .expect("write timeout snapshot");
        let script = root.path().join("pipe-holder");
        pipe_holder_script(&script);
        let mut gates = FifoPair::new(root.path());
        let record = ProjectRecord {
            id: "project-a".to_owned(),
            path: project,
            name: "Project A".to_owned(),
            enabled: true,
            cook: Some(vec![
                script.to_string_lossy().into_owned(),
                response.to_string_lossy().into_owned(),
                gates.ready_path.to_string_lossy().into_owned(),
                gates.release_path.to_string_lossy().into_owned(),
            ]),
        };
        let (result_tx, result_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            result_tx
                .send(run_snapshot(&record, Duration::from_millis(250)))
                .expect("send inherited-pipe timeout result");
        });
        gates.wait_for_run();
        let bounded = result_rx.recv_timeout(Duration::from_secs(2));
        gates.release();
        if bounded.is_err() {
            let _ = result_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("snapshot worker exits after pipe holder release");
        }
        worker.join().expect("join inherited-pipe timeout worker");
        matches!(bounded, Ok(Err(SnapshotFailure::Timeout)))
    };

    let shutdown_enforced = {
        let mut fixture = Fixture::new(true);
        let root = fixture.home.parent().expect("fixture root").to_path_buf();
        let script = root.join("pipe-holder");
        pipe_holder_script(&script);
        let mut gates = FifoPair::new(&root);
        fixture.write_registry(json!([{
            "id": "project-a",
            "path": fixture.project,
            "name": "Project A",
            "enabled": true,
            "cook": [
                script,
                fixture.response,
                gates.ready_path,
                gates.release_path
            ]
        }]));
        fixture.start();
        let mut client = fixture.client();
        client.send(&json!({
            "v": 1,
            "kind": "req",
            "id": "sub",
            "method": "snapshot.subscribe",
            "params": {"projectId": "project-a"}
        }));
        gates.wait_for_run();
        let stop = fixture.run(&["stop"]);
        assert!(stop.status.success(), "stop failed: {stop:?}");
        let ended = client.recv_until(|frame| frame["name"] == "subscription.ended");
        assert_eq!(ended["payload"]["reason"], "shutdown");

        let (exit_tx, exit_rx) = mpsc::channel();
        let waiter = thread::spawn(move || {
            fixture.wait_for_exit();
            exit_tx.send(()).expect("send daemon exit");
        });
        let bounded = exit_rx.recv_timeout(Duration::from_secs(2)).is_ok();
        gates.release();
        if !bounded {
            exit_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("daemon exits after pipe holder release");
        }
        waiter.join().expect("join daemon exit waiter");
        bounded
    };

    assert!(
        timeout_enforced,
        "snapshot timeout stopped after the direct child exited"
    );
    assert!(
        shutdown_enforced,
        "daemon shutdown waited for inherited capture pipes"
    );
}

#[test]
fn review_contract_registry_path_replacement_discards_stale_completion() {
    let mut fixture = Fixture::new(true);
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let script = root.join("path-aware-cook");
    let old_response = root.join("old-snapshot.json");
    let new_response = root.join("new-snapshot.json");
    let log = root.join("path-aware.log");
    fs::write(
        &old_response,
        support::snapshot("2026-08-10T12:00:00Z", "old path"),
    )
    .expect("write old-path snapshot");
    fs::write(
        &new_response,
        support::snapshot("2026-08-10T12:01:00Z", "new path"),
    )
    .expect("write new-path snapshot");
    fs::write(&log, "").expect("create path-aware invocation log");
    write_executable(
        &script,
        r#"#!/bin/sh
old_path=$1
old_response=$2
new_response=$3
ready=$4
release=$5
log=$6
printf '%s\n' "$PWD" >> "$log"
if [ "$PWD" = "$old_path" ]; then
  parent=$$
  (
    while kill -0 "$parent" 2>/dev/null; do :; done
    printf 'run\n' > "$ready"
    IFS= read -r _release < "$release"
  ) &
  response=$old_response
else
  response=$new_response
fi
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line"
done < "$response"
exit 0
"#,
    );
    let mut gates = FifoPair::new(&root);
    let cook = json!([
        script,
        fixture.project,
        old_response,
        new_response,
        gates.ready_path,
        gates.release_path,
        log
    ]);
    fixture.write_registry(json!([{
        "id": "project-a",
        "path": fixture.project,
        "name": "Old Project",
        "enabled": true,
        "cook": cook
    }]));
    fixture.start();

    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "old-sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();

    fixture.write_registry(json!([{
        "id": "project-a",
        "path": fixture.other_project,
        "name": "New Project",
        "enabled": true,
        "cook": cook
    }]));
    let updated = client.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(updated["payload"]["projectId"], "project-a");
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "new-get",
        "method": "snapshot.get",
        "params": {"path": fixture.other_project}
    }));
    gates.release();

    let response = client.recv_until(|frame| frame["id"] == "new-get");
    let projection = assert_ok(&response);
    assert_eq!(projection["path"], json!(fixture.other_project));
    assert_eq!(projection["tasks"][0]["title"], "new path");
    assert_eq!(
        wait_for_log_lines(&log, 2),
        [
            fixture.project.to_string_lossy().into_owned(),
            fixture.other_project.to_string_lossy().into_owned()
        ]
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_failed_runtime_watch_install_is_retried_before_changes_are_lost() {
    let mut fixture = Fixture::new(true);
    fs::remove_dir_all(fixture.other_project.join(".jeff"))
        .expect("remove project watch root before runtime registration");
    fixture.write_registry(json!([]));
    fixture.start();
    let mut client = fixture.client();
    let cook = json!([fixture.fake_cook, "--fixture"]);

    fixture.write_registry(json!([{
        "id": "project-b",
        "path": fixture.other_project,
        "name": "Pending Project",
        "enabled": true,
        "cook": cook
    }]));
    let pending = client.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(pending["payload"]["projectId"], "project-b");

    fs::create_dir_all(fixture.other_project.join(".jeff"))
        .expect("create previously missing watch root");
    fixture.write_registry(json!([{
        "id": "project-b",
        "path": fixture.other_project,
        "name": "Pending Project",
        "enabled": true,
        "cook": cook
    }]));
    let retried = client.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(retried["payload"]["projectId"], "project-b");

    fixture.set_snapshot("2026-08-10T12:00:00Z", "initial watched");
    let subscribed = client.request(
        "watch-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-b"}),
    );
    assert!(assert_ok(&subscribed)["subscriptionId"].is_string());
    fixture.set_snapshot("2026-08-10T12:01:00Z", "replacement watched");
    fixture.touch_project(&fixture.other_project, "watch-trigger");
    let replaced = client.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(
        replaced["payload"]["snapshot"]["tasks"][0]["title"],
        "replacement watched"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_cold_subscribe_emits_only_subsequent_replacements() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut gates = FifoPair::new(&root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", &gates.ready_path),
        ("FAKE_RELEASE_FIFO", &gates.release_path),
    ]);

    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();
    gates.release();
    let subscribed = client.recv_until(|frame| frame["id"] == "cold-sub");
    assert_eq!(
        assert_ok(&subscribed)["snapshot"]["tasks"][0]["title"],
        "first"
    );

    fixture.set_snapshot("2026-08-10T12:01:00Z", "subsequent");
    fixture.touch_project(&fixture.project, "subsequent-trigger");
    gates.wait_for_run();
    gates.release();
    let next = client.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(
        next["payload"]["snapshot"]["tasks"][0]["title"], "subsequent",
        "the cold snapshot must not be duplicated as a replacement event"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_oversized_frames_distinguish_known_and_unknown_request_ids() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    fixture.start();

    let mut known = fixture.client();
    let prefix =
        br#"{"v":1,"kind":"req","id":"too-big","method":"server.hello","params":{},"padding":""#;
    let mut frame = Vec::with_capacity(MAX_FRAME_BYTES + 2);
    frame.extend_from_slice(prefix);
    frame.resize(MAX_FRAME_BYTES + 1, b'x');
    frame.push(b'\n');
    known.write_raw(&frame);
    let error = known.recv();
    assert_eq!(error["id"], "too-big");
    assert_eq!(error["ok"], false);
    assert_eq!(error["error"]["code"], "frame_too_large");
    known.read_eof();

    let mut unknown = fixture.client();
    let mut frame = vec![b' '; MAX_FRAME_BYTES + 1];
    frame.push(b'\n');
    unknown.write_raw(&frame);
    unknown.read_eof();

    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_hello_and_list_require_object_params() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    fixture.start();
    let mut client = fixture.client();

    let hello = client.request("hello-scalar", "server.hello", json!(7));
    assert_eq!(hello["id"], "hello-scalar");
    assert_eq!(hello["ok"], false);
    assert_eq!(hello["error"]["code"], "invalid_params");

    let list = client.request("list-array", "project.list", json!([]));
    assert_eq!(list["id"], "list-array");
    assert_eq!(list["ok"], false);
    assert_eq!(list["error"]["code"], "invalid_params");

    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_malformed_request_echoes_a_safely_decoded_string_id() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    fixture.start();
    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "malformed-safe-id",
        "params": {}
    }));
    let error = client.recv();
    assert_eq!(error["kind"], "res");
    assert_eq!(error["id"], "malformed-safe-id");
    assert_eq!(error["ok"], false);
    assert_eq!(error["error"]["code"], "invalid_request");

    client.send(&json!({
        "v": 1,
        "kind": "res",
        "id": "response-safe-id",
        "ok": true,
        "result": {}
    }));
    let response_error = client.recv();
    assert_eq!(response_error["id"], "response-safe-id");
    assert_eq!(response_error["ok"], false);
    assert_eq!(response_error["error"]["code"], "invalid_request");
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_concurrent_cold_get_and_subscribe_share_one_invocation() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut gates = FifoPair::new(&root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", &gates.ready_path),
        ("FAKE_RELEASE_FIFO", &gates.release_path),
    ]);

    let mut getter = fixture.client();
    getter.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-get",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();

    let mut subscriber = fixture.client();
    subscriber.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-subscribe",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    subscriber.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "after-subscribe",
        "method": "server.hello",
        "params": {}
    }));
    let after_subscribe = subscriber.recv_until(|frame| frame["id"] == "after-subscribe");
    assert_eq!(assert_ok(&after_subscribe)["protocolVersion"], 1);

    gates.release();
    gates.release();
    let get = getter.recv_until(|frame| frame["id"] == "cold-get");
    let subscribe = subscriber.recv_until(|frame| frame["id"] == "cold-subscribe");
    assert_eq!(assert_ok(&get)["tasks"][0]["title"], "first");
    assert_eq!(
        assert_ok(&subscribe)["snapshot"]["tasks"][0]["title"],
        "first"
    );
    assert_eq!(
        fixture.invocations(),
        [format!(
            "{}|--fixture snapshot --json",
            fixture.project.display()
        )],
        "both cold requests must join the same active invocation"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_unsubscribe_rejects_a_different_connection() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start();
    let mut owner = fixture.client();
    assert_ok(&owner.request("warm", "snapshot.get", json!({"projectId": "project-a"})));
    let subscribed = owner.request(
        "owned-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    let subscription_id = assert_ok(&subscribed)["subscriptionId"]
        .as_str()
        .expect("subscription id")
        .to_owned();

    let mut foreign = fixture.client();
    let rejected = foreign.request(
        "foreign-unsubscribe",
        "snapshot.unsubscribe",
        json!({"subscriptionId": subscription_id}),
    );
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "unknown_subscription");
    let removed = owner.request(
        "owner-unsubscribe",
        "snapshot.unsubscribe",
        json!({"subscriptionId": subscription_id}),
    );
    assert_eq!(assert_ok(&removed), &json!({"ok": true}));
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn review_contract_disconnect_drops_subscription_ownership_before_later_events() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start();
    let mut observer = fixture.client();
    assert_ok(&observer.request("warm", "snapshot.get", json!({"projectId": "project-a"})));
    let observed = observer.request(
        "observer-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert!(assert_ok(&observed)["subscriptionId"].is_string());

    let mut disconnected = UnixStream::connect(&fixture.socket).expect("connect raw subscriber");
    disconnected
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("bound disconnected-client reads");
    let mut disconnected_reader =
        BufReader::new(disconnected.try_clone().expect("clone raw subscriber"));
    raw_send(
        &mut disconnected,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "disconnect-sub",
            "method": "snapshot.subscribe",
            "params": {"projectId": "project-a"}
        }),
    );
    let subscribed = raw_recv_until(&mut disconnected_reader, |frame| {
        frame["id"] == "disconnect-sub"
    });
    let subscription_id = assert_ok(&subscribed)["subscriptionId"]
        .as_str()
        .expect("subscription id")
        .to_owned();

    disconnected
        .shutdown(Shutdown::Write)
        .expect("disconnect subscriber write half");
    let mut byte = [0_u8; 1];
    assert_eq!(
        disconnected_reader
            .read(&mut byte)
            .expect("observe server-side disconnect closure"),
        0
    );

    fixture.set_snapshot("2026-08-10T12:02:00Z", "after disconnect");
    fixture.touch_project(&fixture.project, "disconnect-trigger");
    let replacement = observer.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(
        replacement["payload"]["snapshot"]["tasks"][0]["title"],
        "after disconnect"
    );
    assert_eq!(
        disconnected_reader
            .read(&mut byte)
            .expect("disconnected client remains closed after event"),
        0,
        "a disconnected subscriber must not receive later project events"
    );

    let rejected = observer.request(
        "removed-owner",
        "snapshot.unsubscribe",
        json!({"subscriptionId": subscription_id}),
    );
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "unknown_subscription");
    assert!(fixture.stop_and_wait().status.success());
}
