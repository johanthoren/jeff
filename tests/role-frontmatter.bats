#!/usr/bin/env bats
# tests/role-frontmatter.bats: content contract for agents/*.md frontmatter.
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

@test "role frontmatter: agents inherit model and pin settled effort" {
  while IFS='|' read -r stage effort; do
    local file="$REPO/agents/cook-${stage}.md"
    [ -f "$file" ] || { echo "missing agent file: $file"; return 1; }
    [ -z "$(frontmatter_field "$file" model)" ] || { echo "stage=$stage must not prescribe model"; return 1; }
    [ "$(frontmatter_field "$file" effort)" = "$effort" ] || { echo "stage=$stage effort must be $effort"; return 1; }
  done <<'CASES'
plan|xhigh
implement|high
refactor|xhigh
review|xhigh
audit|xhigh
refute|xhigh
CASES
}
