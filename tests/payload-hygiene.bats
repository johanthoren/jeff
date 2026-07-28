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

# ===========================================================================
# task #117: right-size the harness for frontier-tier models
#
# Seam: the payload prose IS the product here. `skills/` (plus `agents/`) is the
# only runtime surface both plugin manifests expose, and `skills/cook/SKILL.md`
# is loaded in full on every activation. What a consuming host loads, and what a
# maintainer reads in the shipped `AGENTS.md`, is therefore observable in exactly
# one place: the shipped files. There is no second seam these assertions shadow
# (contrast the task-0050 deletions, where the behavior was already guarded at a
# produced-artifact seam), so these are structural payload invariants of the same
# kind as the machine-path guards above, not source-prose change-detectors.
#
# Marker discipline: every marker below is a command name, env var, field name,
# identifier, or verbatim duplicated clause: load-bearing content that survives
# rewording. No assertion pins a sentence a maintainer may legitimately rephrase,
# and no assertion pins a new reference file's name.
# ===========================================================================

# ---------------------------------------------------------------------------
# AC1: the model expectation is declared in AGENTS.md
#
# RED now: AGENTS.md has no Model expectation section.
# ---------------------------------------------------------------------------

@test "#117 AC1: AGENTS.md declares the model expectation and the no-gating stance" {
  local agents="$REPO/AGENTS.md" model

  grep -qE '^#{2,3} Model expectation' "$agents" \
    || { echo "AGENTS.md carries no 'Model expectation' section"; return 1; }

  for model in 'Claude Opus 5' 'GPT-5.6 Sol' 'Grok 4.5'; do
    grep -qF -- "$model" "$agents" \
      || { echo "Model expectation does not name the design target: $model"; return 1; }
  done

  # jeff never gates on the model. This is the operative commitment: it forbids a
  # future model check/refusal, and weaker models may still run the pipeline.
  grep -qiE 'never[^.]*(detect|check|refus)[^.]*model|model[^.]*never[^.]*(detect|check|refus)' "$agents" \
    || { echo "Model expectation does not state that jeff never detects, checks, or refuses a model"; return 1; }

  # Re-thickening the harness for a weaker model is out of scope for maintenance.
  grep -qF 'not a maintenance goal' "$agents" \
    || { echo "Model expectation does not rule out re-thickening the harness as a maintenance goal"; return 1; }
}

@test "#117 AC1: the dogfood stamp is gone from AGENTS.md" {
  # The stamp claimed an execution context readers took for a compatibility
  # floor; the Model expectation section replaces it.
  run grep -in 'dogfood' "$REPO/AGENTS.md"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC2: per-stage effort is stated once, in agents/cook-*.md frontmatter
#
# `xhigh` is the effort vocabulary's unique token: it exists only as a role
# effort value. tests/role-frontmatter.bats owns the positive assertion (the
# frontmatter values); this owns the single-source half. Two homes for one
# value is drift waiting to happen, and the model reconciles the conflict.
#
# RED now: AGENTS.md:47 and skills/cook/SKILL.md:193-202 restate the values.
# ---------------------------------------------------------------------------

@test "#117 AC2: per-stage effort values appear only in role frontmatter" {
  run grep -rn 'xhigh' "$REPO/AGENTS.md" "$REPO/skills/cook"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC3: each duplicated topic has exactly one normative home
#
# Direction is fixed by the packaging fact, not by preference: a consuming repo
# receives AGENTS.md inside node_modules and never loads it, and both plugin
# manifests expose only skills/ (plus agents/). A runtime-operative fact that
# lands in AGENTS.md is silently lost for every non-Claude-Code host. So each
# topic below must remain reachable from skills/cook/ and must not be restated
# in AGENTS.md, which references the runtime owner by path instead.
#
# RED now: all five markers are in both files.
# ---------------------------------------------------------------------------

@test "#117 AC3: duplicated topics resolve to the runtime surface, not AGENTS.md" {
  local topic marker
  while IFS='|' read -r topic marker; do
    grep -rqF -- "$marker" "$REPO/skills/cook" \
      || { echo "topic=$topic: '$marker' is absent from skills/cook (runtime surface lost the fact)"; return 1; }
    if grep -qF -- "$marker" "$REPO/AGENTS.md"; then
      echo "topic=$topic: AGENTS.md restates '$marker' instead of pointing at the runtime owner"
      return 1
    fi
  done <<'CASES'
persona and flavor|JEFF_FLAVOR
convergence and council|K=3
git|Never put red
standards|code-standards
builder/judge separation|INV-1
CASES
}

# ---------------------------------------------------------------------------
# AC4: branch-gated detail is progressively disclosed
#
# Four blocks are provably dead in a given run yet load in full on every
# activation. Each must leave SKILL.md and land in skills/cook/reference/.
# Both halves are asserted per block: absence alone would be satisfied by
# deleting the content, which is the catastrophic failure (a lite run with no
# lite instructions).
#
# Block → what moves:
#   lite mode                    : the whole "Lite mode (shared repos)" subtree
#   full-mode registry           : "Creating a task" + BACKLOG maintenance
#   full-mode prune              : terminal-with-removal sequence
#   full-mode baseline           : "Entry-state baseline"
#   operation semantics          : operation plan/execution + cooperative boundary
#   codex native dispatch        : "Codex native v2 dispatch"
#
# RED now: every marker is resident in SKILL.md and in no reference file.
# ---------------------------------------------------------------------------

@test "#117 AC4: branch-gated blocks moved from SKILL.md into skills/cook/reference/" {
  local block marker
  while IFS='|' read -r block marker; do
    if grep -qF -- "$marker" "$REPO/skills/cook/SKILL.md"; then
      echo "block=$block: SKILL.md still carries '$marker'; it belongs in skills/cook/reference/"
      return 1
    fi
    grep -rqF -- "$marker" "$REPO/skills/cook/reference" \
      || { echo "block=$block: '$marker' is in no reference file; disclosure lost the content"; return 1; }
  done <<'CASES'
lite mode|cook indiff
full-mode registry|Next free id
full-mode prune|Strip satisfied deps
full-mode baseline|red baseline
operation semantics|Cooperative operation boundary
operation semantics|never contains a grant
codex native dispatch|spawn_agent
CASES
}

@test "#117 AC4 / #120 AC5: bundled skill paths resolve in both directions" {
  # Forward: any bundled path a role or skill tells a specialist to read must
  # exist, or the disclosure is a dead end at runtime. #120 widens the scan from
  # skills/cook/reference/*.md to every skills/**.md path, because a role that
  # delegates a rule to a bundled skill (rather than to a reference file) fails
  # the same way: the pointer dangles and the rule silently evaporates. Anything
  # under skills/ ships wholesale (package.json "files"), so resolution here is
  # also the shipping half; tests/package-publish.bats owns the pack assertion.
  # src/**/*.test.js is excluded: unit fixtures name synthetic host skill paths
  # (/home/chef/.claude/skills/...) that are neither payload pointers nor
  # published files.
  # Reverse: a reference file SKILL.md never names is unreachable payload.
  # GREEN now: a regression lock that fails on a pointer to a path that is not
  # there, and on a reference file nothing names.
  local path base file
  while read -r path; do
    [ -n "$path" ] || continue
    [ -f "$REPO/$path" ] || { echo "dangling bundled path named in the payload: $path"; return 1; }
  done <<EOF
$(grep -rhoE --exclude='*.test.js' 'skills/[A-Za-z0-9._/-]+\.md' \
    "$REPO/skills" "$REPO/agents" "$REPO/src" "$REPO/AGENTS.md" "$REPO/README.md" | sort -u)
EOF

  for file in "$REPO"/skills/cook/reference/*.md; do
    [ -f "$file" ] || continue
    base="$(basename "$file")"
    grep -qF "skills/cook/reference/$base" "$REPO/skills/cook/SKILL.md" \
      || { echo "orphan reference file: SKILL.md never names skills/cook/reference/$base"; return 1; }
  done
}

# ---------------------------------------------------------------------------
# AC5: removed scaffolding stays removed
#
# Both blocks steer the model inside an exploration space it no longer needs:
# a worked Bad/Good pair for the grounder, and argument-handling mechanics the
# CLI already enforces (tests/strict-args.bats owns that behavior).
#
# RED now: SKILL.md:40-41 (grounder pair) and SKILL.md:80-81 (argument
# scaffolding). Scanned across skills/cook so relocation is not a loophole.
# ---------------------------------------------------------------------------

@test "#117 AC5: the Bad/Good grounder example pair stays removed" {
  run grep -rnE '^(Bad|Good)[[:space:]]*[:(]' "$REPO/skills/cook"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "#117 AC5: request routing carries no argument-handling scaffolding" {
  local pattern='the `#` is stripped|≡|unrecognized argument to a shell'
  run grep -rnE "$pattern" "$REPO/skills/cook"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ===========================================================================
# task #120: cut prescriptive rules the declared model tier no longer needs
#
# Seam: unchanged from #117. The payload prose IS the product, and the shipped
# files are the only place a host observes it.
#
# Only the one mechanical failure mode of a deletion task is asserted here: a
# rule delegated to a bundled skill that the receiving station cannot reach.
# Deleted prose cannot regress at runtime, so no assertion pins the absence of
# a removed sentence; that is the change-detector class this suite already
# rejects (see tests/command-routing.bats). Everything else in #120 is a
# judgment about what each remaining rule protects, and is review-owned.
# ===========================================================================

@test "#120 AC2: the review role names the bundled skill path it delegates to" {
  # The review station runs with Read, Grep, Glob and no skill loader, so it can
  # reach a bundled skill only through an explicit path. A bare skill name is
  # not a pointer: a delegated rule behind one is unreachable at dispatch, and
  # the review station judges test dispositions without it.
  # The link guard above owns the other half (a named path must resolve); this
  # owns the pointer existing at all.
  #
  # RED now: agents/cook-review.md names the `testing` skill but no path to it.
  grep -qE 'skills/[A-Za-z0-9._/-]+\.md' "$REPO/agents/cook-review.md" \
    || { echo "agents/cook-review.md names no bundled skill path; a Read/Grep/Glob station cannot reach what it delegates"; return 1; }
}
