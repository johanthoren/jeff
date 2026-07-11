#!/usr/bin/env bats
# tests/payload-hygiene.bats: task 0033: shipped payload must carry no machine-specific
# paths, local Codex artifacts, or operationally-broken forge identity references.
#
# Covers:
#   AC6: guard test: payload free of $HOME/code, /Users/, local Codex cache/session
#         artifacts, and forge path/identity tokens.
#
# Payload scan set (mirrors release-check.bats payload prefix list):
#   skills/  agents/  commands/  hooks/  .claude-plugin/  .codex-plugin/
#   .agents/plugins/  AGENTS.md  README.md
#   commands/ and hooks/ are optional: grep returns 1 (no match) on absent dirs,
#   which we treat as passing.  docs/, tests/, .jeff/, Makefile are excluded
#   by construction (AC5: historical forge refs in docs/ must survive).
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

# ---------------------------------------------------------------------------
# Helper: collect payload paths into an array suitable for grep.
# We pass them explicitly so absent optional dirs are silently skipped.
# ---------------------------------------------------------------------------

_payload_args() {
  local args=()
  for dir in skills agents commands hooks .claude-plugin .codex-plugin .agents/plugins; do
    [ -d "$REPO/$dir" ] && args+=("$REPO/$dir")
  done
  for f in AGENTS.md README.md; do
    [ -f "$REPO/$f" ] && args+=("$REPO/$f")
  done
  printf '%s\n' "${args[@]}"
}

# ---------------------------------------------------------------------------
# AC6: no machine-specific path: $HOME/code
#
# RED now: skills/security-auditor/SKILL.md:39 contains "$HOME/code/forge/..."
# ---------------------------------------------------------------------------

@test "payload: no \$HOME/code occurrence (machine-specific path)" {
  local -a targets
  mapfile -t targets < <(_payload_args)
  run grep -r --include="*" -l '\$HOME/code' "${targets[@]}"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC6: no machine-specific absolute path: /Users/
#
# GREEN now (no /Users/ literal exists in current payload; asserted as regression lock).
# ---------------------------------------------------------------------------

@test "payload: no /Users/ occurrence (machine-specific absolute path)" {
  local -a targets
  mapfile -t targets < <(_payload_args)
  run grep -r --include="*" -l '/Users/' "${targets[@]}"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC6: no local Codex cache/session provenance in the public payload.
# Public Codex support and manifests are expected; only internal artifact paths
# and concrete rollout logs are forbidden.
# ---------------------------------------------------------------------------

@test "payload: no local Codex cache or session provenance" {
  local -a targets
  mapfile -t targets < <(_payload_args)
  local pattern='\.codex/(plugins/cache|sessions)(/|[^[:alnum:]_-]|$)|\.codex/session_index\.jsonl|rollout-[0-9]{4}-[0-9]{2}-[0-9]{2}T[^/[:space:]]+\.jsonl'
  run grep -rE --include="*" -l "$pattern" "${targets[@]}"
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
  local -a targets
  mapfile -t targets < <(_payload_args)
  local pattern='\$HOME/code/forge|code/forge/|[Ff]orge repo|for Forge|/forge/'
  run grep -rE --include="*" -l "$pattern" "${targets[@]}"
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
