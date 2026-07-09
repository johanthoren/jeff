#!/usr/bin/env bats
# tests/backlog.bats: bats suite for task 0027: soft .jeff/BACKLOG.md
#
# Covers:
#   1. [RED]   The repo ships .jeff/BACKLOG.md with NOW/NEXT/TODO headings.
#   2. [RED]   skills/cook/SKILL.md documents the BACKLOG maintenance contract:
#              - reference to BACKLOG.md
#              - freshness/staleness check before starting a task (in BACKLOG context)
#              - refresh action after a task reaches done (in BACKLOG context)
#   3. [GREEN] cook validate is soft toward BACKLOG.md: exit status, task count,
#              and output are identical whether BACKLOG.md is absent, valid,
#              empty, or garbage. Regression guard for the soft contract.
#
# Tests 1 and 2 are RED now (the file and prose do not exist yet).
# Test 3 is GREEN now (validate ignores the file by construction) and is a
# characterization / regression guard.
#
# Strategy mirrors profile.bats / lite-adopt.bats:
#   REPO/COOK vars; setup() creates a fresh mktemp -d git repo; teardown() rm -rf.
#   cook() wrapper uses COOK_ROOT="$TMP".
#   All synthetic fixtures; no dependency on production .jeff/.

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
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@backlog.example"
  git -C "$TMP" config user.name "Backlog Test"
  # Lite mode for the synthetic $TMP store: these tests assert that `cook
  # validate`'s exit status/output is stable across BACKLOG.md content; the done
  # fixture is incidental. Lite drops the registry-only [prune] check (task 0063)
  # so the resting done fixture does not trip [prune]; the assertions are
  # mode-agnostic and unaffected.
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT.
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers: minimal valid full-mode store for validate tests
# ---------------------------------------------------------------------------

# _setup_valid_store: build a minimal full-mode jeff store (one clean task
# dir) that passes cook validate with no profile present.
_setup_valid_store() {
  local task_dir="$BK/tasks/1-backlog-guard"
  mkdir -p "$task_dir"
  jq -n '{
    schemaVersion: 1,
    id: 1,
    slug: "backlog-guard",
    title: "Backlog guard synthetic task",
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
      evidence: ["synthetic"]
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

# ---------------------------------------------------------------------------
# TESTS 1 & 2: REMOVED (task 0050)
#
# Test 1 (backlog-seed, 4 tests) grep-ed the static .jeff/BACKLOG.md doc
# for its NOW/NEXT/TODO heading structure; Test 2 (skill-md, 3 tests) grep-ed
# skills/cook/SKILL.md prose (via awk proximity) for the BACKLOG-maintenance
# contract wording. Both are change-detectors per skills/testing/SKILL.md's
# consumer-observable discriminator: BACKLOG.md is a free-form maintainer-facing
# doc and SKILL.md is instruction-surface prose: no consumer/operator observes
# their heading text or wording as runtime behavior, the assertions go red only
# on a prose edit, and they catch no regression that edit would not. Deleted
# (git is the archive).
#
# The one behavioral contract for the BACKLOG feature, that `cook validate` stays
# SOFT toward BACKLOG.md (present/absent/empty/garbage all behave identically),
# is fully guarded by the validate-soft tests below, which run `cook validate`
# and assert exit code + output. That is the only BACKLOG behavior a consumer
# observes, and it survives intact.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# TEST 3: [GREEN] cook validate is soft toward BACKLOG.md
#
# AC: "whether the file is present, absent, empty, or malformed, validate
#     behaves identically (same exit status, same task count, same output)"
#
# This is a characterization / regression guard: it passes NOW because
# cmd_validate reads only task.json files and profile.md: it never globs
# .jeff/*.md. Must stay green after the implementation too.
#
# The four variants are tested independently for clear failure attribution.
# ---------------------------------------------------------------------------

@test "validate-soft: no BACKLOG.md: validate exits 0 and prints task count" {
  # GREEN NOW: validate ignores BACKLOG.md by construction.
  _setup_valid_store
  [ ! -f "$BK/BACKLOG.md" ]
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
  [[ "$output" == *"1 task(s)"* ]]
}

@test "validate-soft: valid BACKLOG.md: exit status and output identical to absent" {
  # GREEN NOW: regression guard: adding a well-formed BACKLOG.md must not
  # change validate's exit status or task-count output line.
  _setup_valid_store
  printf '## NOW\n\n- 1\n\n## NEXT\n\n## TODO\n\n- 2\n' > "$BK/BACKLOG.md"
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
  [[ "$output" == *"1 task(s)"* ]]
}

@test "validate-soft: empty BACKLOG.md: exit status and output identical to absent" {
  # GREEN NOW: an empty file must be equally ignored.
  _setup_valid_store
  : > "$BK/BACKLOG.md"
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
  [[ "$output" == *"1 task(s)"* ]]
}

@test "validate-soft: garbage BACKLOG.md: exit status and output identical to absent" {
  # GREEN NOW: a file with non-markdown garbage content (including a stray JSON
  # fence, which would trip profile.md parsing) must be equally ignored.
  _setup_valid_store
  printf 'NOT MARKDOWN\n```json\n{broken json\n```\nmore garbage\n' > "$BK/BACKLOG.md"
  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
  [[ "$output" == *"1 task(s)"* ]]
}

# Removed (merged 0050): "all four BACKLOG.md variants produce identical exit
# status" was a redundant cross-check. The four per-variant tests above
# (absent/valid/empty/garbage) each already assert `[ "$status" -eq 0 ]` plus
# the full output line ("validation OK", "1 task(s)"), strictly subsuming the
# same-exit-status assertion this test made. No behavior is lost.
