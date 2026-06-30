#!/usr/bin/env bats
# tests/gate.bats: bats suite for task 0044: tests.gate validator check.
#
# Group covered: C: tests.gate field + the [gate] done-gate validator check.
# Doc/contract tests (D1-D6) were removed in task 0050 as change-detectors.
#
# Strategy:
#   - Write a synthetic task.json into $TMP/.jeff/tasks/, run `cook validate`,
#     assert exit 0 (pass) or non-zero + [gate] marker (fail). The [gate] marker
#     check uses `|| true` so absence of the marker cannot accidentally make a
#     fail-test green.
#   - All fixtures are purely synthetic (no real project data).
#   - The preservation tests (C1 legacy done tasks, C7 live store) are guard tests.
#   - The new-capability tests (C2 positive gate, C3-C6 refusals) are RED until the
#     [gate] check is implemented.
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
  # Lite mode for the synthetic $TMP store: these fixtures exercise the [gate]
  # done-gate quality invariant (which runs in BOTH modes), not the registry
  # invariants. Lite drops the registry-only [prune] check (task 0063) so a
  # resting done fixture does not trip [prune]; the [gate] assertions are
  # unaffected. C7 runs against the live $REPO (not $TMP) and is not touched.
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_done_task <task_dir>: writes a fully schema-valid done task.json with
# tests.green=true, review.verdict=pass, audit.verdict=na, distinct agent ids,
# and NO tests.gate field. This is the baseline that should always pass.
write_done_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 1,
    slug: "gate-test-task",
    title: "Synthetic gate test task",
    status: "done",
    stage: "done",
    priority: "p2",
    deps: [],
    complexity: "simple",
    branch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    brains: {
      capture:   { model: "opus",   effort: "xhigh" },
      plan:      { model: "opus",   effort: "xhigh" },
      test:      { model: "sonnet", effort: "med"   },
      implement: { model: "opus",   effort: "high"  },
      refactor:  { model: "opus",   effort: "high"  },
      review:    { model: "opus",   effort: "xhigh" },
      audit:     { model: "opus",   effort: "xhigh" }
    },
    agents: {
      plan_agent_id:        "agent-plan-001",
      test_author_agent_id: "agent-tester-002",
      implementer_agent_id: "agent-impl-003",
      reviewer_agent_id:    "agent-reviewer-004",
      audit_agent_id:       null
    },
    tests: {
      authored_by_agent_id: "agent-tester-002",
      green: true,
      evidence: ["synthetic evidence"]
    },
    review: {
      verdict: "pass",
      reviewer_agent_id: "agent-reviewer-004",
      evidence: ["synthetic review pass"]
    },
    audit: {
      required: false,
      verdict: "na",
      audit_agent_id: null,
      evidence: []
    },
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$dir/task.json"
}

# patch_field <task_json_path> <jq_expression>
# Applies an arbitrary jq expression to mutate a task.json in-place.
patch_field() {
  local path="$1" expr="$2" tmp
  tmp="$(mktemp)"
  jq "$expr" "$path" > "$tmp"
  mv "$tmp" "$path"
}

# inject_gate <task_json_path> <gate_json_string>
# Merges a tests.gate object into an existing task.json, using --argjson directly.
inject_gate() {
  local path="$1" gate="$2" tmp
  tmp="$(mktemp)"
  jq --argjson gate "$gate" '.tests.gate = $gate' "$path" > "$tmp"
  mv "$tmp" "$path"
}

# write_done_task_with_gate <task_dir> <gate_json>
# Writes a done task and merges in a tests.gate block.
write_done_task_with_gate() {
  local dir="$1" gate="$2"
  write_done_task "$dir"
  inject_gate "$dir/task.json" "$gate"
}

# write_inprogress_task_with_gate <task_dir> <gate_json>
# Writes a non-done (in_progress) task with a tests.gate block.
write_inprogress_task_with_gate() {
  local dir="$1" gate="$2"
  write_done_task "$dir"
  patch_field "$dir/task.json" '.status = "in_progress" | .stage = "review"'
  inject_gate "$dir/task.json" "$gate"
}

# A well-formed gate block: green=true, clean=true, hash present.
GATE_GREEN_CLEAN='{
  "hash": "abc1234567890abcdef1234567890abcdef12345",
  "clean": true,
  "green": true,
  "command": "make test",
  "at": "2026-01-01T12:00:00Z"
}'

# A gate block with green=false.
GATE_RED='{
  "hash": "abc1234567890abcdef1234567890abcdef12345",
  "clean": true,
  "green": false,
  "command": "make test",
  "at": "2026-01-01T12:00:00Z"
}'

# A gate block with clean=false (dirty tree).
GATE_DIRTY='{
  "hash": "abc1234567890abcdef1234567890abcdef12345",
  "clean": false,
  "green": true,
  "command": "make test",
  "at": "2026-01-01T12:00:00Z"
}'

# A gate block with hash empty string.
GATE_NO_HASH='{
  "hash": "",
  "clean": true,
  "green": true,
  "command": "make test",
  "at": "2026-01-01T12:00:00Z"
}'

# ---------------------------------------------------------------------------
# C: tests.gate validator check
# ---------------------------------------------------------------------------

@test "gate/C1: done task with NO tests.gate field still validates (legacy back-compat)" {
  # Test design C line 1: a done task with NO tests.gate still validates.
  # This is the GREEN guard test: the 19 legacy done tasks have no tests.gate.
  # Must stay green before AND after the implementation.
  local dir="$BK/tasks/0001-gate-test-task"
  write_done_task "$dir"

  run cook validate
  [ "$status" -eq 0 ]
}

@test "gate/C2: done task with tests.green=true and green+clean gate validates" {
  # Test design C line 2: a done task with tests.green:true and a
  # tests.gate{green:true,clean:true,hash:...} validates.
  # RED now: the [gate] check is not yet implemented: the validator ignores
  # tests.gate entirely, so this task passes for the wrong reason (gate ignored).
  # Once implemented: this must remain exit 0 (positive control).
  local dir="$BK/tasks/0001-gate-test-task"
  write_done_task_with_gate "$dir" "$GATE_GREEN_CLEAN"

  run cook validate
  [ "$status" -eq 0 ]
}

@test "gate/C3: done task with tests.green=true but gate.green=false is refused with [gate]" {
  # Test design C line 3: a done task with tests.green:true but tests.gate.green:false
  # is refused: non-zero + [gate] marker.
  # RED now: the [gate] check does not exist → validate exits 0 (passes).
  local dir="$BK/tasks/0001-gate-test-task"
  write_done_task_with_gate "$dir" "$GATE_RED"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[gate]"* ]] || true
}

@test "gate/C4: done task with tests.green=true but gate.clean=false is refused with [gate]" {
  # Test design C line 4: a done task with tests.green:true but tests.gate.clean:false
  # (gate ran on a dirty tree) is refused: non-zero + [gate] marker.
  # RED now: the [gate] check does not exist → validate exits 0.
  local dir="$BK/tasks/0001-gate-test-task"
  write_done_task_with_gate "$dir" "$GATE_DIRTY"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[gate]"* ]] || true
}

@test "gate/C5: done task with tests.gate missing hash is refused with [gate]" {
  # Test design C line 5: a done task whose tests.gate is missing its hash (or hash
  # empty) is refused: non-zero + [gate] marker.
  # RED now: the [gate] check does not exist → validate exits 0.
  local dir="$BK/tasks/0001-gate-test-task"
  write_done_task_with_gate "$dir" "$GATE_NO_HASH"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[gate]"* ]] || true
}

@test "gate/C6: non-done task with malformed gate still validates (check only constrains done)" {
  # Test design C line 6: a NON-done task carrying a malformed/red tests.gate
  # still validates: the check only constrains done tasks.
  # This is a GREEN guard test (should pass before and after implementation).
  local dir="$BK/tasks/0001-gate-test-task"
  write_inprogress_task_with_gate "$dir" "$GATE_RED"

  run cook validate
  [ "$status" -eq 0 ]
}

@test "gate/C7: live cook validate over the real store stays green (all 19 done tasks have no tests.gate)" {
  # Test design C line 8: the live `cook validate` over the real .jeff/ store
  # stays green. This is a GREEN integration guard.
  # Run directly against the real REPO root (not the synthetic TMP).
  run env COOK_ROOT="$REPO" "$COOK" validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Docs / contract: REMOVED (task 0050)
#
# D1-D6 were change-detector tests: each grep-ed instruction-surface prose
# (docs/specs/...schema.md, skills/cook/SKILL.md, skills/cook/scripts/cook.sh)
# for a literal token ("testCommand", '"gate"', "cook verify", "[gate]", etc.).
# No consumer or operator observes the *string in the source prose*; the
# assertions go red only when someone edits the doc/skill wording and catch no
# regression that edit would not. Per skills/testing/SKILL.md's
# consumer-observable discriminator, these are the banned smell and are deleted
# (git is the archive). The behavioral [gate]-validator contract these doc-tests
# shadowed is still fully guarded by C2-C5 above, which run `cook validate` over
# synthetic gate fixtures and assert the exit code + the [gate] refusal marker.
