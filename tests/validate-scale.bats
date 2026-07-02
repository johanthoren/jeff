#!/usr/bin/env bats
# tests/validate-scale.bats: AC3 behavioral guard for task 0055.
#
# Asserts: a large task store (aggregated task array >128KB) validates
# successfully (`cook validate` exits 0 with the "validation OK" message)
# rather than dying with "Argument list too long".
#
# Linux has MAX_ARG_STRLEN = 131072 bytes (128KB), which caps a single
# command-line argument.  macOS has no per-arg cap, so this test is green on
# macOS both before and after the fix.  On Linux it is red pre-fix (the store
# overflows argv) and green post-fix.  That is the CI regression guard.
#
# The test asserts ONLY the consumer-observable outcome (exit 0 + success
# message).  It NEVER asserts HOW the store reaches jq (no grep of source,
# no stdin/printf/--argjson assertion): that transport-mechanism assertion
# is the change-detector smell this project bans.
#
# Fixture design (seam: COOK_ROOT=$TMP cook validate over a synthetic store):
#   - 160 schema-valid done tasks, each ~1KB, giving ~160KB aggregated.
#   - Fixed ids / slugs / content: no $RANDOM, no clock, no network.
#   - Per-test mktemp -d, fully hermetic, parallel-safe (bats --jobs).
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
  # Lite mode for the synthetic $TMP store: this suite asserts the >128KB-store
  # stdin transport (task 0055): `cook validate` exits 0 with "validation OK"
  # on a large store. Lite still pipes the whole store via stdin, exercising the
  # same transport, while dropping the registry-only [prune] check (task 0063) so
  # the 160 resting done fixtures do not trip [prune]. The transport assertion is
  # mode-agnostic and unaffected.
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

# write_scale_task <bk_dir> <n>
#
# Writes a fully schema-valid done task.json for task number <n> (1-based).
# Uses a long tests.evidence entry to push per-task size to ~1KB so 160 tasks
# aggregate to ~160KB, well above the 131072-byte Linux per-arg cap.
# The evidence string is fixed content (no $RANDOM), making the fixture
# deterministic and parallel-safe.
write_scale_task() {
  local bk="$1" n="$2"
  local padded
  # Zero-pad n to 4 digits for directory names that sort correctly.
  padded="$(printf '%04d' "$n")"
  local task_dir="$bk/tasks/${padded}-scale-task-${padded}"
  mkdir -p "$task_dir"

  # Fixed ~900-byte evidence string; combined with the JSON envelope this puts
  # each task.json at ~1.1KB, giving 160 tasks ~176KB aggregated.
  local evidence_pad="scale-evidence-pad-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  jq -n \
    --argjson id "$n" \
    --arg padded "$padded" \
    --arg evidence_pad "$evidence_pad" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: ("scale-task-" + $padded),
      title: ("Synthetic scale task " + $padded),
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
        evidence: [("synthetic evidence for scale test: " + $evidence_pad)]
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
    }' > "$task_dir/task.json"
}

# ---------------------------------------------------------------------------
# AC3: large store (>128KB aggregated) validates successfully
# ---------------------------------------------------------------------------

@test "scale/AC3: store with >128KB aggregated task array validates (exit 0)" {
  # Traced to: task 0055 AC3: behavioral fixture guard.
  # Asserts the OUTCOME only: cook validate over a >128KB store exits 0
  # with the "validation OK" message.  Does NOT assert transport mechanism.
  #
  # On Linux (CI) this is red pre-fix (argv overflow) and green post-fix.
  # On macOS (dev box) it is green either way (no per-arg cap): that is
  # expected and correct: the test documents intent and guards on CI.

  local TASK_COUNT=160
  local n
  for n in $(seq 1 "$TASK_COUNT"); do
    write_scale_task "$BK" "$n"
  done

  run cook validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
}
