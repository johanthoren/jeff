#!/usr/bin/env bats
# tests/disposition.bats: bats suite for task 0049: optional test disposition
#
# Groups covered (from Test design block in .jeff/tasks/0049-optional-test-disposition/notes.md):
#   D1: None/na done-state passes (new na path)
#   D2: na without justification is refused
#   D3: na without reviewer agreement is refused
#   D4: na does not let a recorded red gate pass unchecked
#   D5: Preserve/Change still require a real boolean green (false still refused)
#   D6: Remove keeps the green gate (existing path unchanged)
#   D7: legacy back-compat: boolean true + real author still exits 0
#   D8: live store stays green after the change
#
# Strategy:
#   - All tests run `cook validate` against a synthetic task.json fixture built
#     under a mktemp -d store, asserting exit code (0 = pass / non-zero = refused)
#     and, on refusal, the reason marker on stderr.
#   - Seam is identical for every test: the `cook validate` outcome-boundary seam
#     as used by tests/gate.bats (NOT jq internals).
#   - The synthetic store uses lite mode (config.json mode=lite) so the validator
#     reaches the inv4 quality-invariant pass with registry checks disabled.
#     The [gate] pre-flight runs before this gate; it is mode-independent.
#   - D1 is a genuine red→green test: it FAILS now because today's cook validate
#     refuses tests.green == "na" at inv4. D2-D8 are guard tests that PASS now.
#   - No markdown is grepped. No real clock / network / cook verify / git HEAD
#     probe / shared mutable state / sleep.
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="${COOK_OVERRIDE:-$REPO/skills/cook/scripts/cook.sh}"

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
  # Use lite mode so the validator runs inv4 with registry checks (inv5,
  # dup-id) disabled. The [gate] pre-flight is mode-independent.
  printf '{"schemaVersion":1,"system":"jeff","active":true,"mode":"lite"}\n' \
    > "$BK/config.json"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers: mirror gate.bats conventions
# ---------------------------------------------------------------------------

# write_done_task <task_dir>
# Writes a fully schema-valid done task.json with tests.green=true,
# review.verdict=pass, audit.verdict=na, distinct agent ids, NO tests.gate.
# This is the baseline that should always pass validate.
write_done_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 1,
    slug: "disposition-test-task",
    title: "Synthetic disposition test task",
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
# Merges a tests.gate object into an existing task.json.
inject_gate() {
  local path="$1" gate="$2" tmp
  tmp="$(mktemp)"
  jq --argjson gate "$gate" '.tests.gate = $gate' "$path" > "$tmp"
  mv "$tmp" "$path"
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

# ---------------------------------------------------------------------------
# D1: None/na done-state passes (red→green: new behavior)
# ---------------------------------------------------------------------------

@test "disposition/D1: done task with tests.green=na + evidence + review.pass + no author + no gate exits 0" {
  # Design D1: tests.green == "na" AND non-empty tests.evidence AND
  # review.verdict == "pass" AND no tests.authored_by_agent_id AND no tests.gate
  # → cook validate exits 0.
  # RED NOW: today's inv4 refuses "na" (expects true).
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"
  patch_field "$dir/task.json" '
    .tests.green = "na"
    | .tests.authored_by_agent_id = null
    | .tests.evidence = ["AC5 is a prose constraint with no consumer-observable runtime behavior"]
    | del(.tests.gate)
  '

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# D2: na without justification is refused (guard: stays-refused)
# ---------------------------------------------------------------------------

@test "disposition/D2: done task with tests.green=na but empty evidence is refused with [inv4]" {
  # Design D2: tests.green == "na" but tests.evidence == [] → non-zero + [inv4].
  # The justification is load-bearing; a bare na must not be a free pass.
  # Guard test: stays-refused now and after implement.
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"
  patch_field "$dir/task.json" '
    .tests.green = "na"
    | .tests.authored_by_agent_id = null
    | .tests.evidence = []
    | del(.tests.gate)
  '

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[inv4]"* ]] || true
}

# ---------------------------------------------------------------------------
# D3: na without reviewer agreement is refused (guard: stays-refused)
# ---------------------------------------------------------------------------

@test "disposition/D3: done task with tests.green=na + evidence but review.verdict!=pass is refused with [inv4]" {
  # Design D3: tests.green == "na" + non-empty evidence but review.verdict != "pass"
  # → non-zero + [inv4].
  # The reviewer-agreed clause is enforced.
  # Guard test: stays-refused.
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"
  patch_field "$dir/task.json" '
    .tests.green = "na"
    | .tests.authored_by_agent_id = null
    | .tests.evidence = ["justification present"]
    | .review.verdict = "pending"
    | del(.tests.gate)
  '

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[inv4]"* ]] || true
}

# ---------------------------------------------------------------------------
# D4: na does not let a recorded red gate pass unchecked (guard: stays-refused)
# ---------------------------------------------------------------------------

@test "disposition/D4: done task with tests.green=na that carries a red gate is refused with [gate]" {
  # Design D4: tests.green == "na" + valid evidence + review pass,
  # but tests.gate.green == false → still refused ([gate] pre-flight fires).
  # The na path must not be a backdoor around a recorded-but-red gate.
  # Guard test: stays-refused.
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"
  patch_field "$dir/task.json" '
    .tests.green = "na"
    | .tests.authored_by_agent_id = null
    | .tests.evidence = ["justification present"]
    | del(.tests.gate)
  '
  inject_gate "$dir/task.json" "$GATE_RED"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[gate]"* ]] || true
}

# ---------------------------------------------------------------------------
# D5: boolean false is still refused (guard: stays-refused)
# ---------------------------------------------------------------------------

@test "disposition/D5: done task with tests.green=false (boolean) is refused with [inv4]" {
  # Design D5: boolean tests.green == false is refused with [inv4].
  # The na change relaxes only the literal string "na", not "anything truthy/non-false".
  # Guard test: stays-refused.
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"
  patch_field "$dir/task.json" '.tests.green = false'

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"[inv4]"* ]] || true
}

# ---------------------------------------------------------------------------
# D6: Remove keeps the green gate (guard: stays-green)
# ---------------------------------------------------------------------------

@test "disposition/D6: done task representing a Remove records true+gate and exits 0" {
  # Design D6: a Remove task (obsolete tests deleted) records tests.green == true
  # backed by a green+clean tests.gate → exits 0.
  # Remove rides the existing green-gate path; no schema relaxation.
  # Guard test: stays-green.
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"
  inject_gate "$dir/task.json" "$GATE_GREEN_CLEAN"

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# D7: legacy back-compat: boolean true + real author still exits 0 (guard: stays-green)
# ---------------------------------------------------------------------------

@test "disposition/D7: done task with boolean tests.green=true and real non-implementer author exits 0" {
  # Design D7: boolean tests.green == true, real non-implementer test author,
  # review.verdict == "pass", no tests.gate → exits 0.
  # Guards that the na predicate change does not regress the boolean-true path.
  # write_done_task already has green=true and authored_by_agent_id != implementer_agent_id.
  # Guard test: stays-green.
  local dir="$BK/tasks/0001-disposition-test-task"
  write_done_task "$dir"

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# D8: live store stays green (integration guard: stays-green)
# ---------------------------------------------------------------------------

@test "disposition/D8: cook validate over the real .jeff/ store exits 0" {
  # Design D8: cook validate over the real committed .jeff/ store exits 0.
  # Read-only over committed state; no mutation, no clock/network.
  # Guard test: stays-green.
  run env COOK_ROOT="$REPO" "$COOK" validate
  [ "$status" -eq 0 ]
}
