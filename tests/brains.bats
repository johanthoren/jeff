#!/usr/bin/env bats
# tests/brains.bats: content-contract for agents/*.md frontmatter.
#
# Task 0026: brain tiering by pure frontmatter assignment.
# Task 0041: dispatched plan specialist + test reframed as a low-effort doer.
# Each dispatched stage must pin BOTH model: and effort: to the settled values:
#
#   stage       model   effort
#   plan        opus    xhigh   (new in 0041: dispatched test-designer)
#   test        opus    medium  (0041: re-pinned down from xhigh: encoder/doer)
#   implement   opus    high
#   refactor    opus    xhigh
#   review      opus    xhigh
#   audit       opus    xhigh
#   refute      opus    xhigh
#
# RED now (task 0041): agents/plan.md does not yet exist, and
# agents/test.md still pins effort: xhigh. GREEN after 0041 adds plan
# and re-pins test to medium.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# frontmatter_field <file> <field>
# Extracts the value of `field: value` from the YAML frontmatter block (between
# the opening --- and the closing ---). Returns empty string if not found.
frontmatter_field() {
  local file="$1" field="$2"
  awk '/^---$/{if(++n==2)exit} n==1 && /^'"$field"':/{gsub(/^'"$field"':[[:space:]]*/,""); print}' "$file"
}

# ---------------------------------------------------------------------------
# Consolidated from 13 per-stage one-value assertions (merged 0050).
#
# Judgment call (flagged for the reviewer): these assertions grep frontmatter
# VALUES out of the agent files: the change-detector's shape (config restated
# in the test). There is no in-repo consumer seam to rewrite them against (the
# CLI never reads these values; the harness reads them at dispatch). They were
# kept rather than deleted because the brain table is a hard-won, repeatedly
# regressed operational decision (see memory: jeff-brain-tiering), so the
# regression guard has real value: and consolidated into two table-driven
# tests so the whole settled brain table lives in one place and every original
# model/effort assertion is preserved. The reviewer should ratify keep-as-merge
# vs delete.
#
# Settled brain table (stage → model · effort):
#   plan        opus    xhigh   (dispatched test-designer, 0041)
#   test        sonnet  medium  (doer/encoder, low-effort by design)
#   implement   opus    high
#   refactor    opus    xhigh   (judge caliber: zoom-out dedup/harmonization, a different angle than review)
#   review      opus    xhigh
#   audit       opus    xhigh
#   refute      opus    xhigh   (can overturn a judge's blocking finding)
# ---------------------------------------------------------------------------

@test "brains: each stage agent pins the settled model" {
  while IFS='|' read -r stage want; do
    [ -n "$stage" ] || continue
    local f="$REPO/agents/cook-${stage}.md"
    [ -f "$f" ] || { echo "missing agent file: $f"; return 1; }
    local got
    got="$(frontmatter_field "$f" model)"
    [ "$got" = "$want" ] || { echo "stage=$stage model: want=$want got=$got"; return 1; }
  done <<'MODEL_CASES'
plan|opus
test|sonnet
implement|opus
refactor|opus
review|opus
audit|opus
refute|opus
MODEL_CASES
}

@test "brains: each stage agent pins the settled effort" {
  while IFS='|' read -r stage want; do
    [ -n "$stage" ] || continue
    local f="$REPO/agents/cook-${stage}.md"
    [ -f "$f" ] || { echo "missing agent file: $f"; return 1; }
    local got
    got="$(frontmatter_field "$f" effort)"
    [ "$got" = "$want" ] || { echo "stage=$stage effort: want=$want got=$got"; return 1; }
  done <<'EFFORT_CASES'
plan|xhigh
test|medium
implement|high
refactor|xhigh
review|xhigh
audit|xhigh
refute|xhigh
EFFORT_CASES
}
