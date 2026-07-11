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

codex_dispatch_contract() {
  awk '
    /^### Codex native v2 dispatch$/ { found = 1 }
    found && /^### / && $0 != "### Codex native v2 dispatch" { exit }
    found { print }
  ' "$REPO/skills/cook/SKILL.md"
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

@test "Codex native v2 instructions preserve the orchestration contract without child overrides" {
  local contract
  contract="$(codex_dispatch_contract)"
  [ -n "$contract" ]

  grep -F 'agents/cook-<stage>.md' <<<"$contract"
  grep -E 'unique.*task_name' <<<"$contract"
  grep -F 'fork_turns' <<<"$contract" | grep -F 'none'
  grep -E 'spawn_agent.*task_name.*fork_turns.*message' <<<"$contract"
  grep -E 'never pass.*model.*effort' <<<"$contract"
  grep -E 'spawn.*review.*audit.*before.*wait_agent' <<<"$contract"
  grep -E 'FINAL_ANSWER.*independent' <<<"$contract"
  grep -E 'structured return' <<<"$contract"
  grep -E 'native.*(path|id)' <<<"$contract"
  grep -E '(interrupt_agent|close_agent).*(result|response)' <<<"$contract"
  grep -E '(shutdown|cancel).*notification.*correlate' <<<"$contract"
  grep -E 'notification.*do not require' <<<"$contract"
  grep -E 'not_found.*(prove|evidence).*(cancel|cancellation)' <<<"$contract"
}
