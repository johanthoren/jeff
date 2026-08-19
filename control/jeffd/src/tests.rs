use super::{
    load_registry, parse_snapshot_output, run_snapshot, DaemonConfig, DirtyTracker, ProjectCache,
    SnapshotFailure, SnapshotInvocation,
};
use jeff_project::{ProjectRecord, Snapshot};
use serde_json::json;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn record(root: &Path, cook: Option<Vec<String>>) -> ProjectRecord {
    ProjectRecord {
        id: "demo".to_owned(),
        path: root.to_path_buf(),
        name: "Demo".to_owned(),
        enabled: true,
        cook,
    }
}

fn snapshot(generated_at: &str, title: &str) -> Snapshot {
    parse_snapshot_output(
        serde_json::to_string(&json!({
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "mode": "lite",
            "tasks": [{
                "id": 1,
                "slug": "one",
                "title": title,
                "status": "in_progress",
                "stage": "implement",
                "priority": "p1",
                "deps": [],
                "blockedReason": null
            }]
        }))
        .expect("serialize snapshot")
        .as_bytes(),
    )
    .expect("parse valid snapshot")
}

#[test]
fn registry_loads_the_shared_record_array_and_preserves_disabled_projects() {
    let root = tempfile::tempdir().expect("create isolated registry root");
    let project = root.path().join("project");
    fs::create_dir(&project).expect("create project root");
    let cook = root.path().join("cook");
    fs::write(&cook, "#!/bin/sh\n").expect("write cook fixture");
    fs::set_permissions(&cook, fs::Permissions::from_mode(0o700)).expect("make cook executable");
    let registry = root.path().join("projects.json");
    fs::write(
        &registry,
        serde_json::to_vec(&json!([
            {
                "id": "demo",
                "path": project,
                "name": "Demo",
                "enabled": false,
                "cook": [cook, "--installed"]
            }
        ]))
        .expect("serialize registry"),
    )
    .expect("write registry");

    let projects = load_registry(&registry).expect("load valid registry");

    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, "demo");
    assert_eq!(projects[0].name, "Demo");
    assert!(!projects[0].enabled);
    assert_eq!(projects[0].path, project);
    assert_eq!(
        projects[0].cook,
        Some(vec![
            cook.to_string_lossy().into_owned(),
            "--installed".to_owned()
        ])
    );
}

#[test]
fn registry_rejects_relative_project_paths_and_cook_executables() {
    let root = tempfile::tempdir().expect("create isolated registry root");
    let registry = root.path().join("projects.json");
    for invalid in [
        json!([{
            "id": "demo",
            "path": "relative/project",
            "name": "Demo",
            "enabled": true,
            "cook": null
        }]),
        json!([{
            "id": "demo",
            "path": root.path().join("project"),
            "name": "Demo",
            "enabled": true,
            "cook": ["cook-wrapper"]
        }]),
        json!([{
            "id": "demo",
            "path": root.path().join("project"),
            "name": "Demo",
            "enabled": true,
            "cook": []
        }]),
    ] {
        fs::write(
            &registry,
            serde_json::to_vec(&invalid).expect("serialize invalid registry"),
        )
        .expect("write invalid registry");
        assert!(
            load_registry(&registry).is_err(),
            "invalid registry was accepted: {invalid}"
        );
    }
}

#[test]
fn invocation_uses_registered_cwd_and_appends_the_snapshot_contract() {
    let root = tempfile::tempdir().expect("create isolated project root");
    let executable = root.path().join("cook-wrapper");
    let project = record(
        root.path(),
        Some(vec![
            executable.to_string_lossy().into_owned(),
            "--installed".to_owned(),
        ]),
    );

    let explicit = SnapshotInvocation::for_project(&project).expect("build explicit invocation");
    assert_eq!(explicit.program(), executable);
    assert_eq!(explicit.args(), ["--installed", "snapshot", "--json"]);
    assert_eq!(explicit.cwd(), root.path());

    let fallback =
        SnapshotInvocation::for_project(&record(root.path(), None)).expect("build PATH invocation");
    assert_eq!(fallback.program(), PathBuf::from("cook"));
    assert_eq!(fallback.args(), ["snapshot", "--json"]);
    assert_eq!(fallback.cwd(), root.path());
}

#[test]
fn snapshot_output_requires_exactly_one_supported_json_document() {
    let valid = serde_json::to_string(&json!({
        "schemaVersion": 1,
        "generatedAt": "2026-08-10T10:00:00Z",
        "mode": "lite",
        "tasks": []
    }))
    .expect("serialize valid snapshot");

    assert!(parse_snapshot_output(valid.as_bytes()).is_ok());
    assert!(parse_snapshot_output(format!("{valid}\n{valid}").as_bytes()).is_err());
    assert!(parse_snapshot_output(b"[]").is_err());
    assert!(parse_snapshot_output(b"\xff").is_err());

    let old = valid.replace("\"schemaVersion\":1", "\"schemaVersion\":0");
    let new = valid.replace("\"schemaVersion\":1", "\"schemaVersion\":2");
    assert!(parse_snapshot_output(old.as_bytes())
        .expect_err("old schema must fail")
        .to_string()
        .contains("older than supported minimum"));
    assert!(parse_snapshot_output(new.as_bytes())
        .expect_err("new schema must fail")
        .to_string()
        .contains("newer than supported maximum"));
}
#[test]
fn daemon_defaults_expose_the_contract_timeout_and_debounce() {
    let config = DaemonConfig::default();

    assert_eq!(config.snapshot_timeout(), Duration::from_secs(30));
    assert_eq!(config.debounce_window(), Duration::from_millis(150));
    assert_eq!(config.frame_limit(), 16 * 1024 * 1024);
}

#[test]
fn zero_deadline_times_out_and_reaps_the_snapshot_child() {
    let root = tempfile::tempdir().expect("create isolated process root");
    let executable = root.path().join("cook");
    fs::write(&executable, "#!/bin/sh\nwhile :; do :; done\n").expect("write blocking cook");
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700))
        .expect("make blocking cook executable");
    let project = record(
        root.path(),
        Some(vec![executable.to_string_lossy().into_owned()]),
    );

    let error = run_snapshot(&project, Duration::ZERO).expect_err("snapshot must time out");

    assert!(matches!(error, SnapshotFailure::Timeout));
}

#[test]
fn cache_failure_retains_last_good_generation_and_exposes_degraded_health() {
    let root = tempfile::tempdir().expect("create isolated cache root");
    let project = record(root.path(), None);
    let first = snapshot("2026-08-10T10:00:00Z", "first");
    let second = snapshot("2026-08-10T10:01:00Z", "second");
    let mut cache = ProjectCache::new(project);

    cache.replace(first);
    cache.replace(second);
    cache.fail("cook exited 7".to_owned(), Some(7));

    let projection = cache.projection().expect("last good projection retained");
    assert_eq!(projection.snapshot.generated_at, "2026-08-10T10:01:00Z");
    assert_eq!(projection.snapshot.tasks[0].title, "second");
    assert_eq!(projection.degraded, ["snapshot_stale"]);
    assert_eq!(
        cache.last_successful_generation(),
        Some("2026-08-10T10:01:00Z")
    );
    let failure = cache.last_error().expect("last failure retained");
    assert_eq!(failure.message, "cook exited 7");
    assert_eq!(failure.exit_code, Some(7));
}

#[test]
fn dirty_tracker_coalesces_per_project_and_allows_one_dirty_again_rerun() {
    let mut tracker = DirtyTracker::new(Duration::from_millis(150));

    tracker.mark_dirty("a", Duration::ZERO);
    tracker.mark_dirty("a", Duration::from_millis(40));
    tracker.mark_dirty("b", Duration::from_millis(50));
    assert!(tracker.due(Duration::from_millis(189)).is_empty());
    assert_eq!(tracker.due(Duration::from_millis(190)), ["a"]);
    assert_eq!(
        tracker.due(Duration::from_millis(199)),
        Vec::<String>::new()
    );
    assert_eq!(tracker.due(Duration::from_millis(200)), ["b"]);

    tracker.mark_dirty("a", Duration::from_millis(201));
    tracker.mark_dirty("a", Duration::from_millis(202));
    tracker.mark_dirty("a", Duration::from_millis(203));
    tracker.finished("a", Duration::from_millis(210));
    assert!(tracker.due(Duration::from_millis(359)).is_empty());
    assert_eq!(tracker.due(Duration::from_millis(360)), ["a"]);
    tracker.finished("a", Duration::from_millis(361));
    assert!(tracker.due(Duration::from_secs(10)).is_empty());

    tracker.finished("b", Duration::from_millis(362));
}
