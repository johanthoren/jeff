#!/usr/bin/env bats
# tests/payload-hygiene.bats: task 0033: shipped payload must carry no machine-specific
# paths, local Codex artifacts, or operationally-broken forge identity references.
#
# Covers:
#   AC6: guard test: payload free of $HOME/code, /Users/, local Codex cache/session
#         artifacts, and forge path/identity tokens.
#
# Public payload scan set:
#   skills/  agents/  commands/  hooks/  src/  assets/  .claude-plugin/
#   .codex-plugin/  .agents/plugins/  AGENTS.md  README.md  NOTICE  package.json
#   Optional paths are skipped. docs/, tests/, .jeff/, Makefile are excluded by
#   construction (AC5: historical forge refs in docs/ must survive).
#
# fire-and-forget safety:
#   skills/cook/SKILL.md contains "fire-and-forget": the substring "forge" appears
#   inside that word.  A bare `grep -i forge` would false-positive on it.  The
#   forge-shape assertion uses an explicit alternation of offender patterns that does
#   NOT match "fire-and-forget".  See notes.md "Load-bearing scoping facts".
#
# Parallel-safety: read-only; no shared mutable state; no cwd assumption beyond REPO.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

setup() {
  PAYLOAD_ARGS=()
  for dir in skills agents commands hooks src assets .claude-plugin .codex-plugin .agents/plugins; do
    [ -d "$REPO/$dir" ] && PAYLOAD_ARGS+=("$REPO/$dir")
  done
  for file in AGENTS.md README.md NOTICE package.json; do
    [ -f "$REPO/$file" ] && PAYLOAD_ARGS+=("$REPO/$file")
  done
}

# ---------------------------------------------------------------------------
# AC6: no machine-specific path: $HOME/code
#
# RED now: skills/security-auditor/SKILL.md:39 contains "$HOME/code/forge/..."
# ---------------------------------------------------------------------------

@test "payload: no \$HOME/code occurrence (machine-specific path)" {
  run grep -r --include="*" -l '\$HOME/code' "${PAYLOAD_ARGS[@]}"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC6: no machine-specific absolute path: /Users/
#
# GREEN now (no /Users/ literal exists in current payload; asserted as regression lock).
# ---------------------------------------------------------------------------

@test "payload: no /Users/ occurrence (machine-specific absolute path)" {
  run grep -r --include="*" -l '/Users/' "${PAYLOAD_ARGS[@]}"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC6: no local Codex cache/session provenance in the public payload.
# Public Codex support and manifests are expected; only internal artifact paths
# and concrete rollout logs are forbidden.
# ---------------------------------------------------------------------------

@test "payload: no local Codex cache or session provenance" {
  local pattern='\.codex/(plugins/cache|sessions)(/|[^[:alnum:]_-]|$)|\.codex/session_index\.jsonl|rollout-[0-9]{4}-[0-9]{2}-[0-9]{2}T[^/[:space:]]+\.jsonl'
  run grep -rE --include="*" -l "$pattern" "${PAYLOAD_ARGS[@]}"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC6: no forge path-or-identity token (fire-and-forget safe)
#
# Matches the confirmed offender shapes only; does NOT match "fire-and-forget".
# Pattern alternation:
#   \$HOME/code/forge  : machine-path reference (SKILL.md:39)
#   code/forge/        : path segment form
#   [Ff]orge repo      : identity noun phrase (SKILL.md:36)
#   for Forge          : identity noun phrase (review_security.py:2)
#   /forge/            : bare path segment
#
# RED now: at minimum SKILL.md:36, SKILL.md:39, review_security.py:2 match.
# ---------------------------------------------------------------------------

@test "payload: no forge path-or-identity token (fire-and-forget safe)" {
  local pattern='\$HOME/code/forge|code/forge/|[Ff]orge repo|for Forge|/forge/'
  run grep -rE --include="*" -l "$pattern" "${PAYLOAD_ARGS[@]}"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC2 (task 0001): no dead inline-fallback clause in cook SKILL.md
#
# The string 'general-purpose' is unique to the dead else-branch on SKILL.md:178
# ("else general-purpose with the agent brief inlined").  Cook stages always
# ship as named subagent types; this clause never fires and must be removed.
# Keying on 'general-purpose' (not agents/cook-<stage>.md) avoids false-positives
# on SKILL.md:169 and :179 where that path legitimately remains.
#
# RED now: 'general-purpose' is present on SKILL.md:178.
# GREEN after implementer rewrites line 178 to drop the dead else-branch.
# ---------------------------------------------------------------------------

@test "cook SKILL.md: no general-purpose fallback clause (dead inline-fallback removed)" {
  run grep -nF 'general-purpose' "$REPO/skills/cook/SKILL.md"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# task #47: migration.md After migration — in-flight branches are generic
#
# Consumer-observable: operators reading the shipped migration guide must not
# be told that branch topology depends on complexity. The After migration note
# still teaches that existing in-flight branches are unaffected (names do not
# reference the state dir), but without a complexity-conditioned branch form.
#
# RED now: "**In-flight branches** (`task/<id>-<slug>` for complex tasks)".
# GREEN after implementer drops the complexity association and keeps a generic
# in-flight-branches note.
# ---------------------------------------------------------------------------

@test "migration.md: After migration still notes in-flight branches generically" {
  local section
  section="$(
    awk '/^## After migration[[:space:]]*$/ {p=1; next} p && /^## / {exit} p' \
      "$REPO/skills/cook/reference/migration.md"
  )"
  [ -n "$section" ]

  # Retain the operator-facing aftercare note (do not delete the bullet).
  grep -F '**In-flight branches**' <<<"$section"
  grep -F 'unaffected' <<<"$section"
  grep -F 'branch names do not reference the state dir' <<<"$section"
}

@test "migration.md: no branch topology associated with complexity" {
  # Any residual complexity↔branch coupling in the migration guide fails AC2.
  # Scoped patterns: complexity on the same line as branch guidance, or the
  # retired "for complex tasks" parenthetical on the in-flight branch example.
  local pattern='for complex tasks|In-flight branches[^\n]*complex|complex[^\n]*In-flight branches|branch[^\n]{0,100}complex|complex[^\n]{0,100}branch|task/<id>-<slug>[^\n]{0,40}complex'
  run grep -nEi "$pattern" "$REPO/skills/cook/reference/migration.md"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}
