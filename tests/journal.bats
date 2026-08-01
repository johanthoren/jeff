#!/usr/bin/env bats

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/src/cli/cook.js"

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  TASK_DIR="$BK/tasks/018-journal"
  mkdir -p "$TASK_DIR"
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
  jq -n '{
    schemaVersion: 1,
    id: 18,
    slug: "journal",
    title: "Journal fixture",
    status: "in_progress",
    stage: "plan",
    priority: "p2",
    deps: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    complexity: "simple",
    agents: {
      implementer_agent_id: null,
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null
    },
    tests: {authored_by_agent_id:null, green:false, evidence:[]},
    review: {verdict:null, reviewer_agent_id:null, findings:[], evidence:[]},
    audit: {required:true, verdict:"na", audit_agent_id:null, findings:[], evidence:[]},
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$TASK_DIR/task.json"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

require_success() {
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$output"
    return 1
  fi
}

@test "Item 3 journal CLI appends intent and external completion events" {
  run cook journal 18 intent --stage plan --note "dispatch plan specialist"
  require_success

  run cook journal 18 external --note "created pull request 42"
  require_success

  run jq -s -e '
    length == 2
    and .[0].seq == 0
    and .[0].event == "intent"
    and .[0].stage == "plan"
    and .[0].note == "dispatch plan specialist"
    and (.[0].at | type == "string" and length > 0)
    and .[1].seq == 1
    and .[1].event == "external"
    and .[1].note == "created pull request 42"
    and (.[1] | has("stage") | not)
    and (.[1].at | type == "string" and length > 0)
  ' "$TASK_DIR/journal.jsonl"
  require_success
}

@test "Item 3 resume fixture preserves a dangling external intent before recording observed completion" {
  printf '%s\n' \
    '{"seq":0,"at":"2026-08-01T00:00:00Z","event":"intent","stage":"external","note":"create pull request"}' \
    > "$TASK_DIR/journal.jsonl"

  run cook journal 18 external --note "pull request 42 already exists"
  require_success

  run jq -s -e '
    length == 2
    and .[0] == {
      seq: 0,
      at: "2026-08-01T00:00:00Z",
      event: "intent",
      stage: "external",
      note: "create pull request"
    }
    and .[1].seq == 1
    and .[1].event == "external"
    and .[1].note == "pull request 42 already exists"
  ' "$TASK_DIR/journal.jsonl"
  require_success
}
