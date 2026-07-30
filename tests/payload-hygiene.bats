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
# with Read, Grep, Glob and no skill loader, so it reaches a bundled skill only
# through a path its own role file names, resolved against the absolute form
# the brief supplies.
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
