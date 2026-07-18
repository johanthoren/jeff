#!/usr/bin/env bats
# tests/prune.bats: bats suite for task 0063: [prune] full-mode registry invariant.
#
# The [prune] clause (not yet implemented) will make `cook validate` FAIL (non-zero)
# with a `[prune]` marker whenever a full-mode store contains a task resting at
# status:"done" or status:"abandoned". Lite mode drops this invariant.
#
# P1 (RED): full-mode store, one done task      → validate FAILS + [prune] marker
# P2 (RED): full-mode store, one abandoned task → validate FAILS + [prune] marker
# P3 (GREEN guard): full-mode, only pending/in_progress → validate PASSES
# P4 (GREEN guard): lite-mode, done ledger      → validate PASSES ([prune] is lite-gated)
#
# P5 is NOT a new test: gate.bats C7 already guards "live cook validate over $REPO
# stays green"; after the implement sweep it continues to pass (no terminal dirs left).
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="${COOK_OVERRIDE:-$REPO/src/cli/cook.js}"

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers (per-file convention; do NOT touch test_helper.bash)
# ---------------------------------------------------------------------------

# write_prune_done_task <task_dir>
# Writes a fully schema-valid done task (tests.green=true, review pass, audit na,
# distinct agent ids, deps:[]). The ONLY reason validate should fail under the new
# clause is status:"done": no other schema violation.
write_prune_done_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 101,
    slug: "prune-done-task",
    title: "Synthetic prune done task",
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
      plan_agent_id:        "prune-plan-001",
      test_author_agent_id: "prune-tester-002",
      implementer_agent_id: "prune-impl-003",
      reviewer_agent_id:    "prune-reviewer-004",
      audit_agent_id:       null
    },
    tests: {
      authored_by_agent_id: "prune-tester-002",
      green: true,
      evidence: ["synthetic evidence"]
    },
    review: {
      verdict: "pass",
      reviewer_agent_id: "prune-reviewer-004",
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

# write_prune_abandoned_task <task_dir>
# Writes a schema-valid abandoned task (status/stage="abandoned", abandonReason non-null).
write_prune_abandoned_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 102,
    slug: "prune-abandoned-task",
    title: "Synthetic prune abandoned task",
    status: "abandoned",
    stage: "abandoned",
    priority: "p3",
    deps: [],
    complexity: "simple",
    branch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
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
      plan_agent_id:        "prune-plan-011",
      test_author_agent_id: "prune-tester-012",
      implementer_agent_id: null,
      reviewer_agent_id:    null,
      audit_agent_id:       null
    },
    tests: {
      authored_by_agent_id: null,
      green: false,
      evidence: []
    },
    review: {
      verdict: "na",
      reviewer_agent_id: null,
      evidence: []
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
    abandonReason: "Superseded by a different approach"
  }' > "$dir/task.json"
}

# write_prune_pending_task <task_dir>
# Writes a schema-valid pending task (status:"pending").
write_prune_pending_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 103,
    slug: "prune-pending-task",
    title: "Synthetic prune pending task",
    status: "pending",
    stage: "capture",
    priority: "p2",
    deps: [],
    complexity: "simple",
    branch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
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
      plan_agent_id:        null,
      test_author_agent_id: null,
      implementer_agent_id: null,
      reviewer_agent_id:    null,
      audit_agent_id:       null
    },
    tests: {
      authored_by_agent_id: null,
      green: false,
      evidence: []
    },
    review: {
      verdict: "na",
      reviewer_agent_id: null,
      evidence: []
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

# write_prune_inprogress_task <task_dir>
# Writes a schema-valid in_progress task (status:"in_progress").
write_prune_inprogress_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 104,
    slug: "prune-inprogress-task",
    title: "Synthetic prune in-progress task",
    status: "in_progress",
    stage: "implement",
    priority: "p1",
    deps: [],
    complexity: "complex",
    branch: "task/prune-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
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
      plan_agent_id:        "prune-plan-021",
      test_author_agent_id: "prune-tester-022",
      implementer_agent_id: null,
      reviewer_agent_id:    null,
      audit_agent_id:       null
    },
    tests: {
      authored_by_agent_id: "prune-tester-022",
      green: true,
      evidence: ["tests written"]
    },
    review: {
      verdict: "na",
      reviewer_agent_id: null,
      evidence: []
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

# write_lite_config: write .jeff/config.json with mode:"lite", active:true.
write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# ---------------------------------------------------------------------------
# P1 (RED): full-mode + done resting task → validate FAILS with [prune]
# ---------------------------------------------------------------------------

@test "prune/P1: full-mode done task causes validate to fail with [prune] marker" {
  # P1: RED until the [prune] clause is implemented.
  # A full-mode store (no config.json) with a resting status:"done" task must
  # cause `cook validate` to exit non-zero AND emit a [prune] marker.
  local dir="$BK/tasks/0101-prune-done-task"
  write_prune_done_task "$dir"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[prune]"* ]]
}

# ---------------------------------------------------------------------------
# P2 (RED): full-mode + abandoned resting task → validate FAILS with [prune]
# ---------------------------------------------------------------------------

@test "prune/P2: full-mode abandoned task causes validate to fail with [prune] marker" {
  # P2: RED until the [prune] clause is implemented.
  # A full-mode store with a resting status:"abandoned" task (abandonReason non-null)
  # must cause `cook validate` to exit non-zero AND emit a [prune] marker.
  local dir="$BK/tasks/0102-prune-abandoned-task"
  write_prune_abandoned_task "$dir"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[prune]"* ]]
}

# ---------------------------------------------------------------------------
# P3 (GREEN guard): full-mode + only live tasks → validate PASSES
# ---------------------------------------------------------------------------

@test "prune/P3: full-mode store with only pending+in_progress tasks validates cleanly" {
  # P3: GREEN guard (must pass before AND after the [prune] clause lands).
  # The [prune] check must not over-fire on live (non-terminal) tasks.
  local dir_p="$BK/tasks/0103-prune-pending-task"
  local dir_i="$BK/tasks/0104-prune-inprogress-task"
  write_prune_pending_task "$dir_p"
  write_prune_inprogress_task "$dir_i"

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# P4 (GREEN guard): lite-mode + done ledger → validate PASSES ([prune] is full-only)
# ---------------------------------------------------------------------------

@test "prune/P4: lite-mode store with done ledger validates cleanly ([prune] is lite-gated)" {
  # P4: GREEN guard (must pass before AND after the [prune] clause lands).
  # The [prune] invariant is a registry invariant that lite mode drops.
  # A lite operator keeps their local done ledger; validate must exit 0.
  local dir="$BK/tasks/0101-prune-done-task"
  write_prune_done_task "$dir"
  write_lite_config

  run cook validate
  [ "$status" -eq 0 ]
}
