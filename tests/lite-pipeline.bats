#!/usr/bin/env bats
# tests/lite-pipeline.bats: bats suite for lite pipeline wiring.
#
# Covers:
#   A. `cook indiff <base-ref> <pre-ref>` (lite-only)
#      - PASS: refactor touches only subset of implement-changed files
#      - FAIL: refactor touches a NEW file outside implement-changed set → exit non-zero + names file
#      - Full-mode refusal
#   B. Lite done-gate: adopted-ledger-specific inv4 test
#      - Adopted ledger missing inv4 fields (done but tests.green=false) is rejected
#      - Adopted ledger satisfying all inv4 fields passes
#   C. GONE-verb: `cook handoff` is no longer a verb (exits non-zero, names handoff)
#
# Strategy:
#   - Fresh mktemp -d git repo per test (setup/teardown mirrors tests/lite-adopt.bats).
#   - cook() wrapper: COOK_ROOT="$TMP" "$COOK" "$@"
#   - write_lite_config helper: writes .jeff/config.json with mode:"lite", active:true.

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
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@lite-pipeline.example"
  git -C "$TMP" config user.name "Lite Pipeline Test"
  # Create an initial commit on main so HEAD is valid and branch ops work.
  git -C "$TMP" commit --allow-empty -q -m "init"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT.
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_lite_config: write .jeff/config.json with mode:"lite", active:true.
write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# checkout_feature_branch: create and switch to a feature branch off main.
checkout_feature_branch() {
  local branch="${1:-feature/my-task}"
  git -C "$TMP" checkout -q -b "$branch"
}

# write_adopted_ledger_done <tests_green> <review_verdict> <audit_verdict>
#
# Writes a lite adopted ledger (shape produced by cmd_on) into .jeff/tasks/
# with status:"done" and the specified inv4-relevant fields. Used to test the
# done-gate on the exact shape cmd_on produces.
write_adopted_ledger_done() {
  local tests_green="$1" review_verdict="$2" audit_verdict="$3"
  local dir="$BK/tasks/lite-adopt-done-1234567"
  mkdir -p "$dir"
  jq -n \
    --argjson green "$tests_green" \
    --arg rv "$review_verdict" \
    --arg av "$audit_verdict" \
    '{
      schemaVersion: 1,
      id: "docs/plans/widget.md",
      externalRef: "docs/plans/widget.md",
      slug: "lite-adopt",
      title: "docs/plans/widget.md",
      status: "done",
      stage: "done",
      priority: "p2",
      deps: [],
      trivial: false,
      branch: "feature/widget",
      createdAt: "2026-06-19T00:00:00Z",
      updatedAt: "2026-06-19T01:00:00Z",
      brains: {
        capture:   { model: "opus",   effort: "xhigh" },
        plan:      { model: "opus",   effort: "high"  },
        test:      { model: "sonnet", effort: "med"   },
        implement: { model: "opus",   effort: "high"  },
        refactor:  { model: "sonnet", effort: "high"  },
        review:    { model: "opus",   effort: "xhigh" },
        audit:     { model: "opus",   effort: "xhigh" }
      },
      agents: {
        test_author_agent_id: "agent-tester-001",
        implementer_agent_id: "agent-impl-002",
        reviewer_agent_id:    "agent-reviewer-003",
        audit_agent_id:       null
      },
      tests: {
        authored_by_agent_id: "agent-tester-001",
        green: $green,
        evidence: ["synthetic"]
      },
      review: {
        verdict: (if $rv == "null" then null else $rv end),
        reviewer_agent_id: "agent-reviewer-003",
        evidence: ["synthetic review"]
      },
      audit: {
        required: false,
        verdict: (if $av == "null" then null else $av end),
        audit_agent_id: null,
        evidence: []
      },
      commits: [],
      kickbacks: [],
      blockedReason: null,
      abandonReason: null
    }' > "$dir/task.json"
}

# ---------------------------------------------------------------------------
# A. `cook indiff <base-ref> <pre-ref>`: in-diff refactor guard
# ---------------------------------------------------------------------------

@test "indiff/pass: refactor touches only subset of implement-changed files → exits 0" {
  # AC: actual ⊆ allowed → exit 0.
  # Setup: base commit; implement commit touches X and Y; working-tree change on X only.
  # RED now: `cook indiff` is an unknown subcommand → exits non-zero.
  write_lite_config

  # base commit
  printf 'base content\n' > "$TMP/file_x.txt"
  printf 'base content\n' > "$TMP/file_y.txt"
  git -C "$TMP" add file_x.txt file_y.txt
  git -C "$TMP" commit -q -m "base"
  local base_ref
  base_ref="$(git -C "$TMP" rev-parse HEAD)"

  # implement commit: touch both X and Y
  printf 'implement change\n' >> "$TMP/file_x.txt"
  printf 'implement change\n' >> "$TMP/file_y.txt"
  git -C "$TMP" add file_x.txt file_y.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  # refactor working-tree change: only X (subset of {X,Y})
  printf 'refactor edit\n' >> "$TMP/file_x.txt"
  git -C "$TMP" add file_x.txt

  run cook indiff "$base_ref" "$pre_ref"
  [ "$status" -eq 0 ]
}

@test "indiff/fail: refactor touches a new file outside implement set → exits non-zero" {
  # AC: actual ⊄ allowed → exit non-zero; offending path named on stderr.
  # Setup: base commit; implement commit touches X and Y; working-tree adds Z.
  # RED now: unknown subcommand → exits non-zero (correct failure, wrong reason).
  write_lite_config

  # base commit
  printf 'base\n' > "$TMP/file_x.txt"
  printf 'base\n' > "$TMP/file_y.txt"
  git -C "$TMP" add file_x.txt file_y.txt
  git -C "$TMP" commit -q -m "base"
  local base_ref
  base_ref="$(git -C "$TMP" rev-parse HEAD)"

  # implement commit: touch X and Y
  printf 'implement\n' >> "$TMP/file_x.txt"
  printf 'implement\n' >> "$TMP/file_y.txt"
  git -C "$TMP" add file_x.txt file_y.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  # refactor working-tree: also touches Z (a new file, not in {X,Y})
  printf 'refactor\n' >> "$TMP/file_x.txt"
  printf 'new file outside diff\n' > "$TMP/file_z.txt"
  git -C "$TMP" add file_x.txt file_z.txt

  run cook indiff "$base_ref" "$pre_ref"
  [ "$status" -ne 0 ]
}

@test "indiff/fail: stderr names the offending file when refactor exceeds diff" {
  # AC: the offending path(s) must be printed to stderr.
  # RED now: unknown subcommand: stderr has "unknown subcommand" not the file name.
  # Once implemented: stderr names file_z.txt specifically.
  write_lite_config

  printf 'base\n' > "$TMP/file_x.txt"
  git -C "$TMP" add file_x.txt
  git -C "$TMP" commit -q -m "base"
  local base_ref
  base_ref="$(git -C "$TMP" rev-parse HEAD)"

  printf 'implement\n' >> "$TMP/file_x.txt"
  git -C "$TMP" add file_x.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  # Refactor adds a brand-new file outside the diff.
  printf 'out of scope\n' > "$TMP/file_z.txt"
  git -C "$TMP" add file_z.txt

  run cook indiff "$base_ref" "$pre_ref"
  [ "$status" -ne 0 ]
  # The offending filename must appear somewhere in the combined output.
  [[ "$output" == *"file_z.txt"* ]]
}

@test "indiff/pass-exact-match: refactor touches all implement files → exits 0" {
  # AC: actual == allowed (equality is a valid subset) → exit 0.
  # RED now: unknown subcommand.
  write_lite_config

  printf 'base\n' > "$TMP/file_a.txt"
  printf 'base\n' > "$TMP/file_b.txt"
  git -C "$TMP" add file_a.txt file_b.txt
  git -C "$TMP" commit -q -m "base"
  local base_ref
  base_ref="$(git -C "$TMP" rev-parse HEAD)"

  printf 'implement\n' >> "$TMP/file_a.txt"
  printf 'implement\n' >> "$TMP/file_b.txt"
  git -C "$TMP" add file_a.txt file_b.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  # Refactor touches both A and B (exact set match: still a subset).
  printf 'refactor\n' >> "$TMP/file_a.txt"
  printf 'refactor\n' >> "$TMP/file_b.txt"
  git -C "$TMP" add file_a.txt file_b.txt

  run cook indiff "$base_ref" "$pre_ref"
  [ "$status" -eq 0 ]
}

@test "indiff/full-mode-refusal: cook indiff refuses when mode is not lite" {
  # AC: `cook indiff` is a lite-only command; full mode must refuse.
  # No config.json → full mode.
  printf 'x\n' > "$TMP/f.txt"
  git -C "$TMP" add f.txt
  git -C "$TMP" commit -q -m "base"
  local base_ref
  base_ref="$(git -C "$TMP" rev-parse HEAD)"

  printf 'y\n' >> "$TMP/f.txt"
  git -C "$TMP" add f.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  run cook indiff "$base_ref" "$pre_ref"
  [ "$status" -ne 0 ]
}

@test "indiff/full-mode-refusal: cook indiff refuses with explicit mode:full config" {
  # AC: non-lite config → refusal.
  jq -n '{schemaVersion:1, mode:"full", active:true}' > "$BK/config.json"

  printf 'x\n' > "$TMP/f.txt"
  git -C "$TMP" add f.txt
  git -C "$TMP" commit -q -m "base"
  local base_ref
  base_ref="$(git -C "$TMP" rev-parse HEAD)"

  printf 'y\n' >> "$TMP/f.txt"
  git -C "$TMP" add f.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  run cook indiff "$base_ref" "$pre_ref"
  [ "$status" -ne 0 ]
}

@test "indiff/help: cook help mentions indiff subcommand" {
  # AC: `cook indiff` is a new subcommand; it must appear in help.
  # RED now: usage() does not list 'indiff'.
  run cook help
  [ "$status" -eq 0 ]
  [[ "$output" == *"indiff"* ]]
}

# ---------------------------------------------------------------------------
# B. Lite done-gate: adopted-ledger-specific inv4 assertions
#
# These tests use a ledger with the exact shape cmd_on produces (string id,
# externalRef, all the fields). The done-gate (inv4) must fire on this shape.
# lite.bats covers the generic inv4 numeric-id case; these tests add the
# adopted-ledger-specific coverage.
# ---------------------------------------------------------------------------

@test "done-gate/adopted: done ledger with tests.green=false is rejected (inv4)" {
  # AC: lite done-gate rejects a done adopted ledger with tests.green=false.
  # The adopted ledger has the exact shape cmd_on writes (string id, externalRef).
  # RED now: the test itself passes (validate rejects the done-gate violation): but
  # with tests.green=false AND tests.authored_by != implementer, inv4 fires correctly
  # in the existing validator (the adopted ledger shape is already supported by the
  # jq pass). This test pins that the inv4 gate cannot be bypassed on this shape.
  write_lite_config
  write_adopted_ledger_done "false" "pass" "na"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv4"* ]] || [[ "$output" == *"FAILED"* ]]
}

@test "done-gate/adopted: done ledger with review.verdict=null is rejected (inv4)" {
  # AC: lite done-gate rejects a done adopted ledger missing a review pass.
  # RED now: same rationale as the test above.
  write_lite_config
  write_adopted_ledger_done "true" "null" "na"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv4"* ]] || [[ "$output" == *"FAILED"* ]]
}

@test "done-gate/adopted: done ledger with audit.verdict=fail is rejected (inv4)" {
  # AC: lite done-gate rejects a done adopted ledger with audit.verdict not pass|na.
  write_lite_config
  write_adopted_ledger_done "true" "pass" "fail"

  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv4"* ]] || [[ "$output" == *"FAILED"* ]]
}

@test "done-gate/adopted: complete done ledger passes validate (positive control)" {
  # AC: a fully satisfied adopted ledger (tests green, review pass, audit na)
  # passes cook validate in lite mode.
  write_lite_config
  write_adopted_ledger_done "true" "pass" "na"

  run cook validate
  [ "$status" -eq 0 ]
}

@test "done-gate/adopted: complete done ledger with audit pass also passes (positive control)" {
  # AC: audit.verdict="pass" is also a valid done-gate state.
  write_lite_config
  write_adopted_ledger_done "true" "pass" "pass"

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Audit cycle 1: F3: missing `--` in `indiff` `git diff` → arbitrary file write
#
# CWE-88: argument injection. bin/cook:1208 runs
#   git diff --name-only "$base_ref" "$pre_ref"
# without a `--` separator before the user-supplied refs. A base_ref value of
# "--output=<path>" causes git to interpret it as the `--output` option and write
# the diff output to that path, creating or overwriting an arbitrary file.
#
# Load-bearing assertion: after `cook indiff "--output=<sentinel>" <pre_ref>`,
# the sentinel file must NOT exist. A correct fix places `--` before the refs.
#
# RED now: git diff --name-only --output=<sentinel> <pre_ref> creates the file.
# ---------------------------------------------------------------------------

@test "security/F3-missing-dash-dash-indiff: --output= in base-ref arg does NOT write sentinel file" {
  # Setup: a lite repo with two commits so a valid <pre_ref> exists.
  # The sentinel path is outside the repo (uses mktemp -u for a fresh name).
  # We pass --output=<sentinel> as the base_ref positional argument.

  write_lite_config

  printf 'base\n' > "$TMP/file.txt"
  git -C "$TMP" add file.txt
  git -C "$TMP" commit -q -m "base"

  printf 'implement\n' >> "$TMP/file.txt"
  git -C "$TMP" add file.txt
  git -C "$TMP" commit -q -m "implement"
  local pre_ref
  pre_ref="$(git -C "$TMP" rev-parse HEAD)"

  # Sentinel: a file path that MUST NOT be created by the command.
  local sentinel
  sentinel="$(mktemp -u)"

  # Confirm sentinel does not exist before the run.
  [ ! -f "$sentinel" ]

  # Run indiff with the --output injection as the first positional arg (base_ref).
  run cook indiff "--output=$sentinel" "$pre_ref"

  # Load-bearing: the sentinel file must not have been created.
  # A correct fix uses `--` to separate options from refs, so git does not
  # interpret --output=<sentinel> as a git diff option.
  [ ! -f "$sentinel" ] || {
    rm -f "$sentinel"
    printf 'FAIL F3: sentinel file was created by --output= injection\n' >&2
    false
  }
}

# ---------------------------------------------------------------------------
# C. GONE-verb: `cook handoff` is no longer a verb
#
# AC2: `cook handoff` (bare, --dry-run, --help) exits non-zero and names
# "handoff" in its output as an unknown subcommand. The verb has been removed;
# it falls through to the unknown-subcommand default arm in main().
#
# RED now: cmd_handoff still exists, so `cook handoff --dry-run` exits 0.
# ---------------------------------------------------------------------------

@test "gone-verb/handoff: cook handoff (bare, --dry-run, --help) exits non-zero and names handoff" {
  # AC2: removing the verb makes all three invocations unknown subcommands.
  # RED now: cmd_handoff still exists → cook handoff --dry-run exits 0 (test fails).
  write_lite_config
  checkout_feature_branch "feature/gone-verb-test"

  # bare invocation
  run cook handoff
  [ "$status" -ne 0 ]
  [[ "$output" == *"handoff"* ]]

  # --dry-run flag
  run cook handoff --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" == *"handoff"* ]]

  # --help flag
  run cook handoff --help
  [ "$status" -ne 0 ]
  [[ "$output" == *"handoff"* ]]
}
