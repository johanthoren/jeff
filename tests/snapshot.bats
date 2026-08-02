#!/usr/bin/env bats

# Item 8: cook snapshot --json CLI contract.
# Hermetic COOK_ROOT fixtures; no dependency on the production .jeff/ store.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/src/cli/cook.js"

setup() {
  TMP="$(mktemp -d)"
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

write_lite_config() {
  mkdir -p "$TMP/.jeff/tasks"
  jq -n '{schemaVersion:1, system:"jeff", mode:"lite", active:true}' > "$TMP/.jeff/config.json"
}

write_task() {
  local dir_name="$1"
  local id="$2"
  local title="$3"
  local dir="$TMP/.jeff/tasks/$dir_name"
  mkdir -p "$dir"
  jq -n \
    --argjson id "$id" \
    --arg title "$title" \
    --arg slug "$dir_name" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: $slug,
      title: $title,
      status: "pending",
      stage: "capture",
      priority: "p2",
      deps: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      agents: {
        implementer_agent_id: null,
        reviewer_agent_id: null,
        reviewer2_agent_id: null,
        audit_agent_id: null
      },
      tests: {authored_by_agent_id:null, green:false, evidence:[]},
      review: {verdict:null, reviewer_agent_id:null, evidence:[]},
      audit: {required:false, verdict:"na", audit_agent_id:null, evidence:[]},
      commits: [],
      kickbacks: [],
      blockedReason: null,
      abandonReason: null
    }' > "$dir/task.json"
}

@test "snapshot/--json: initialized project exits 0 with parseable projection JSON" {
  write_lite_config
  write_task "0001-one" 1 "One"

  run cook snapshot --json
  require_success

  run jq -e '
    .schemaVersion == 1
    and (.generatedAt | type == "string" and length > 0)
    and .mode == "lite"
    and (.tasks | type == "array")
    and (.tasks | length) == 1
    and .tasks[0].id == 1
    and .tasks[0].title == "One"
    and (.maxParallelTasks | not)
    and (.tasks[0] | has("claim") | not)
  ' <<<"$output"
  require_success
}

@test "snapshot/--json: outside an initialized project exits non-zero with a clear error" {
  # TMP has no .jeff/config.json
  run cook snapshot --json
  [ "$status" -ne 0 ]
  [[ "$output" == *"cook: snapshot:"* ]] || {
    printf 'expected cook: snapshot: error, got: %s\n' "$output"
    return 1
  }
}

@test "snapshot/--json: invalid store still emits a snapshot" {
  write_lite_config
  local dir="$TMP/.jeff/tasks/0009-broken"
  mkdir -p "$dir"
  # Parseable JSON that fails cook validate (bogus status/stage), not unreadable bytes.
  jq -n '{
    schemaVersion: 1,
    id: 9,
    slug: "broken",
    title: "Broken",
    status: "not-a-status",
    stage: "not-a-stage",
    priority: "p2",
    deps: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    agents: {
      implementer_agent_id: null,
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null
    },
    tests: {authored_by_agent_id:null, green:false, evidence:[]},
    review: {verdict:null, reviewer_agent_id:null, evidence:[]},
    audit: {required:false, verdict:"na", audit_agent_id:null, evidence:[]},
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$dir/task.json"

  run cook validate
  [ "$status" -ne 0 ]

  run cook snapshot --json
  require_success
  run jq -e '
    .schemaVersion == 1
    and (.tasks | length) == 1
    and .tasks[0].id == 9
    and .tasks[0].status == "not-a-status"
  ' <<<"$output"
  require_success
}
