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

# codex_dispatch_contract
# Extracts the Codex native v2 dispatch contract from wherever the cook payload
# keeps it. Task #117 discloses that branch-gated block progressively: it moves
# out of the always-loaded SKILL.md into skills/cook/reference/. The contract
# itself is unchanged, so this helper follows the content instead of pinning a
# location: it scans SKILL.md and every reference file, and takes the section
# from its heading to the next heading of the same or shallower level (so a
# dedicated file's own subsections stay inside the contract).
codex_dispatch_contract() {
  local file
  for file in "$REPO"/skills/cook/SKILL.md "$REPO"/skills/cook/reference/*.md; do
    [ -f "$file" ] || continue
    awk '
      /^#+[ \t]/ {
        match($0, /^#+/); level = RLENGTH
        if (found && level <= start_level) exit
        if (!found && $0 ~ /Codex native v2 dispatch/) { found = 1; start_level = level }
      }
      found { print }
    ' "$file"
  done
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
execute|high
refactor|xhigh
review|xhigh
verify|xhigh
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

@test "issue 105 operation roles describe one cooperative workflow across hosts" {
  local plan_role execute_role verify_role contract
  plan_role="$(cat "$REPO/agents/cook-plan.md")"
  execute_role="$(cat "$REPO/agents/cook-execute.md")"
  verify_role="$(cat "$REPO/agents/cook-verify.md")"
  contract="$(cat "$REPO/skills/cook/SKILL.md")"

  grep -E 'operator-facing.*approvalBoundary|approvalBoundary.*operator-facing' <<<"$plan_role"
  grep -E 'approval-required.*approvalBoundary|approvalBoundary.*approval-required' <<<"$execute_role"
  grep -E 'role contract.*stop|stop.*role contract' <<<"$execute_role"
  grep -E 're-fire.*execute|execute.*re-fire' <<<"$execute_role"
  grep -E 'verification (method|seam)|verificationSeams' <<<"$verify_role"
  grep -E '(Never|never).*(executor|execution|execute).*evidence' <<<"$verify_role"
  grep -E 'cooperative.*(workflow|protocol)|(workflow|protocol).*cooperative' <<<"$contract"
  grep -E 'not (a )?security sandbox|not.*sandbox' <<<"$contract"
  grep -E 'host.*(tool|capabilit).*(not|is not).*(invariant|guarantee)|not.*cross-host.*invariant' <<<"$contract"
  grep -F 'cook approve <id> <operator>' <<<"$contract"

  ! grep -E 'operation_apply|verify_query|canonical argv batch|Operation verification host capability gate' \
    <<<"$plan_role"$'\n'"$execute_role"$'\n'"$verify_role"$'\n'"$contract"
}

@test "issue 101 cycle 2: operation planner has a strict durable escalation return" {
  local role
  role="$(cat "$REPO/agents/cook-plan.md")"

  grep -E 'operation.*unresolved fork|unresolved fork.*operation' <<<"$role"
  grep -F '"stage":"plan","result":"escalation"' <<<"$role"
  grep -E '"slices":.*"escalation":.*"fork":.*"options"' <<<"$role"
}

# ---------------------------------------------------------------------------
# issue 173: the judgment tool grant, stated once for every host
#
# Issue 101 narrowed verify and audit to read-only at the two boundaries it
# could reach, Claude Code frontmatter and the Pi grant table, and left Codex
# to inherit whatever the orchestrator holds. The rule then bound two hosts and
# not the third, and no payload sentence said so, so the divergence was
# invisible until an operation happened to verify on Codex. Issue 173 widens
# the grant on all three hosts and states the Codex position instead of leaving
# a reader to infer it from absent configuration.
#
# Seam: §Dispatch of skills/cook/SKILL.md, which every host loads and which
# already carries the per-host bullets. skills/cook/reference/codex-dispatch.md
# is read only once the orchestrator is already on Codex, so a statement there
# cannot reach the reader this contract is for, and a statement in both places
# is the drifting duplicate that produced the divergence in the first place.
#
# The Edit/Write half of the grant is not asserted here: exact frontmatter
# equality in src/pi/skill-frontmatter.test.js and the exact per-stage maps in
# src/pi/role-session.test.js already fail on it at both enforcing boundaries.
# ---------------------------------------------------------------------------

# dispatch_section
# The `## Dispatch` block of SKILL.md, from its heading to the next heading of
# the same level, so the stage subsections stay inside it.
dispatch_section() {
  awk '/^## /{ if (found) exit; found = ($0 ~ /Dispatch/) } found' "$REPO/skills/cook/SKILL.md"
}

@test "issue 173: the dispatch contract grants both operation judgment stations command capability" {
  local section grant
  section="$(dispatch_section)"
  [ -n "$section" ] || { echo "SKILL.md has no Dispatch section"; return 1; }

  grant="$(grep -Ei 'verify' <<<"$section" | grep -Ei 'audit' | grep -Ei 'command|bash')" || {
    echo "SKILL.md Dispatch does not state that verify and audit run commands; without it the only record of the grant is per-host configuration, which is what diverged"
    return 1
  }
  [ -n "$grant" ]
}

@test "issue 173: the dispatch contract states what Codex grants rather than leaving it to absent configuration" {
  local section
  section="$(dispatch_section)"

  grep -Ei 'codex' <<<"$section" | grep -Ei 'inherit' | grep -qEi 'tool|capabilit|grant|command' || {
    echo "SKILL.md Dispatch does not say that a Codex child inherits the orchestrator's tool capability; a reader cannot tell what Codex grants without inferring it from silence"
    return 1
  }
}

@test "issue 173: the stations that gained command capability state that they never mutate" {
  local file role
  for file in cook-verify cook-audit; do
    role="$(cat "$REPO/agents/$file.md")"

    grep -qEi '(never|not|no|without)[^.]{0,80}mutat' <<<"$role" || {
      echo "agents/$file.md can now run commands but never states that it does not mutate; prose is the only control left, since jeff declines to add a validator-level one"
      return 1
    }
    grep -qEi 'external state' <<<"$role" || {
      echo "agents/$file.md does not carry the widened reach of that prohibition: a command reaches external state, not just files"
      return 1
    }
  done
}

@test "issue 173: the auditor still consumes the supplied scan instead of running its own" {
  # Green control, not a new contract. Command capability makes "run your own
  # scan" newly possible for the auditor, so the sentence that forbids it stops
  # being enforced by the absence of a shell and starts being enforced by this.
  local role
  role="$(cat "$REPO/agents/cook-audit.md")"

  grep -qEi 'scanner evidence' <<<"$role" || {
    echo "agents/cook-audit.md no longer requires the supplied scanner evidence"
    return 1
  }
  grep -qEi 'needs-work[^.]*missing audit input|missing audit input[^.]*needs-work' <<<"$role" || {
    echo "agents/cook-audit.md no longer returns needs-work for missing audit input"
    return 1
  }
  grep -qEi 'invent[^.]*scan' <<<"$role" || {
    echo "agents/cook-audit.md no longer forbids substituting a self-run scan for the supplied one"
    return 1
  }
}
