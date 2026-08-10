#![cfg(unix)]

mod support;

use serde_json::json;
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;

use support::{assert_ok, wait_for_log_lines, Client, FifoPair, Fixture, MAX_FRAME_BYTES};

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
