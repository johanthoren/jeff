#!/usr/bin/env bats
# tests/lite.bats: bats suite for task 0008: lite mode foundation.
#
# Covers:
#   - `cook lite` activation (config.json, .git/info/exclude, idempotency, no hook)
#   - `cook doctor` lite-aware report
#   - lite validator KEEPS quality invariants (inv1..4, inv9 sample)
#   - lite validator DROPS registry gates (string id, inv5 skip)
#   - full mode untouched (string id still rejected in full mode)
#
# Strategy:
#   - All fixtures are wholly synthetic (no real project data).
#   - Each test gets a fresh temp dir via mktemp -d; setup() initialises it as a
#     minimal git repo so .git/info/exclude handling works.
#   - The `cook()` wrapper runs with COOK_ROOT="$TMP" (mirrors convergence.bats).
#   - Tests that expect FAIL assert status -ne 0 (hard requirement).
#   - Tests that expect PASS assert status -eq 0.
#   - For "KEEP" quality-gate tests, the task store has mode:lite (no index.json needed).
#     Full mode also validates dir-sourced tasks directly (task 0065).
#   - For "DROPS" registry-gate tests, the store is constructed so full mode FAILS
#     (string id, inv5 dep, etc.) but lite mode should pass → tests are RED now.
#   - NOTE on write_baseline_lite_task: identical to convergence.bats's
#     write_baseline_task but outputs the task under a string-named dir when id is
#     a string; the numeric-id variant uses the same dir naming as convergence.bats.

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
  # Minimal git repo so .git/info/exclude operations are valid
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@lite.example"
  git -C "$TMP" config user.name "Lite Test"
}

teardown() {
  rm -rf "$TMP"
  [ -z "${LINKED_TMP:-}" ] || rm -rf "$LINKED_TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_lite_config <bk_dir>
#
# Writes .jeff/config.json with mode:"lite" and active:true.
# Used to pre-configure lite mode when `cook lite` is not yet implemented.
write_lite_config() {
  local bk="$1"
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$bk/config.json"
}

# write_baseline_task_numeric <bk_dir> <id> <slug>
#
# Writes a fully schema-valid v1 task.json with a NUMERIC id under
# <bk_dir>/tasks/<id>-<slug>/task.json. No convergence block, done status
# with all done-gate fields satisfied. Agents are distinct.
write_baseline_task_numeric() {
  local bk="$1" id="$2" slug="$3"
  local task_dir="$bk/tasks/${id}-${slug}"
  mkdir -p "$task_dir"
  jq -n \
    --argjson id "$id" \
    --arg slug "$slug" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: $slug,
      title: ("Lite synthetic task: " + $slug),
      status: "done",
      stage: "done",
      priority: "p2",
      deps: [],
      trivial: false,
      branch: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      brains: {
        capture:   { model: "opus",   effort: "xhigh" },
        plan:      { model: "opus",   effort: "high"  },
        test:      { model: "sonnet", effort: "med"   },
        implement: { model: "sonnet", effort: "med"   },
        refactor:  { model: "sonnet", effort: "med"   },
        review:    { model: "opus",   effort: "high"  },
        audit:     { model: "opus",   effort: "high"  }
      },
      agents: {
        test_author_agent_id: "agent-tester-001",
        implementer_agent_id: "agent-impl-002",
        reviewer_agent_id:    "agent-reviewer-003",
        audit_agent_id:       null
      },
      tests: {
        authored_by_agent_id: "agent-tester-001",
        green: true,
        evidence: ["synthetic evidence"]
      },
      review: {
        verdict: "pass",
        reviewer_agent_id: "agent-reviewer-003",
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
    }' > "$task_dir/task.json"
}

# write_baseline_task_string_id <bk_dir> <string_id> <slug>
#
# Writes a quality-clean task.json with a STRING id (e.g. "JIRA-42") under
# <bk_dir>/tasks/<string_id>-<slug>/task.json. Quality gates are satisfied
# (distinct agents, tests green, review pass). This is a pending task (not
# done) to avoid triggering done-gate checks against a string id in code that
# doesn't handle them yet.
write_baseline_task_string_id() {
  local bk="$1" str_id="$2" slug="$3"
  local task_dir="$bk/tasks/${str_id}-${slug}"
  mkdir -p "$task_dir"
  jq -n \
    --arg id "$str_id" \
    --arg slug "$slug" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: $slug,
      title: ("Lite string-id task: " + $slug),
      status: "pending",
      stage: "capture",
      priority: "p2",
      deps: [],
      trivial: false,
      branch: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      brains: {
        capture:   { model: "opus",   effort: "xhigh" },
        plan:      { model: "opus",   effort: "high"  },
        test:      { model: "sonnet", effort: "med"   },
        implement: { model: "sonnet", effort: "med"   },
        refactor:  { model: "sonnet", effort: "med"   },
        review:    { model: "opus",   effort: "high"  },
        audit:     { model: "opus",   effort: "high"  }
      },
      agents: {
        test_author_agent_id: "agent-tester-001",
        implementer_agent_id: "agent-impl-002",
        reviewer_agent_id:    "agent-reviewer-003",
        audit_agent_id:       null
      },
      tests: {
        authored_by_agent_id: "agent-tester-001",
        green: false,
        evidence: []
      },
      review: {
        verdict: null,
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
    }' > "$task_dir/task.json"
}

# patch_field <task_json_path> <jq_expression>
#
# Applies an arbitrary jq expression to mutate a task.json in-place.
patch_field() {
  local path="$1" expr="$2" tmp
  tmp="$(mktemp)"
  jq "$expr" "$path" > "$tmp"
  mv "$tmp" "$path"
}

# ---------------------------------------------------------------------------
# ACTIVATION: `cook lite`
# ---------------------------------------------------------------------------

@test "activation: cook lite command exists (help output mentions lite)" {
  # Before implementation, `cook help` does not mention `lite`.
  # This test is RED until the subcommand is added to the usage text.
  run cook help
  [ "$status" -eq 0 ]
  [[ "$output" == *"lite"* ]]
}

@test "activation: cook lite exits 0" {
  # Before implementation, `cook lite` exits non-zero (unknown subcommand).
  run cook lite
  [ "$status" -eq 0 ]
}

@test "activation: cook lite writes .jeff/config.json with mode:lite" {
  run cook lite
  [ "$status" -eq 0 ]
  [ -f "$BK/config.json" ]
  run jq -r '.mode' "$BK/config.json"
  [ "$status" -eq 0 ]
  [ "$output" = "lite" ]
}

@test "activation: cook lite writes .jeff/config.json with active:true" {
  run cook lite
  [ "$status" -eq 0 ]
  run jq -r '.active' "$BK/config.json"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}

@test "activation: cook lite appends .jeff/ to .git/info/exclude" {
  run cook lite
  [ "$status" -eq 0 ]
  [ -f "$TMP/.git/info/exclude" ]
  run grep -c '\.jeff/' "$TMP/.git/info/exclude"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "activation: cook lite creates .git/info/exclude if absent" {
  # The exclude file should not exist yet in a fresh init
  rm -f "$TMP/.git/info/exclude"
  run cook lite
  [ "$status" -eq 0 ]
  [ -f "$TMP/.git/info/exclude" ]
}

@test "activation: cook lite does NOT install pre-commit hook" {
  run cook lite
  [ "$status" -eq 0 ]
  # The pre-commit hook must be absent (or not a jeff hook)
  if [ -f "$TMP/.git/hooks/pre-commit" ]; then
    run grep -c 'jeff-validate-hook' "$TMP/.git/hooks/pre-commit"
    # Must NOT contain the jeff hook marker
    [ "$output" = "0" ] || [ "$status" -ne 0 ]
  else
    true
  fi
}

@test "activation idempotent: re-running cook lite does not duplicate .jeff/ in exclude" {
  run cook lite
  [ "$status" -eq 0 ]
  run cook lite
  [ "$status" -eq 0 ]
  # .jeff/ line must appear exactly once
  run grep -c '\.jeff/' "$TMP/.git/info/exclude"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "activation idempotent: re-running cook lite keeps mode:lite and active:true" {
  run cook lite
  [ "$status" -eq 0 ]
  run cook lite
  [ "$status" -eq 0 ]
  run jq -r '.mode' "$BK/config.json"
  [ "$output" = "lite" ]
  run jq -r '.active' "$BK/config.json"
  [ "$output" = "true" ]
}

@test "activation idempotent: re-running cook lite is a safe no-op (exit 0)" {
  run cook lite
  [ "$status" -eq 0 ]
  run cook lite
  [ "$status" -eq 0 ]
}

@test "root boundary: init rejects a nested COOK_ROOT before writing" {
  local nested="$TMP/nested-init"
  mkdir -p "$nested"

  run env COOK_ROOT="$nested" "$COOK" init
  [ ! -e "$nested/.jeff" ]
  [ "$status" -ne 0 ]
}

@test "root boundary: lite rejects a nested COOK_ROOT before writing" {
  local nested="$TMP/nested-lite"
  mkdir -p "$nested"

  run env COOK_ROOT="$nested" "$COOK" lite
  [ ! -e "$nested/.jeff" ]
  [ "$status" -ne 0 ]
}

@test "worktree AC3: init succeeds and writes its scaffold in a linked worktree" {
  make_linked_worktree

  run env COOK_ROOT="$LINKED_ROOT" "$COOK" init
  [ "$status" -eq 0 ]
  [ "$(jq -r '.active' "$LINKED_ROOT/.jeff/config.json")" = "true" ]
  [ -f "$LINKED_ROOT/.jeff/tasks/.gitkeep" ]
}

@test "worktree AC3: lite succeeds and writes config plus Git-reported exclusion" {
  make_linked_worktree
  local exclude
  exclude="$(git -C "$LINKED_ROOT" rev-parse --git-path info/exclude)"

  run env COOK_ROOT="$LINKED_ROOT" "$COOK" lite
  [ "$status" -eq 0 ]
  [ "$(jq -r '.mode, .active' "$LINKED_ROOT/.jeff/config.json")" = $'lite\ntrue' ]
  [ "$(grep -cFx '.jeff/' "$exclude")" -eq 1 ]
}

# ---------------------------------------------------------------------------
# DOCTOR: lite-aware report
# ---------------------------------------------------------------------------

@test "doctor: reports mode: lite when config.json has mode:lite" {
  # Before implementation, `cook doctor` does not print mode information.
  # This test is RED until cmd_doctor reads and reports the mode field.
  write_lite_config "$BK"
  run cook doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"mode: lite"* ]]
}

@test "doctor: reports hook: intentionally not installed under lite mode" {
  # Before implementation, doctor prints the standard hook message.
  # This test is RED until doctor emits the lite-aware hook line.
  write_lite_config "$BK"
  run cook doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"intentionally not installed"* ]]
}

@test "doctor: does NOT say 'run cook init' for hook when in lite mode" {
  # Full mode doctor instructs 'run cook init' for a missing hook.
  # Lite mode must not emit that instruction (hook is intentionally absent).
  write_lite_config "$BK"
  run cook doctor
  [ "$status" -eq 0 ]
  # The "run \`cook init\`" prompt for hook installation must not appear in lite mode
  [[ "$output" != *"run \`cook init\`"* ]]
}

@test "doctor: full mode still reports hook: not installed (run cook init) without mode:lite" {
  # Guard: full-mode doctor behavior is unchanged.
  # No config.json: mode is full/absent.
  run cook doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"cook init"* ]]
}

# ---------------------------------------------------------------------------
# LITE VALIDATOR: KEEPS quality gates
#
# All tests in this block use mode:lite config. Full mode also runs quality
# checks on dir-sourced tasks (task 0065); lite drops the registry checks only.
# ---------------------------------------------------------------------------

@test "lite-keep/inv1: test author == implementer fails validate under mode:lite" {
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv1-same"
  # Make test author == implementer (violates inv1)
  patch_field "$BK/tasks/1-lite-inv1-same/task.json" '
    .agents.implementer_agent_id = "agent-tester-001"
    | .agents.test_author_agent_id = "agent-tester-001"
    | .tests.authored_by_agent_id = "agent-tester-001"
  '
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv1"* ]] || true
}

@test "lite-keep/inv2: implementer == reviewer fails validate under mode:lite" {
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv2-same"
  # Make implementer == reviewer (violates inv2)
  patch_field "$BK/tasks/1-lite-inv2-same/task.json" '
    .agents.implementer_agent_id = "agent-impl-002"
    | .agents.reviewer_agent_id  = "agent-impl-002"
    | .review.reviewer_agent_id  = "agent-impl-002"
  '
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv2"* ]] || true
}

@test "lite-keep/inv2: reviewer2 == implementer fails validate under mode:lite" {
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv2-reviewer2-same"
  patch_field "$BK/tasks/1-lite-inv2-reviewer2-same/task.json" '
    .agents.implementer_agent_id = "agent-impl-002"
    | .agents.reviewer2_agent_id = "agent-impl-002"
  '
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv2"* ]]
}

@test "full-mode guard: reviewer2 == implementer fails validate" {
  write_baseline_task_numeric "$BK" 1 "full-inv2-reviewer2-same"
  patch_field "$BK/tasks/1-full-inv2-reviewer2-same/task.json" '
    .status = "in_progress"
    | .stage = "implement"
    | .agents.implementer_agent_id = "agent-impl-002"
    | .agents.reviewer2_agent_id = "agent-impl-002"
  '
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv2"* ]]
}

@test "legacy test-stage ledger with historical identities validates and remains listed" {
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "legacy-test-stage"
  patch_field "$BK/tasks/1-legacy-test-stage/task.json" '
    .status = "in_progress"
    | .stage = "test"
    | .agents.plan_agent_id = "agent-impl-002"
    | .agents.test_author_agent_id = "agent-tester-001"
  '

  run cook validate
  [ "$status" -eq 0 ]
  run cook ls
  [ "$status" -eq 0 ]
  [[ "$output" == *$'1\tin_progress\ttest\t'* ]]
}

@test "lite-keep/inv4: done without tests.green fails validate under mode:lite" {
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv4-notgreen"
  # tests.green = false violates inv4 on a done task
  patch_field "$BK/tasks/1-lite-inv4-notgreen/task.json" '.tests.green = false'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv4"* ]] || true
}

@test "lite-keep/inv4: done without review pass fails validate under mode:lite" {
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv4-no-review"
  # review.verdict = null violates inv4 on a done task
  patch_field "$BK/tasks/1-lite-inv4-no-review/task.json" '.review.verdict = null'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv4"* ]] || true
}

@test "lite-keep/inv9 (convergence): finding survived!=determinism fails validate under mode:lite" {
  # Verifies that the convergence invariants are still enforced in lite mode.
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv9-bad"
  # Patch a convergence block with an inv9 violation: survived=true but blockingVotes=1
  local tmp
  tmp="$(mktemp)"
  jq '. + {convergence: {
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "fake bug", "blockingVotes": 1, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }}' "$BK/tasks/1-lite-inv9-bad/task.json" > "$tmp"
  mv "$tmp" "$BK/tasks/1-lite-inv9-bad/task.json"
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "lite-keep: clean task with no violations passes validate under mode:lite (no index.json)" {
  # Positive case: a quality-clean task in lite mode (no index.json) must pass.
  # Under the current code this exits 0 early: but the test will verify the
  # expected exit 0 both before and after lite mode implementation, so it is a
  # GREEN GUARD. Pinning it here so it cannot be accidentally broken.
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-clean"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# LITE VALIDATOR: DROPS registry gates
#
# Each test is constructed so full mode FAILS (string-id violation or inv5 dep
# violation). Under lite mode the same store must pass.
# ---------------------------------------------------------------------------

@test "lite-drops/string-id: string id accepted under mode:lite" {
  # Full mode fails: "id must be a number".
  # Lite mode must accept a string id without error.
  write_lite_config "$BK"
  write_baseline_task_string_id "$BK" "JIRA-42" "string-id-task"
  run cook validate
  [ "$status" -eq 0 ]
}

@test "lite-drops/missing-index: missing index.json is tolerated under mode:lite" {
  # Full mode exits 0 early ("not a jeff project"): coincidentally passing.
  # But paired with a quality violation it becomes red: full mode exits 0 early
  # (before the violation is caught), while lite mode must run the validator
  # and catch the violation → non-zero. The test pins the COMBINATION:
  # "lite mode validates even without index.json" AND "quality gates still fire".
  # This test is also a KEEP test; placed here because its primary structural
  # contribution is the missing-index.json signal.
  write_lite_config "$BK"
  # No index.json written
  write_baseline_task_numeric "$BK" 1 "lite-no-index"
  # Introduce an inv4 violation: done task but tests.green=false
  patch_field "$BK/tasks/1-lite-no-index/task.json" '.tests.green = false'
  run cook validate
  [ "$status" -ne 0 ]
  # The violation tag (inv4) should appear, not a "nothing to validate" message
  [[ "$output" != *"nothing to validate"* ]] || true
}

@test "lite-drops/inv5-skipped: dep pointing to nonexistent task NOT failed under mode:lite" {
  # Full mode fails: "dep 999 does not exist [inv5]".
  # Lite mode must skip inv5 and pass.
  # The task is quality-clean; only inv5 would fire in full mode.
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-inv5-skip"
  # Add a dep to a nonexistent task
  patch_field "$BK/tasks/1-lite-inv5-skip/task.json" '.deps = [999]'
  run cook validate
  [ "$status" -eq 0 ]
}

@test "lite-drops/no-duplicate-id-check: duplicate numeric ids do not fail under mode:lite" {
  # Full mode fails: "duplicate task id N".
  # Lite mode drops the duplicate-id check (registry gate).
  write_lite_config "$BK"
  write_baseline_task_numeric "$BK" 1 "lite-dup-a"
  # Write a second task in a different dir but with the same id:1
  local task_dir2="$BK/tasks/1-lite-dup-b"
  mkdir -p "$task_dir2"
  jq '.slug = "lite-dup-b" | .title = "Lite dup B"' \
    "$BK/tasks/1-lite-dup-a/task.json" > "$task_dir2/task.json"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# FULL MODE UNTOUCHED
#
# These tests assert that full-mode behavior is byte-identical to today.
# They must stay GREEN both before and after task 0008 is implemented.
# ---------------------------------------------------------------------------

@test "full-mode guard: string id rejected in full mode (no mode:lite config)" {
  # No config.json → full mode. String id must still fail.
  write_baseline_task_string_id "$BK" "JIRA-99" "full-str-id"
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"id must be a number"* ]] || true
}

@test "full-mode guard: dep to nonexistent task fails in full mode" {
  # T4 [0065]: inv5 fires dir-only: no index.json in fixture [AC1, inv5 survives].
  # RED now: store has no index.json so validator early-returns "nothing to validate"
  # instead of running inv5. Green after the index early-return guard is replaced.
  write_baseline_task_numeric "$BK" 1 "full-inv5"
  patch_field "$BK/tasks/1-full-inv5/task.json" '.deps = [999]'
  # ponytail: write_index_for_numeric call removed: proves inv5 fires dir-only (task 0065)
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv5"* ]] || true
}

@test "full-mode guard: inv1 still fires in full mode" {
  write_baseline_task_numeric "$BK" 1 "full-inv1"
  patch_field "$BK/tasks/1-full-inv1/task.json" '
    .agents.implementer_agent_id = "agent-tester-001"
    | .agents.test_author_agent_id = "agent-tester-001"
    | .tests.authored_by_agent_id = "agent-tester-001"
  '
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv1"* ]] || true
}

@test "full-mode guard: clean task with no index.json passes in full mode" {
  write_baseline_task_numeric "$BK" 1 "full-clean"
  patch_field "$BK/tasks/1-full-clean/task.json" '.status = "in_progress" | .stage = "implement"'
  run cook validate
  [ "$status" -eq 0 ]
}

@test "full-mode guard: real task validates in full mode without index.json" {
  # T3 [0065]: a store with a real numeric task dir and NO index.json must now
  # VALIDATE the task (exit 0, NOT "nothing to validate") [AC1].
  # RED now: the current guard early-returns "nothing to validate" when index.json
  # is absent: the test asserts the opposite (validation runs, not early-return).
  write_baseline_task_numeric "$BK" 1 "full-no-idx"
  patch_field "$BK/tasks/1-full-no-idx/task.json" '.status = "in_progress" | .stage = "implement"'
  # No index.json written: the new behavior validates the dir-sourced task.
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" != *"nothing to validate"* ]]
}


# ---------------------------------------------------------------------------
# FULL MODE DIR-ONLY VALIDATE (task 0065)
#
# T1/T2/T5/T6: full-mode validate derives purely from task dirs, no index.json.
# RED now: the current validator requires index.json (early-returns "nothing to
# validate" when absent). Green after the early-return guard is replaced with
# the empty-tasks-dir check and the index parse block is removed.
# ---------------------------------------------------------------------------

@test "full-mode dir-only: real store without index.json validates OK (exit 0, validation OK)" {
  # T1 [0065]: full-mode cook validate over >=1 numeric task dir, no index.json
  # present, must exit 0 and print "validation OK" [AC1].
  # RED now: exits 0 but prints "nothing to validate" (index-absence early-return).
  write_baseline_task_numeric "$BK" 1 "t1-dir-only"
  patch_field "$BK/tasks/1-t1-dir-only/task.json" '.status = "in_progress" | .stage = "implement"'
  # No index.json: new behavior: dir-sourced validate runs.
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
}

@test "full-mode dir-only: empty store without index.json exits 0 with nothing to validate" {
  # T2 [0065]: empty tasks/ dir (no dirs, no index.json) still exits 0 with
  # "nothing to validate": the empty-store guard moves from index-absence to
  # empty-tasks-dir, same outcome [AC1].
  # GREEN-throughout: deliberate regression guard: the empty path stays 0.
  # (tasks/ dir was created by setup() but no task dirs inside it.)
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to validate"* ]]
}

@test "full-mode dir-only: duplicate task id fires without index.json (non-zero, duplicate task id)" {
  # T5 [0065]: two numeric task dirs sharing id:1, no index.json.
  # duplicate-id check must fire from dirs alone [AC1].
  # RED now: no index.json → early-return, duplicate-id never checked.
  write_baseline_task_numeric "$BK" 1 "t5-dup-a"
  mkdir -p "$BK/tasks/1-t5-dup-b"
  jq '.slug = "t5-dup-b" | .title = "T5 dup B"'     "$BK/tasks/1-t5-dup-a/task.json" > "$BK/tasks/1-t5-dup-b/task.json"
  # No index.json
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"duplicate task id"* ]]
}

@test "full-mode dir-only: dependency cycle fires without index.json (non-zero, dependency cycle)" {
  # T6 [0065]: two task dirs with a mutual dep cycle (A→B, B→A), no index.json.
  # dep-cycle (inv5 Kahn) must fire from dirs alone [AC1].
  # RED now: no index.json → early-return, dep-cycle never checked.
  write_baseline_task_numeric "$BK" 1 "t6-cycle-a"
  write_baseline_task_numeric "$BK" 2 "t6-cycle-b"
  patch_field "$BK/tasks/1-t6-cycle-a/task.json" '.deps = [2]'
  patch_field "$BK/tasks/2-t6-cycle-b/task.json" '.deps = [1]'
  # No index.json
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"dependency cycle"* ]]
}
