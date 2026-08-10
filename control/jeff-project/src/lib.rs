use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::path::PathBuf;
use thiserror::Error;

const SNAPSHOT_SCHEMA_MINIMUM: u64 = 1;
const SNAPSHOT_SCHEMA_MAXIMUM: u64 = 1;

/// A projected jeff task identifier.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum TaskId {
    Number(u64),
    String(String),
}

/// The project mode recorded by a snapshot.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectMode {
    Lite,
    Full,
}

/// Claim metadata projected for a task.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SnapshotClaim {
    pub by: String,
    pub at: String,
}

/// An unresolved planning fork projected for a task.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SnapshotEscalation {
    pub fork: String,
    pub options: Vec<String>,
}

/// The task fields exposed by `cook snapshot --json`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTask {
    pub id: TaskId,
    pub slug: String,
    pub title: String,
    pub status: String,
    pub stage: String,
    pub priority: String,
    pub deps: Vec<TaskId>,
    pub blocked_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovered_from: Option<TaskId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim: Option<SnapshotClaim>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escalation: Option<SnapshotEscalation>,
}

/// A versioned read-only project snapshot.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: u64,
    pub generated_at: String,
    pub mode: ProjectMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_parallel_tasks: Option<u64>,
    pub tasks: Vec<SnapshotTask>,
}

/// Errors returned while decoding or checking a snapshot.
#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("invalid snapshot: {0}")]
    Malformed(#[source] serde_json::Error),
    #[error(
        "snapshot schema {found} is older than supported minimum {minimum}; upgrade project jeff, or run a backend that still supports that schema"
    )]
    SchemaTooOld { found: u64, minimum: u64 },
    #[error(
        "snapshot schema {found} is newer than supported maximum {maximum}; upgrade jeffd / control clients"
    )]
    SchemaTooNew { found: u64, maximum: u64 },
}

/// Checks whether a snapshot schema version is supported.
pub fn check_snapshot_schema(version: u64) -> Result<(), SnapshotError> {
    if version < SNAPSHOT_SCHEMA_MINIMUM {
        Err(SnapshotError::SchemaTooOld {
            found: version,
            minimum: SNAPSHOT_SCHEMA_MINIMUM,
        })
    } else if version > SNAPSHOT_SCHEMA_MAXIMUM {
        Err(SnapshotError::SchemaTooNew {
            found: version,
            maximum: SNAPSHOT_SCHEMA_MAXIMUM,
        })
    } else {
        Ok(())
    }
}

/// Decodes a snapshot and applies the explicit schema compatibility gate.
pub fn parse_snapshot(input: &str) -> Result<Snapshot, SnapshotError> {
    let snapshot: Snapshot = serde_json::from_str(input).map_err(SnapshotError::Malformed)?;
    check_snapshot_schema(snapshot.schema_version)?;
    Ok(snapshot)
}

/// A project registered with the daemon.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectRecord {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub enabled: bool,
    pub cook: Option<Vec<String>>,
}

/// Snapshot data enriched with its project identity and health notes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProjection {
    pub project_id: String,
    pub path: PathBuf,
    #[serde(flatten)]
    pub snapshot: Snapshot,
    pub degraded: Vec<String>,
}

/// A request method understood or dispatchable by the daemon.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Method {
    ServerHello,
    ProjectList,
    SnapshotGet,
    SnapshotSubscribe,
    SnapshotUnsubscribe,
    Unknown(String),
}

impl Method {
    fn as_str(&self) -> &str {
        match self {
            Self::ServerHello => "server.hello",
            Self::ProjectList => "project.list",
            Self::SnapshotGet => "snapshot.get",
            Self::SnapshotSubscribe => "snapshot.subscribe",
            Self::SnapshotUnsubscribe => "snapshot.unsubscribe",
            Self::Unknown(method) => method,
        }
    }
}

impl Serialize for Method {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Method {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match String::deserialize(deserializer)?.as_str() {
            "server.hello" => Self::ServerHello,
            "project.list" => Self::ProjectList,
            "snapshot.get" => Self::SnapshotGet,
            "snapshot.subscribe" => Self::SnapshotSubscribe,
            "snapshot.unsubscribe" => Self::SnapshotUnsubscribe,
            method => Self::Unknown(method.to_owned()),
        })
    }
}

/// A server event name.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum EventName {
    #[serde(rename = "project.updated")]
    ProjectUpdated,
    #[serde(rename = "snapshot.replaced")]
    SnapshotReplaced,
    #[serde(rename = "snapshot.failed")]
    SnapshotFailed,
    #[serde(rename = "subscription.ended")]
    SubscriptionEnded,
}

/// A request, response, or event protocol envelope.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum Envelope {
    #[serde(rename = "req")]
    Request {
        #[serde(rename = "v")]
        version: u64,
        id: String,
        method: Method,
        params: Value,
    },
    #[serde(rename = "res")]
    Response {
        #[serde(rename = "v")]
        version: u64,
        id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<Value>,
    },
    #[serde(rename = "event")]
    Event {
        #[serde(rename = "v")]
        version: u64,
        name: EventName,
        payload: Value,
    },
}
