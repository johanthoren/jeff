#!/usr/bin/env bats
# tests/convergence.bats: bats suite for convergence block validator assertions.
#
# Pins INV-7..INV-11 (cap/council/verdict/follow-up/done-gate) as defined in:
#   .jeff/tasks/0002-review-cap-and-council-escalation/notes.md
#
# Strategy:
#   - All fixtures are wholly synthetic (no real project data).
#   - write_baseline_task <task_dir> emits a fully schema-valid task.json with
#     NO convergence block so only the convergence mutation under test drives
#     any failure.
#   - Tests that expect PASS assert status -eq 0.
#   - Tests that expect FAIL assert status -ne 0 and, where the tag is output-
#     visible (pending implementation), check for the invariant tag in output.
#     The hard requirement is non-zero exit; the tag check uses `|| true` so the
#     test does NOT accidentally go green just because the tag is absent.

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
  # Lite mode for the synthetic $TMP store: these fixtures exercise the
  # convergence block (INV-7..INV-11) and the [gate] done-gate, both of which
  # run in BOTH modes. Lite drops only the registry-only invariants (including
  # the [prune] check, task 0063), so a resting done baseline fixture does not
  # trip [prune]; the convergence assertions are unaffected. The $REPO-based
  # back-compat test runs against the live store (not $TMP) and is not touched.
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook validate against $TMP as COOK_ROOT
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_baseline_task <bk_dir> <task_id> <slug>
#
# Writes a fully schema-valid v1 task.json under <bk_dir>/tasks/<id>-<slug>/
# with no convergence block and a valid done-gate so it survives all existing
# invariants.  The caller may then mutate the convergence field freely.
# Uses a non-implementer test author (different agent ids) and review/audit
# verdicts = pass to satisfy inv1..4.
write_baseline_task() {
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
      title: ("Synthetic task: " + $slug),
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

# patch_convergence <task_json_path> <convergence_json>
#
# Merges a convergence block into an existing task.json via jq.
patch_convergence() {
  local path="$1" conv="$2" tmp
  tmp="$(mktemp)"
  jq --argjson conv "$conv" '. + {convergence: $conv}' "$path" > "$tmp"
  mv "$tmp" "$path"
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
# Shared convergence fixtures
# ---------------------------------------------------------------------------

# A minimal valid convergence block with convened=false: no council.
CONV_ABSENT='null'   # sentinel: do not add convergence at all

CONV_VALID_NO_COUNCIL='{
  "cap": 2,
  "stages": {
    "review": { "blockingKickbacks": 1 },
    "audit":  { "blockingKickbacks": 0 }
  },
  "council": {
    "convened": false,
    "stage": null,
    "members": [],
    "findings": [],
    "verdict": null,
    "outcome": null
  }
}'

# A valid convened council with 3 distinct members, all distinct from
# agents.implementer_agent_id ("agent-impl-002") and
# agents.reviewer_agent_id ("agent-reviewer-003"), with a ship verdict and
# one survived=false finding that has a followupTaskId pointing to task 99.
CONV_VALID_COUNCIL_SHIP='{
  "cap": 2,
  "stages": {
    "review": { "blockingKickbacks": 2 },
    "audit":  { "blockingKickbacks": 0 }
  },
  "council": {
    "convened": true,
    "stage": "review",
    "members": [
      { "agent_id": "council-agent-A", "lens": "integrity",   "temperature": 0.3 },
      { "agent_id": "council-agent-B", "lens": "security",    "temperature": 0.7 },
      { "agent_id": "council-agent-C", "lens": "pragmatist",  "temperature": 1.0 }
    ],
    "findings": [
      { "id": "f1", "summary": "minor style issue", "blockingVotes": 1, "survived": false, "followupTaskId": 99 }
    ],
    "verdict": "ship",
    "outcome": "shipped"
  }
}'

# A valid convened council with a block verdict and surviving finding.
# followupTaskId for the surviving finding is null (correct per contract).
CONV_VALID_COUNCIL_BLOCK='{
  "cap": 2,
  "stages": {
    "review": { "blockingKickbacks": 2 },
    "audit":  { "blockingKickbacks": 0 }
  },
  "council": {
    "convened": true,
    "stage": "review",
    "members": [
      { "agent_id": "council-agent-A", "lens": "integrity",   "temperature": 0.3 },
      { "agent_id": "council-agent-B", "lens": "security",    "temperature": 0.7 },
      { "agent_id": "council-agent-C", "lens": "pragmatist",  "temperature": 1.0 }
    ],
    "findings": [
      { "id": "f1", "summary": "data-loss bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
    ],
    "verdict": "block",
    "outcome": "scoped-fix-shipped"
  }
}'

# ---------------------------------------------------------------------------
# Back-compat (AC-1 / INV-absent)
# ---------------------------------------------------------------------------

@test "back-compat: task.json with NO convergence block passes validate" {
  write_baseline_task "$BK" 1 "task-no-conv"
  run cook validate
  [ "$status" -eq 0 ]
}

@test "back-compat: real store (tasks 0001+0002) passes validate" {
  # Uses the repo's own .jeff, not the temp dir.
  # bats `run` does not expand env assignments inline; invoke via env(1).
  run env COOK_ROOT="$REPO" "$COOK" validate
  [ "$status" -eq 0 ]
}

@test "back-compat: task with valid convergence (no-council) passes validate" {
  write_baseline_task "$BK" 1 "task-conv-nocounsel"
  patch_convergence "$BK/tasks/1-task-conv-nocounsel/task.json" "$CONV_VALID_NO_COUNCIL"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INV-7: shape/range checks
# ---------------------------------------------------------------------------

@test "INV-7: cap < 1 (zero) fails validate" {
  write_baseline_task "$BK" 1 "task-inv7-cap0"
  patch_convergence "$BK/tasks/1-task-inv7-cap0/task.json" '{
    "cap": 0,
    "stages": { "review": { "blockingKickbacks": 0 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  # Tag check is aspirational: non-zero exit is the hard requirement
  [[ "$output" == *"inv7"* ]] || true
}

@test "INV-7: cap negative fails validate" {
  write_baseline_task "$BK" 1 "task-inv7-capneg"
  patch_convergence "$BK/tasks/1-task-inv7-capneg/task.json" '{
    "cap": -1,
    "stages": { "review": { "blockingKickbacks": 0 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv7"* ]] || true
}

@test "INV-7: blockingKickbacks negative fails validate" {
  write_baseline_task "$BK" 1 "task-inv7-kbneg"
  patch_convergence "$BK/tasks/1-task-inv7-kbneg/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": -1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv7"* ]] || true
}

@test "INV-7: blockingKickbacks > cap fails validate" {
  write_baseline_task "$BK" 1 "task-inv7-kbexcap"
  patch_convergence "$BK/tasks/1-task-inv7-kbexcap/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 3 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv7"* ]] || true
}

@test "INV-7: blockingKickbacks == cap passes validate" {
  write_baseline_task "$BK" 1 "task-inv7-kbeqcap"
  patch_convergence "$BK/tasks/1-task-inv7-kbeqcap/task.json" "$CONV_VALID_NO_COUNCIL"
  # CONV_VALID_NO_COUNCIL has cap=2, review.blockingKickbacks=1 (within range)
  run cook validate
  [ "$status" -eq 0 ]
}

@test "INV-7: blockingKickbacks == 0 with cap == 1 passes validate" {
  write_baseline_task "$BK" 1 "task-inv7-cap1"
  patch_convergence "$BK/tasks/1-task-inv7-cap1/task.json" '{
    "cap": 1,
    "stages": { "review": { "blockingKickbacks": 0 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INV-8: council distinctness
# ---------------------------------------------------------------------------

@test "INV-8: convened council with only 2 members fails validate" {
  write_baseline_task "$BK" 1 "task-inv8-2mem"
  patch_convergence "$BK/tasks/1-task-inv8-2mem/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "INV-8: convened council with 4 members fails validate" {
  write_baseline_task "$BK" 1 "task-inv8-4mem"
  patch_convergence "$BK/tasks/1-task-inv8-4mem/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 },
        { "agent_id": "council-agent-D", "lens": "integrity",  "temperature": 0.5 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "INV-8: duplicate member agent_ids fails validate" {
  write_baseline_task "$BK" 1 "task-inv8-dupid"
  patch_convergence "$BK/tasks/1-task-inv8-dupid/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-A", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "INV-8: council member sharing agent_id with implementer fails validate" {
  # agents.implementer_agent_id = "agent-impl-002" in baseline
  write_baseline_task "$BK" 1 "task-inv8-impl-overlap"
  patch_convergence "$BK/tasks/1-task-inv8-impl-overlap/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "agent-impl-002", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "INV-8: council member sharing agent_id with reviewer fails validate" {
  # agents.reviewer_agent_id = "agent-reviewer-003" in baseline
  write_baseline_task "$BK" 1 "task-inv8-rv-overlap"
  patch_convergence "$BK/tasks/1-task-inv8-rv-overlap/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A",   "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "agent-reviewer-003", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C",   "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "INV-8: council.stage not in {review,audit} fails validate" {
  write_baseline_task "$BK" 1 "task-inv8-badstage"
  patch_convergence "$BK/tasks/1-task-inv8-badstage/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "implement",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "INV-8: valid 3-distinct council with all three lenses passes validate" {
  write_baseline_task "$BK" 1 "task-inv8-valid"
  # CONV_VALID_COUNCIL_SHIP has distinct members, valid lenses, stage=review,
  # no member overlapping with implementer/reviewer.
  # followupTaskId=99 needs task 99 in the store for INV-10 to also pass.
  write_baseline_task "$BK" 99 "task-followup"
  patch_convergence "$BK/tasks/1-task-inv8-valid/task.json" "$CONV_VALID_COUNCIL_SHIP"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INV-9: per-finding determinism
# ---------------------------------------------------------------------------

@test "INV-9: finding.survived=true but blockingVotes < 2 fails validate" {
  write_baseline_task "$BK" 1 "task-inv9-surv-wrong"
  patch_convergence "$BK/tasks/1-task-inv9-surv-wrong/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 1, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "INV-9: finding.survived=false but blockingVotes >= 2 fails validate" {
  write_baseline_task "$BK" 1 "task-inv9-notsurv-wrong"
  # A finding with blockingVotes=2 but survived=false is inconsistent.
  # followupTaskId=99 to avoid triggering INV-10 instead.
  write_baseline_task "$BK" 99 "task-followup-inv9"
  patch_convergence "$BK/tasks/1-task-inv9-notsurv-wrong/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "bug", "blockingVotes": 2, "survived": false, "followupTaskId": 99 }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "INV-9: verdict=block but no finding survived fails validate" {
  write_baseline_task "$BK" 1 "task-inv9-block-nosurv"
  # followupTaskId=99 for the non-surviving finding to avoid INV-10 triggering first
  write_baseline_task "$BK" 99 "task-followup-b"
  patch_convergence "$BK/tasks/1-task-inv9-block-nosurv/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor", "blockingVotes": 1, "survived": false, "followupTaskId": 99 }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "INV-9: verdict=ship but a finding survived fails validate" {
  write_baseline_task "$BK" 1 "task-inv9-ship-surv"
  patch_convergence "$BK/tasks/1-task-inv9-ship-surv/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "INV-9: self-consistent council (ship, no survivals) passes validate" {
  write_baseline_task "$BK" 1 "task-inv9-pass-ship"
  write_baseline_task "$BK" 99 "task-followup-ship"
  patch_convergence "$BK/tasks/1-task-inv9-pass-ship/task.json" "$CONV_VALID_COUNCIL_SHIP"
  run cook validate
  [ "$status" -eq 0 ]
}

@test "INV-9: self-consistent council (block, one survival) passes validate" {
  write_baseline_task "$BK" 1 "task-inv9-pass-block"
  # CONV_VALID_COUNCIL_BLOCK has blockingVotes=2, survived=true, verdict=block,
  # outcome=scoped-fix-shipped, status=done: all consistent with INV-9 + INV-11.
  patch_convergence "$BK/tasks/1-task-inv9-pass-block/task.json" "$CONV_VALID_COUNCIL_BLOCK"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INV-10: follow-up tracking
# ---------------------------------------------------------------------------

@test "INV-10: survived=false finding with followupTaskId=null fails validate" {
  write_baseline_task "$BK" 1 "task-inv10-nofollowup"
  patch_convergence "$BK/tasks/1-task-inv10-nofollowup/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": 1, "survived": false, "followupTaskId": null }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv10"* ]] || true
}

@test "INV-10: survived=false finding pointing to non-existent task fails validate" {
  write_baseline_task "$BK" 1 "task-inv10-badref"
  patch_convergence "$BK/tasks/1-task-inv10-badref/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": 1, "survived": false, "followupTaskId": 999 }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  # Only task 1 in index: task 999 does not exist
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv10"* ]] || true
}

@test "INV-10: survived=false finding with followupTaskId referencing existing task passes validate" {
  write_baseline_task "$BK" 1 "task-inv10-ok"
  write_baseline_task "$BK" 42 "task-followup-ok"
  patch_convergence "$BK/tasks/1-task-inv10-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": 1, "survived": false, "followupTaskId": 42 }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INV-11: block resolution / done-gate
# ---------------------------------------------------------------------------

@test "INV-11a: verdict=block + outcome=blocked-to-operator while status!=blocked fails validate" {
  # Task has status=done (from baseline) but outcome=blocked-to-operator: inconsistent.
  write_baseline_task "$BK" 1 "task-inv11a-notblocked"
  patch_convergence "$BK/tasks/1-task-inv11a-notblocked/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "blocked-to-operator"
    }
  }'
  # Baseline task has status=done: must fail (blocked-to-operator requires status=blocked)
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv11"* ]] || true
}

@test "INV-11a: verdict=block + outcome=blocked-to-operator with status=blocked passes validate (inv11a shape)" {
  write_baseline_task "$BK" 1 "task-inv11a-blocked-ok"
  patch_convergence "$BK/tasks/1-task-inv11a-blocked-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "blocked-to-operator"
    }
  }'
  # Mutate to status=blocked + blockedReason + adjust inv4 inapplicable fields
  patch_field "$BK/tasks/1-task-inv11a-blocked-ok/task.json" '
    .status = "blocked"
    | .stage = "review"
    | .blockedReason = "council blocked: handed to operator"
    | .tests.green = false
    | .review.verdict = null
  '
  run cook validate
  [ "$status" -eq 0 ]
}

@test "INV-11b: status=done while council convened + verdict=block + outcome!=scoped-fix-shipped fails validate" {
  write_baseline_task "$BK" 1 "task-inv11b-done-block"
  patch_convergence "$BK/tasks/1-task-inv11b-done-block/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "blocked-to-operator"
    }
  }'
  # status=done in baseline but outcome=blocked-to-operator: violates INV-11b
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv11"* ]] || true
}

@test "INV-11: council-block resolved via scoped-fix-shipped reaching done passes validate" {
  write_baseline_task "$BK" 1 "task-inv11-resolved"
  # CONV_VALID_COUNCIL_BLOCK has verdict=block, outcome=scoped-fix-shipped.
  # Baseline task has status=done and all done-gate fields satisfied.
  patch_convergence "$BK/tasks/1-task-inv11-resolved/task.json" "$CONV_VALID_COUNCIL_BLOCK"
  run cook validate
  [ "$status" -eq 0 ]
}

@test "INV-11: council-ship reaching done passes validate" {
  write_baseline_task "$BK" 1 "task-inv11-ship-done"
  write_baseline_task "$BK" 99 "task-inv11-followup"
  patch_convergence "$BK/tasks/1-task-inv11-ship-done/task.json" "$CONV_VALID_COUNCIL_SHIP"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# B1 regression: type-coercion fail-open in the council gate
#
# The gate `($cl.convened == true) as $conv` is jq type-strict: a STRING
# "true" or the NUMBER 1 compares false, causing $conv=false and silently
# skipping INV-8, INV-9, INV-10, and the convened-clauses of INV-11.
# A status=done task with convened="true" (string), verdict=block, and
# outcome=blocked-to-operator currently evades the done-gate and exits 0.
# These tests pin that: they must be RED until B1 is fixed.
# ---------------------------------------------------------------------------

@test "B1-regression: convened=STRING-true evades done-gate (validate must fail)" {
  # Worst-case: status=done, verdict=block, outcome=blocked-to-operator.
  # With convened as the STRING "true", the gate evaluates false, $conv=false,
  # and INV-11b is never checked: validate wrongly returns OK.
  # A correct fix must make this exit non-zero.
  write_baseline_task "$BK" 1 "task-b1-str-true"
  patch_convergence "$BK/tasks/1-task-b1-str-true/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": "true",
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "blocked-to-operator"
    }
  }'
  run cook validate
  # Must FAIL: status=done with a blocking council must not reach done
  # (except via scoped-fix-shipped).  The gate must treat "true" as truthy.
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv11"* ]] || true
}

@test "B1-regression: convened=NUMBER-1 evades done-gate (validate must fail)" {
  # Same scenario with convened as the NUMBER 1, which jq also does not
  # consider == true.  Pinning both coercions guards against a partial fix.
  write_baseline_task "$BK" 1 "task-b1-num-1"
  patch_convergence "$BK/tasks/1-task-b1-num-1/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": 1,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "blocked-to-operator"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv11"* ]] || true
}

@test "B1-regression: convened=BOOL-true with block+blocked-to-operator still fails (guard against over-broad fix)" {
  # Confirms the boolean-true path is not accidentally disabled by a fix that
  # broadens or removes the council check.  This must remain non-zero after
  # any correct fix (same expectation as the pre-existing INV-11a/11b tests).
  write_baseline_task "$BK" 1 "task-b1-bool-guard"
  patch_convergence "$BK/tasks/1-task-b1-bool-guard/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "data-loss bug", "blockingVotes": 2, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "blocked-to-operator"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv11"* ]] || true
}

# ---------------------------------------------------------------------------
# F1 (INV-7): integer-ness: cap and blockingKickbacks must be integers
# ---------------------------------------------------------------------------

@test "F1/INV-7: cap=1.5 (float) fails validate" {
  write_baseline_task "$BK" 1 "task-f1-cap-float"
  patch_convergence "$BK/tasks/1-task-f1-cap-float/task.json" '{
    "cap": 1.5,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv7"* ]] || true
}

@test "F1/INV-7: stages.review.blockingKickbacks=1.5 (float) fails validate" {
  write_baseline_task "$BK" 1 "task-f1-bk-float"
  patch_convergence "$BK/tasks/1-task-f1-bk-float/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1.5 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv7"* ]] || true
}

@test "F1/INV-7: integer cap and blockingKickbacks pass validate" {
  write_baseline_task "$BK" 1 "task-f1-int-ok"
  patch_convergence "$BK/tasks/1-task-f1-int-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# F2 (INV-9): blockingVotes must be an integer in 0..3
# ---------------------------------------------------------------------------

@test "F2/INV-9: finding.blockingVotes=5 (above max) fails validate" {
  # blockingVotes:5 with survived:true keeps INV-9 determinism satisfied (5>=2),
  # isolating the bound check.  verdict=block to stay consistent with survival.
  write_baseline_task "$BK" 1 "task-f2-bv-high"
  patch_convergence "$BK/tasks/1-task-f2-bv-high/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": 5, "survived": true, "followupTaskId": null }
      ],
      "verdict": "block",
      "outcome": "scoped-fix-shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "F2/INV-9: finding.blockingVotes=-1 (below min) fails validate" {
  # blockingVotes:-1 with survived:false keeps INV-9 determinism satisfied (-1<2),
  # isolating the bound check.  followupTaskId=99 satisfies INV-10.
  write_baseline_task "$BK" 1 "task-f2-bv-neg"
  write_baseline_task "$BK" 99 "task-f2-followup"
  patch_convergence "$BK/tasks/1-task-f2-bv-neg/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": -1, "survived": false, "followupTaskId": 99 }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "F2/INV-9: finding.blockingVotes in 0..3 passes validate" {
  # blockingVotes=0, survived:false, verdict:ship: all in-contract.
  # followupTaskId=99 satisfies INV-10.
  write_baseline_task "$BK" 1 "task-f2-bv-ok"
  write_baseline_task "$BK" 99 "task-f2-bv-followup"
  patch_convergence "$BK/tasks/1-task-f2-bv-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": 0, "survived": false, "followupTaskId": 99 }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# F3 (INV-9): convened:true requires findings non-empty
# ---------------------------------------------------------------------------

@test "F3/INV-9: convened=true with findings=[] fails validate" {
  # No findings => no survivals => verdict="ship" (consistent with INV-9
  # determinism). The F3 gap is that an empty-findings council is accepted.
  write_baseline_task "$BK" 1 "task-f3-empty-findings"
  patch_convergence "$BK/tasks/1-task-f3-empty-findings/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv9"* ]] || true
}

@test "F3/INV-9: convened=true with at least one finding passes validate" {
  # One finding, blockingVotes=1 (survived:false), followupTaskId=99, verdict=ship.
  write_baseline_task "$BK" 1 "task-f3-findings-ok"
  write_baseline_task "$BK" 99 "task-f3-followup"
  patch_convergence "$BK/tasks/1-task-f3-findings-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 2 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": true,
      "stage": "review",
      "members": [
        { "agent_id": "council-agent-A", "lens": "integrity",  "temperature": 0.3 },
        { "agent_id": "council-agent-B", "lens": "security",   "temperature": 0.7 },
        { "agent_id": "council-agent-C", "lens": "pragmatist", "temperature": 1.0 }
      ],
      "findings": [
        { "id": "f1", "summary": "minor nit", "blockingVotes": 1, "survived": false, "followupTaskId": 99 }
      ],
      "verdict": "ship",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# F4 (INV-8/9): closed enums: verdict and outcome must be in-contract values
# Enforced on any non-null council object (convened:false included).
# ---------------------------------------------------------------------------

@test "F4/INV-8: council.verdict=\"banana\" on convened=false object fails validate" {
  # convened:false so INV-9 determinism branch is skipped; the enum check fires alone.
  write_baseline_task "$BK" 1 "task-f4-verdict-banana"
  patch_convergence "$BK/tasks/1-task-f4-verdict-banana/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": "banana", "outcome": null }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "F4/INV-8: council.outcome=\"banana\" on convened=false object fails validate" {
  # Pin that the outcome enum is enforced even pre-council.
  write_baseline_task "$BK" 1 "task-f4-outcome-banana"
  patch_convergence "$BK/tasks/1-task-f4-outcome-banana/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": "banana" }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "F4/INV-8: in-enum verdict and outcome on convened=false object passes validate" {
  # null/null is the documented pre-council state: must remain valid.
  write_baseline_task "$BK" 1 "task-f4-enum-ok"
  patch_convergence "$BK/tasks/1-task-f4-enum-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# F5 (INV-8): council must be a non-null object when convergence is present
# ---------------------------------------------------------------------------

@test "F5/INV-8: convergence present with council=null fails validate" {
  write_baseline_task "$BK" 1 "task-f5-council-null"
  patch_convergence "$BK/tasks/1-task-f5-council-null/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": null
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "F5/INV-8: convergence present with council key absent fails validate" {
  write_baseline_task "$BK" 1 "task-f5-council-absent"
  # Build convergence without a council key at all
  patch_field "$BK/tasks/1-task-f5-council-absent/task.json" '
    . + {convergence: {"cap": 2, "stages": {"review": {"blockingKickbacks": 1}, "audit": {"blockingKickbacks": 0}}}}
  '
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

@test "F5/INV-8: convergence present with proper council object passes validate" {
  write_baseline_task "$BK" 1 "task-f5-council-ok"
  patch_convergence "$BK/tasks/1-task-f5-council-ok/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": { "convened": false, "stage": null, "members": [], "findings": [], "verdict": null, "outcome": null }
  }'
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# task 0005: un-convened block shape rule [inv8]
#
# Rule being added: a council object with convened != true may not carry
# verdict == "block".  Violation tag: [inv8].
#
# Tests 1 & 2 are RED until the rule lands in bin/cook (TDD red).
# Tests 3 & 4 are GREEN guards that must stay green before and after.
# ---------------------------------------------------------------------------

# Test 1 (RED): convened:false + verdict:"block" must fail validate.
# Mirrors CONV_VALID_NO_COUNCIL structure but overrides verdict to "block".
# outcome:"shipped" is included; the rule fires on convened/verdict alone.
@test "task-0005/inv8: convened=false with verdict=block fails validate" {
  write_baseline_task "$BK" 1 "task-0005-false-block"
  patch_convergence "$BK/tasks/1-task-0005-false-block/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": false,
      "stage": null,
      "members": [],
      "findings": [],
      "verdict": "block",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

# Test 2 (RED): the audit seam: status:done, convened:false, verdict:block,
# outcome:shipped also fails validate.  Baseline task is already status:done;
# the convergence patch is the sole mutation.
@test "task-0005/inv8: done task with convened=false verdict=block outcome=shipped fails validate" {
  write_baseline_task "$BK" 1 "task-0005-done-false-block"
  patch_convergence "$BK/tasks/1-task-0005-done-false-block/task.json" '{
    "cap": 2,
    "stages": { "review": { "blockingKickbacks": 1 }, "audit": { "blockingKickbacks": 0 } },
    "council": {
      "convened": false,
      "stage": null,
      "members": [],
      "findings": [],
      "verdict": "block",
      "outcome": "shipped"
    }
  }'
  run cook validate
  [ "$status" -ne 0 ]
  [[ "$output" == *"inv8"* ]] || true
}

# Test 3 (GREEN guard): a valid convened:true block must still pass.
# Uses CONV_VALID_COUNCIL_BLOCK (convened:true, survived finding, verdict:block,
# outcome:scoped-fix-shipped) on a done baseline task.
# Guards against an over-broad rule that rejects legitimate convened blocks.
@test "task-0005/inv8 guard: convened=true verdict=block passes validate" {
  write_baseline_task "$BK" 1 "task-0005-true-block-ok"
  patch_convergence "$BK/tasks/1-task-0005-true-block-ok/task.json" "$CONV_VALID_COUNCIL_BLOCK"
  run cook validate
  [ "$status" -eq 0 ]
}

# Test 4 (GREEN guard): convened:false + verdict:null + outcome:null (the
# documented pre-council state, i.e. CONV_VALID_NO_COUNCIL) must still pass.
# Guards back-compat: the rule must not reject un-convened nulls.
@test "task-0005/inv8 guard: convened=false verdict=null outcome=null passes validate" {
  write_baseline_task "$BK" 1 "task-0005-false-null-ok"
  patch_convergence "$BK/tasks/1-task-0005-false-null-ok/task.json" "$CONV_VALID_NO_COUNCIL"
  run cook validate
  [ "$status" -eq 0 ]
}
