#!/usr/bin/env bats
# tests/kickback.bats: bats suite for task #17: `cook kickback <id> <stage>`.
#
# Encodes the `## Test design` block in
# .jeff/tasks/lite-17-1482164961/notes.md (write lines only; the reuse/skip
# lines carry no test here). `cmd_kickback` does not exist yet: every test
# below is RED because `cook kickback ...` falls through main()'s `*)` to
# `die "unknown subcommand: kickback ..."` (also non-zero), so the exit-0
# cases assert the decisive stdout token + resulting JSON + `cook validate`
# (never present pre-implement), and the non-zero cases assert the SPECIFIC
# stderr wording (never bare exit code) so none can false-green against the
# fallthrough.
#
# bash 3.2 / POSIX-leaning; no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

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
# Fixture helpers (per-file convention; test_helper.bash untouched)
# ---------------------------------------------------------------------------

# write_baseline_task <bk_dir> <task_id> <slug> [status]
# A fully schema-valid v1 task.json, no convergence block, so only the
# convergence mutation under test can drive a validate failure. status
# defaults to "done"; tests that also run `cook validate` in FULL mode pass
# "in_progress" so the fixture does not trip the full-mode [prune] registry
# invariant (a done/abandoned task dir must not rest in the store); that
# invariant is unrelated to the convergence block under test here, and a
# kickback mid-review/audit is realistically in_progress, not done anyway.
write_baseline_task() {
  local bk="$1" id="$2" slug="$3" status="${4:-done}"
  local task_dir="$bk/tasks/${id}-${slug}"
  mkdir -p "$task_dir"
  jq -n \
    --argjson id "$id" \
    --arg slug "$slug" \
    --arg status "$status" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: $slug,
      title: ("Synthetic task: " + $slug),
      status: $status,
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
patch_convergence() {
  local path="$1" conv="$2" tmp
  tmp="$(mktemp)"
  jq --argjson conv "$conv" '. + {convergence: $conv}' "$path" > "$tmp"
  mv "$tmp" "$path"
}

# write_lite_config: .jeff/config.json with mode:"lite", active:true.
write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# The documented pre-council block, no council: mirrors convergence.bats'
# CONV_VALID_NO_COUNCIL exactly (cap:2, both stages initialized, convened:false).
CONV_PRE_COUNCIL_R0A1='{
  "cap": 2,
  "stages": {
    "review": { "blockingKickbacks": 0 },
    "audit":  { "blockingKickbacks": 1 }
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

CONV_PRE_COUNCIL_R1A0='{
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

CONV_PRE_COUNCIL_R2A0='{
  "cap": 2,
  "stages": {
    "review": { "blockingKickbacks": 2 },
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

# ---------------------------------------------------------------------------
# AC1 write line 1: absent convergence -> verb creates the full valid block
# ---------------------------------------------------------------------------

@test "kickback: absent convergence creates full valid block and prints kickback" {
  write_baseline_task "$BK" 1 "task-kb-absent" "in_progress"

  run cook kickback 1 review
  [ "$status" -eq 0 ]
  [ "$output" = "kickback" ]

  local f="$BK/tasks/1-task-kb-absent/task.json"
  [ "$(jq -r '.convergence.stages.review.blockingKickbacks' "$f")" = "1" ]
  [ "$(jq -r '.convergence.stages.audit.blockingKickbacks' "$f")" = "0" ]
  [ "$(jq -r '.convergence.council.convened' "$f")" = "false" ]

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC1 write line 2: present block, kick one stage preserves the other stage's
# count and the whole council object byte-identical.
# ---------------------------------------------------------------------------

@test "kickback: present block preserves the other stage's count and the council object" {
  write_baseline_task "$BK" 2 "task-kb-preserve"
  local f="$BK/tasks/2-task-kb-preserve/task.json"
  patch_convergence "$f" "$CONV_PRE_COUNCIL_R0A1"
  local council_before
  council_before="$(jq -c '.convergence.council' "$f")"

  run cook kickback 2 review
  [ "$status" -eq 0 ]
  [ "$output" = "kickback" ]

  [ "$(jq -r '.convergence.stages.review.blockingKickbacks' "$f")" = "1" ]
  [ "$(jq -r '.convergence.stages.audit.blockingKickbacks' "$f")" = "1" ]
  [ "$(jq -c '.convergence.council' "$f")" = "$council_before" ]
}

# ---------------------------------------------------------------------------
# AC1 write line 3: cap rule, 2nd kickback still kicks (review 1 -> 2)
# ---------------------------------------------------------------------------

@test "kickback: 2nd kickback increments to cap and still prints kickback" {
  write_baseline_task "$BK" 3 "task-kb-2nd"
  local f="$BK/tasks/3-task-kb-2nd/task.json"
  patch_convergence "$f" "$CONV_PRE_COUNCIL_R1A0"

  run cook kickback 3 review
  [ "$status" -eq 0 ]
  [ "$output" = "kickback" ]
  [ "$(jq -r '.convergence.stages.review.blockingKickbacks' "$f")" = "2" ]
}

# ---------------------------------------------------------------------------
# AC1 write line 4: cap rule, 3rd holds the count and prints council without
# convening.
# ---------------------------------------------------------------------------

@test "kickback: at cap the verb holds the count, prints council, does not convene" {
  write_baseline_task "$BK" 4 "task-kb-3rd" "in_progress"
  local f="$BK/tasks/4-task-kb-3rd/task.json"
  patch_convergence "$f" "$CONV_PRE_COUNCIL_R2A0"

  run cook kickback 4 review
  [ "$status" -eq 0 ]
  [ "$output" = "council" ]
  [ "$(jq -r '.convergence.stages.review.blockingKickbacks' "$f")" = "2" ]
  [ "$(jq -r '.convergence.council.convened' "$f")" = "false" ]

  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC1 write line 5: stage arg must be exactly review|audit
# ---------------------------------------------------------------------------

@test "kickback: rejects a stage other than review/audit with no partial write" {
  write_baseline_task "$BK" 5 "task-kb-badstage"
  local f="$BK/tasks/5-task-kb-badstage/task.json"
  local before after
  before="$(cat "$f")"

  run cook kickback 5 deploy
  [ "$status" -ne 0 ]
  [[ "$output" == *"review"* && "$output" == *"audit"* ]]

  after="$(cat "$f")"
  [ "$before" = "$after" ]
}

# ---------------------------------------------------------------------------
# AC1 write line 6: id resolution miss
# ---------------------------------------------------------------------------

@test "kickback: unknown id dies naming the id, store unmutated" {
  write_baseline_task "$BK" 6 "task-kb-idmiss"
  local f="$BK/tasks/6-task-kb-idmiss/task.json"
  local before after
  before="$(cat "$f")"

  run cook kickback 999 review
  [ "$status" -ne 0 ]
  [[ "$output" == *"no task with id 999"* ]]

  after="$(cat "$f")"
  [ "$before" = "$after" ]
}

# ---------------------------------------------------------------------------
# AC1 write line 7: arity guards (missing stage / excess positional)
# ---------------------------------------------------------------------------

@test "kickback: missing stage argument dies with no partial write" {
  write_baseline_task "$BK" 7 "task-kb-arity-missing"
  local f="$BK/tasks/7-task-kb-arity-missing/task.json"
  local before after
  before="$(cat "$f")"

  run cook kickback 7
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage"* && "$output" == *"kickback"* ]]

  after="$(cat "$f")"
  [ "$before" = "$after" ]
}

@test "kickback: excess positional argument dies with no partial write" {
  write_baseline_task "$BK" 7 "task-kb-arity-excess"
  local f="$BK/tasks/7-task-kb-arity-excess/task.json"
  local before after
  before="$(cat "$f")"

  run cook kickback 7 review extra
  [ "$status" -ne 0 ]
  [[ "$output" == *"extra"* ]]

  after="$(cat "$f")"
  [ "$before" = "$after" ]
}

# ---------------------------------------------------------------------------
# AC1 write line 8: runs in BOTH modes (not full-gated like prune)
# ---------------------------------------------------------------------------

@test "kickback: runs in lite mode (not full-gated), audit stage kicks and validates" {
  write_baseline_task "$BK" 8 "task-kb-lite"
  write_lite_config

  run cook kickback 8 audit
  [ "$status" -eq 0 ]

  local f="$BK/tasks/8-task-kb-lite/task.json"
  [ "$(jq -r '.convergence.stages.audit.blockingKickbacks' "$f")" = "1" ]

  run cook validate
  [ "$status" -eq 0 ]
}
