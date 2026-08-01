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

@test "Item 3 rejects a hardlinked journal without changing the outside inode" {
  local victim="$TMP/outside-victim"
  local snapshot="$TMP/outside-victim.before"
  local journal="$TASK_DIR/journal.jsonl"
  printf '%s\n' '{"seq":0,"at":"2026-08-01T00:00:00Z","event":"intent","stage":"plan"}' > "$victim"
  cp "$victim" "$snapshot"

  run node -e 'require("node:fs").linkSync(process.argv[1], process.argv[2])' "$victim" "$journal"
  if [ "$status" -ne 0 ]; then
    case "$output" in
      *"code: 'EPERM'"*|*"code: 'ENOSYS'"*|*"code: 'ENOTSUP'"*|*"code: 'EOPNOTSUPP'"*)
        skip "host does not support hard links: $output"
        ;;
      *)
        printf '%s\n' "$output"
        return 1
        ;;
    esac
  fi

  run cook journal 18 intent --stage plan
  local append_status="$status"
  local append_output="$output"
  local failures=0
  if [ "$append_status" -eq 0 ]; then
    printf 'hardlinked journal append unexpectedly succeeded\n'
    failures=$((failures + 1))
  fi
  if [[ ! "$append_output" =~ \[journal[^]]*\] ]]; then
    printf 'missing named journal rejection: %s\n' "$append_output"
    failures=$((failures + 1))
  fi
  if ! cmp -s "$victim" "$snapshot"; then
    printf 'outside hardlink victim bytes changed\n'
    failures=$((failures + 1))
  fi
  [ "$failures" -eq 0 ]
}

@test "Item 3 journal CLI rejects the malformed invocation matrix without creating bytes" {
  local cases=(
    "missing id|"
    "missing event|18"
    "unsupported event|18 gate"
    "missing option value|18 intent --stage plan --note"
    "unsupported intent stage|18 intent --stage deploy"
    "duplicate option|18 intent --stage plan --stage plan"
    "unknown option|18 intent --stage plan --unknown"
    "extra positional|18 intent --stage plan extra"
    "intent without stage|18 intent"
    "external with stage|18 external --stage external"
  )
  local failures=0
  local case_data label arguments

  for case_data in "${cases[@]}"; do
    rm -f "$TASK_DIR/journal.jsonl"
    IFS='|' read -r label arguments <<< "$case_data"
    local argv=()
    if [ -n "$arguments" ]; then
      read -r -a argv <<< "$arguments"
    fi

    run cook journal "${argv[@]}"
    if [ "$status" -eq 0 ]; then
      printf '%s unexpectedly succeeded\n' "$label"
      failures=$((failures + 1))
    fi
    if [ -e "$TASK_DIR/journal.jsonl" ]; then
      printf '%s created journal bytes\n' "$label"
      failures=$((failures + 1))
    fi
  done

  [ "$failures" -eq 0 ]
}
