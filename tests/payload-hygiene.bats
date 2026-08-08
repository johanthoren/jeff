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
full-mode prune|Append the finishing id to `prunedTaskIds` only after its task record earns `done` or `abandoned`
full-mode baseline|red baseline
operation semantics|Cooperative operation boundary
operation semantics|never contains a grant
codex native dispatch|spawn_agent
CASES
}

@test "#140 full-mode allocation includes live and terminally pruned ids without duplicating live state" {
  local reference="$REPO/skills/cook/reference/full-mode.md"

  grep -qF -- 'maximum id in the union of live task ids and `prunedTaskIds`' "$reference" \
    || { echo "full-mode allocation no longer accounts for both live and terminally pruned ids"; return 1; }
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
# task #120 / #128 / #131: the bundled-skill pointer, locked as a property of
# the idiom instead of per instance
#
# Seam: unchanged from #117. The payload prose IS the product, and the shipped
# role files are the only place a host observes it. A dispatched station runs
# with no skill loader whatever its tool grant is, so it reaches a bundled skill
# only through a path its own role file names, resolved against the absolute
# form the brief supplies. (The grant itself moved in #173 and is not what this
# block depends on; agents/*.md frontmatter owns it.)
#
# One declaration drives three assertions:
#   guard   : every declared role file binds the brief's absolute path and
#             names what it returns when that path is unreachable;
#   forward : every declared (role file, bundled path) pair is present;
#   reverse : every bundled path named under agents/ is declared.
#
# Reverse is what ends the per-instance sequence (#120 added a pointer and did
# not lock it; #128 locked that one and added another it did not lock): a new
# pointer must be declared, and declaring it pulls its role file into the guard
# too. The wide link guard above is no substitute, since it fails on a dangling
# path and never on a deleted one.
#
# Marker discipline, per the #117 block above: bundled paths are identifiers,
# and `needs-work`, `escalation`, `kickback` and `summary` are the return
# vocabulary each role's own strict JSON object already fixes. Rewording the
# sentence around any of them still passes. Host-provided skills (`rust`,
# `swift`, `clojure`) ship no bundled path, so they enter neither the table nor
# the scan.
#
# Forward subsumes the single pair #128 pinned here (cook-review.md ->
# skills/testing/SKILL.md), which is why that assertion is gone rather than
# kept beside this one.
# ===========================================================================

# role file | bundled paths it must name | the token its return uses to report
# one it cannot read. Single source for the three assertions below.
list_bundled_pointers() {
  cat <<'CASES'
cook-audit.md|skills/security-auditor/SKILL.md|needs-work
cook-execute.md|skills/code-standards/SKILL.md|kickback
cook-implement.md|skills/code-standards/SKILL.md|kickback
cook-plan.md|skills/code-standards/SKILL.md skills/testing/SKILL.md|escalation
cook-refactor.md|skills/code-standards/SKILL.md|summary
cook-review.md|skills/code-standards/SKILL.md skills/testing/SKILL.md|needs-work
CASES
}

@test "#131 AC1 / AC2: every role file that names a bundled skill path carries the guard" {
  # Two failure directions, one clause. Without the resolution base the station
  # stats a repo-relative path against whatever cwd it has: silent in a consumer
  # repo that has its own same-named document, spurious on a correct dispatch.
  # Without the stop, a station whose skill is unreachable proceeds degraded.
  local role paths stop
  while IFS='|' read -r role paths stop; do
    awk -v stop="$stop" '
      { lower = tolower($0) }
      index(lower, "absolute") && index(lower, "brief") && index($0, stop) { found = 1 }
      END { if (!found) exit 1 }
    ' "$REPO/agents/$role" || {
      echo "agents/$role names a bundled skill path but no line carries the guard: it must bind the station to the absolute path its brief supplies, and name '$stop' as what it returns when that path is unreachable"
      return 1
    }
  done < <(list_bundled_pointers)
}

@test "#131 AC3 forward: every declared bundled pointer is present in its role file" {
  local role paths stop path
  while IFS='|' read -r role paths stop; do
    for path in $paths; do
      grep -qF -- "$path" "$REPO/agents/$role" || {
        echo "agents/$role no longer names $path; the rules delegated behind that pointer are unreachable from a station with no skill loader"
        return 1
      }
    done
  done < <(list_bundled_pointers)
}

@test "#131 AC3 reverse: every bundled skill path named under agents/ is declared" {
  local file role declared path
  for file in "$REPO"/agents/*.md; do
    role="$(basename "$file")"
    declared=" $(list_bundled_pointers | awk -F'|' -v role="$role" '$1 == role { print $2 }') "
    while read -r path; do
      [ -n "$path" ] || continue
      case "$declared" in
        *" $path "*) ;;
        *)
          echo "agents/$role names $path, which the pointer table above does not declare for it; declare the pair so the pointer is locked and the role file is held to the guard"
          return 1
          ;;
      esac
    done <<EOF
$(grep -oE 'skills/[A-Za-z0-9._/-]+\.md' "$file" | sort -u)
EOF
  done
}

# ===========================================================================
# task #123: the base-directory resolution recipe has one home, and every
# payload reference path stays in the form the link guard can see
#
# Seam: unchanged from the #117 block above. The payload prose IS the product,
# and skills/cook/SKILL.md loads in full on every activation, so whether a
# consuming host can resolve a payload path is observable in exactly one place:
# the shipped files.
#
# Marker discipline, per that block: `../..` is a path token, not a sentence.
# Every statement of the recipe contains it and no rewording removes it, so the
# count below tracks how many homes the recipe has, never how it is phrased.
# The second test pins a path *form*, which is likewise structural.
# ===========================================================================

@test "#123 AC2: the base-directory resolution recipe has exactly one home, in SKILL.md" {
  # Two failure directions, one count. More than one line restates the recipe
  # (SKILL.md :48 and :149 plus reference/migration.md today: three homes to
  # keep in step, and migration.md already spells the placeholder differently).
  # Zero lines means the generalization deleted the rule rather than moving it.
  #
  # Requiring the survivor to sit in SKILL.md is the load-bearing half. SKILL.md
  # loads on every activation; a reference file loads only on its own branch. A
  # recipe that lands in a reference file is absent from every run that never
  # reads that branch, which is the class of defect this task closes.
  local homes
  homes="$(grep -rn '\.\./\.\.' "$REPO/skills/cook" || true)"

  [ "$(printf '%s\n' "$homes" | grep -c .)" -eq 1 ] || {
    printf 'the base-directory resolution recipe must have exactly one home; found:\n%s\n' "$homes"
    return 1
  }

  printf '%s\n' "$homes" | grep -qF "$REPO/skills/cook/SKILL.md:" || {
    printf 'the surviving recipe is not in SKILL.md, so a run that never reads its branch cannot resolve any payload path:\n%s\n' "$homes"
    return 1
  }
}

@test "#123 AC3 / AC4: every payload reference path is plugin-root-relative" {
  # The #120 defect, locked so it cannot recur silently. A pointer written
  # base-relative (`reference/<name>.md`) resolves against whatever directory
  # the reader happens to be at, and never matches the `skills/...` scan the
  # link guard above runs, so that guard stays green while the pointer dangles.
  # One uniform plugin-root-relative form is what lets the guard see these paths
  # at all, which is why the fix is the recipe and not the paths.
  #
  # The asymmetry is live on the tree, not hypothetical: the link guard above
  # passes today while both offenders below are present, and it cannot see
  # skills/security-auditor/reference/adversarial-audit.md at all.
  #
  # src/**/*.test.js is excluded for the reason that guard states: unit fixtures
  # name synthetic host skill paths that are neither payload pointers nor
  # published files.
  local offenders
  offenders="$(
    grep -rnoE --exclude='*.test.js' '[A-Za-z0-9._/-]*reference/[A-Za-z0-9._-]+\.md' \
      "${PAYLOAD_ARGS[@]}" \
      | grep -vE ':[0-9]+:skills/[A-Za-z0-9._-]+/reference/' || true
  )"

  [ -z "$offenders" ] || {
    printf 'payload reference paths outside the plugin-root-relative skills/<skill>/reference/<name>.md form; the link guard above cannot see these:\n%s\n' "$offenders"
    return 1
  }
}

# ===========================================================================
# task #134: the recipe's reach, locked to the path classes it covers
#
# The assertion above counts how many homes the recipe has and never what it
# reaches. Re-narrowing it to the CLI alone leaves that count at one, in
# SKILL.md, with no reference path touched: both assertions above stay green
# while the #123 defect returns verbatim, since bundled skill paths and the
# reference reads are again covered by no stated rule.
#
# Marker discipline, per the #117 block above: the three markers are payload
# path classes, not sentences. `src/cli/cook.js` is the shipped command
# surface, and `skills/` and `agents/` are the two payload directories both
# plugin manifests expose. A recipe that covers all three names all three, in
# any phrasing; a recipe narrowed to one of them cannot name the other two.
# Each directory marker is matched as a bare class token, so naming one file
# inside a directory does not pass for covering the directory.
#
# The section is located by the `../..` marker, not by its heading: a heading
# is prose a maintainer may rename (#123 renamed this one), while the marker is
# the path token every statement of the recipe carries. The assertion above
# fixes that marker to exactly one home in SKILL.md, so "the section carrying
# `../..`" names exactly one section.
# ===========================================================================

@test "#134 AC2: the resolution recipe reaches all three payload path classes" {
  local recipe class
  recipe="$(
    awk '
      /^##+ / { if (found) exit; body = ""; next }
      { body = body $0 ORS }
      index($0, "../..") { found = 1 }
      END { if (found) printf "%s", body }
    ' "$REPO/skills/cook/SKILL.md"
  )"

  [ -n "$recipe" ] || {
    echo "no section of skills/cook/SKILL.md states the base-directory resolution recipe"
    return 1
  }

  # Trailing class excludes the path characters that would make the hit part of
  # a longer path: `skills/cook/reference/migration.md` is one file, not the
  # `skills/` class.
  for class in 'src/cli/cook\.js' 'skills/([^A-Za-z0-9._/-]|$)' 'agents/([^A-Za-z0-9._/-]|$)'; do
    grep -qE -- "$class" <<<"$recipe" || {
      printf 'the base-directory resolution recipe no longer reaches the payload path class /%s/, so paths in that class resolve by no stated rule:\n%s\n' \
        "$class" "$recipe"
      return 1
    }
  done
}

# ===========================================================================
# task #136: the recipe's scope, locked to the class it carves out
#
# The assertion above locks the recipe's *reach*: which payload classes it
# covers. Nothing locks its *scope*: that project state sits outside it.
# Restoring :48's subject to the unqualified "Every path this skill names" with
# the carve-out deleted leaves tests 19, 20 and 21 green (one home, in SKILL.md;
# every payload class still named; no reference path touched) and reproduces the
# CWE-706 finding recorded in .jeff/tasks/lite-123-2452497030/task.json: a
# `.jeff/memory/` or `.jeff/BACKLOG.md` write sent through the formula lands in
# the installed plugin directory every project shares. Reach fails closed, scope
# fails open, so scope is the half carrying the security weight.
#
# Marker discipline, per the #117 block above: `.jeff/` is a path class token of
# the same kind as `skills/` and `agents/`, and it is matched as a bare class, so
# a member path does not pass for the class. A carve-out names the class it
# excludes in any phrasing, exactly as the recipe names the classes it covers;
# no sentence is pinned. Member tokens could not serve as markers: the whole
# point of this task is that `.jeff/config.json` and the seven paths beside it
# are enumeration a maintainer may legitimately stop naming, while the class
# survives every rewording that keeps the carve-out.
#
# kiss: the extraction is section-scoped and duplicated from the assertion
# above rather than shared, because tests 19-21 are line-cited by three prior
# stations' records. Both readers key on the same `../..` marker and both fail
# closed on an empty section. Fold them into one helper the next time this
# block is touched for its own reasons.
#
# Ceiling: section scope means the carve-out must live in the section that
# states the recipe, which is where it belongs (it is that recipe's complement,
# and "every *other* path" has no referent apart from it). A carve-out moved
# into a section of its own is a false positive here; the upgrade path is to key
# each half off its own token file-wide and drop the section bound.
# ===========================================================================

@test "#136 AC3: the resolution recipe carves out the .jeff/ project-state class" {
  local recipe
  recipe="$(
    awk '
      /^##+ / { if (found) exit; body = ""; next }
      { body = body $0 ORS }
      index($0, "../..") { found = 1 }
      END { if (found) printf "%s", body }
    ' "$REPO/skills/cook/SKILL.md"
  )"

  [ -n "$recipe" ] || {
    echo "no section of skills/cook/SKILL.md states the base-directory resolution recipe"
    return 1
  }

  # Bare class token: `.jeff/config.json` is one file, not the `.jeff/` class.
  grep -qE -- '\.jeff/([^A-Za-z0-9._/-]|$)' <<<"$recipe" || {
    printf 'the section stating the base-directory resolution recipe names no bare `.jeff/` class, so project state is inside the recipe by default and a .jeff/ write resolves into the plugin directory every project shares:\n%s\n' \
      "$recipe"
    return 1
  }
}

# ===========================================================================
# issue #121: one host-observed specialist identity
#
# The role briefs and orchestration skill are shipped runtime payload. These
# checks bind the public return contract, not an implementation detail: every
# host asks specialists for these strict objects, then records the native child
# id it observed separately.
# ===========================================================================

@test "#121 specialist role return contracts omit agent_id" {
  run grep -nH -F '"agent_id"' "$REPO"/agents/cook-*.md
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "#121 orchestration makes the host-observed id authoritative" {
  grep -Ei 'host-observed.*(authoritative|source of truth)' "$REPO/skills/cook/SKILL.md"
  grep -Ei 'specialist.*return.*(omit|does not include).*agent_id' "$REPO/skills/cook/SKILL.md"

  run grep -nEi 'claimed (JSON )?id|claimed `?agent_id|compare[^.]*agent_id' "$REPO/skills/cook/SKILL.md"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# ===========================================================================
# issue #144: `cook <id>` and `cook on <ref>` share the host start route
#
# Seam: the shipped skill is the host router. The checked-JS CLI deliberately
# has no pipeline starter, so CLI execution cannot prove host orchestration.
# These assertions bind the payload decisions a consuming host observes, while
# tests/lite-adopt.bats and tests/gh-issues.bats retain the private pending
# adoption helper's filesystem, idempotency, and failure coverage.
# ===========================================================================

@test "#144 host routing sends both task spellings through one start or resume path" {
  local activation routing shared_row
  activation="$(
    awk '
      /^### Activating jeff/ { in_section = 1 }
      /^### Request routing/ { if (in_section) exit }
      in_section { print }
    ' "$REPO/skills/cook/SKILL.md"
  )"
  routing="$(
    awk '
      /^### Request routing/ { in_section = 1 }
      /^### Lite mode/ { if (in_section) exit }
      in_section { print }
    ' "$REPO/skills/cook/SKILL.md"
  )"

  if grep -qF -- 'cook on <ref>' <<<"$activation"; then
    echo "cook on <ref> is still exposed as activation instead of task start"
    return 1
  fi
  if grep -qiE 'adoptPlan|checked[- ]JS[^.]{0,120}on|on[^.]{0,120}adopt' <<<"$activation"; then
    echo "the private adoption invocation is exposed in activation"
    return 1
  fi

  shared_row="$(grep -E 'cook <(id|ref|taskId)>.*cook on <ref>|cook on <ref>.*cook <(id|ref|taskId)>' <<<"$routing" || true)"
  [ -n "$shared_row" ] || {
    echo "request routing does not place cook <id> and cook on <ref> on one route"
    return 1
  }
  grep -qiE 'pipeline|start|resume' <<<"$shared_row" || {
    echo "the shared route does not start or resume the pipeline"
    return 1
  }
  if grep -qiE 'adopt|register|wiring|private|internal|checked[- ]JS|pending[ -]?only' <<<"$shared_row"; then
    echo "the Chef-facing shared route still presents cook on as adoption-only wiring"
    return 1
  fi
  grep -qiE '(current|recorded)[[:space:]-]*(stage|phase)|(stage|phase)[[:space:]-]*(current|recorded)' <<<"$routing" || {
    echo "request routing does not preserve the ledger's current stage"
    return 1
  }
}

@test "#144 lite host routing names its private adoption seam and preserves outcomes" {
  local section compact seam
  section="$(
    awk '
      /^## Named-task start \+ capture-augments \(lite\)/ { in_section = 1 }
      in_section && /^## / && !/^## Named-task start \+ capture-augments \(lite\)/ { exit }
      in_section { print }
    ' "$REPO/skills/cook/reference/lite-mode.md"
  )"
  [ -n "$section" ]
  compact="$(tr '\n' ' ' <<<"$section")"

  while IFS=';' read -r pattern message; do
    grep -qiE "$pattern" <<<"$compact" || {
      echo "$message"
      return 1
    }
  done <<'CASES'
(local (ledger|task)[^.]{0,180}configured[^.]{0,120}(external|plan store|GitHub)|configured[^.]{0,180}(external|plan store|GitHub)[^.]{0,120}local (ledger|task));lite routing does not state local-first and configured-external resolution together
(private|internal)[^.]{0,120}(idempotent|adopt|wiring)|(idempotent|adopt|wiring)[^.]{0,120}(private|internal);adoption is not private idempotent wiring
(continue|proceed|immediate)[^.]{0,160}(capture|(current|recorded)[[:space:]-]*(stage|phase))|(capture|(current|recorded)[[:space:]-]*(stage|phase))[^.]{0,160}(continue|proceed|immediate);private wiring still stops before the recorded pipeline stage
(neither|no such|missing (local|task))[^.]{0,220}(partial ledger|external mutation|mutating the external)|(partial ledger|external mutation|mutating the external)[^.]{0,220}(neither|no such|missing (local|task));missing task routing does not promise a mutation-free failure
CASES

  seam="$(
    awk '
      BEGIN { RS = ""; ORS = "\n\n" }
      {
        paragraph = tolower($0)
        names_private = paragraph ~ /(private|internal)/
        names_callable = paragraph ~ /adoptplan/ ||
          (paragraph ~ /checked[- ]js/ &&
           paragraph ~ /(^|[^[:alnum:]_])on([^[:alnum:]_]|$)/)
        names_invocation = paragraph ~ /(invoke|call|dispatch|run)/
        if (names_private && names_callable && names_invocation) print
      }
    ' <<<"$section"
  )"
  [ -n "$seam" ] || {
    echo "lite routing does not name a callable private checked-JS on/adoptPlan seam"
    return 1
  }
}

@test "#144 pending adoption remains private while public prose drops adoption-only cook on" {
  local entry record commands
  entry="$(
    awk '
      /^## Entry/ { in_section = 1 }
      /^## The loop/ { if (in_section) exit }
      in_section { print }
    ' "$REPO/skills/cook/SKILL.md"
  )"
  record="$(grep -F -- '**Record future work:**' <<<"$entry" || true)"
  [ -n "$record" ] || {
    echo "Entry no longer defines Record future work"
    return 1
  }
  grep -qiE '(private|internal)[^.]{0,100}(pending[ -]?adoption|adoption)|(pending[ -]?adoption|adoption)[^.]{0,100}(private|internal)' <<<"$record" || {
    echo "Record future work does not use a private pending-adoption mechanism"
    return 1
  }
  if grep -qiE 'cook on|adoptPlan|checked[- ]JS' <<<"$record"; then
    echo "Record future work still presents cook on <ref> as adoption-only control"
    return 1
  fi

  commands="$(
    awk '
      /^## 8\. Commands/ { in_section = 1 }
      /^## 9\. Ambient entry/ { if (in_section) exit }
      in_section { print }
    ' "$REPO/docs/specs/jeff-design.md"
  )"
  if grep -qE '(^|[`,[:space:]])on([`,[:space:]]|$)' <<<"$commands"; then
    echo "the design still lists on as a public CLI command"
    return 1
  fi
  if grep -qF -- 'Adopting a plan: `cook on`' "$REPO/skills/cook/reference/lite-mode.md"; then
    echo "the lite reference still defines cook on as an adoption-only terminal"
    return 1
  fi
  if grep -qF -- 'adopted` from by `cook on <ref>`' "$REPO/skills/cook/reference/jeff-state-schema.md"; then
    echo "the state reference still attributes pending adoption to a public cook on command"
    return 1
  fi
}

@test "#144 README and migration reject adoption-only cook on" {
  local readme_setup readme_use migration route compact section
  local adoption_only='cook on[^.]{0,160}(adopt|register|pending|bookkeeping|not execution|does not start|without start)|(adopt|register|pending|bookkeeping|not execution|does not start|without start)[^.]{0,160}cook on'

  readme_setup="$(
    awk '/^## Set up/ { in_section = 1 } /^## Use/ { if (in_section) exit } in_section { print }' \
      "$REPO/README.md"
  )"
  readme_use="$(
    awk '/^## Use/ { in_section = 1 } in_section && /^## / && !/^## Use/ { exit } in_section { print }' \
      "$REPO/README.md"
  )"
  migration="$(
    awk '
      /^## Compatibility notes/ { in_section = 1 }
      in_section && /^## / && !/^## Compatibility notes/ { exit }
      in_section { print }
    ' "$REPO/skills/cook/reference/migration.md"
  )"
  [ -n "$readme_setup" ]
  [ -n "$readme_use" ]
  [ -n "$migration" ]

  route="$(grep -Ei 'cook <(id|ref)>.*cook on <(id|ref)>|cook on <(id|ref)>.*cook <(id|ref)>' <<<"$readme_use" || true)"
  grep -qiE '(equivalent|same|either)' <<<"$route" || {
    echo "README Use does not present both cook forms as the same start route"
    return 1
  }
  grep -qiE 'start|resume' <<<"$route" || {
    echo "README Use does not identify the shared route as start or resume"
    return 1
  }

  compact="$(tr '\n' ' ' <<<"$migration")"
  grep -qiE 'string ids?[^.]{0,160}lite ledgers?[^.]{0,120}external tasks?|external tasks?[^.]{0,160}lite ledgers?[^.]{0,120}string ids?' <<<"$compact" || {
    echo "migration compatibility notes no longer tie lite string ids to external tasks"
    return 1
  }
  for section in "$readme_setup" "$readme_use" "$migration"; do
    compact="$(tr '\n' ' ' <<<"$section")"
    if grep -qiE "$adoption_only" <<<"$compact"; then
      echo "an operator-facing owning section still ties cook on to adoption-only behavior"
      return 1
    fi
  done
}

# ---------------------------------------------------------------------------
# task #153: all source-bound refutes fan out concurrently
#
# The shipped dispatch skill is the orchestrator contract. This assertion
# requires the complete rule without pinning its exact sentence.
# ---------------------------------------------------------------------------

@test "#153 cook dispatches all per-finding refutes concurrently and records any order" {
  local rule
  rule="$(awk '/^\*\*Parallel refutes\.\*\*/ { in_rule = 1 } in_rule && /^[[:space:]]*$/ { exit } in_rule { print }' "$REPO/skills/cook/SKILL.md")"
  [ -n "$rule" ] || {
    echo "cook SKILL.md has no Parallel refutes rule"
    return 1
  }
  grep -qiE 'all[^.]*refute[^.]*concurrent|concurrent[^.]*all[^.]*refute' <<<"$rule" || {
    echo "Parallel refutes does not dispatch all refutes concurrently"
    return 1
  }
  grep -qiE 'source[-[:space:]]bound|bound[^.]{0,80}(source|judgment)|tied[^.]{0,80}(source|judgment)' <<<"$rule" || {
    echo "Parallel refutes does not bind each refute to its judgment source"
    return 1
  }
  grep -qiE 'fresh|new[^.]{0,60}(specialist|context)|(specialist|context)[^.]{0,60}new' <<<"$rule" || {
    echo "Parallel refutes does not require fresh specialists"
    return 1
  }
  grep -qiE 'blind|unaware[^.]{0,80}(other|remaining)|without[^.]{0,40}(seeing|access|knowledge)[^.]{0,80}(other|remaining)|(brief|show|giv|receiv|expos|access)[[:alpha:]]*[^.]{0,80}(only|exactly)[^.]{0,60}(assigned|its|one)[^.]{0,30}finding' <<<"$rule" || {
    echo "Parallel refutes does not keep specialists blind to other findings"
    return 1
  }
  grep -qiE 'one[^.]*per[^.]*finding' <<<"$rule" || {
    echo "Parallel refutes does not preserve one specialist per finding"
    return 1
  }
  grep -qiE '(record|return)[^.]*any order|order[^.]*irrelevant' <<<"$rule" || {
    echo "Parallel refutes does not make recording order irrelevant"
    return 1
  }
}

# ---------------------------------------------------------------------------
# Graph slate Item 2: optional facts-only context packets
# ---------------------------------------------------------------------------

list_context_packet_consumers() {
  cat <<'CONSUMERS'
implement|agents/cook-implement.md
refactor|agents/cook-refactor.md
review|agents/cook-review.md
audit|agents/cook-audit.md
refute|agents/cook-refute.md
council|
CONSUMERS
}

context_packet_dispatch_rule() {
  awk '
    /^\*\*Context packets\.\*\*/ { in_rule = 1 }
    in_rule && /^[[:space:]]*$/ { exit }
    in_rule { print }
  ' "$REPO/skills/cook/SKILL.md"
}

@test "Item 2: plan owns the initial facts-only packet and its task scope" {
  local file="$REPO/agents/cook-plan.md"
  local compact
  compact="$(tr '\n' ' ' <"$file")"

  grep -qF 'context.md' <<<"$compact" || {
    echo "cook-plan.md does not name context.md"
    return 1
  }
  grep -qiE '(create|write|author)[^.]{0,100}initial[^.]{0,100}context\.md|initial[^.]{0,100}context\.md[^.]{0,100}(create|write|author)' <<<"$compact" || {
    echo "cook-plan.md does not make plan the initial context.md author"
    return 1
  }
  grep -qiE 'plan[^.]{0,100}owns?[^.]{0,80}task scope|task scope[^.]{0,100}(owned|belongs)[^.]{0,80}plan' <<<"$compact" || {
    echo "cook-plan.md does not make plan the context packet task-scope owner"
    return 1
  }
  grep -qiE 'refresh[^.]{0,100}(whenever|every time)[^.]{0,80}plan[^.]{0,40}re[- ]?enters|plan[^.]{0,40}re[- ]?enters[^.]{0,100}refresh' <<<"$compact" || {
    echo "cook-plan.md does not refresh context.md whenever plan re-enters"
    return 1
  }
  grep -qiE 'facts[- ]only' <<<"$compact" || {
    echo "cook-plan.md does not require facts-only content"
    return 1
  }

  local required
  for required in \
    'relevant (files|paths)' \
    'path[^.]{0,60}role|role[^.]{0,60}path' \
    'file:line' \
    'exact[^.]{0,80}targeted[- ]test|targeted[- ]test[^.]{0,80}exact' \
    'build/run' \
    'mechanical constraints?' \
    'hypotheses?' \
    'root[- ]cause' \
    'suggested fixes' \
    'verdicts?' \
    'opinions?'; do
    grep -qiE "$required" <<<"$compact" || {
      echo "cook-plan.md context packet contract is missing binding token: $required"
      return 1
    }
  done

  grep -qiE 'conclusions?[^.]{0,100}notes\.md|notes\.md[^.]{0,100}conclusions?' <<<"$compact" || {
    echo "cook-plan.md does not keep conclusions in notes.md"
    return 1
  }
}

@test "Item 2: downstream dispatch carries the bounded caveat without packet reconstruction" {
  local caveat='a map, not an authority: use it to skip discovery; verify only entries you rely on; correct stale facts if writable, otherwise report them.'
  local rule stage
  rule="$(context_packet_dispatch_rule)"

  grep -qF "$caveat" <<<"$rule" || {
    echo "cook SKILL.md does not carry the exact bounded-verification caveat"
    return 1
  }
  grep -qF 'context.md' <<<"$rule" || {
    echo "the context packet dispatch rule does not name context.md"
    return 1
  }
  grep -qiE 'when present|if (the )?file exists' <<<"$rule" || {
    echo "the context packet dispatch rule does not preserve optional absence"
    return 1
  }
  grep -qiE '(never|do not|must not)[^.]{0,120}(independently[[:space:]]+)?(reconstruct|rebuild)[^.]{0,80}(packet|context\.md)|(packet|context\.md)[^.]{0,80}(never|do not|must not)[^.]{0,120}(reconstruct|rebuild)' <<<"$rule" || {
    echo "the context packet dispatch rule does not forbid whole-packet reconstruction"
    return 1
  }

  while IFS='|' read -r stage _; do
    grep -qiE "(^|[^[:alnum:]_-])$stage([^[:alnum:]_-]|$)" <<<"$rule" || {
      echo "the context packet dispatch rule omits the $stage consumer"
      return 1
    }
  done < <(list_context_packet_consumers)
}

@test "Item 2: implement and refactor maintain only facts encountered in assigned work" {
  local rule
  rule="$(context_packet_dispatch_rule)"

  grep -qiE 'implement[^.]{0,80}refactor|refactor[^.]{0,80}implement' <<<"$rule" || {
    echo "the context packet rule does not group implement and refactor as writable consumers"
    return 1
  }
  grep -qiE '(maintain|correct|update)[^.]{0,100}(entries|facts)|(entries|facts)[^.]{0,100}(maintain|correct|update)' <<<"$rule" || {
    echo "writable consumers are not required to maintain context packet facts"
    return 1
  }
  local required
  for required in 'direct(ly)?' 'verif' 'invalidat' 'creat' 'mov'; do
    grep -qiE "$required" <<<"$rule" || {
      echo "writable context maintenance is missing binding token: $required"
      return 1
    }
  done
  grep -qiE '(assigned|task[- ]scoped)[^.]{0,80}(work|code changes?)|(work|code changes?)[^.]{0,80}(assigned|task[- ]scoped)' <<<"$rule" || {
    echo "writable context maintenance is not limited to assigned code work"
    return 1
  }
  grep -qiE '(may not|must not|do not|never)[^.]{0,80}(expand|widen)[^.]{0,40}(task )?scope' <<<"$rule" || {
    echo "writable context maintenance does not forbid task-scope expansion"
    return 1
  }
  grep -qiE '(may not|must not|do not|never)[^.]{0,80}(add|write)[^.]{0,40}conclusions?' <<<"$rule" || {
    echo "writable context maintenance does not forbid conclusions"
    return 1
  }
}

@test "Item 2: review audit refute and council report stale facts read-only" {
  local rule stage
  rule="$(context_packet_dispatch_rule)"

  for stage in review audit refute council; do
    grep -qiE "(^|[^[:alnum:]_-])$stage([^[:alnum:]_-]|$)" <<<"$rule" || {
      echo "the read-only context packet rule omits $stage"
      return 1
    }
  done
  grep -qiE 'read[- ]only' <<<"$rule" || {
    echo "judgment consumers are not explicitly read-only for context.md"
    return 1
  }
  grep -qiE 'report[^.]{0,80}stale[^.]{0,80}(entries|facts)|(stale[^.]{0,80}(entries|facts)[^.]{0,80}report)' <<<"$rule" || {
    echo "read-only consumers are not required to report stale context facts"
    return 1
  }
  grep -qiE 'existing[^.]{0,60}return[^.]{0,60}evidence|evidence[^.]{0,60}existing[^.]{0,60}return' <<<"$rule" || {
    echo "stale context reporting is not routed through existing return evidence"
    return 1
  }
}

@test "Item 2: each file-backed consumer declares the bounded optional map input" {
  local stage relative file paragraph required
  while IFS='|' read -r stage relative; do
    [ -n "$relative" ] || continue
    file="$REPO/$relative"
    paragraph="$(awk '
      BEGIN { RS = ""; ORS = "\n" }
      index($0, "context.md") { print; found = 1 }
      END { if (!found) exit 1 }
    ' "$file")" || {
      echo "$relative does not declare context.md as an input"
      return 1
    }

    for required in \
      'optional' \
      'facts[- ]only' \
      'plan' \
      'skip discovery' \
      'verify only[^.]{0,80}(entries|facts)[^.]{0,80}rely' \
      'encounter'; do
      grep -qiE "$required" <<<"$paragraph" || {
        echo "$relative context.md input is missing binding token: $required"
        return 1
      }
    done
  done < <(list_context_packet_consumers)
}

@test "Item 2: on-disk layout documents the context packet" {
  local section
  section="$(awk '
    /^## On-disk layout$/ { in_section = 1; next }
    in_section && /^## / { exit }
    in_section { print }
  ' "$REPO/skills/cook/reference/jeff-state-schema.md")"

  grep -qE '\.jeff/tasks/<[^>]+>/context\.md' <<<"$section" || {
    echo "jeff-state-schema.md on-disk layout does not name task context.md"
    return 1
  }
}

# ---------------------------------------------------------------------------
# Graph slate Item 5: evidence-scaled escalation
#
# The bonus cycle and the follow-up ledger are routed by SKILL.md sections
# Kickbacks and Council; the judgment briefs name the ledger as the follow-up
# destination.  Legality itself lives in src/core/ and is covered there.
# ---------------------------------------------------------------------------

skill_section() {
  awk -v heading="$1" '
    $0 ~ heading { in_section = 1; next }
    in_section && /^#{2,3} / { exit }
    in_section { print }
  ' "$REPO/skills/cook/SKILL.md"
}

section_paragraphs() {
  awk -v token="$1" 'BEGIN { RS = ""; ORS = "\n\n" } tolower($0) ~ tolower(token) { print }'
}

@test "Item 5: SKILL.md Kickbacks carries the evidence-scaled bonus cycle" {
  local section rule required
  section="$(skill_section '^## Kickbacks$')"
  [ -n "$section" ] || {
    echo "cook SKILL.md has no Kickbacks section"
    return 1
  }
  rule="$(section_paragraphs 'bonus' <<<"$section")"
  [ -n "$rule" ] || {
    echo "SKILL.md Kickbacks carries no bonus-cycle rule"
    return 1
  }

  for required in \
    'cap \+ 1|cap plus one|one extra cycle|one bonus cycle|one additional cycle' \
    'exactly once|only once|once per source' \
    'implement' \
    'refactor' \
    'smaller|fewer|shrink' \
    'confined' \
    'council' \
    'unconditional'; do
    grep -qiE "$required" <<<"$rule" || {
      echo "SKILL.md Kickbacks bonus rule is missing binding token: $required"
      return 1
    }
  done
}

@test "Item 5: SKILL.md Kickbacks routes ordinary follow-ups to the ledger" {
  local section rule
  section="$(skill_section '^## Kickbacks$')"
  rule="$(section_paragraphs 'FOLLOWUPS.md' <<<"$section")"
  [ -n "$rule" ] || {
    echo "SKILL.md Kickbacks does not name .jeff/FOLLOWUPS.md"
    return 1
  }

  grep -qF '.jeff/FOLLOWUPS.md' <<<"$rule" || {
    echo "SKILL.md Kickbacks names the ledger without its .jeff/ path"
    return 1
  }
  grep -qiE 'one line|a single line' <<<"$rule" || {
    echo "SKILL.md Kickbacks does not cost a follow-up one ledger line"
    return 1
  }
  grep -qiE 'graduat|promot' <<<"$rule" || {
    echo "SKILL.md Kickbacks does not describe follow-up graduation"
    return 1
  }
  grep -qiE 'operator' <<<"$rule" || {
    echo "SKILL.md Kickbacks does not gate graduation on the operator"
    return 1
  }
  grep -qiE 'tracked backlog task' <<<"$section" && {
    echo "SKILL.md Kickbacks still charges a follow-up a tracked backlog task"
    return 1
  }
  return 0
}

@test "Item 5: SKILL.md owns the exact follow-up ledger line format" {
  grep -qF -- '- [ ] task <id> · <file>:<line> · <what> (<source>, <YYYY-MM-DD>)' "$REPO/skills/cook/SKILL.md" || {
    echo "cook SKILL.md does not carry the exact .jeff/FOLLOWUPS.md line format"
    return 1
  }
}

@test "Item 5: SKILL.md Council permits demoting a finding to the ledger" {
  local section
  section="$(skill_section '^### Council')"
  [ -n "$section" ] || {
    echo "cook SKILL.md has no Council section"
    return 1
  }

  grep -qF 'followupTaskId' <<<"$section" || {
    echo "SKILL.md Council does not name followupTaskId"
    return 1
  }
  grep -qE '["`'"'"']ledger["`'"'"']' <<<"$section" || {
    echo "SKILL.md Council does not permit the literal ledger demotion target"
    return 1
  }
  grep -qiE 'task id' <<<"$section" || {
    echo "SKILL.md Council drops the existing task-id demotion target"
    return 1
  }
}

@test "Item 5: review and audit briefs send follow-ups to the ledger" {
  local relative line
  for relative in agents/cook-review.md agents/cook-audit.md; do
    line="$(grep -F '**Follow-up**' "$REPO/$relative")" || {
      echo "$relative has no follow-up classification line"
      return 1
    }
    grep -qF '.jeff/FOLLOWUPS.md' <<<"$line" || {
      echo "$relative follow-up line does not name .jeff/FOLLOWUPS.md"
      return 1
    }
    grep -qiE 'tracked backlog task' <<<"$line" && {
      echo "$relative follow-up line still promises a tracked backlog task"
      return 1
    }
    grep -qiE 'never blocks' <<<"$line" || {
      echo "$relative follow-up line no longer keeps follow-ups non-blocking"
      return 1
    }
  done
}

# ---------------------------------------------------------------------------
# Graph slate Item 6: capture and plan decomposition guidance
# ---------------------------------------------------------------------------

@test "Item 6: capture applies the fake-edge decomposition test" {
  local row rule required
  row="$(awk '$0 ~ /^\| `capture` \|/ { print; exit }' "$REPO/skills/cook/SKILL.md")"
  [ -n "$row" ] || {
    echo "cook SKILL.md has no capture stage row"
    return 1
  }
  grep -qiE 'fake[- ]edge' <<<"$row" || {
    echo "the capture stage row does not name the fake-edge test"
    return 1
  }

  rule="$(awk '
    BEGIN { RS = ""; ORS = "\n\n" }
    tolower($0) ~ /fake[- ]edge/ && $0 !~ /^\|/ { print }
  ' "$REPO/skills/cook/SKILL.md")"
  [ -n "$rule" ] || {
    echo "cook SKILL.md has no capture decomposition paragraph"
    return 1
  }

  for required in \
    'two or more|multiple' \
    'independently shippable' \
    'separate tasks' \
    'deps?[^.]{0,100}genuine(ly)?[^.]{0,80}consum' \
    'several simple tasks|multiple simple tasks' \
    'acceptance criteria' \
    'independent seams' \
    'guidance[^.]{0,60}not a gate|not a gate'; do
    grep -qiE "$required" <<<"$rule" || {
      echo "capture decomposition guidance is missing binding behavior: $required"
      return 1
    }
  done
}

@test "Item 6: plan escalates independently shippable splits through the existing shape" {
  local role rule
  role="$REPO/agents/cook-plan.md"
  rule="$(awk '
    BEGIN { RS = ""; ORS = "\n\n" }
    tolower($0) ~ /independently shippable/ { print }
  ' "$role")"
  [ -n "$rule" ] || {
    echo "cook-plan.md has no independently shippable split rule"
    return 1
  }

  grep -qiE 'planning|plan' <<<"$rule" || {
    echo "the split rule is not bound to planning"
    return 1
  }
  grep -qiE 'existing[^.]{0,80}escalation|escalation[^.]{0,80}existing' <<<"$rule" || {
    echo "the split rule does not reuse the existing escalation shape"
    return 1
  }
  grep -qiE 'fork[^.]{0,100}(proposed split|split proposal)|(proposed split|split proposal)[^.]{0,100}fork' <<<"$rule" || {
    echo "the escalation fork does not name the proposed split"
    return 1
  }
  grep -qF '"stage":"plan","result":"escalation"' "$role" || {
    echo "cook-plan.md no longer carries the existing plan escalation result"
    return 1
  }
  grep -qE '"slices":.*"escalation":.*"fork":.*"options"' "$role" || {
    echo "cook-plan.md no longer carries the existing escalation fields"
    return 1
  }
}

# ===========================================================================
# issue #199: the assess→fork gate routes by consequence and expected lifetime
#
# Seam: unchanged from the #117 block above. The payload prose IS the product.
# skills/cook/SKILL.md loads in full on every invocation, and the checked-JS CLI
# deliberately owns no entry gate (tests/command-routing.bats covers what the CLI
# does route), so the rule a consuming host obeys when it decides whether work
# enters the tracked pipeline is observable in exactly one place: this shipped
# file. There is no second seam these assertions shadow.
#
# Marker discipline, per the #117 block above: every marker below is a route
# identifier the rest of the payload already references (`A. Ad-hoc minimal
# ship`, `B.`, `C.`), a classification axis this gate introduces as vocabulary
# (`consequence`, `lifetime`), a named member of the risk-floor set, or a
# worked-example class noun. None pins a sentence a maintainer may legitimately
# rephrase: every proximity assertion is bounded by `[^.]`, so it holds within
# one sentence in any wording, and every enumeration is matched case-insensitively
# on its stem.
#
# The floor set is asserted member by member because it is the safety carve-out.
# A member silently dropped from it routes security-sensitive, user-data, or
# irreversible work down the ad-hoc path with no specialist and no audit, which
# is the one failure mode of this change that costs more than the friction it
# removes. Each member is therefore bound to the floor sentence by the same
# `floor[^.]{0,240}` proximity idiom the rest of this block uses, never grepped
# loose over the whole gate: several members are common words that also occur in
# unrelated Entry prose (the recommendation bias carries "release-shaped"), so a
# loose stem would keep passing after the member was deleted from the floor set.
# ===========================================================================

entry_gate() {
  skill_section '^## Entry$' | tr '\n' ' '
}

# The gate minus its A/B/C option rows. Those rows already carry "Ad-hoc minimal
# ship" and "no fake pipeline", so an assertion about what the routing prose
# states must not be satisfiable by a table that disposable work no longer sees.
entry_gate_prose() {
  skill_section '^## Entry$' | grep -v '^|' | tr '\n' ' '
}

@test "#199 AC1: the Entry gate classifies on consequence and expected lifetime before the first durable write" {
  local gate
  gate="$(entry_gate)"
  [ -n "$gate" ] || {
    echo "cook SKILL.md has no Entry section"
    return 1
  }

  grep -qiE 'consequence[^.]{0,240}lifetime|lifetime[^.]{0,240}consequence' <<<"$gate" || {
    echo "the Entry gate does not classify work on both axes together; a route picked from consequence alone or lifetime alone is not the classification this gate owes"
    return 1
  }
  grep -qiE '(classif|classification)[^.]{0,200}before[^.]{0,140}durable write|before[^.]{0,140}durable write[^.]{0,200}(classif|classification)' <<<"$gate" || {
    echo "the Entry gate does not place the classification before the first durable write, so the route is chosen after the write it was meant to govern"
    return 1
  }
  grep -qiE '(state|stated|states|announce|say|report)[^.]{0,200}reason|reason[^.]{0,200}(state|stated|states|announce|say|report)' <<<"$gate" || {
    echo "the Entry gate does not surface the classification and its reason at the routing moment; an implicit classification is one the operator cannot correct"
    return 1
  }
}

@test "#199 AC2: disposable work takes route A with no blocking stop, ahead of the structural signals" {
  local gate
  gate="$(entry_gate)"
  [ -n "$gate" ] || {
    echo "cook SKILL.md has no Entry section"
    return 1
  }

  grep -qiE 'disposable[^.]{0,240}(\*\*A\*\*|route A|option A|path A|ad-?hoc minimal ship)|(\*\*A\*\*|route A|option A|path A|ad-?hoc minimal ship)[^.]{0,240}disposable' <<<"$gate" || {
    echo "the Entry gate does not route disposable work to the existing A. Ad-hoc minimal ship treatment"
    return 1
  }
  grep -qiE 'disposable[^.]{0,240}(does not|do not|never|without|no)[^.]{0,160}(stop|pause|ask|question|interrupt)|(does not|do not|never|without|no)[^.]{0,160}(stop|pause|ask|question|interrupt)[^.]{0,240}disposable' <<<"$gate" || {
    echo "the Entry gate still opens the A/B/C question for disposable work; an interrupt per disposable artifact is the friction this change exists to remove"
    return 1
  }
  grep -qiE '(even (when|if|where)|regardless of|overrid|takes precedence)[^.]{0,240}(structural|multi[- ]file|cross[- ]cutting|pause signal)|(structural|multi[- ]file|cross[- ]cutting|pause signal)[^.]{0,240}(even (when|if|where)|regardless of|overrid|takes precedence)' <<<"$gate" || {
    echo "the Entry gate does not hold the disposable classification when a structural pause signal fires, so a multi-file throwaway collector still routes like shipped payload"
    return 1
  }
}

@test "#199 AC3: a named risk floor overrides a lighter classification and restores the ordinary pause" {
  local gate member label
  gate="$(entry_gate)"
  [ -n "$gate" ] || {
    echo "cook SKILL.md has no Entry section"
    return 1
  }

  while IFS='|' read -r member label; do
    grep -qiE -- "floor[^.]{0,240}$member|$member[^.]{0,240}floor" <<<"$gate" || {
      echo "the Entry gate's floor sentence does not name $label; work on that boundary would route by classification alone, with no restored pause and no specialist"
      return 1
    }
  done <<'FLOORS'
production behavio|production behavior
user data|user data
security boundar|security boundaries
accessibilit|accessibility basics
irreversible|irreversible state
shared state|shared state
release|releases
build|durable build infrastructure
deploy|durable deploy infrastructure
FLOORS

  grep -qiE 'floor[^.]{0,240}(overrid|always|beats?|wins?|trumps?)|(overrid|always)[^.]{0,240}floor' <<<"$gate" || {
    echo "the Entry gate does not make a risk floor override a lighter classification; a floor that only advises is not a floor"
    return 1
  }
  grep -qiE 'floor[^.]{0,240}(restore|ordinary pause|pause|stop|full)|(restore|ordinary pause)[^.]{0,240}floor' <<<"$gate" || {
    echo "the Entry gate does not restore the ordinary pause on a floor hit"
    return 1
  }
}

@test "#199 AC4: the assess-to-fork options table still offers exactly the three existing routes" {
  local rows count option
  rows="$(skill_section '^## Entry$' | grep '^| \*\*' || true)"
  count="$(printf '%s\n' "$rows" | grep -c . || true)"

  [ "$count" -eq 3 ] || {
    printf 'the assess-to-fork options table must keep its three-route shape; a fourth route is one every downstream validator, kickback and done-gate path would have to learn. Found %s option row(s):\n%s\n' \
      "$count" "$rows"
    return 1
  }
  for option in 'A. Ad-hoc minimal ship' 'B. Record pending' 'C. Record + start capture'; do
    printf '%s\n' "$rows" | grep -qF -- "$option" || {
      printf 'the assess-to-fork options table no longer offers "%s":\n%s\n' "$option" "$rows"
      return 1
    }
  done
}

@test "#199 AC5: work promotes on growth, and the no-downgrade rule lives where recovery is governed" {
  local gate kickbacks
  local downgrade='(re-?classif|downgrad|downward|demot)[^.]{0,240}(failed check|blocking finding)|(failed check|blocking finding)[^.]{0,240}(re-?classif|downgrad|downward|demot)'
  gate="$(entry_gate)"
  kickbacks="$(skill_section '^## Kickbacks$' | tr '\n' ' ')"
  [ -n "$gate" ] || {
    echo "cook SKILL.md has no Entry section"
    return 1
  }
  [ -n "$kickbacks" ] || {
    echo "cook SKILL.md has no Kickbacks section"
    return 1
  }

  grep -qiE '(promot|escalat|graduat|move up)[^.]{0,240}(lifetime|blast radius)|(lifetime|blast radius)[^.]{0,240}(promot|escalat|graduat|move up)' <<<"$gate" || {
    echo "the Entry gate does not promote work to the full path as its lifetime or blast radius grows; classification with no upward path is a one-way discount"
    return 1
  }
  grep -qiE "$downgrade" <<<"$kickbacks" || {
    echo "SKILL.md Kickbacks does not forbid re-classifying tracked work downward to escape a failed check or a blocking finding; recovery is the branch where that rule has to be reachable"
    return 1
  }
  if grep -qiE "$downgrade" <<<"$gate"; then
    echo "the no-downgrade rule has a second home in the Entry gate; it governs work already inside the pipeline, and a duplicate is a line every invocation pays to load"
    return 1
  fi
}

@test "#199 AC6: worked examples pin routing in both directions" {
  local gate token label
  gate="$(entry_gate)"
  [ -n "$gate" ] || {
    echo "cook SKILL.md has no Entry section"
    return 1
  }

  while IFS='|' read -r token label; do
    grep -qiE "disposable[^.]{0,240}$token|$token[^.]{0,240}disposable" <<<"$gate" || {
      echo "the Entry gate does not pin $label to the disposable side of the routing decision"
      return 1
    }
  done <<'LIGHT'
experiment|a throwaway experiment
comparison|a comparison
evidence[- ]collector|a local evidence collector
one-off|a one-off helper
LIGHT

  grep -qiE 'floor[^.]{0,240}migration|migration[^.]{0,240}floor' <<<"$gate" || {
    echo "the Entry gate does not pin data migration to the risk-floor side; the floor-side examples are what keep a lighter classification away from user data"
    return 1
  }
}

@test "#199 AC7: auto-routed work is named ad-hoc and never presented as pipeline-verified" {
  local prose
  prose="$(entry_gate_prose)"
  [ -n "$prose" ] || {
    echo "cook SKILL.md has no Entry section"
    return 1
  }

  grep -qiE 'ad-?hoc' <<<"$prose" || {
    echo "the Entry gate's routing prose never names the lighter route as ad-hoc; disposable work no longer sees the options table, so the table is not where the operator learns what they got"
    return 1
  }
  grep -qiE 'ad-?hoc[^.]{0,240}(not|never|no)[^.]{0,160}(verif|pipeline|tracked|specialist|review)|(not|never|no)[^.]{0,160}(verif|pipeline|tracked|specialist)[^.]{0,240}ad-?hoc' <<<"$prose" || {
    echo "the Entry gate does not disclaim ad-hoc work as unverified by the pipeline; silently skipping the brigade and calling the result checked is the dishonest failure mode"
    return 1
  }
}

@test "#199 AC8: the always-loaded cook SKILL.md stays inside its budget, with no new section or reference file" {
  # Budget derivation (plan, issue #199): 281 lines at task entry, plus the ~12
  # lines of gate prose the eight criteria require, plus 2 lines of slack = 295.
  # A new `##` section or a new reference file costs several times that and is
  # what the budget exists to refuse, so both are bounded at their entry counts.
  #
  # This is a bound, not a restated literal: skills/cook/SKILL.md loads in full
  # on every invocation, so its size is a cost every consuming host pays.
  #
  # kiss: a file-wide line bound couples this assertion to every other task that
  # edits SKILL.md, which is the intent while #118, #125 and #130 are open on
  # trimming this same payload. If that coupling outlives them, re-express the
  # bound over the Entry section alone.
  local budget=295 max_sections=11 max_references=6 lines sections references
  lines="$(grep -c '' "$REPO/skills/cook/SKILL.md")"
  [ "$lines" -le "$budget" ] || {
    echo "skills/cook/SKILL.md is $lines lines, over its $budget-line budget; it loads in full on every invocation"
    return 1
  }

  sections="$(grep -c '^## ' "$REPO/skills/cook/SKILL.md")"
  [ "$sections" -le "$max_sections" ] || {
    echo "skills/cook/SKILL.md grew to $sections top-level sections from $max_sections; this change is prose inside the existing gate, not a new section"
    return 1
  }

  references="$(ls -1 "$REPO"/skills/cook/reference/*.md | grep -c .)"
  [ "$references" -le "$max_references" ] || {
    echo "skills/cook/reference/ grew to $references files from $max_references; this change is prose inside the existing gate, not a new reference file"
    return 1
  }
}