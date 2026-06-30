#!/usr/bin/env bats
# tests/strict-args.bats: bats suite for task 0038: strict argument validation.
#
# Covers:
#   - T1: cook lite --help rejected with no side effect (witnessed bug)
#   - T2: cook lite extra positional rejected, no side effect
#   - T3: --help to a subcommand errors, stderr names the token
#   - T4: -h to a subcommand errors
#   - T6: excess positional rejected for status, stderr names token
#   - T7: excess positional rejected for init, no scaffold
#   - T8: excess positional rejected for show (with a task present so arity is
#         the rejection cause, not "task not found")
#   - T9: excess positional rejected for deinit
#   - T10: excess positional rejected for baseline check (with HEAD logged green
#          so arity is the rejection cause, not "hash mismatch")
#   - T11: unknown flag rejected, stderr names the token
#
# Strategy:
#   - Hermetic git fixture per test (mktemp -d, git init).
#   - cook() wrapper: COOK_ROOT="$TMP" "$COOK" "$@"
#   - All tests assert OUTCOMES (exit status, file presence, stderr content)
#     not internal implementation details.
#   - Tests are RED against the current unmodified cook.sh because the
#     subcommands do not yet reject unknown args.

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
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@strict-args.example"
  git -C "$TMP" config user.name "Strict Args Test"
  # Initial commit so HEAD is valid
  git -C "$TMP" commit --allow-empty -q -m "init"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# write_task_38: create a task with id 38 so cmd_show can find it.
# Without this, cook show 38 39 exits non-zero because "no task with id 38",
# which is the wrong reason. We need it to exit non-zero because of 2 args.
write_task_38() {
  mkdir -p "$BK/tasks/38-t38-slug"
  jq -n '{
    schemaVersion: 1,
    id: 38,
    slug: "t38-slug",
    title: "T38 strict-args fixture",
    status: "pending",
    stage: "capture",
    priority: "p2",
    deps: [],
    trivial: false,
    branch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
  }' > "$BK/tasks/38-t38-slug/task.json"
}

# seed_green_baseline: log a green+clean run for the current HEAD so that
# cook baseline check <HEAD> (1 arg) would succeed. Used for T10 to ensure
# the rejection comes from arity, not from "no baseline logged for that hash".
seed_green_baseline() {
  local head
  head="$(git -C "$TMP" rev-parse HEAD)"
  mkdir -p "$BK"
  jq -n --arg h "$head" \
    '{hash: $h, dirty: false, result: "green", ts: "2026-01-01T00:00:00Z"}' \
    >> "$BK/test-runs.jsonl"
}

# ---------------------------------------------------------------------------
# T1: cook lite --help: rejected, no side effect (the witnessed bug)
# AC3: rejection takes no side effect.
# ---------------------------------------------------------------------------

@test "strict/T1: cook lite --help exits non-zero" {
  # AC2+AC3: --help passed to lite must error, not activate.
  # RED now: cook lite currently ignores --help and activates lite mode (exit 0).
  run cook lite --help
  [ "$status" -ne 0 ]
}

@test "strict/T1: cook lite --help does not write .jeff/config.json" {
  # AC3: the rejected invocation must produce no activation side effect.
  # RED now: cook lite --help currently writes config.json.
  run cook lite --help
  [ ! -f "$BK/config.json" ]
}

@test "strict/T1: cook lite --help does not add .jeff/ line to .git/info/exclude" {
  # AC3: no mutation of .git/info/exclude on a rejected invocation.
  # RED now: cook lite --help currently appends .jeff/ to the exclude file.
  run cook lite --help
  if [ -f "$TMP/.git/info/exclude" ]; then
    run grep -c '\.jeff/' "$TMP/.git/info/exclude"
    [ "$output" -eq 0 ]
  fi
}

# ---------------------------------------------------------------------------
# T2: cook lite extra: excess positional rejected, no activation side effect
# AC4: excess positional arguments are rejected.
# ---------------------------------------------------------------------------

@test "strict/T2: cook lite extra exits non-zero" {
  # AC4: excess positional to lite must error.
  # RED now: cook lite currently ignores extra positionals and activates.
  run cook lite extra
  [ "$status" -ne 0 ]
}

@test "strict/T2: cook lite extra does not write .jeff/config.json" {
  # AC3: no activation side effect on rejection.
  # RED now: cook lite extra currently writes config.json.
  run cook lite extra
  [ ! -f "$BK/config.json" ]
}

# ---------------------------------------------------------------------------
# T3: --help to a subcommand errors, stderr names the offending token
# AC2, AC6: --help to any subcommand is rejected; error names the token.
# ---------------------------------------------------------------------------

@test "strict/T3: cook status --help exits non-zero" {
  # AC2: --help is only recognized at top level; as a subcommand arg it errors.
  # RED now: cook status currently ignores unknown flags and exits 0.
  run cook status --help 2>&1
  [ "$status" -ne 0 ]
}

@test "strict/T3: cook status --help names --help in stderr" {
  # AC6: error message must name the offending token.
  # RED now: cook status exits 0 and produces no error.
  run cook status --help 2>&1
  [[ "$output" == *"--help"* ]]
}

# ---------------------------------------------------------------------------
# T4: -h to a subcommand errors
# AC2: -h passed to a subcommand is an unknown arg and errors.
# ---------------------------------------------------------------------------

@test "strict/T4: cook status -h exits non-zero" {
  # AC2: -h is only recognized at top level.
  # RED now: cook status ignores -h and exits 0.
  run cook status -h
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# T6: excess positional rejected for status, stderr names token
# AC4, AC6: cook status extra → error naming 'extra'.
# ---------------------------------------------------------------------------

@test "strict/T6: cook status extra exits non-zero" {
  # AC4: excess positional to status must error.
  # RED now: cook status ignores extra positionals and exits 0.
  run cook status extra 2>&1
  [ "$status" -ne 0 ]
}

@test "strict/T6: cook status extra names the token in stderr" {
  # AC6: error must name the offending token.
  # RED now: cook status exits 0 with no error.
  run cook status extra 2>&1
  [[ "$output" == *"extra"* ]]
}

# ---------------------------------------------------------------------------
# T7: excess positional rejected for init, no scaffold created
# AC4, AC3: cook init foo → error, no .jeff/ scaffold written.
# ---------------------------------------------------------------------------

@test "strict/T7: cook init foo exits non-zero" {
  # AC4: excess positional to init must error.
  # RED now: cook init ignores extra positionals and runs init.
  run cook init foo
  [ "$status" -ne 0 ]
}

@test "strict/T7: cook init foo does not create .jeff/config.json" {
  # AC3: no scaffold side effect on a rejected invocation.
  # RED now: cook init foo currently runs init and creates scaffold files.
  run cook init foo
  [ ! -f "$BK/config.json" ]
}

# ---------------------------------------------------------------------------
# T8: excess positional rejected for show
# AC4: cook show 38 39 → error (show takes exactly 1 positional).
#
# A task with id 38 is created so the rejection is due to arity, not because
# the task is absent. Without the task, show exits non-zero for "no task with
# id 38" which would be the wrong reason.
# ---------------------------------------------------------------------------

@test "strict/T8: cook show 38 39 exits non-zero (arity, not missing task)" {
  # AC4: show accepts exactly one positional; a second must error via arity check.
  # RED now: cook show ignores the second arg and succeeds (prints task json).
  write_task_38

  run cook show 38 39
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# T9: excess positional rejected for deinit
# AC4: cook deinit x → error.
# ---------------------------------------------------------------------------

@test "strict/T9: cook deinit x exits non-zero" {
  # AC4: deinit accepts no positionals; any arg must error.
  # RED now: cook deinit ignores extra positionals.
  run cook deinit x
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# T10: excess positional rejected for baseline check (2 args)
# AC1, AC4: baseline check accepts 0 or 1 hash; 2+ must error.
#
# A green baseline is seeded for HEAD so that the rejection is due to arity
# (2 args), not because no baseline is logged. Without the seed, the command
# exits non-zero for "hash mismatch" (first arg != HEAD) which is wrong.
# ---------------------------------------------------------------------------

@test "strict/T10: cook baseline check HEAD bbb exits non-zero (arity, not hash-mismatch)" {
  # AC4: baseline check accepts at most 1 positional; 2 args must error via arity.
  # RED now: cook baseline check uses the first arg as the hash and ignores bbb.
  seed_green_baseline
  local head
  head="$(git -C "$TMP" rev-parse HEAD)"

  run cook baseline check "$head" bbb
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# T11: unknown flag rejected, stderr names the token
# AC1, AC6: cook status --foo → error naming '--foo'.
# ---------------------------------------------------------------------------

@test "strict/T11: cook status --foo exits non-zero" {
  # AC1, AC6: unknown flag to any subcommand must error.
  # RED now: cook status ignores unknown flags and exits 0.
  run cook status --foo 2>&1
  [ "$status" -ne 0 ]
}

@test "strict/T11: cook status --foo names --foo in stderr" {
  # AC6: error message must name the offending token.
  # RED now: cook status exits 0 and produces no error.
  run cook status --foo 2>&1
  [[ "$output" == *"--foo"* ]]
}

# ---------------------------------------------------------------------------
# T12: unknown subcommand: cook migrate exits non-zero naming the subcommand
# AC1 (task 0064): migrate dispatch case removed; the *)  arm must fire.
# ---------------------------------------------------------------------------

@test "strict/T12: cook migrate exits non-zero" {
  # AC1 (task 0064): migrate must no longer be a routable subcommand.
  # RED now: migrate is still dispatched (exits 0 with "nothing to do").
  run cook migrate 2>&1
  [ "$status" -ne 0 ]
}

@test "strict/T12: cook migrate names it an unknown subcommand" {
  # AC1 (task 0064): the *) dispatch arm must emit "unknown subcommand: migrate".
  # RED now: migrate is still routed so no unknown-subcommand message appears.
  run cook migrate 2>&1
  [[ "$output" == *"unknown subcommand: migrate"* ]]
}
