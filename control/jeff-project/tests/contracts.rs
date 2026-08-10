use jeff_project::{
    check_snapshot_schema, parse_snapshot, Envelope, EventName, GraphProjection, Method,
    ProjectMode, ProjectRecord, SnapshotError, TaskId,
};
use serde_json::{json, Value};
use std::path::PathBuf;

const CURRENT_SNAPSHOT: &str = r#"
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-03T12:00:00.000Z",
  "mode": "lite",
  "maxParallelTasks": 3,
  "tasks": [
    {
      "id": 20,
      "slug": "beta",
      "title": "Beta",
      "status": "in_progress",
      "stage": "plan",
      "priority": "p1",
      "deps": [10],
      "blockedReason": null,
      "category": "code",
      "discoveredFrom": 10,
      "claim": {"by": "worker-a", "at": "2026-08-03T11:00:00.000Z"},
      "escalation": {"fork": "Which registry?", "options": ["local", "remote"]},
      "futureTaskField": true
    }
  ],
  "futureDocumentField": {"safe": true}
}
"#;

const LEGACY_SNAPSHOT: &str = r##"
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-01T00:00:00.000Z",
  "mode": "full",
  "tasks": [
    {
      "id": "#18",
      "slug": "legacy",
      "title": "Legacy",
      "status": "pending",
      "stage": "capture",
      "priority": "p2",
      "deps": [],
      "blockedReason": null
    }
  ]
}
"##;

#[test]
fn current_snapshot_round_trips_known_fields_and_tolerates_additions() {
    let snapshot = parse_snapshot(CURRENT_SNAPSHOT).expect("current snapshot parses");

    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.generated_at, "2026-08-03T12:00:00.000Z");
    assert_eq!(snapshot.mode, ProjectMode::Lite);
    assert_eq!(snapshot.max_parallel_tasks, Some(3));
    assert_eq!(snapshot.tasks.len(), 1);

    let task = &snapshot.tasks[0];
    assert_eq!(task.id, TaskId::Number(20));
    assert_eq!(task.slug, "beta");
    assert_eq!(task.title, "Beta");
    assert_eq!(task.status, "in_progress");
    assert_eq!(task.stage, "plan");
    assert_eq!(task.priority, "p1");
    assert_eq!(task.deps, vec![TaskId::Number(10)]);
    assert_eq!(task.category.as_deref(), Some("code"));
    assert_eq!(task.discovered_from, Some(TaskId::Number(10)));
    assert_eq!(task.blocked_reason, None);
    let claim = task.claim.as_ref().expect("claim");
    assert_eq!(claim.by, "worker-a");
    assert_eq!(claim.at, "2026-08-03T11:00:00.000Z");
    let escalation = task.escalation.as_ref().expect("escalation");
    assert_eq!(escalation.fork, "Which registry?");
    assert_eq!(escalation.options, ["local", "remote"]);
    let encoded_value = serde_json::to_value(&snapshot).expect("snapshot serializes");
    assert!(encoded_value.get("futureDocumentField").is_none());
    assert!(encoded_value["tasks"][0].get("futureTaskField").is_none());

    let encoded = serde_json::to_string(&snapshot).expect("snapshot serializes");
    assert_eq!(
        parse_snapshot(&encoded).expect("serialized snapshot reparses"),
        snapshot
    );
}

#[test]
fn legacy_snapshot_maps_missing_optional_fields_to_absence() {
    let snapshot = parse_snapshot(LEGACY_SNAPSHOT).expect("legacy snapshot parses");
    let task = &snapshot.tasks[0];

    assert_eq!(snapshot.mode, ProjectMode::Full);
    assert_eq!(snapshot.max_parallel_tasks, None);
    assert_eq!(task.id, TaskId::String("#18".to_owned()));
    assert_eq!(task.category, None);
    assert_eq!(task.discovered_from, None);
    assert_eq!(task.claim, None);
    assert_eq!(task.escalation, None);
}

#[test]
fn malformed_required_snapshot_data_returns_a_typed_error() {
    let malformed = r#"
    {
      "schemaVersion": 1,
      "generatedAt": "2026-08-03T12:00:00.000Z",
      "mode": "lite",
      "tasks": [{"id": 1, "slug": "missing-required-task-fields"}]
    }
    "#;

    let error = parse_snapshot(malformed).expect_err("malformed snapshot must fail");
    assert!(matches!(&error, SnapshotError::Malformed(_)));
    assert!(error.to_string().contains("invalid snapshot"));
}

#[test]
fn compatibility_gate_accepts_schema_version_one() {
    check_snapshot_schema(1).expect("schema version 1 is supported");
}

#[test]
fn unsupported_snapshot_versions_return_directional_typed_errors() {
    let older = LEGACY_SNAPSHOT.replace("\"schemaVersion\": 1", "\"schemaVersion\": 0");
    let older_error = parse_snapshot(&older).expect_err("older schema must fail");
    assert!(matches!(
        &older_error,
        SnapshotError::SchemaTooOld {
            found: 0,
            minimum: 1
        }
    ));
    assert!(older_error.to_string().contains("upgrade project jeff"));

    let newer = LEGACY_SNAPSHOT.replace("\"schemaVersion\": 1", "\"schemaVersion\": 2");
    let newer_error = parse_snapshot(&newer).expect_err("newer schema must fail");
    assert!(matches!(
        &newer_error,
        SnapshotError::SchemaTooNew {
            found: 2,
            maximum: 1
        }
    ));
    assert!(newer_error.to_string().contains("upgrade jeffd"));
}

#[test]
fn graph_projection_reuses_the_typed_snapshot_contract() {
    let projection: GraphProjection = serde_json::from_value(json!({
        "projectId": "demo",
        "path": "/abs/demo",
        "schemaVersion": 1,
        "generatedAt": "2026-08-03T12:00:00.000Z",
        "mode": "lite",
        "tasks": [],
        "degraded": ["claims_absent"]
    }))
    .expect("graph projection parses");

    assert_eq!(projection.project_id, "demo");
    assert_eq!(projection.path, PathBuf::from("/abs/demo"));
    assert_eq!(projection.snapshot.schema_version, 1);
    assert_eq!(projection.snapshot.mode, ProjectMode::Lite);
    assert!(projection.snapshot.tasks.is_empty());
    assert_eq!(projection.degraded, ["claims_absent"]);
}

#[test]
fn registry_record_round_trips_an_argv_cook_override() {
    let record: ProjectRecord = serde_json::from_value(json!({
        "id": "demo",
        "path": "/abs/demo",
        "name": "Demo",
        "enabled": true,
        "cook": ["node", "/abs/cook.js"],
        "futureRegistryField": "ignored"
    }))
    .expect("registry record parses");

    assert_eq!(record.id, "demo");
    assert_eq!(record.path, PathBuf::from("/abs/demo"));
    assert_eq!(record.name, "Demo");
    assert!(record.enabled);
    assert_eq!(
        record.cook,
        Some(vec!["node".to_owned(), "/abs/cook.js".to_owned()])
    );

    let encoded = serde_json::to_value(record).expect("registry record serializes");
    assert_eq!(encoded["cook"], json!(["node", "/abs/cook.js"]));
    assert!(encoded.get("futureRegistryField").is_none());
}

#[test]
fn every_p1a_request_method_round_trips_and_unknown_methods_remain_dispatchable() {
    let cases = [
        ("server.hello", Method::ServerHello),
        ("project.list", Method::ProjectList),
        ("snapshot.get", Method::SnapshotGet),
        ("snapshot.subscribe", Method::SnapshotSubscribe),
        ("snapshot.unsubscribe", Method::SnapshotUnsubscribe),
        ("future.method", Method::Unknown("future.method".to_owned())),
    ];

    for (wire_method, expected_method) in cases {
        let input = json!({
            "v": 1,
            "kind": "req",
            "id": "c-1",
            "method": wire_method,
            "params": {},
            "futureEnvelopeField": true
        });
        let envelope: Envelope = serde_json::from_value(input).expect("request parses");

        match &envelope {
            Envelope::Request {
                version,
                id,
                method,
                params,
            } => {
                assert_eq!(*version, 1);
                assert_eq!(id, "c-1");
                assert_eq!(method, &expected_method);
                assert_eq!(params, &json!({}));
            }
            other => panic!("expected request, got {other:?}"),
        }

        let encoded = serde_json::to_value(envelope).expect("request serializes");
        assert_eq!(encoded["method"], wire_method);
    }
}

#[test]
fn success_and_error_response_envelopes_round_trip() {
    let cases = [
        json!({"v": 1, "kind": "res", "id": "c-1", "ok": true, "result": {}}),
        json!({
            "v": 1,
            "kind": "res",
            "id": "c-2",
            "ok": false,
            "error": {"code": "unavailable", "message": "snapshot unavailable"}
        }),
    ];

    for input in cases {
        let envelope: Envelope = serde_json::from_value(input.clone()).expect("response parses");
        match &envelope {
            Envelope::Response {
                version,
                id,
                ok,
                result,
                error,
            } => {
                assert_eq!(*version, 1);
                assert_eq!(*ok, result.is_some());
                assert_eq!(!*ok, error.is_some());
                assert!(id == "c-1" || id == "c-2");
            }
            other => panic!("expected response, got {other:?}"),
        }
        assert_eq!(
            serde_json::to_value(envelope).expect("response serializes"),
            input
        );
    }
}

#[test]
fn every_p1a_event_name_round_trips_without_a_request_id() {
    let cases = [
        ("project.updated", EventName::ProjectUpdated),
        ("snapshot.replaced", EventName::SnapshotReplaced),
        ("snapshot.failed", EventName::SnapshotFailed),
        ("subscription.ended", EventName::SubscriptionEnded),
    ];

    for (wire_name, expected_name) in cases {
        let input = json!({
            "v": 1,
            "kind": "event",
            "name": wire_name,
            "payload": {"projectId": "demo"}
        });
        let envelope: Envelope = serde_json::from_value(input.clone()).expect("event parses");

        match &envelope {
            Envelope::Event {
                version,
                name,
                payload,
            } => {
                assert_eq!(*version, 1);
                assert_eq!(name, &expected_name);
                assert_eq!(payload, &json!({"projectId": "demo"}));
            }
            other => panic!("expected event, got {other:?}"),
        }

        let encoded: Value = serde_json::to_value(envelope).expect("event serializes");
        assert_eq!(encoded, input);
        assert!(encoded.get("id").is_none());
    }
}
