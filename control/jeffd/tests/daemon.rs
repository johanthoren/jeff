#![cfg(unix)]

mod support;

use jeff_project::ProjectRecord;
use jeffd::{load_registry, run_snapshot, SnapshotFailure};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::env;
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{symlink, PermissionsExt};
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
fn cycle_one_contract_shutdown_ends_only_established_subscriptions_before_eof() {
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
        "id": "established-sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();
    gates.release();
    let established = client.recv_until(|frame| frame["id"] == "established-sub");
    let established_subscription_id = assert_ok(&established)["subscriptionId"]
        .as_str()
        .expect("successful subscribe returns an id")
        .to_owned();

    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-get",
        "method": "snapshot.get",
        "params": {"projectId": "project-b"}
    }));
    gates.wait_for_run();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "pending-sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-b"}
    }));
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted",
        "method": "server.hello",
        "params": {}
    }));
    let accepted = client.recv_until(|frame| frame["id"] == "accepted");
    assert_eq!(assert_ok(&accepted)["protocolVersion"], 1);

    let stop = fixture.run(&["stop"]);
    assert!(stop.status.success(), "stop failed: {stop:?}");
    let frames = client.recv_all_until_eof(8);
    fixture.wait_for_exit();

    for request_id in ["cold-get", "pending-sub"] {
        let terminal = frames
            .iter()
            .filter(|frame| frame["kind"] == "res" && frame["id"] == request_id)
            .collect::<Vec<_>>();
        assert_eq!(
            terminal.len(),
            1,
            "accepted {request_id} must receive exactly one terminal response through EOF: {frames:?}"
        );
        assert_eq!(terminal[0]["ok"], false);
        assert_eq!(terminal[0]["error"]["code"], "unavailable");
    }
    let ended = frames
        .iter()
        .filter(|frame| frame["name"] == "subscription.ended")
        .collect::<Vec<_>>();
    assert_eq!(
        ended.len(),
        1,
        "only the successfully returned subscription may end: {frames:?}"
    );
    assert_eq!(
        ended[0]["payload"],
        json!({
            "subscriptionId": established_subscription_id,
            "reason": "shutdown"
        })
    );
    assert!(!fixture.socket.exists());
}

#[test]
fn cycle_one_contract_shutdown_reserves_terminal_capacity_for_accepted_cold_requests() {
    let mut fixture = Fixture::new(true);
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let project_c = root.join("project-c");
    fs::create_dir_all(project_c.join(".jeff")).expect("create third project fixture");
    fixture.write_registry(json!([
        fixture.default_record(),
        fixture.path_cook_record(),
        {
            "id": "project-c",
            "path": project_c,
            "name": "Project C",
            "enabled": true,
            "cook": [fixture.fake_cook, "--fixture"]
        }
    ]));
    let mut gates = FifoPair::new(&root);
    let mut barrier = EgressWriteBarrier::new(&root);
    let mut environment = barrier.environment();
    environment.extend([
        ("FAKE_READY_FIFO", gates.ready_path.as_path()),
        ("FAKE_RELEASE_FIFO", gates.release_path.as_path()),
        (
            "_JEFFD_TEST_LIMITS",
            Path::new("ingress=16,in_flight=16,egress_frames=1,egress_bytes=8388608"),
        ),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);

    let mut observer = fixture.client();
    observer.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "established-sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();
    gates.release();
    let established = observer.recv_until(|frame| frame["id"] == "established-sub");
    let established_subscription_id = assert_ok(&established)["subscriptionId"]
        .as_str()
        .expect("successful subscribe returns an id")
        .to_owned();

    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted-cold-b",
        "method": "snapshot.get",
        "params": {"projectId": "project-b"}
    }));
    gates.wait_for_run();

    barrier.arm();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "blocked-ordinary",
        "method": "server.hello",
        "params": {}
    }));
    barrier.wait();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "queued-ordinary",
        "method": "server.hello",
        "params": {}
    }));
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted-cold-c",
        "method": "snapshot.get",
        "params": {"projectId": "project-c"}
    }));
    gates.wait_for_run();

    let stop = fixture.run(&["stop"]);
    assert!(stop.status.success(), "stop failed: {stop:?}");
    let ended = observer.recv_until(|frame| frame["name"] == "subscription.ended");
    assert_eq!(
        ended["payload"],
        json!({
            "subscriptionId": established_subscription_id,
            "reason": "shutdown"
        }),
        "the established-subscription event is the shutdown admission barrier"
    );
    barrier.release();
    let frames = client.recv_all_until_eof(8);
    fixture.wait_for_exit();

    for request_id in ["accepted-cold-b", "accepted-cold-c"] {
        let terminal = frames
            .iter()
            .filter(|frame| frame["kind"] == "res" && frame["id"] == request_id)
            .collect::<Vec<_>>();
        assert_eq!(
            terminal.len(),
            1,
            "accepted {request_id} must receive exactly one terminal response through EOF: {frames:?}"
        );
        assert_eq!(terminal[0]["ok"], false);
        assert_eq!(terminal[0]["error"]["code"], "unavailable");
    }
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

fn raw_send_request_burst(stream: &mut UnixStream, count: usize, method: &str, params: &Value) {
    let mut bytes = Vec::new();
    for sequence in 0..count {
        serde_json::to_writer(
            &mut bytes,
            &json!({
                "v": 1,
                "kind": "req",
                "id": format!("burst-{sequence}"),
                "method": method,
                "params": params
            }),
        )
        .expect("serialize raw request burst");
        bytes.push(b'\n');
    }
    stream.write_all(&bytes).expect("write raw request burst");
    stream.flush().expect("flush raw request burst");
}

fn bounded_raw_client(socket: &Path) -> UnixStream {
    let stream = UnixStream::connect(socket).expect("connect bounded raw client");
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("bound raw client reads");
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .expect("bound raw client writes");
    stream
}

fn shrink_receive_buffer(stream: &UnixStream) {
    let receive_buffer: libc::c_int = 1024;
    assert_eq!(
        unsafe {
            libc::setsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_RCVBUF,
                (&receive_buffer as *const libc::c_int).cast(),
                std::mem::size_of_val(&receive_buffer) as libc::socklen_t,
            )
        },
        0,
        "shrink raw client receive buffer: {}",
        std::io::Error::last_os_error()
    );
}

fn raw_read_to_eof(stream: &mut UnixStream, maximum_bytes: usize) -> usize {
    let mut total = 0_usize;
    let mut chunk = [0_u8; 8192];
    loop {
        let count = stream
            .read(&mut chunk)
            .expect("read bounded raw output or EOF");
        if count == 0 {
            return total;
        }
        total = total.checked_add(count).expect("raw byte count fits usize");
        assert!(
            total <= maximum_bytes,
            "connection exceeded the bounded raw output allowance"
        );
    }
}

struct EgressWriteBarrier {
    library: PathBuf,
    arm_path: PathBuf,
    ready_path: PathBuf,
    release_path: PathBuf,
    ready: mpsc::Receiver<String>,
    release: File,
}

impl EgressWriteBarrier {
    fn new(root: &Path) -> Self {
        let source = root.join("egress-write-interpose.c");
        let library = root.join(if cfg!(target_os = "macos") {
            "egress-write-interpose.dylib"
        } else {
            "egress-write-interpose.so"
        });
        let arm_path = root.join("egress-write-arm");
        let ready_path = root.join("egress-write-ready.fifo");
        let release_path = root.join("egress-write-release.fifo");
        make_race_fifo(&ready_path);
        make_race_fifo(&release_path);
        fs::write(&source, EGRESS_WRITE_INTERPOSER).expect("write egress write interposer");
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
            .expect("compile egress write interposer");
        assert!(
            output.status.success(),
            "egress write interposer failed to compile: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let ready_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ready_path)
            .expect("open egress ready FIFO");
        let (ready_tx, ready) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(ready_file);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("read blocked egress write signal");
            ready_tx
                .send(line)
                .expect("forward blocked egress write signal");
        });
        Self {
            library,
            arm_path,
            ready,
            release: OpenOptions::new()
                .read(true)
                .write(true)
                .open(&release_path)
                .expect("open egress release FIFO"),
            ready_path,
            release_path,
        }
    }

    fn environment(&self) -> Vec<(&'static str, &Path)> {
        let mut environment = vec![
            ("_JEFFD_TEST_EGRESS_ARM", self.arm_path.as_path()),
            ("_JEFFD_TEST_EGRESS_READY", self.ready_path.as_path()),
            ("_JEFFD_TEST_EGRESS_RELEASE", self.release_path.as_path()),
        ];
        if cfg!(target_os = "macos") {
            environment.push(("DYLD_INSERT_LIBRARIES", self.library.as_path()));
            environment.push(("DYLD_FORCE_FLAT_NAMESPACE", Path::new("1")));
        } else {
            environment.push(("LD_PRELOAD", self.library.as_path()));
        }
        environment
    }

    fn arm(&self) {
        fs::write(&self.arm_path, b"armed").expect("arm egress write barrier");
    }

    fn wait(&self) {
        assert_eq!(
            self.ready
                .recv_timeout(Duration::from_secs(10))
                .expect("daemon reaches the blocked egress write"),
            "run\n"
        );
    }

    fn release(&mut self) {
        self.release
            .write_all(b"x")
            .expect("release blocked egress write");
        self.release.flush().expect("flush egress write release");
    }
}

const EGRESS_WRITE_INTERPOSER: &str = r#"
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

static int blocked = 0;

static ssize_t next_write(int descriptor, const void *buffer, size_t count) {
#ifdef __APPLE__
    return (ssize_t)syscall(SYS_write, descriptor, buffer, count);
#else
    ssize_t (*next)(int, const void *, size_t) = dlsym(RTLD_NEXT, "write");
    return next(descriptor, buffer, count);
#endif
}

static ssize_t next_send(int descriptor, const void *buffer, size_t count, int flags) {
#ifdef __APPLE__
    return (ssize_t)syscall(SYS_sendto, descriptor, buffer, count, flags, NULL, 0);
#else
    ssize_t (*next)(int, const void *, size_t, int) = dlsym(RTLD_NEXT, "send");
    return next(descriptor, buffer, count, flags);
#endif
}

static void block_socket_write(int descriptor) {
    const char *arm = getenv("_JEFFD_TEST_EGRESS_ARM");
    const char *ready = getenv("_JEFFD_TEST_EGRESS_READY");
    const char *release = getenv("_JEFFD_TEST_EGRESS_RELEASE");
    int socket_type = 0;
    socklen_t socket_type_size = sizeof(socket_type);
    if (arm == NULL || ready == NULL || release == NULL
        || access(arm, F_OK) != 0
        || getsockopt(descriptor, SOL_SOCKET, SO_TYPE, &socket_type, &socket_type_size) != 0
        || !__sync_bool_compare_and_swap(&blocked, 0, 1)) {
        return;
    }
    int ready_fd = open(ready, O_WRONLY);
    if (ready_fd >= 0) {
        next_write(ready_fd, "run\n", 4);
        close(ready_fd);
    }
    int release_fd = open(release, O_RDONLY);
    if (release_fd >= 0) {
        char byte;
        read(release_fd, &byte, 1);
        close(release_fd);
    }
}

static ssize_t hook_write(int descriptor, const void *buffer, size_t count) {
    block_socket_write(descriptor);
    return next_write(descriptor, buffer, count);
}

static ssize_t hook_send(int descriptor, const void *buffer, size_t count, int flags) {
    block_socket_write(descriptor);
    return next_send(descriptor, buffer, count, flags);
}

#ifdef __APPLE__
#define DYLD_INTERPOSE(replacement, replacee) \
    __attribute__((used)) static struct { const void *replacement; const void *replacee; } \
    _interpose_##replacee __attribute__((section("__DATA,__interpose"))) = { \
        (const void *)(unsigned long)&replacement, (const void *)(unsigned long)&replacee \
    }
DYLD_INTERPOSE(hook_write, write);
DYLD_INTERPOSE(hook_send, send);
#else
ssize_t write(int descriptor, const void *buffer, size_t count) {
    return hook_write(descriptor, buffer, count);
}

ssize_t send(int descriptor, const void *buffer, size_t count, int flags) {
    return hook_send(descriptor, buffer, count, flags);
}
#endif
"#;

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
        client.send(&json!({
            "v": 1,
            "kind": "req",
            "id": "accepted",
            "method": "server.hello",
            "params": {}
        }));
        let accepted = client.recv();
        assert_eq!(accepted["id"], "accepted");
        assert_eq!(assert_ok(&accepted)["protocolVersion"], 1);
        let stop = fixture.run(&["stop"]);
        assert!(stop.status.success(), "stop failed: {stop:?}");
        let terminal_frames = client.recv_all_until_eof(8);
        let coherent_terminal = terminal_frames
            .iter()
            .filter(|frame| frame["kind"] == "res" && frame["id"] == "sub")
            .count()
            == 1
            && terminal_frames.iter().any(|frame| {
                frame["kind"] == "res"
                    && frame["id"] == "sub"
                    && frame["ok"] == false
                    && frame["error"]["code"] == "unavailable"
            })
            && terminal_frames
                .iter()
                .all(|frame| frame["name"] != "subscription.ended");

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
        (bounded, coherent_terminal)
    };

    assert!(
        timeout_enforced,
        "snapshot timeout stopped after the direct child exited"
    );
    assert!(
        shutdown_enforced.0,
        "daemon shutdown waited for inherited capture pipes"
    );
    assert!(
        shutdown_enforced.1,
        "accepted cold subscribe must receive unavailable before inherited-pipe shutdown: {shutdown_enforced:?}"
    );
}

#[test]
fn second_recovery_contract_replacement_does_not_expose_an_unreturned_subscription() {
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
    let mut replacement_frames = Vec::new();
    while !replacement_frames
        .iter()
        .any(|frame: &Value| frame["name"] == "project.updated")
    {
        replacement_frames.push(client.recv());
    }
    gates.release();
    while !replacement_frames
        .iter()
        .any(|frame| frame["id"] == "old-sub")
    {
        replacement_frames.push(client.recv());
    }

    let updated = replacement_frames
        .iter()
        .find(|frame| frame["name"] == "project.updated")
        .expect("replacement emits project.updated");
    assert_eq!(updated["payload"]["projectId"], "project-a");

    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "new-get",
        "method": "snapshot.get",
        "params": {"path": fixture.other_project}
    }));
    while !replacement_frames
        .iter()
        .any(|frame| frame["kind"] == "res" && frame["id"] == "new-get")
    {
        replacement_frames.push(client.recv());
    }
    let current = replacement_frames
        .iter()
        .find(|frame| frame["kind"] == "res" && frame["id"] == "new-get")
        .expect("replacement path receives a current response")
        .clone();
    let projection = assert_ok(&current);
    assert_eq!(projection["path"], json!(fixture.other_project));
    assert_eq!(projection["tasks"][0]["title"], "new path");
    assert_eq!(
        wait_for_log_lines(&log, 2),
        [
            fixture.project.to_string_lossy().into_owned(),
            fixture.other_project.to_string_lossy().into_owned()
        ]
    );

    let stop = fixture.run(&["stop"]);
    assert!(stop.status.success(), "stop failed: {stop:?}");
    replacement_frames.extend(client.recv_all_until_eof(8));
    fixture.wait_for_exit();

    let terminal = replacement_frames
        .iter()
        .filter(|frame| frame["kind"] == "res" && frame["id"] == "old-sub")
        .collect::<Vec<_>>();
    assert_eq!(
        terminal.len(),
        1,
        "the pending cold subscribe must fail exactly once: {replacement_frames:?}"
    );
    assert_eq!(terminal[0]["ok"], false);
    assert_eq!(terminal[0]["error"]["code"], "unavailable");
    assert!(
        replacement_frames
            .iter()
            .all(|frame| frame["name"] != "subscription.ended"),
        "a subscription id may be ended only after its successful response was delivered: {replacement_frames:?}"
    );
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
    let subscribed = client.recv();
    assert_eq!(
        subscribed["id"], "cold-sub",
        "the subscribe response must be the first cold-subscription frame: {subscribed}"
    );
    assert_eq!(
        assert_ok(&subscribed)["snapshot"]["tasks"][0]["title"],
        "first"
    );

    fixture.set_snapshot("2026-08-10T12:01:00Z", "subsequent");
    fixture.touch_project(&fixture.project, "subsequent-trigger");
    gates.wait_for_run();
    gates.release();
    let next = client.recv();
    assert_eq!(next["name"], "snapshot.replaced");
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

#[test]
fn cycle_one_contract_invalid_reload_preserves_state_while_invalid_is_installed() {
    let mut fixture = Fixture::new(true);
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let generation_cook = root.join("generation-cook");
    let obsolete_snapshot = root.join("obsolete-generation.json");
    let fresh_snapshot = root.join("fresh-generation.json");
    let generation_count = root.join("generation-count");
    let generation_log = root.join("generation.log");
    let mut generation_gate = FifoPair::new(&root);
    fs::write(
        &obsolete_snapshot,
        support::snapshot("2026-08-10T13:00:00Z", "obsolete generation"),
    )
    .expect("write obsolete generation");
    fs::write(
        &fresh_snapshot,
        support::snapshot("2026-08-10T13:01:00Z", "fresh generation"),
    )
    .expect("write fresh generation");
    fs::write(&generation_count, "0\n").expect("initialize generation counter");
    fs::write(&generation_log, "").expect("initialize generation log");
    write_executable(
        &generation_cook,
        r#"#!/bin/sh
obsolete=$1
fresh=$2
count_file=$3
ready=$4
release=$5
log=$6
count=0
IFS= read -r count < "$count_file"
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"
printf '%s\n' "$PWD" >> "$log"
if [ "$count" -eq 1 ]; then
  parent=$$
  (
    while kill -0 "$parent" 2>/dev/null; do :; done
    printf 'run\n' > "$ready"
    IFS= read -r _release < "$release"
  ) &
  response=$obsolete
else
  response=$fresh
fi
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line"
done < "$response"
exit 0
"#,
    );

    let generation_a = json!({
        "id": "project-a",
        "path": fixture.project,
        "name": "Generation A",
        "enabled": true,
        "cook": [
            generation_cook,
            obsolete_snapshot,
            fresh_snapshot,
            generation_count,
            generation_gate.ready_path,
            generation_gate.release_path,
            generation_log
        ]
    });
    let mut generation_b = generation_a.clone();
    generation_b["name"] = json!("Generation B");
    let retained = fixture.path_cook_record();
    let registry_a = json!([generation_a, retained]);
    fixture.write_registry(registry_a.clone());
    fixture.start();

    let mut retained_client = fixture.client();
    let retained_subscription = retained_client.request(
        "retained-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-b"}),
    );
    assert_eq!(
        assert_ok(&retained_subscription)["snapshot"]["tasks"][0]["title"],
        "first"
    );
    assert_eq!(
        wait_for_log_lines(&fixture.log, 1),
        [format!(
            "{}|snapshot --json",
            fixture.other_project.to_string_lossy()
        )]
    );

    let mut daemon_stderr = fixture.take_stderr();
    let (reload_tx, reload_rx) = mpsc::channel();
    let reload_reader = thread::spawn(move || loop {
        let mut line = String::new();
        let bytes = daemon_stderr
            .read_line(&mut line)
            .expect("read daemon registry diagnostic");
        if bytes == 0 {
            break;
        }
        if line.contains("registry reload ignored") {
            reload_tx
                .send(())
                .expect("signal invalid registry rejection");
        }
    });
    fs::write(fixture.registry_path(), b"{invalid runtime registry")
        .expect("write invalid regular registry");
    reload_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("daemon rejects the invalid regular registry");
    retained_client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "list-after-invalid",
        "method": "project.list",
        "params": {}
    }));

    let listed = retained_client.recv_until(|frame| frame["id"] == "list-after-invalid");
    let rows = assert_ok(&listed)["projects"]
        .as_array()
        .expect("project list rows");
    assert_eq!(
        rows.iter()
            .map(|row| row["id"].as_str().expect("listed project id"))
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["project-a", "project-b"])
    );
    let cached = retained_client.request(
        "get-after-invalid",
        "snapshot.get",
        json!({"projectId": "project-b"}),
    );
    assert_eq!(assert_ok(&cached)["tasks"][0]["title"], "first");

    fixture.set_snapshot("2026-08-10T13:02:00Z", "after invalid reload");
    fixture.touch_project(&fixture.other_project, "after-invalid-trigger");
    assert_eq!(
        wait_for_log_lines(&fixture.log, 2),
        [
            format!(
                "{}|snapshot --json",
                fixture.other_project.to_string_lossy()
            ),
            format!(
                "{}|snapshot --json",
                fixture.other_project.to_string_lossy()
            ),
        ]
    );
    let retained_replacement =
        retained_client.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(
        retained_replacement["payload"]["snapshot"]["tasks"][0]["title"],
        "after invalid reload"
    );
    let status_while_invalid = fixture.run(&["status"]);
    assert!(
        status_while_invalid.status.success(),
        "status remains responsive while invalid registry content is installed: {status_while_invalid:?}"
    );
    fixture.write_registry(registry_a.clone());

    let mut obsolete_client = fixture.client();
    obsolete_client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "obsolete-get",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    generation_gate.wait_for_run();

    let mut current_client = fixture.client();
    fixture.write_registry(json!([generation_b, fixture.path_cook_record()]));
    let generation_b_update = current_client.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(generation_b_update["payload"]["projectId"], "project-a");
    fixture.write_registry(registry_a);
    let generation_a_update = current_client.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(generation_a_update["payload"]["projectId"], "project-a");
    current_client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "current-get",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    generation_gate.release();
    let current =
        current_client.recv_until(|frame| frame["kind"] == "res" && frame["id"] == "current-get");
    let current_title = assert_ok(&current)["tasks"][0]["title"]
        .as_str()
        .expect("current generation title")
        .to_owned();
    let generation_invocations = fs::read_to_string(&generation_log)
        .expect("read generation invocation log")
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    while reload_rx.try_recv().is_ok() {}
    fs::write(fixture.registry_path(), b"{invalid before shutdown")
        .expect("install invalid regular registry before shutdown");
    reload_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("daemon observes invalid registry before shutdown");
    let stop = fixture.stop_and_wait();
    reload_reader
        .join()
        .expect("join registry diagnostic reader");
    assert!(stop.status.success());

    assert_eq!(current_title, "fresh generation");
    assert_eq!(
        generation_invocations,
        [
            fixture.project.to_string_lossy().into_owned(),
            fixture.project.to_string_lossy().into_owned(),
        ],
        "A restored after A→B→A must launch a new immutable generation"
    );
}

#[test]
fn second_recovery_contract_disabled_rows_and_typed_selectors_fail_without_hidden_work() {
    let mut fixture = Fixture::new(true);
    let disabled = json!({
        "id": "project-disabled",
        "path": fixture.other_project,
        "name": "Disabled Project",
        "enabled": false,
        "cook": [fixture.fake_cook, "--disabled"]
    });
    fixture.write_registry(json!([fixture.default_record(), disabled]));
    fixture.start();
    let mut client = fixture.client();

    let listed = client.request("list", "project.list", json!({}));
    let rows = assert_ok(&listed)["projects"]
        .as_array()
        .expect("project list rows");
    let disabled_row = rows
        .iter()
        .find(|row| row["id"] == "project-disabled")
        .expect("disabled project remains listable");
    assert_eq!(disabled_row["enabled"], false);

    let disabled_get = client.request(
        "disabled-get",
        "snapshot.get",
        json!({"projectId": "project-disabled"}),
    );
    let disabled_subscribe = client.request(
        "disabled-subscribe",
        "snapshot.subscribe",
        json!({"path": fixture.other_project}),
    );
    assert_eq!(
        (
            disabled_get["error"]["code"].clone(),
            disabled_subscribe["error"]["code"].clone(),
        ),
        (json!("unavailable"), json!("unavailable"))
    );
    assert!(
        fixture.invocations().is_empty(),
        "disabled get and subscribe must not invoke cook"
    );

    let mixed_get = client.request(
        "mixed-get",
        "snapshot.get",
        json!({"projectId": "project-a", "path": 7}),
    );
    let mixed_subscribe = client.request(
        "mixed-subscribe",
        "snapshot.subscribe",
        json!({"projectId": 7, "path": fixture.project}),
    );
    let mixed_codes = (
        mixed_get["error"]["code"].clone(),
        mixed_subscribe["error"]["code"].clone(),
    );
    assert!(fixture.stop_and_wait().status.success());

    assert_eq!(
        mixed_codes,
        (json!("invalid_selector"), json!("invalid_selector")),
        "get and subscribe must reject a present selector with the wrong type"
    );
}

#[test]
fn second_recovery_contract_shutdown_interrupts_a_blocked_connection_writer() {
    const RESPONSE_TITLE_BYTES: usize = MAX_FRAME_BYTES / 64;
    const RESPONSE_COUNT: usize = 128;

    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-10T14:00:00Z", &"x".repeat(RESPONSE_TITLE_BYTES));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("ingress=256,in_flight=256,egress_frames=256,egress_bytes=67108864"),
    )]);
    let socket = fixture.socket.clone();
    let mut stalled = UnixStream::connect(&socket).expect("connect stalled output client");
    stalled
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("bound stalled-client reads");
    stalled
        .set_write_timeout(Some(Duration::from_secs(10)))
        .expect("bound stalled-client writes");
    let receive_buffer: libc::c_int = 1024;
    assert_eq!(
        unsafe {
            libc::setsockopt(
                stalled.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_RCVBUF,
                (&receive_buffer as *const libc::c_int).cast(),
                std::mem::size_of_val(&receive_buffer) as libc::socklen_t,
            )
        },
        0,
        "shrink stalled client receive buffer: {}",
        std::io::Error::last_os_error()
    );
    for sequence in 0..RESPONSE_COUNT {
        raw_send(
            &mut stalled,
            &json!({
                "v": 1,
                "kind": "req",
                "id": format!("blocked-snapshot-{sequence}"),
                "method": "snapshot.get",
                "params": {"projectId": "project-a"}
            }),
        );
    }
    let mut first_response_byte = [0_u8; 1];
    stalled
        .read_exact(&mut first_response_byte)
        .expect("server begins the bounded repeated snapshot responses");

    let stop = fixture.run(&["stop"]);
    assert!(stop.status.success(), "stop failed: {stop:?}");
    let (exit_tx, exit_rx) = mpsc::channel();
    let waiter = thread::spawn(move || {
        fixture.wait_for_exit();
        exit_tx.send(()).expect("send blocked-writer daemon exit");
    });
    let shutdown_was_bounded = exit_rx.recv_timeout(Duration::from_secs(2)).is_ok();
    drop(stalled);
    if !shutdown_was_bounded {
        exit_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("daemon exits after stalled client closes");
    }
    waiter.join().expect("join blocked-writer daemon waiter");

    assert!(
        shutdown_was_bounded,
        "shutdown must interrupt blocked connection output before joining the writer"
    );
    assert!(!socket.exists(), "bounded shutdown removes the listener");
}

struct LifecycleWriteBarrier {
    library: PathBuf,
    ready_path: PathBuf,
    release_path: PathBuf,
    ready: mpsc::Receiver<String>,
    release: File,
}

impl LifecycleWriteBarrier {
    fn new(root: &Path) -> Self {
        let source = root.join("lifecycle-write-interpose.c");
        let library = root.join(if cfg!(target_os = "macos") {
            "lifecycle-write-interpose.dylib"
        } else {
            "lifecycle-write-interpose.so"
        });
        let ready_path = root.join("lifecycle-write-ready.fifo");
        let release_path = root.join("lifecycle-write-release.fifo");
        make_race_fifo(&ready_path);
        make_race_fifo(&release_path);
        fs::write(&source, LIFECYCLE_WRITE_INTERPOSER).expect("write lifecycle write interposer");
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
            .expect("compile lifecycle write interposer");
        assert!(
            output.status.success(),
            "lifecycle write interposer failed to compile: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let ready_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ready_path)
            .expect("open lifecycle ready FIFO");
        let (ready_tx, ready) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(ready_file);
            for _ in 0..2 {
                let mut line = String::new();
                reader
                    .read_line(&mut line)
                    .expect("read blocked lifecycle request signal");
                ready_tx
                    .send(line)
                    .expect("forward blocked lifecycle request signal");
            }
        });
        Self {
            library,
            ready_path: ready_path.clone(),
            release_path: release_path.clone(),
            ready,
            release: OpenOptions::new()
                .read(true)
                .write(true)
                .open(release_path)
                .expect("open lifecycle release FIFO"),
        }
    }

    fn install(&self, command: &mut Command) {
        command
            .env("JEFFD_TEST_LIFECYCLE_READY", &self.ready_path)
            .env("JEFFD_TEST_LIFECYCLE_RELEASE", &self.release_path);
        if cfg!(target_os = "macos") {
            command
                .env("DYLD_INSERT_LIBRARIES", &self.library)
                .env("DYLD_FORCE_FLAT_NAMESPACE", "1");
        } else {
            command.env("LD_PRELOAD", &self.library);
        }
    }

    fn wait_for_request(&self) {
        assert_eq!(
            self.ready
                .recv_timeout(Duration::from_secs(10))
                .expect("lifecycle command reaches the blocked request write"),
            "run\n"
        );
    }

    fn release(&mut self) {
        self.release
            .write_all(b"x")
            .expect("release lifecycle request");
        self.release.flush().expect("flush lifecycle release");
    }
}

fn spawn_blocked_lifecycle(
    fixture: &Fixture,
    barrier: &LifecycleWriteBarrier,
    command_name: &str,
) -> std::process::Child {
    let mut command = fixture.command();
    command.arg(command_name);
    barrier.install(&mut command);
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn blocked lifecycle command")
}

#[test]
fn council_recovery_contract_lifecycle_demultiplexes_project_events_before_hello() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    fixture.start();
    let mut observer = fixture.client();
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut barrier = LifecycleWriteBarrier::new(&root);

    let status = spawn_blocked_lifecycle(&fixture, &barrier, "status");
    barrier.wait_for_request();
    fixture.write_registry(json!([fixture.default_record()]));
    let status_event = observer.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(status_event["payload"]["projectId"], "project-a");
    barrier.release();
    let status = status
        .wait_with_output()
        .expect("wait for interleaved status command");

    let stop = spawn_blocked_lifecycle(&fixture, &barrier, "stop");
    barrier.wait_for_request();
    fixture.write_registry(json!([]));
    let stop_event = observer.recv_until(|frame| frame["name"] == "project.updated");
    assert_eq!(stop_event["payload"]["projectId"], "project-a");
    barrier.release();
    let stop = stop
        .wait_with_output()
        .expect("wait for interleaved stop command");
    if !stop.status.success() {
        fixture.signal(libc::SIGTERM);
    }
    fixture.wait_for_exit();

    assert!(
        status.status.success(),
        "status must skip the permitted event and match its lifecycle response: {status:?}"
    );
    assert!(
        stop.status.success(),
        "stop must skip the permitted event, match its lifecycle response, and signal the daemon: {stop:?}"
    );
    assert!(!fixture.socket.exists());
}

#[test]
fn council_recovery_contract_maximum_legal_request_cannot_expand_outbound() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    fixture.start();
    let mut client = fixture.client();
    let prefix = br#"{"v":1,"kind":"req","id":""#;
    let suffix = br#"","method":"server.hello","params":{}}"#;
    let id_bytes = MAX_FRAME_BYTES
        .checked_sub(prefix.len() + suffix.len())
        .expect("request envelope fits frame limit");
    let mut frame = Vec::with_capacity(MAX_FRAME_BYTES + 1);
    frame.extend_from_slice(prefix);
    frame.resize(frame.len() + id_bytes, b'x');
    frame.extend_from_slice(suffix);
    assert_eq!(frame.len(), MAX_FRAME_BYTES);
    frame.push(b'\n');

    client.write_raw(&frame);
    let outbound_bytes = client.read_one_byte();
    let stop = fixture.stop_and_wait();

    assert_eq!(
        outbound_bytes, 0,
        "an unechoable maximum-size request id must close without any oversized outbound frame"
    );
    assert!(stop.status.success(), "daemon remains responsive: {stop:?}");
}

#[test]
fn cycle_one_contract_oversized_snapshot_response_closes_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-11T03:00:00Z", &"x".repeat(MAX_FRAME_BYTES));
    fixture.start();

    let mut offender = fixture.client();
    offender.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "short-safe-id",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    assert_eq!(
        offender.read_one_byte(),
        0,
        "an oversized result reached from a safe short id must emit no partial frame"
    );
    let mut healthy = fixture.client();
    let hello = healthy.request("healthy", "server.hello", json!({}));
    assert_eq!(assert_ok(&hello)["protocolVersion"], 1);
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn cycle_one_contract_ingress_full_shutdown_cannot_block_reader_join() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-11T03:01:00Z", &"\n".repeat(MAX_FRAME_BYTES / 2));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("ingress=4,in_flight=32,egress_frames=32,egress_bytes=67108864"),
    )]);

    let mut warm = fixture.client();
    warm.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "warm-escaped-cache",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    warm.read_eof();

    let mut saturated = bounded_raw_client(&fixture.socket);
    raw_send_request_burst(
        &mut saturated,
        8,
        "snapshot.get",
        &json!({"projectId": "project-a"}),
    );
    assert_eq!(
        raw_read_to_eof(&mut saturated, 1),
        0,
        "the full ingress reader closes before its termination notification"
    );
    fixture.signal(libc::SIGTERM);
    fixture.wait_for_exit();
    assert!(!fixture.socket.exists());
}

#[test]
fn cycle_one_contract_oversized_input_shutdown_cannot_block_reader_join() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-11T03:01:30Z", &"\n".repeat(MAX_FRAME_BYTES / 2));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("ingress=64,in_flight=256,egress_frames=32,egress_bytes=67108864"),
    )]);

    let mut warm = fixture.client();
    warm.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "warm-oversized-cache",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    warm.read_eof();

    let mut owner_filler = bounded_raw_client(&fixture.socket);
    raw_send_request_burst(
        &mut owner_filler,
        128,
        "snapshot.get",
        &json!({"projectId": "project-a"}),
    );

    let mut oversized = bounded_raw_client(&fixture.socket);
    let mut frame = br#"{"v":1,"kind":"req","id":"oversized-input","#.to_vec();
    frame.resize(MAX_FRAME_BYTES + 1, b'x');
    oversized
        .write_all(&frame)
        .expect("write the over-limit input frame");
    oversized.flush().expect("flush the over-limit input frame");

    fixture.signal(libc::SIGTERM);
    fixture.wait_for_exit();
    assert!(!fixture.socket.exists());
}

#[test]
fn cycle_one_contract_ingress_full_closes_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-11T03:02:00Z", &"x".repeat(MAX_FRAME_BYTES / 4));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("ingress=4,in_flight=16,egress_frames=32,egress_bytes=67108864"),
    )]);
    let mut warm = fixture.client();
    let subscribed = warm.request(
        "warm-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert!(assert_ok(&subscribed)["subscriptionId"].is_string());

    let mut offender = bounded_raw_client(&fixture.socket);
    raw_send_request_burst(
        &mut offender,
        8,
        "snapshot.get",
        &json!({"projectId": "project-a"}),
    );
    raw_read_to_eof(&mut offender, 16 * 1024 * 1024);
    fixture.set_snapshot("2026-08-11T03:02:01Z", "healthy after ingress saturation");
    fixture.touch_project(&fixture.project, "after-ingress-saturation");
    let replaced = warm.recv_until(|frame| frame["name"] == "snapshot.replaced");
    assert_eq!(
        replaced["payload"]["snapshot"]["tasks"][0]["title"],
        "healthy after ingress saturation"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn cycle_one_contract_in_flight_full_closes_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-11T03:03:00Z", &"x".repeat(MAX_FRAME_BYTES / 4));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("ingress=16,in_flight=1,egress_frames=32,egress_bytes=67108864"),
    )]);
    let mut warm = fixture.client();
    let warmed = warm.request("warm", "snapshot.get", json!({"projectId": "project-a"}));
    assert_eq!(
        assert_ok(&warmed)["tasks"][0]["title"]
            .as_str()
            .unwrap()
            .len(),
        MAX_FRAME_BYTES / 4
    );

    let mut offender = bounded_raw_client(&fixture.socket);
    raw_send_request_burst(
        &mut offender,
        4,
        "snapshot.get",
        &json!({"projectId": "project-a"}),
    );
    raw_read_to_eof(&mut offender, 16 * 1024 * 1024);
    let mut healthy = fixture.client();
    let hello = healthy.request("healthy", "server.hello", json!({}));
    assert_eq!(assert_ok(&hello)["protocolVersion"], 1);
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn cycle_one_contract_egress_frame_full_closes_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut barrier = EgressWriteBarrier::new(&root);
    let mut environment = barrier.environment();
    environment.push((
        "_JEFFD_TEST_LIMITS",
        Path::new("ingress=16,in_flight=16,egress_frames=1,egress_bytes=8388608"),
    ));
    fixture.start_with_env(&environment);
    drop(environment);

    let mut offender = bounded_raw_client(&fixture.socket);
    barrier.arm();
    raw_send(
        &mut offender,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "blocked-frame",
            "method": "snapshot.get",
            "params": {"projectId": "project-a"}
        }),
    );
    barrier.wait();
    raw_send_request_burst(
        &mut offender,
        2,
        "snapshot.get",
        &json!({"projectId": "project-a"}),
    );

    assert_eq!(
        raw_read_to_eof(&mut offender, 1),
        0,
        "the frame beyond the single queued slot closes only its connection"
    );
    barrier.release();
    let mut healthy = fixture.client();
    let hello = healthy.request("healthy", "server.hello", json!({}));
    assert_eq!(assert_ok(&hello)["protocolVersion"], 1);
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn cycle_one_contract_global_egress_bytes_close_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.set_snapshot("2026-08-11T03:05:00Z", &"x".repeat(MAX_FRAME_BYTES / 4));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut gates = FifoPair::new(&root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", &gates.ready_path),
        ("FAKE_RELEASE_FIFO", &gates.release_path),
        (
            "_JEFFD_TEST_LIMITS",
            Path::new("ingress=16,in_flight=16,egress_frames=4,egress_bytes=6291456"),
        ),
    ]);

    let mut holder = bounded_raw_client(&fixture.socket);
    shrink_receive_buffer(&holder);
    raw_send(
        &mut holder,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "global-holder",
            "method": "snapshot.get",
            "params": {"projectId": "project-a"}
        }),
    );
    gates.wait_for_run();
    gates.release();
    let mut first_byte = [0_u8; 1];
    holder
        .read_exact(&mut first_byte)
        .expect("holder starts one globally accounted frame");

    let mut offender = bounded_raw_client(&fixture.socket);
    shrink_receive_buffer(&offender);
    raw_send(
        &mut offender,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "global-overflow",
            "method": "snapshot.get",
            "params": {"projectId": "project-a"}
        }),
    );
    assert_eq!(
        raw_read_to_eof(&mut offender, 1),
        0,
        "aggregate bytes reject the second connection before any frame is written"
    );
    let mut healthy = fixture.client();
    let hello = healthy.request("healthy", "server.hello", json!({}));
    assert_eq!(assert_ok(&hello)["protocolVersion"], 1);
    drop(holder);
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn council_recovery_contract_connection_and_retained_buffer_caps_preserve_progress() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("connections=3,frame_bytes=256"),
    )]);
    let mut healthy = fixture.client();
    let mut retained_a =
        UnixStream::connect(&fixture.socket).expect("connect first retained reader");
    let mut retained_b =
        UnixStream::connect(&fixture.socket).expect("connect second retained reader");
    retained_a
        .write_all(&vec![b' '; 256])
        .expect("fill first bounded reader buffer");
    retained_b
        .write_all(&vec![b' '; 256])
        .expect("fill second bounded reader buffer");
    let mut overflow = fixture.client();
    overflow.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "over-connection-cap",
        "method": "server.hello",
        "params": {}
    }));
    let overflow_bytes = overflow.read_one_byte();
    let healthy_hello = healthy.request("healthy", "server.hello", json!({}));
    drop(retained_a);
    drop(retained_b);
    let stop = fixture.stop_and_wait();

    assert_eq!(
        overflow_bytes, 0,
        "the connection beyond the injected finite cap must close"
    );
    assert_eq!(assert_ok(&healthy_hello)["protocolVersion"], 1);
    assert!(stop.status.success());
}

#[test]
fn cycle_one_contract_cold_waiter_full_closes_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut gates = FifoPair::new(&root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", &gates.ready_path),
        ("FAKE_RELEASE_FIFO", &gates.release_path),
        (
            "_JEFFD_TEST_LIMITS",
            Path::new("ingress=16,in_flight=16,cold_waiters=2"),
        ),
    ]);
    let mut offender = fixture.client();
    offender.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-get-1",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();
    offender.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-sub-2",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    offender.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted-two",
        "method": "server.hello",
        "params": {}
    }));
    let accepted = offender.recv_until(|frame| frame["id"] == "accepted-two");
    assert_eq!(assert_ok(&accepted)["protocolVersion"], 1);
    offender.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "cold-get-over-limit",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));

    let mut healthy = fixture.client();
    let healthy_hello = healthy.request("healthy", "server.hello", json!({}));
    gates.release();
    let offender_bytes = offender.read_one_byte();
    let stop = fixture.stop_and_wait();

    assert_eq!(
        offender_bytes, 0,
        "the request beyond the cold-waiter cap must close its connection"
    );
    assert_eq!(assert_ok(&healthy_hello)["protocolVersion"], 1);
    assert!(stop.status.success());
}

#[test]
fn cycle_one_contract_per_connection_egress_bytes_close_only_the_offender() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("egress_frames=4,egress_bytes=256"),
    )]);
    let mut offender = fixture.client();
    offender.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "projection-exceeds-egress-budget",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    let offender_bytes = offender.read_one_byte();
    let mut healthy = fixture.client();
    let healthy_hello = healthy.request("healthy", "server.hello", json!({}));
    let stop = fixture.stop_and_wait();

    assert_eq!(
        offender_bytes, 0,
        "a response beyond the per-connection byte budget must close its connection"
    );
    assert_eq!(assert_ok(&healthy_hello)["protocolVersion"], 1);
    assert!(stop.status.success());
}

#[test]
fn council_recovery_contract_registry_rejects_symlinks_and_non_regular_entries() {
    let root = tempfile::tempdir().expect("create isolated registry root");
    let regular = root.path().join("regular.json");
    let symlinked = root.path().join("symlinked.json");
    let directory = root.path().join("directory");
    fs::write(&regular, "[]").expect("write regular registry target");
    symlink(&regular, &symlinked).expect("create registry symlink");
    fs::create_dir(&directory).expect("create non-regular registry directory");

    let symlink_error = load_registry(&symlinked)
        .err()
        .map(|error| error.to_string());
    let directory_error = load_registry(&directory)
        .err()
        .map(|error| error.to_string());

    assert!(
        symlink_error
            .as_deref()
            .is_some_and(|error| error.contains("regular file")),
        "a registry symlink must be rejected before its target is opened: {symlink_error:?}"
    );
    assert!(
        directory_error
            .as_deref()
            .is_some_and(|error| error.contains("regular file")),
        "a registry directory must be rejected before it is opened: {directory_error:?}"
    );
}

#[test]
fn council_recovery_contract_registry_fifo_is_rejected_without_blocking() {
    let root = tempfile::tempdir().expect("create isolated registry root");
    let fifo = root.path().join("projects.json");
    let encoded =
        CString::new(fifo.as_os_str().as_encoded_bytes()).expect("FIFO path has no NUL byte");
    assert_eq!(
        unsafe { libc::mkfifo(encoded.as_ptr(), 0o600) },
        0,
        "create registry FIFO: {}",
        std::io::Error::last_os_error()
    );
    let worker_fifo = fifo.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        result_tx
            .send(load_registry(&worker_fifo))
            .expect("send registry load result");
    });

    let bounded = result_rx.recv_timeout(Duration::from_millis(250));
    let rejected_without_blocking = matches!(
        &bounded,
        Ok(Err(error)) if error.to_string().contains("regular file")
    );
    if bounded.is_err() {
        let mut writer = OpenOptions::new()
            .write(true)
            .open(&fifo)
            .expect("release the currently blocking registry reader");
        writer
            .write_all(b"[]")
            .expect("write cleanup registry payload");
        drop(writer);
        let cleanup = result_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("registry reader exits after cleanup");
        assert!(
            cleanup.is_ok(),
            "current reader must consume the cleanup registry payload"
        );
    }
    worker.join().expect("join registry reader");

    assert!(
        rejected_without_blocking,
        "a FIFO must be rejected from metadata without waiting for a writer"
    );
}

#[test]
fn council_recovery_contract_registry_has_a_finite_one_mibibyte_input_bound() {
    const REGISTRY_LIMIT_BYTES: usize = 1024 * 1024;
    let root = tempfile::tempdir().expect("create isolated registry root");
    let registry = root.path().join("projects.json");
    let oversized = json!([{
        "id": "demo",
        "path": root.path().join("project"),
        "name": "x".repeat(REGISTRY_LIMIT_BYTES),
        "enabled": false,
        "cook": null
    }]);
    fs::write(
        &registry,
        serde_json::to_vec(&oversized).expect("serialize bounded oversized registry"),
    )
    .expect("write bounded oversized registry");

    let message = match load_registry(&registry) {
        Ok(_) => String::new(),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("exceeds") && message.contains("1048576"),
        "registry rejection must name its finite byte limit: {message}"
    );
}

struct RecoveryGate {
    arm_path: PathBuf,
    ready_path: PathBuf,
    release_path: PathBuf,
    ready: mpsc::Receiver<String>,
    release: File,
}

impl RecoveryGate {
    fn new(root: &Path, name: &str) -> Self {
        let arm_path = root.join(format!("{name}-arm"));
        let ready_path = root.join(format!("{name}-ready.fifo"));
        let release_path = root.join(format!("{name}-release.fifo"));
        make_race_fifo(&ready_path);
        make_race_fifo(&release_path);
        let ready_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ready_path)
            .expect("open recovery ready FIFO");
        let (ready_tx, ready) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(ready_file);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("read recovery readiness");
            ready_tx.send(line).expect("forward recovery readiness");
        });
        Self {
            arm_path,
            ready,
            release: OpenOptions::new()
                .read(true)
                .write(true)
                .open(&release_path)
                .expect("open recovery release FIFO"),
            ready_path,
            release_path,
        }
    }

    fn environment(&self) -> [(&'static str, &Path); 3] {
        [
            ("_JEFFD_TEST_OWNER_ARM", self.arm_path.as_path()),
            ("_JEFFD_TEST_OWNER_READY", self.ready_path.as_path()),
            ("_JEFFD_TEST_OWNER_RELEASE", self.release_path.as_path()),
        ]
    }

    fn arm(&self) {
        fs::write(&self.arm_path, b"armed").expect("arm recovery owner gate");
    }

    fn wait(&mut self) {
        assert_eq!(
            self.ready
                .recv_timeout(Duration::from_secs(10))
                .expect("daemon reaches the recovery synchronization point"),
            "run\n"
        );
    }

    fn release(&mut self) {
        if let Err(error) = fs::remove_file(&self.arm_path) {
            assert_eq!(
                error.kind(),
                std::io::ErrorKind::NotFound,
                "disarm recovery owner gate: {error}"
            );
        }
        self.release
            .write_all(b"continue\n")
            .expect("release recovery owner gate");
        self.release.flush().expect("flush recovery owner release");
    }
}

#[test]
fn task_236_contract_terminal_capacity_survives_connection_bytes_and_returned_subscription() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([
        fixture.default_record(),
        fixture.path_cook_record()
    ]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut snapshot_gate = FifoPair::new(&root);
    let mut write_barrier = EgressWriteBarrier::new(&root);
    let blocked_id = "b".repeat(700);
    let blocked_bytes = serde_json::to_vec(&json!({
        "v": 1,
        "kind": "res",
        "id": blocked_id,
        "ok": true,
        "result": {
            "protocolVersion": 1,
            "serverVersion": env!("CARGO_PKG_VERSION"),
            "snapshotSchemaMin": 1,
            "snapshotSchemaMax": 1
        }
    }))
    .expect("serialize exact blocked response")
    .len();
    let limits = PathBuf::from(format!(
        "ingress=16,in_flight=16,egress_frames=1,egress_bytes={blocked_bytes},global_egress_bytes=8192"
    ));
    let mut environment = write_barrier.environment();
    environment.extend([
        ("FAKE_READY_FIFO", snapshot_gate.ready_path.as_path()),
        ("FAKE_RELEASE_FIFO", snapshot_gate.release_path.as_path()),
        ("_JEFFD_TEST_LIMITS", limits.as_path()),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);

    let mut target = fixture.client();
    target.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "returned-subscription",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    snapshot_gate.wait_for_run();
    snapshot_gate.release();
    let returned = target.recv_until(|frame| frame["id"] == "returned-subscription");
    let returned_id = assert_ok(&returned)["subscriptionId"]
        .as_str()
        .expect("returned subscription id")
        .to_owned();
    target.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted-cold-get",
        "method": "snapshot.get",
        "params": {"projectId": "project-b"}
    }));
    snapshot_gate.wait_for_run();

    let mut terminal_barrier = fixture.client();
    terminal_barrier.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted-after-target",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-b"}
    }));
    terminal_barrier.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "barrier-accepted",
        "method": "server.hello",
        "params": {}
    }));
    assert_ok(&terminal_barrier.recv_until(|frame| frame["id"] == "barrier-accepted"));

    write_barrier.arm();
    target.send(&json!({
        "v": 1,
        "kind": "req",
        "id": blocked_id,
        "method": "server.hello",
        "params": {}
    }));
    write_barrier.wait();
    fixture.signal(libc::SIGTERM);
    let barrier_terminal =
        terminal_barrier.recv_until(|frame| frame["id"] == "accepted-after-target");
    assert_eq!(barrier_terminal["error"]["code"], "unavailable");
    write_barrier.release();
    let target_frames = target.recv_all_until_eof(6);
    terminal_barrier.recv_all_until_eof(4);
    fixture.wait_for_exit();
    let terminal = target_frames
        .iter()
        .filter(|frame| frame["id"] == "accepted-cold-get")
        .collect::<Vec<_>>();
    assert_eq!(terminal.len(), 1, "target frames: {target_frames:?}");
    assert_eq!(terminal[0]["error"]["code"], "unavailable");
    assert!(
        target_frames.iter().any(|frame| {
            frame["name"] == "subscription.ended"
                && frame["payload"]["subscriptionId"] == returned_id
        }),
        "the same connection's returned subscription must end after its cold terminal response: {target_frames:?}"
    );
}

#[test]
fn task_236_contract_terminal_capacity_survives_global_ordinary_bytes() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.path_cook_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut snapshot_gate = FifoPair::new(&root);
    let mut write_barrier = EgressWriteBarrier::new(&root);
    let mut shutdown_gate = RecoveryGate::new(&root, "shutdown-terminals");
    let blocked_id = "g".repeat(700);
    let blocked_bytes = serde_json::to_vec(&json!({
        "v": 1,
        "kind": "res",
        "id": blocked_id,
        "ok": true,
        "result": {
            "protocolVersion": 1,
            "serverVersion": env!("CARGO_PKG_VERSION"),
            "snapshotSchemaMin": 1,
            "snapshotSchemaMax": 1
        }
    }))
    .expect("serialize exact globally blocked response")
    .len();
    let limits = PathBuf::from(format!(
        "ingress=16,in_flight=16,egress_frames=2,egress_bytes=8192,global_egress_bytes={blocked_bytes}"
    ));
    let mut environment = write_barrier.environment();
    environment.extend([
        ("FAKE_READY_FIFO", snapshot_gate.ready_path.as_path()),
        ("FAKE_RELEASE_FIFO", snapshot_gate.release_path.as_path()),
        (
            "_JEFFD_TEST_SHUTDOWN_TERMINALS_DONE",
            shutdown_gate.ready_path.as_path(),
        ),
        ("_JEFFD_TEST_LIMITS", limits.as_path()),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);

    let mut target = fixture.client();
    target.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "accepted-global-cold",
        "method": "snapshot.get",
        "params": {"projectId": "project-b"}
    }));
    snapshot_gate.wait_for_run();
    let mut holder = fixture.client();
    write_barrier.arm();
    holder.send(&json!({
        "v": 1,
        "kind": "req",
        "id": blocked_id,
        "method": "server.hello",
        "params": {}
    }));
    write_barrier.wait();

    fixture.signal(libc::SIGTERM);
    shutdown_gate.wait();
    write_barrier.release();
    let frames = target.recv_all_until_eof(3);
    fixture.wait_for_exit();
    let terminal = frames
        .iter()
        .filter(|frame| frame["id"] == "accepted-global-cold")
        .collect::<Vec<_>>();
    assert_eq!(terminal.len(), 1, "target frames: {frames:?}");
    assert_eq!(terminal[0]["error"]["code"], "unavailable");
}

#[test]
fn task_236_contract_snapshot_output_bound_retains_last_good_and_healthy_progress() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start_with_env(&[("_JEFFD_TEST_LIMITS", Path::new("snapshot_bytes=1024"))]);
    let mut subscriber = fixture.client();
    let first = subscriber.request(
        "warm-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert_eq!(assert_ok(&first)["snapshot"]["tasks"][0]["title"], "first");

    fixture.set_snapshot("2026-08-11T10:00:00Z", &"x".repeat(2048));
    fixture.touch_project(&fixture.project, "oversized-snapshot");
    let failure = subscriber.recv();
    assert_eq!(
        failure["name"], "snapshot.failed",
        "oversized child output must be rejected before replacing the cache: {failure}"
    );

    let retained = subscriber.request(
        "retained",
        "snapshot.get",
        json!({"projectId": "project-a"}),
    );
    assert_eq!(assert_ok(&retained)["tasks"][0]["title"], "first");
    let hello = subscriber.request("healthy", "server.hello", json!({}));
    assert_eq!(assert_ok(&hello)["protocolVersion"], 1);
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_contract_per_connection_subscription_limit_releases_on_unsubscribe() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("connection_subscriptions=1,global_subscriptions=8"),
    )]);
    let mut client = fixture.client();
    assert_ok(&client.request("warm", "snapshot.get", json!({"projectId": "project-a"})));
    let first = client.request(
        "first-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    let first_id = assert_ok(&first)["subscriptionId"]
        .as_str()
        .expect("first subscription id")
        .to_owned();
    assert_ok(&client.request(
        "remove-first",
        "snapshot.unsubscribe",
        json!({"subscriptionId": first_id}),
    ));
    let replacement = client.request(
        "replacement-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert!(assert_ok(&replacement)["subscriptionId"].is_string());
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "over-connection-limit",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    assert_eq!(
        client.read_one_byte(),
        0,
        "the newest subscription beyond the per-connection limit must be rejected by closing only that connection"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_contract_global_subscription_limit_releases_on_disconnect() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("connection_subscriptions=4,global_subscriptions=1"),
    )]);
    let mut warm = fixture.client();
    assert_ok(&warm.request("warm", "snapshot.get", json!({"projectId": "project-a"})));
    let mut owner = bounded_raw_client(&fixture.socket);
    let mut owner_reader = BufReader::new(owner.try_clone().expect("clone subscription owner"));
    raw_send(
        &mut owner,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "global-first",
            "method": "snapshot.subscribe",
            "params": {"projectId": "project-a"}
        }),
    );
    let first = raw_recv_until(&mut owner_reader, |frame| frame["id"] == "global-first");
    assert!(assert_ok(&first)["subscriptionId"].is_string());

    let mut overflow = fixture.client();
    overflow.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "global-overflow",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-a"}
    }));
    assert_eq!(
        overflow.read_one_byte(),
        0,
        "the newest subscription beyond the global limit must be rejected"
    );
    owner
        .shutdown(Shutdown::Write)
        .expect("disconnect subscription owner");
    let mut byte = [0_u8; 1];
    assert_eq!(
        owner_reader
            .read(&mut byte)
            .expect("observe subscription owner cleanup"),
        0
    );

    let mut replacement = fixture.client();
    let replaced = replacement.request(
        "after-disconnect",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert!(
        assert_ok(&replaced)["subscriptionId"].is_string(),
        "disconnect cleanup must return global subscription capacity"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_contract_global_cold_waiter_limit_spans_distinct_projects() {
    let mut fixture = Fixture::new(true);
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let project_c = root.join("project-c");
    fs::create_dir_all(project_c.join(".jeff")).expect("create third project");
    fixture.write_registry(json!([
        fixture.default_record(),
        fixture.path_cook_record(),
        {
            "id": "project-c",
            "path": project_c,
            "name": "Project C",
            "enabled": true,
            "cook": [fixture.fake_cook, "--fixture"]
        }
    ]));
    let mut gates = FifoPair::new(&root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", gates.ready_path.as_path()),
        ("FAKE_RELEASE_FIFO", gates.release_path.as_path()),
        (
            "_JEFFD_TEST_LIMITS",
            Path::new("ingress=16,in_flight=16,cold_waiters=2"),
        ),
    ]);
    let mut first = fixture.client();
    first.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "project-a-waiter",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();
    let mut second = fixture.client();
    second.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "project-b-waiter",
        "method": "snapshot.get",
        "params": {"projectId": "project-b"}
    }));
    gates.wait_for_run();

    let mut overflow = fixture.client();
    overflow.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "project-c-overflow",
        "method": "snapshot.get",
        "params": {"projectId": "project-c"}
    }));
    assert_eq!(
        overflow.read_one_byte(),
        0,
        "one waiter on each project must still exhaust the separate global waiter limit"
    );
    let mut healthy = fixture.client();
    assert_eq!(
        assert_ok(&healthy.request("healthy", "server.hello", json!({})))["protocolVersion"],
        1
    );
    gates.release();
    gates.release();
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_contract_oversized_report_observes_a_full_owner_queue() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut owner_gate = RecoveryGate::new(&root, "owner-ingress");
    let mut oversized_gate = RecoveryGate::new(&root, "oversized-report");
    let mut environment = owner_gate.environment().to_vec();
    environment.extend([
        (
            "_JEFFD_TEST_OVERSIZED_READY",
            oversized_gate.ready_path.as_path(),
        ),
        ("_JEFFD_TEST_LIMITS", Path::new("ingress=1,in_flight=8")),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);
    let mut accepted = fixture.client();
    assert_ok(&accepted.request("accepted", "server.hello", json!({})));
    let mut filler = bounded_raw_client(&fixture.socket);
    let mut oversized = bounded_raw_client(&fixture.socket);

    owner_gate.arm();
    accepted.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "owner-gate-trigger",
        "method": "server.hello",
        "params": {}
    }));
    owner_gate.wait();
    raw_send(
        &mut filler,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "fills-owner-queue",
            "method": "server.hello",
            "params": {}
        }),
    );
    raw_send(
        &mut filler,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "proves-owner-queue-full",
            "method": "server.hello",
            "params": {}
        }),
    );
    assert_eq!(raw_read_to_eof(&mut filler, 1), 0);

    let mut oversized_frame = br#"{"v":1,"kind":"req","id":"oversized-full-owner","#.to_vec();
    oversized_frame.resize(MAX_FRAME_BYTES + 1, b'x');
    oversized
        .write_all(&oversized_frame)
        .expect("write bounded oversized frame");
    oversized.flush().expect("flush bounded oversized frame");
    oversized_gate.wait();
    fixture.signal(libc::SIGTERM);
    owner_gate.release();
    fixture.wait_for_exit();
    assert!(!fixture.socket.exists());
}

#[test]
fn task_236_contract_watcher_callback_returns_while_owner_ingress_is_full() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut owner_gate = RecoveryGate::new(&root, "watch-owner");
    let mut notify_gate = RecoveryGate::new(&root, "watch-callback");
    let mut environment = owner_gate.environment().to_vec();
    environment.extend([
        (
            "_JEFFD_TEST_NOTIFY_RETURNED",
            notify_gate.ready_path.as_path(),
        ),
        ("_JEFFD_TEST_LIMITS", Path::new("ingress=1,in_flight=8")),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);
    let mut accepted = fixture.client();
    assert_ok(&accepted.request("accepted", "server.hello", json!({})));
    let mut filler = bounded_raw_client(&fixture.socket);

    owner_gate.arm();
    accepted.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "owner-gate-trigger",
        "method": "server.hello",
        "params": {}
    }));
    owner_gate.wait();
    raw_send(
        &mut filler,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "fills-owner-queue",
            "method": "server.hello",
            "params": {}
        }),
    );
    raw_send(
        &mut filler,
        &json!({
            "v": 1,
            "kind": "req",
            "id": "proves-owner-queue-full",
            "method": "server.hello",
            "params": {}
        }),
    );
    assert_eq!(raw_read_to_eof(&mut filler, 1), 0);

    fixture.touch_project(&fixture.project, "full-owner-notify");
    notify_gate.wait();
    fixture.signal(libc::SIGTERM);
    owner_gate.release();
    fixture.wait_for_exit();
    assert!(!fixture.socket.exists());
}

#[test]
fn task_236_replan_contract_wrapped_snapshot_overflow_retains_last_good_projection() {
    const CEILING: usize = 1024;

    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("frame_bytes=1024,snapshot_bytes=1024"),
    )]);
    let mut subscriber = fixture.client();
    let first = subscriber.request(
        "first-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert_eq!(assert_ok(&first)["snapshot"]["tasks"][0]["title"], "first");

    let title = "x".repeat(700);
    let raw = support::snapshot("2026-08-12T10:00:00Z", &title);
    assert!(
        raw.len() <= CEILING,
        "raw snapshot must causally fit its admission ceiling: {}",
        raw.len()
    );
    let snapshot: Value = serde_json::from_str(&raw).expect("parse near-ceiling snapshot fixture");
    let projection = json!({
        "projectId": "project-a",
        "path": fixture.project,
        "schemaVersion": snapshot["schemaVersion"],
        "generatedAt": snapshot["generatedAt"],
        "mode": snapshot["mode"],
        "tasks": snapshot["tasks"],
        "degraded": []
    });
    let complete_response = json!({
        "v": 1,
        "kind": "res",
        "id": "retained",
        "ok": true,
        "result": projection
    });
    assert!(
        serde_json::to_vec(&complete_response)
            .expect("serialize complete response fixture")
            .len()
            > CEILING,
        "the admitted raw snapshot must grow beyond the complete response ceiling"
    );

    fixture.set_raw_snapshot(&raw);
    fixture.touch_project(&fixture.project, "wrapped-overflow");
    let failure = subscriber.recv_until(|frame| frame["name"] == "snapshot.failed");
    assert_eq!(failure["payload"]["projectId"], "project-a");
    let retained = subscriber.request(
        "retained",
        "snapshot.get",
        json!({"projectId": "project-a"}),
    );
    assert_eq!(assert_ok(&retained)["tasks"][0]["title"], "first");
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_replan_contract_oversized_stdout_terminates_and_reaps_live_process_group() {
    let root = tempfile::tempdir().expect("create oversized-child fixture");
    let project = root.path().join("project");
    fs::create_dir_all(project.join(".jeff")).expect("create oversized-child project");
    let response = root.path().join("oversized.stdout");
    fs::write(&response, vec![b'x'; MAX_FRAME_BYTES + 1])
        .expect("write bounded oversized stdout fixture");
    let pid_file = root.path().join("child.pid");
    let script = root.path().join("oversized-live-child");
    let mut gates = FifoPair::new(root.path());
    write_executable(
        &script,
        r#"#!/bin/sh
response=$1
pid_file=$2
ready=$3
release=$4
printf '%s\n' "$$" > "$pid_file"
cat "$response"
exec 1>&- 2>&-
printf 'run\n' > "$ready"
IFS= read -r _release < "$release"
"#,
    );
    let record = ProjectRecord {
        id: "project-a".to_owned(),
        path: project,
        name: "Project A".to_owned(),
        enabled: true,
        cook: Some(vec![
            script.to_string_lossy().into_owned(),
            response.to_string_lossy().into_owned(),
            pid_file.to_string_lossy().into_owned(),
            gates.ready_path.to_string_lossy().into_owned(),
            gates.release_path.to_string_lossy().into_owned(),
        ]),
    };
    let (result_tx, result_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        result_tx
            .send(run_snapshot(&record, Duration::from_secs(5)))
            .expect("send oversized-child result");
    });
    gates.wait_for_run();
    let pid: i32 = fs::read_to_string(&pid_file)
        .expect("read oversized child pid")
        .trim()
        .parse()
        .expect("parse oversized child pid");
    let result = result_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("oversized closed stdout returns before command timeout");
    worker.join().expect("join oversized snapshot worker");
    assert!(
        matches!(result, Err(SnapshotFailure::OutputTooLarge(_))),
        "oversized stdout must retain its specific failure: {result:?}"
    );

    let process_group_alive = unsafe { libc::kill(-pid, 0) } == 0;
    gates.release();
    if process_group_alive {
        let mut status = 0;
        assert_eq!(
            unsafe { libc::waitpid(pid, &mut status, 0) },
            pid,
            "reap deliberately released oversized child"
        );
    }
    assert!(
        !process_group_alive,
        "an oversized child that closed stdout must be terminated and reaped before failure returns"
    );
}

#[test]
fn task_236_replan_contract_pending_unsubscribe_cannot_return_an_unowned_subscription() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([
        fixture.default_record(),
        fixture.path_cook_record()
    ]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut gates = FifoPair::new(&root);
    fixture.start_with_env(&[
        ("FAKE_READY_FIFO", gates.ready_path.as_path()),
        ("FAKE_RELEASE_FIFO", gates.release_path.as_path()),
    ]);
    let mut client = fixture.client();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "prime",
        "method": "snapshot.get",
        "params": {"projectId": "project-a"}
    }));
    gates.wait_for_run();
    gates.release();
    assert_ok(&client.recv_until(|frame| frame["id"] == "prime"));
    let returned = client.request(
        "known-sub",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    let returned_id = assert_ok(&returned)["subscriptionId"]
        .as_str()
        .expect("known subscription id");
    let (prefix, ordinal) = returned_id
        .rsplit_once('-')
        .expect("subscription id has an ordinal");
    let pending_id = format!(
        "{prefix}-{}",
        ordinal
            .parse::<u64>()
            .expect("subscription ordinal is numeric")
            + 1
    );

    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "pending-sub",
        "method": "snapshot.subscribe",
        "params": {"projectId": "project-b"}
    }));
    gates.wait_for_run();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "pending-unsubscribe",
        "method": "snapshot.unsubscribe",
        "params": {"subscriptionId": pending_id}
    }));
    let unsubscribe = client.recv_until(|frame| frame["id"] == "pending-unsubscribe");
    gates.release();
    let subscribe = client.recv_until(|frame| frame["id"] == "pending-sub");
    assert!(
        unsubscribe["ok"] != true || subscribe["ok"] != true,
        "a successful pending unsubscribe and later successful subscribe would return an unowned stream: unsubscribe={unsubscribe}, subscribe={subscribe}"
    );
    if subscribe["ok"] == true {
        assert_ok(&client.request(
            "remove-returned",
            "snapshot.unsubscribe",
            json!({"subscriptionId": pending_id}),
        ));
    }
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_replan_contract_notify_full_coalesces_registry_replacement() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut owner_gate = RecoveryGate::new(&root, "notify-owner");
    let mut callback_gate = RecoveryGate::new(&root, "notify-callback");
    let mut full_gate = RecoveryGate::new(&root, "notify-registry-full");
    let mut recovered_gate = RecoveryGate::new(&root, "notify-overflow-recovered");
    let mut environment = owner_gate.environment().to_vec();
    environment.extend([
        (
            "_JEFFD_TEST_NOTIFY_RETURNED",
            callback_gate.ready_path.as_path(),
        ),
        (
            "_JEFFD_TEST_NOTIFY_REGISTRY_FULL",
            full_gate.ready_path.as_path(),
        ),
        (
            "_JEFFD_TEST_NOTIFY_OVERFLOW_RECOVERED",
            recovered_gate.ready_path.as_path(),
        ),
        ("_JEFFD_TEST_LIMITS", Path::new("ingress=1,in_flight=8")),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);
    let mut client = fixture.client();
    assert_ok(&client.request("accepted", "server.hello", json!({})));

    owner_gate.arm();
    client.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "pause-owner",
        "method": "server.hello",
        "params": {}
    }));
    owner_gate.wait();
    fixture.touch_project(&fixture.project, "fills-notify-ingress");
    callback_gate.wait();
    fixture.write_registry(json!([fixture.path_cook_record()]));
    full_gate.wait();
    owner_gate.release();
    recovered_gate.wait();

    let listed = client.request("replacement-list", "project.list", json!({}));
    let projects = assert_ok(&listed)["projects"]
        .as_array()
        .expect("replacement project list");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["id"], "project-b");
    assert_eq!(projects[0]["path"], json!(fixture.other_project));
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_replan_contract_subscription_permits_reuse_after_cold_failure_and_replacement() {
    {
        let mut fixture = Fixture::new(true);
        fixture.write_registry(json!([fixture.default_record()]));
        fixture.set_failure(7, "cold failed");
        fixture.start_with_env(&[(
            "_JEFFD_TEST_LIMITS",
            Path::new("connection_subscriptions=1,global_subscriptions=1"),
        )]);
        let mut client = fixture.client();
        let failed = client.request(
            "failed-cold-sub",
            "snapshot.subscribe",
            json!({"projectId": "project-a"}),
        );
        assert_eq!(failed["ok"], false);
        assert_eq!(failed["error"]["code"], "unavailable");
        fixture.set_snapshot("2026-08-12T11:00:00Z", "after failure");
        let replacement = client.request(
            "after-cold-failure",
            "snapshot.subscribe",
            json!({"projectId": "project-a"}),
        );
        assert!(
            assert_ok(&replacement)["subscriptionId"].is_string(),
            "cold failure must return both one-slot permits"
        );
        assert!(fixture.stop_and_wait().status.success());
    }

    {
        let mut fixture = Fixture::new(true);
        fixture.write_registry(json!([fixture.default_record()]));
        let root = fixture.home.parent().expect("fixture root").to_path_buf();
        let mut gates = FifoPair::new(&root);
        fixture.start_with_env(&[
            ("FAKE_READY_FIFO", gates.ready_path.as_path()),
            ("FAKE_RELEASE_FIFO", gates.release_path.as_path()),
            (
                "_JEFFD_TEST_LIMITS",
                Path::new("connection_subscriptions=1,global_subscriptions=1"),
            ),
        ]);
        let mut client = fixture.client();
        client.send(&json!({
            "v": 1,
            "kind": "req",
            "id": "replaced-pending-sub",
            "method": "snapshot.subscribe",
            "params": {"projectId": "project-a"}
        }));
        gates.wait_for_run();
        fixture.write_registry(json!([{
            "id": "project-a",
            "path": fixture.other_project,
            "name": "Replacement",
            "enabled": true,
            "cook": [fixture.fake_cook, "--fixture"]
        }]));
        let mut saw_updated = false;
        let mut saw_terminal = false;
        while !saw_updated || !saw_terminal {
            let frame = client.recv();
            saw_updated |= frame["name"] == "project.updated";
            saw_terminal |= frame["id"] == "replaced-pending-sub"
                && frame["ok"] == false
                && frame["error"]["code"] == "unavailable";
        }
        client.send(&json!({
            "v": 1,
            "kind": "req",
            "id": "after-replacement",
            "method": "snapshot.subscribe",
            "params": {"projectId": "project-a"}
        }));
        gates.wait_for_run();
        gates.release();
        let replacement = client.recv_until(|frame| frame["id"] == "after-replacement");
        assert!(
            assert_ok(&replacement)["subscriptionId"].is_string(),
            "registry replacement must return both one-slot permits"
        );
        assert!(fixture.stop_and_wait().status.success());
    }
}

#[test]
fn task_236_replan_contract_accept_budget_preserves_owner_progress_and_shutdown() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([]));
    let root = fixture.home.parent().expect("fixture root").to_path_buf();
    let mut owner_gate = RecoveryGate::new(&root, "accept-owner");
    let mut yield_gate = RecoveryGate::new(&root, "accept-yield");
    let mut environment = owner_gate.environment().to_vec();
    environment.extend([
        (
            "_JEFFD_TEST_ACCEPT_YIELD_ARM",
            yield_gate.arm_path.as_path(),
        ),
        (
            "_JEFFD_TEST_ACCEPT_YIELDED",
            yield_gate.ready_path.as_path(),
        ),
        (
            "_JEFFD_TEST_LIMITS",
            Path::new("connections=2,ingress=8,in_flight=8,accepts_per_turn=1"),
        ),
    ]);
    fixture.start_with_env(&environment);
    drop(environment);
    let mut owner = fixture.client();
    assert_ok(&owner.request("accepted", "server.hello", json!({})));

    owner_gate.arm();
    owner.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "pause-before-backlog",
        "method": "server.hello",
        "params": {}
    }));
    owner_gate.wait();
    let queued = (0..4)
        .map(|_| UnixStream::connect(&fixture.socket).expect("queue accepted socket backlog"))
        .collect::<Vec<_>>();
    owner.send(&json!({
        "v": 1,
        "kind": "req",
        "id": "owner-progress",
        "method": "server.hello",
        "params": {}
    }));
    yield_gate.arm();
    owner_gate.release();
    yield_gate.wait();
    assert_eq!(
        assert_ok(&owner.recv_until(|frame| frame["id"] == "owner-progress"))["protocolVersion"],
        1
    );
    fixture.signal(libc::SIGTERM);
    fixture.wait_for_exit();
    assert!(!fixture.socket.exists());
    drop(queued);
}

fn bounded_start_outcome(fixture: &Fixture) -> (bool, std::process::Output) {
    let mut command = fixture.command();
    let child = command
        .arg("start")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn unsafe-registry daemon");
    let pid = child.id() as i32;
    let (result_tx, result_rx) = mpsc::channel();
    thread::spawn(move || {
        result_tx
            .send(child.wait_with_output())
            .expect("send unsafe-registry start result");
    });
    match result_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(result) => (true, result.expect("wait for rejected unsafe registry")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            assert_eq!(
                unsafe { libc::kill(pid, libc::SIGKILL) },
                0,
                "kill daemon that failed to reject unsafe registry"
            );
            (
                false,
                result_rx
                    .recv_timeout(Duration::from_secs(10))
                    .expect("killed unsafe-registry daemon exits")
                    .expect("wait for killed unsafe-registry daemon"),
            )
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            panic!("unsafe-registry waiter disconnected")
        }
    }
}

#[test]
fn task_236_replan_contract_external_socket_rejects_unsafe_registry_directory_and_file() {
    let directory_outcome = {
        let fixture = Fixture::new(true);
        let marker = fixture
            .home
            .parent()
            .expect("fixture root")
            .join("directory-attacker-ran");
        let attacker = fixture
            .home
            .parent()
            .expect("fixture root")
            .join("directory-attacker");
        write_executable(
            &attacker,
            &format!("#!/bin/sh\nprintf owned > '{}'\n", marker.display()),
        );
        fixture.write_registry(json!([{
            "id": "project-a",
            "path": fixture.project,
            "name": "Unsafe Directory",
            "enabled": true,
            "cook": [attacker]
        }]));
        fs::set_permissions(
            fixture.registry_path().parent().expect("registry parent"),
            fs::Permissions::from_mode(0o777),
        )
        .expect("make registry parent replaceable");
        let outcome = bounded_start_outcome(&fixture);
        (outcome, marker.exists())
    };

    let file_outcome = {
        let fixture = Fixture::new(true);
        let marker = fixture
            .home
            .parent()
            .expect("fixture root")
            .join("file-attacker-ran");
        let attacker = fixture
            .home
            .parent()
            .expect("fixture root")
            .join("file-attacker");
        write_executable(
            &attacker,
            &format!("#!/bin/sh\nprintf owned > '{}'\n", marker.display()),
        );
        fixture.write_registry(json!([{
            "id": "project-a",
            "path": fixture.project,
            "name": "Unsafe File",
            "enabled": true,
            "cook": [attacker]
        }]));
        fs::set_permissions(fixture.registry_path(), fs::Permissions::from_mode(0o666))
            .expect("make registry file replaceable");
        let outcome = bounded_start_outcome(&fixture);
        (outcome, marker.exists())
    };

    for (label, ((exited, output), attacker_ran)) in [
        ("unsafe registry directory", directory_outcome),
        ("unsafe registry file", file_outcome),
    ] {
        assert!(
            exited && !output.status.success(),
            "{label} must fail closed before binding the external socket: exited={exited}, status={}, stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !attacker_ran,
            "{label} must be rejected before registered attacker code executes"
        );
    }
}

fn task_236_project_record(fixture: &Fixture, project_id: &str) -> Value {
    let path = fixture
        .home
        .parent()
        .expect("fixture root")
        .join(project_id);
    fs::create_dir_all(path.join(".jeff")).expect("create bounded project fixture");
    json!({
        "id": project_id,
        "path": path,
        "name": project_id,
        "enabled": true,
        "cook": [fixture.fake_cook, "--fixture"]
    })
}

fn serialized_len(value: &Value) -> usize {
    serde_json::to_vec(value)
        .expect("serialize bounded contract fixture")
        .len()
}

#[test]
fn task_236_surviving_contract_long_id_cannot_poison_retained_snapshot_service() {
    const FRAME_BYTES: usize = 32 * 1024;
    const RESPONSE_ID_BYTES: usize = 4 * 1024;

    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([fixture.default_record()]));
    fixture.start_with_env(&[(
        "_JEFFD_TEST_LIMITS",
        Path::new("frame_bytes=32768,snapshot_bytes=32768"),
    )]);
    let mut client = fixture.client();
    let subscribed = client.request(
        "prime",
        "snapshot.subscribe",
        json!({"projectId": "project-a"}),
    );
    assert_eq!(
        assert_ok(&subscribed)["snapshot"]["tasks"][0]["title"],
        "first"
    );

    let empty_snapshot: Value =
        serde_json::from_str(&support::snapshot("2026-08-12T12:00:00Z", ""))
            .expect("parse empty-title snapshot");
    let empty_projection = json!({
        "projectId": "project-a",
        "path": fixture.project,
        "schemaVersion": empty_snapshot["schemaVersion"],
        "generatedAt": empty_snapshot["generatedAt"],
        "mode": empty_snapshot["mode"],
        "tasks": empty_snapshot["tasks"],
        "degraded": ["snapshot_stale"]
    });
    let empty_probe_bytes = [
        serialized_len(&json!({
            "v": 1,
            "kind": "res",
            "id": "",
            "ok": true,
            "result": &empty_projection
        })),
        serialized_len(&json!({
            "v": 1,
            "kind": "res",
            "id": "",
            "ok": true,
            "result": {
                "subscriptionId": format!("s-{}-{}", usize::MAX, u64::MAX),
                "snapshot": &empty_projection
            }
        })),
        serialized_len(&json!({
            "v": 1,
            "kind": "event",
            "name": "snapshot.replaced",
            "payload": {"projectId": "project-a", "snapshot": &empty_projection}
        })),
    ]
    .into_iter()
    .max()
    .expect("retained admission has probes");
    let title = "x".repeat(
        FRAME_BYTES
            .checked_sub(empty_probe_bytes)
            .expect("empty retained envelope fits the frame"),
    );
    let raw = support::snapshot("2026-08-12T12:00:00Z", &title);
    assert!(
        raw.len() <= FRAME_BYTES,
        "raw snapshot must fit its input ceiling: {}",
        raw.len()
    );
    let snapshot: Value = serde_json::from_str(&raw).expect("parse boundary snapshot");
    let stale_projection = json!({
        "projectId": "project-a",
        "path": fixture.project,
        "schemaVersion": snapshot["schemaVersion"],
        "generatedAt": snapshot["generatedAt"],
        "mode": snapshot["mode"],
        "tasks": snapshot["tasks"],
        "degraded": ["snapshot_stale"]
    });
    let largest_empty_probe = [
        serialized_len(&json!({
            "v": 1,
            "kind": "res",
            "id": "",
            "ok": true,
            "result": &stale_projection
        })),
        serialized_len(&json!({
            "v": 1,
            "kind": "res",
            "id": "",
            "ok": true,
            "result": {
                "subscriptionId": format!("s-{}-{}", usize::MAX, u64::MAX),
                "snapshot": &stale_projection
            }
        })),
        serialized_len(&json!({
            "v": 1,
            "kind": "event",
            "name": "snapshot.replaced",
            "payload": {"projectId": "project-a", "snapshot": &stale_projection}
        })),
    ]
    .into_iter()
    .max()
    .expect("retained admission has probes");
    assert_eq!(
        largest_empty_probe, FRAME_BYTES,
        "fixture must sit on the exact empty-ID admission boundary"
    );

    let worst_id = "\0".repeat(RESPONSE_ID_BYTES);
    let encoded_id = serde_json::to_string(&worst_id).expect("serialize worst legal response ID");
    assert_eq!(encoded_id.len(), RESPONSE_ID_BYTES * 6 + 2);
    assert!(
        encoded_id.as_bytes()[1..encoded_id.len() - 1]
            .chunks_exact(6)
            .all(|escape| escape == br"\u0000"),
        "every decoded NUL byte must use the worst legal six-byte JSON escape"
    );
    let retained_projection = json!({
        "projectId": "project-a",
        "path": fixture.project,
        "schemaVersion": snapshot["schemaVersion"],
        "generatedAt": snapshot["generatedAt"],
        "mode": snapshot["mode"],
        "tasks": snapshot["tasks"],
        "degraded": []
    });
    assert!(
        serialized_len(&json!({
            "v": 1,
            "kind": "res",
            "id": &worst_id,
            "ok": true,
            "result": retained_projection
        })) > FRAME_BYTES,
        "the actual legal ID must overflow the frame accepted by the empty-ID probe"
    );
    assert!(
        serialized_len(&json!({
            "v": 1,
            "kind": "req",
            "id": &worst_id,
            "method": "snapshot.get",
            "params": {"projectId": "project-a"}
        })) <= FRAME_BYTES,
        "the worst-serialized legal ID must still fit an admitted request"
    );

    fixture.set_raw_snapshot(&raw);
    fixture.touch_project(&fixture.project, "long-id-boundary");
    let update = client.recv();
    let retained = client.request(&worst_id, "snapshot.get", json!({"projectId": "project-a"}));
    assert_eq!(
        assert_ok(&retained)["tasks"][0]["title"],
        "first",
        "a rejected boundary projection must leave last-good serviceable"
    );
    assert_eq!(
        update["name"], "snapshot.failed",
        "the boundary projection must be rejected before cache replacement"
    );
    assert!(fixture.stop_and_wait().status.success());
}

#[test]
fn task_236_surviving_contract_active_snapshot_budget_is_fair_and_responsive() {
    let ids = ["bounded-a", "bounded-b", "bounded-c", "bounded-d"];
    let launched_before_shutdown = {
        let mut fixture = Fixture::new(true);
        let records: Vec<_> = ids
            .iter()
            .map(|project_id| task_236_project_record(&fixture, project_id))
            .collect();
        fixture.write_registry(json!(records));
        let root = fixture.home.parent().expect("fixture root").to_path_buf();
        let mut gates = FifoPair::new(&root);
        let mut saturated = RecoveryGate::new(&root, "active-saturated");
        fixture.start_with_env(&[
            ("FAKE_READY_FIFO", gates.ready_path.as_path()),
            ("FAKE_RELEASE_FIFO", gates.release_path.as_path()),
            (
                "_JEFFD_TEST_ACTIVE_SNAPSHOTS_SATURATED",
                saturated.ready_path.as_path(),
            ),
            ("_JEFFD_TEST_LIMITS", Path::new("active_snapshots=2")),
        ]);
        let mut client = fixture.client();
        for project_id in ids {
            client.send(&json!({
                "v": 1,
                "kind": "req",
                "id": format!("get-{project_id}"),
                "method": "snapshot.get",
                "params": {"projectId": project_id}
            }));
        }
        let owner = client.request("owner-responsive", "server.hello", json!({}));
        assert_eq!(assert_ok(&owner)["protocolVersion"], 1);
        saturated.wait();
        gates.wait_for_run();
        gates.wait_for_run();
        fixture.signal(libc::SIGTERM);
        fixture.wait_for_exit();
        assert!(!fixture.socket.exists());
        fixture.invocations().len()
    };

    {
        let mut fixture = Fixture::new(true);
        let records: Vec<_> = ids
            .iter()
            .map(|project_id| task_236_project_record(&fixture, project_id))
            .collect();
        fixture.write_registry(json!(records));
        let root = fixture.home.parent().expect("fixture root").to_path_buf();
        let mut gates = FifoPair::new(&root);
        let mut saturated = RecoveryGate::new(&root, "fair-saturated");
        fixture.start_with_env(&[
            ("FAKE_READY_FIFO", gates.ready_path.as_path()),
            ("FAKE_RELEASE_FIFO", gates.release_path.as_path()),
            (
                "_JEFFD_TEST_ACTIVE_SNAPSHOTS_SATURATED",
                saturated.ready_path.as_path(),
            ),
            ("_JEFFD_TEST_LIMITS", Path::new("active_snapshots=2")),
        ]);
        let mut client = fixture.client();
        for project_id in ids {
            client.send(&json!({
                "v": 1,
                "kind": "req",
                "id": format!("fair-{project_id}"),
                "method": "snapshot.get",
                "params": {"projectId": project_id}
            }));
        }
        let owner = client.request("fair-owner-responsive", "server.hello", json!({}));
        assert_eq!(assert_ok(&owner)["protocolVersion"], 1);
        saturated.wait();

        gates.wait_for_run();
        gates.wait_for_run();
        gates.release();
        gates.release();
        gates.wait_for_run();
        gates.wait_for_run();
        gates.release();
        gates.release();

        let mut completed = BTreeSet::new();
        while completed.len() < ids.len() {
            let frame = client.recv();
            if let Some(project_id) = frame["id"].as_str().and_then(|id| id.strip_prefix("fair-")) {
                assert_ok(&frame);
                completed.insert(project_id.to_owned());
            }
        }
        assert_eq!(
            completed,
            ids.into_iter().map(str::to_owned).collect(),
            "every deferred project must eventually make progress"
        );
        assert!(fixture.stop_and_wait().status.success());
    }

    assert_eq!(
        launched_before_shutdown, 2,
        "shutdown may observe no more than the configured active snapshot budget"
    );
}

#[test]
fn task_236_surviving_contract_snapshot_thread_launch_failure_releases_active_ownership() {
    let mut fixture = Fixture::new(true);
    fixture.write_registry(json!([
        task_236_project_record(&fixture, "failure-a"),
        task_236_project_record(&fixture, "failure-b")
    ]));
    fixture.start_with_env(&[
        ("_JEFFD_TEST_LIMITS", Path::new("active_snapshots=1")),
        (
            "_JEFFD_TEST_SNAPSHOT_THREAD_FAILURE",
            Path::new("failure-a:stdout"),
        ),
    ]);
    let mut client = fixture.client();
    let failure = client.request(
        "injected-reader-launch-failure",
        "snapshot.get",
        json!({"projectId": "failure-a"}),
    );
    let recovered = client.request(
        "after-reader-launch-failure",
        "snapshot.get",
        json!({"projectId": "failure-b"}),
    );
    let recovered_ok = recovered["ok"] == true;
    let stopped = fixture.stop_and_wait().status.success();

    assert!(
        failure["ok"] == false
            && failure["error"]["code"] == "unavailable"
            && recovered_ok
            && stopped,
        "injected reader-launch failure must release active ownership: failure={failure}, recovered={recovered_ok}, stopped={stopped}"
    );
}

#[test]
fn task_236_surviving_contract_aggregate_cache_budget_rejects_newest_and_retains_last_good() {
    let mut fixture = Fixture::new(true);
    let ids = ["cache-a", "cache-b", "cache-c"];
    let records: Vec<_> = ids
        .iter()
        .map(|project_id| task_236_project_record(&fixture, project_id))
        .collect();
    fixture.write_registry(json!(records));

    let initial: Value = serde_json::from_str(&support::snapshot("2026-08-10T10:00:00Z", "first"))
        .expect("parse initial cache fixture");
    let retained_cost = |project_id: &str| {
        serialized_len(&json!({
            "projectId": project_id,
            "path": fixture
                .home
                .parent()
                .expect("fixture root")
                .join(project_id),
            "schemaVersion": initial["schemaVersion"],
            "generatedAt": initial["generatedAt"],
            "mode": initial["mode"],
            "tasks": initial["tasks"],
            "degraded": ["snapshot_stale"]
        }))
    };
    let cache_budget = retained_cost("cache-a") + retained_cost("cache-b");
    let limits = format!("frame_bytes=4096,snapshot_bytes=4096,cache_bytes={cache_budget}");
    fixture.start_with_env(&[("_JEFFD_TEST_LIMITS", Path::new(&limits))]);
    let mut client = fixture.client();

    let first = client.request(
        "cache-a-first",
        "snapshot.get",
        json!({"projectId": "cache-a"}),
    );
    assert_eq!(assert_ok(&first)["tasks"][0]["title"], "first");
    let subscribed = client.request(
        "cache-a-subscribe",
        "snapshot.subscribe",
        json!({"projectId": "cache-a"}),
    );
    assert_eq!(
        assert_ok(&subscribed)["snapshot"]["tasks"][0]["title"],
        "first"
    );
    let second = client.request(
        "cache-b-first",
        "snapshot.get",
        json!({"projectId": "cache-b"}),
    );
    assert_eq!(assert_ok(&second)["tasks"][0]["title"], "first");
    let newest = client.request(
        "cache-c-over-budget",
        "snapshot.get",
        json!({"projectId": "cache-c"}),
    );

    fixture.set_snapshot(
        "2026-08-12T13:00:00Z",
        "replacement grows beyond the retained aggregate budget",
    );
    let cache_a = fixture.home.parent().expect("fixture root").join("cache-a");
    fixture.touch_project(&cache_a, "aggregate-budget-replacement");
    let replacement = client.recv();
    let retained = client.request(
        "cache-a-retained",
        "snapshot.get",
        json!({"projectId": "cache-a"}),
    );
    let retained_projection = assert_ok(&retained);

    let bounded = newest["ok"] == false
        && newest["error"]["code"] == "unavailable"
        && replacement["name"] == "snapshot.failed"
        && retained_projection["tasks"][0]["title"] == "first"
        && retained_projection["degraded"] == json!(["snapshot_stale"]);
    assert!(
        bounded,
        "aggregate admission must reject the newest cold cache and preserve last-good on replacement: newest={newest}, replacement={replacement}, retained={retained_projection}"
    );
    assert!(fixture.stop_and_wait().status.success());
}

const LIFECYCLE_WRITE_INTERPOSER: &str = r#"
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <sys/socket.h>

static int claimed = 0;

static int contains_lifecycle(const void *buffer, size_t count) {
    const char target[] = "lifecycle";
    const unsigned char *bytes = buffer;
    if (count < sizeof(target) - 1) return 0;
    for (size_t index = 0; index + sizeof(target) - 1 <= count; index++) {
        if (memcmp(bytes + index, target, sizeof(target) - 1) == 0) return 1;
    }
    return 0;
}

static ssize_t next_write(int descriptor, const void *buffer, size_t count) {
#ifdef __APPLE__
    return (ssize_t)syscall(SYS_write, descriptor, buffer, count);
#else
    ssize_t (*next)(int, const void *, size_t) = dlsym(RTLD_NEXT, "write");
    return next(descriptor, buffer, count);
#endif
}

static ssize_t next_send(int descriptor, const void *buffer, size_t count, int flags) {
#ifdef __APPLE__
    return (ssize_t)syscall(SYS_sendto, descriptor, buffer, count, flags, NULL, 0);
#else
    ssize_t (*next)(int, const void *, size_t, int) = dlsym(RTLD_NEXT, "send");
    return next(descriptor, buffer, count, flags);
#endif
}

static void rendezvous(void) {
    char byte;
    int ready = open(getenv("JEFFD_TEST_LIFECYCLE_READY"), O_WRONLY);
    if (ready >= 0) {
        next_write(ready, "run\n", 4);
        close(ready);
    }
    int release = open(getenv("JEFFD_TEST_LIFECYCLE_RELEASE"), O_RDONLY);
    if (release >= 0) {
        read(release, &byte, 1);
        close(release);
    }
}

static ssize_t hook_write(int descriptor, const void *buffer, size_t count) {
    if (contains_lifecycle(buffer, count) && __sync_bool_compare_and_swap(&claimed, 0, 1)) {
        rendezvous();
    }
    return next_write(descriptor, buffer, count);
}

static ssize_t hook_send(int descriptor, const void *buffer, size_t count, int flags) {
    if (contains_lifecycle(buffer, count) && __sync_bool_compare_and_swap(&claimed, 0, 1)) {
        rendezvous();
    }
    return next_send(descriptor, buffer, count, flags);
}

#ifdef __APPLE__
#define DYLD_INTERPOSE(replacement, replacee) \
    __attribute__((used)) static struct { const void *replacement; const void *replacee; } \
    _interpose_##replacee __attribute__((section("__DATA,__interpose"))) = { \
        (const void *)(unsigned long)&replacement, (const void *)(unsigned long)&replacee \
    }
DYLD_INTERPOSE(hook_write, write);
DYLD_INTERPOSE(hook_send, send);
#else
ssize_t write(int descriptor, const void *buffer, size_t count) {
    return hook_write(descriptor, buffer, count);
}

ssize_t send(int descriptor, const void *buffer, size_t count, int flags) {
    return hook_send(descriptor, buffer, count, flags);
}
#endif
"#;
