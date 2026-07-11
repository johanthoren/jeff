#!/usr/bin/env bats
# tests/brains.bats: content-contract for agents/*.md frontmatter.
#
# Specialist roles prescribe effort only; their model is inherited from the
# orchestrator by the host.

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

@test "brains: stage agents omit model so the host inherits the orchestrator model" {
  local stage
  for stage in plan test implement refactor review audit refute; do
    local f="$REPO/agents/cook-${stage}.md"
    [ -f "$f" ] || { echo "missing agent file: $f"; return 1; }
    [ -z "$(frontmatter_field "$f" model)" ] || { echo "stage=$stage must not prescribe model"; return 1; }
  done
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
