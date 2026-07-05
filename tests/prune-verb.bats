#!/usr/bin/env bats
# tests/prune-verb.bats: bats suite for task #16: `cook prune <id>` verb.
#
# Encodes the plan's `## Test design` block (write lines only; see
# .jeff/tasks/lite-16-2319567677/notes.md). `cmd_prune` does not exist yet:
# every subcommand falls through main()'s `*)` to
# `die "unknown subcommand: prune (try \`cook help\`)"`, which is ALSO
# non-zero. So every non-zero-exit assertion below pins the verb's SPECIFIC
# stderr message (never exit code alone) to stay genuinely red until
# `cmd_prune` lands.
#
# Keeps `tests/prune.bats` (the [prune]-invariant P1-P4 suite) untouched and
# separate; this file is the verb's own behavior contract.
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

bats_require_minimum_version 1.5.0

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

# pv_write_live <dir> <id> <slug> <status> <stage> <deps_json> <blockedReason_or_null>
# Writes a schema-valid live (pending/in_progress/blocked) task. No inv4
# done-gate requirements apply to non-done tasks.
pv_write_live() {
  local dir="$1" id="$2" slug="$3" status="$4" stage="$5" deps="$6" blocked="$7"
  mkdir -p "$dir"
  jq -n --argjson id "$id" --arg slug "$slug" --arg status "$status" --arg stage "$stage" \
    --argjson deps "$deps" --arg blocked "$blocked" '
  {
    schemaVersion: 1, id: $id, slug: $slug, title: ("Synthetic " + $slug),
    status: $status, stage: $stage, priority: "p2", deps: $deps,
    complexity: "simple", branch: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    brains: {
      capture: {model:"opus",effort:"xhigh"}, plan: {model:"opus",effort:"xhigh"},
      test: {model:"sonnet",effort:"med"}, implement: {model:"opus",effort:"high"},
      refactor: {model:"opus",effort:"high"}, review: {model:"opus",effort:"xhigh"},
      audit: {model:"opus",effort:"xhigh"}
    },
    agents: { plan_agent_id: null, test_author_agent_id: null, implementer_agent_id: null,
              reviewer_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: null, green: false, evidence: [] },
    review: { verdict: "na", reviewer_agent_id: null, evidence: [] },
    audit: { required: false, verdict: "na", audit_agent_id: null, evidence: [] },
    commits: [], kickbacks: [],
    blockedReason: (if $blocked == "null" then null else $blocked end),
    abandonReason: null
  }' > "$dir/task.json"
}

# pv_write_done <dir> <id> <slug> <deps_json>
# Writes a fully inv4-clean done task (tests.green=true, review pass, audit
# na, distinct agent ids) so the ONLY reason it would trip validate is the
# [prune] resting-dir invariant (i.e. it validates cleanly once removed).
pv_write_done() {
  local dir="$1" id="$2" slug="$3" deps="$4"
  mkdir -p "$dir"
  jq -n --argjson id "$id" --arg slug "$slug" --argjson deps "$deps" '
  {
    schemaVersion: 1, id: $id, slug: $slug, title: ("Synthetic " + $slug),
    status: "done", stage: "done", priority: "p2", deps: $deps,
    complexity: "simple", branch: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    brains: {
      capture: {model:"opus",effort:"xhigh"}, plan: {model:"opus",effort:"xhigh"},
      test: {model:"sonnet",effort:"med"}, implement: {model:"opus",effort:"high"},
      refactor: {model:"opus",effort:"high"}, review: {model:"opus",effort:"xhigh"},
      audit: {model:"opus",effort:"xhigh"}
    },
    agents: { plan_agent_id: "pv-plan-1", test_author_agent_id: "pv-tester-1",
              implementer_agent_id: "pv-impl-1", reviewer_agent_id: "pv-reviewer-1",
              audit_agent_id: null },
    tests: { authored_by_agent_id: "pv-tester-1", green: true, evidence: ["synthetic evidence"] },
    review: { verdict: "pass", reviewer_agent_id: "pv-reviewer-1", evidence: ["synthetic pass"] },
    audit: { required: false, verdict: "na", audit_agent_id: null, evidence: [] },
    commits: [], kickbacks: [],
    blockedReason: null, abandonReason: null
  }' > "$dir/task.json"
}

# pv_write_abandoned <dir> <id> <slug> <deps_json> <abandonReason>
pv_write_abandoned() {
  local dir="$1" id="$2" slug="$3" deps="$4" reason="$5"
  mkdir -p "$dir"
  jq -n --argjson id "$id" --arg slug "$slug" --argjson deps "$deps" --arg reason "$reason" '
  {
    schemaVersion: 1, id: $id, slug: $slug, title: ("Synthetic " + $slug),
    status: "abandoned", stage: "abandoned", priority: "p3", deps: $deps,
    complexity: "simple", branch: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    brains: {
      capture: {model:"opus",effort:"xhigh"}, plan: {model:"opus",effort:"xhigh"},
      test: {model:"sonnet",effort:"med"}, implement: {model:"opus",effort:"high"},
      refactor: {model:"opus",effort:"high"}, review: {model:"opus",effort:"xhigh"},
      audit: {model:"opus",effort:"xhigh"}
    },
    agents: { plan_agent_id: "pv-plan-2", test_author_agent_id: "pv-tester-2",
              implementer_agent_id: null, reviewer_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: null, green: false, evidence: [] },
    review: { verdict: "na", reviewer_agent_id: null, evidence: [] },
    audit: { required: false, verdict: "na", audit_agent_id: null, evidence: [] },
    commits: [], kickbacks: [],
    blockedReason: null, abandonReason: $reason
  }' > "$dir/task.json"
}

# write_lite_config: mirrors tests/prune.bats' helper.
write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# pv_commit_store: git init the fixture repo and commit the seeded .jeff store
# so `git rm -r` (inside cook prune) operates on TRACKED files, not untracked
# ones (an untracked-dir `git rm` fails for an unrelated reason).
pv_commit_store() {
  git -C "$TMP" init -q
  git -C "$TMP" add -A
  git -C "$TMP" commit -q -m "fixture: seed store"
}

# pv_head_count: HEAD commit count.
pv_head_count() {
  git -C "$TMP" rev-list --count HEAD
}

# ---------------------------------------------------------------------------
# AC1 · dep-strip: strips the finishing id from every live sibling's deps,
# preserves a co-dep, leaves an unrelated live sibling unchanged.
# ---------------------------------------------------------------------------

@test "prune-verb/AC1-strip: strips finishing id from live siblings, preserves co-dep, unrelated sibling untouched" {
  local done_dir="$BK/tasks/0901-pv-done"
  local a_dir="$BK/tasks/0902-pv-pending"
  local b_dir="$BK/tasks/0903-pv-inprogress"
  local c_dir="$BK/tasks/0904-pv-blocked"

  pv_write_done "$done_dir" 901 "pv-done" '[]'
  pv_write_live "$a_dir" 902 "pv-pending" pending capture '[901,903]' null
  pv_write_live "$b_dir" 903 "pv-inprogress" in_progress implement '[901]' null
  pv_write_live "$c_dir" 904 "pv-blocked" blocked implement '[903]' "waiting on 903"
  pv_commit_store

  run --separate-stderr cook prune 901
  [ "$status" -eq 0 ]

  local deps_a deps_b deps_c
  deps_a="$(jq -c '.deps' "$a_dir/task.json")"
  deps_b="$(jq -c '.deps' "$b_dir/task.json")"
  deps_c="$(jq -c '.deps' "$c_dir/task.json")"
  [ "$deps_a" = "[903]" ]
  [ "$deps_b" = "[]" ]
  [ "$deps_c" = "[903]" ]
}

# ---------------------------------------------------------------------------
# AC1 · hook-safe ordering + done commit cmd: dir absent, internal validate
# passes, nothing committed, exact `git commit -m 'task <id> · done: …'`
# printed to stdout.
# ---------------------------------------------------------------------------

@test "prune-verb/AC1-order: removes done dir, validates clean, commits nothing, prints the done commit line" {
  local done_dir="$BK/tasks/1001-pv-done-solo"
  pv_write_done "$done_dir" 1001 "pv-done-solo" '[]'
  pv_commit_store

  local before after
  before="$(pv_head_count)"

  run --separate-stderr cook prune 1001
  [ "$status" -eq 0 ]

  after="$(pv_head_count)"
  [ "$after" = "$before" ]
  [ ! -d "$done_dir" ]
  [[ "$output" == *"git commit -m 'task 1001 · done:"* ]]
}

# ---------------------------------------------------------------------------
# AC1 · failure posture: post-removal validate fails on a pre-existing
# independent invalidity (a live sibling with a dep on a nonexistent id) ⇒
# `validation FAILED` surfaced, no `git commit` line, nothing committed.
# ---------------------------------------------------------------------------

@test "prune-verb/AC1-failure: surfaces validation FAILED, prints no commit line, commits nothing" {
  local done_dir="$BK/tasks/1101-pv-done-fail"
  local sib_dir="$BK/tasks/1102-pv-pending-badd"
  pv_write_done "$done_dir" 1101 "pv-done-fail" '[]'
  # 9999 does not exist anywhere in this store: independent inv5a violation
  # that survives the strip of 1101 (the finishing id).
  pv_write_live "$sib_dir" 1102 "pv-pending-badd" pending capture '[1101,9999]' null
  pv_commit_store

  local before after
  before="$(pv_head_count)"

  run --separate-stderr cook prune 1101
  [ "$status" -ne 0 ]

  after="$(pv_head_count)"
  [ "$after" = "$before" ]
  [[ "$stderr" == *"validation FAILED"* ]]
  [[ "$output" != *"git commit -m"* ]]
}

# ---------------------------------------------------------------------------
# AC1 · abandoned: prints `task <id> · abandoned: …` commit line, removes
# dir, commits nothing.
# ---------------------------------------------------------------------------

@test "prune-verb/AC1-abandoned: removes abandoned dir, commits nothing, prints the abandoned commit line" {
  local dir="$BK/tasks/1201-pv-abandoned"
  pv_write_abandoned "$dir" 1201 "pv-abandoned" '[]' "Superseded by a different approach"
  pv_commit_store

  local before after
  before="$(pv_head_count)"

  run --separate-stderr cook prune 1201
  [ "$status" -eq 0 ]

  after="$(pv_head_count)"
  [ "$after" = "$before" ]
  [ ! -d "$dir" ]
  [[ "$output" == *"git commit -m 'task 1201 · abandoned:"* ]]
}

# ---------------------------------------------------------------------------
# AC1 · live-task refusal: still-live task refused with a clear non-terminal
# error, removing/committing nothing.
# ---------------------------------------------------------------------------

@test "prune-verb/AC1-refuse-live: refuses a still-live task, dir untouched" {
  local dir="$BK/tasks/1301-pv-pending-live"
  pv_write_live "$dir" 1301 "pv-pending-live" pending capture '[]' null
  pv_commit_store

  run --separate-stderr cook prune 1301
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"erminal"* ]]
  [ -d "$dir" ]
}

# ---------------------------------------------------------------------------
# AC2 · lite refusal: lite-mode store refuses with a full-mode-only error,
# removing nothing.
# ---------------------------------------------------------------------------

@test "prune-verb/AC2-lite: refuses in a lite-mode store, done dir untouched" {
  local dir="$BK/tasks/1401-pv-done-lite"
  pv_write_done "$dir" 1401 "pv-done-lite" '[]'
  write_lite_config
  pv_commit_store

  run --separate-stderr cook prune 1401
  [ "$status" -ne 0 ]
  [[ "$stderr" =~ [Ff]ull[-\ ]mode ]]
  [ -d "$dir" ]
}

# ---------------------------------------------------------------------------
# AC3 · id-injection safety: a malicious <id> resolves to no task, dies with
# the resolver's message, the real done dir survives, a canary outside
# .jeff/tasks/ is untouched, nothing committed.
# ---------------------------------------------------------------------------

@test "prune-verb/AC3-injection: malicious ids resolve to no task and touch nothing" {
  local dir="$BK/tasks/1501-pv-done-real"
  pv_write_done "$dir" 1501 "pv-done-real" '[]'
  echo "canary" > "$TMP/canary.txt"
  pv_commit_store

  local before after
  before="$(pv_head_count)"

  local mal
  for mal in '../../../etc/passwd' '*' '; rm -rf /tmp/pv-canary' '1501-pv-done-real'; do
    run --separate-stderr cook prune "$mal"
    [ "$status" -ne 0 ]
    [[ "$stderr" == *"no task with id"* ]]
  done

  after="$(pv_head_count)"
  [ "$after" = "$before" ]
  [ -d "$dir" ]
  [ "$(cat "$TMP/canary.txt")" = "canary" ]
}
