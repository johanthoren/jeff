#!/usr/bin/env bash
#
# cook: Jeff v1-lean CLI.
#
# Subcommands:
#   validate         Check .jeff state against the schema + philosophy invariants.
#   verify           Run the configured test command (full-suite gate); log the verdict.
#   baseline check   Is <hash> (default HEAD) a known green+clean baseline in the run log?
#   ls               List tasks (id, status, stage, priority, title).
#   status           Show in-flight task(s) + backlog health.
#   show <id>        Print one task's task.json.
#   doctor           Check the environment (jq) and report.
#   init             Activate jeff here: scaffold .jeff/ + mark active.
#   help             This help.
#
# The validator is the mechanical backstop: it guarantees separation + completeness
# are real (it cannot judge whether a spec is good or a review thorough).
# Invariants: see docs/specs/2026-06-13-jeff-v1-lean-schema.md:
#   1. test author != implementer
#   2. implementer != reviewer
#   4. no status=done without (non-implementer tests green + review pass + audit pass|na).
#       tests.green is boolean true (a real green gate) OR the string "na" (task
#       0049's None/terminal disposition: a declarative AC with no consumer-
#       observable behavior to test). The "na" state requires non-empty
#       tests.evidence (the cited justification) + review.verdict==pass, and has
#       no test author. Only the literal "na" is accepted; false stays refused.
#   [gate]. when a done task records tests.gate, it must be green+clean with a
#       non-empty gated hash, and tests.green must be backed by gate.green
#       (task 0044). NULL-TOLERANT: tests.gate absent ⇒ skipped (legacy done
#       tasks keep validating). Recorded at the gate run via `cook verify`.
#   5. deps reference existing tasks; no cycles
#   6. task.json schema-valid (required fields, enums)
#   7..11. convergence block (OPTIONAL; absent ⇒ skipped): cap/counter range,
#          council distinctness (K=3 lenses, distinct from reviewer/implementer),
#          per-finding ≥2-majority determinism, follow-up tracking, block/done-gate.

set -euo pipefail

ROOT="${COOK_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
BK="$ROOT/.jeff"

die()  { printf 'cook: %s\n' "$*" >&2; exit 1; }
warn() { printf 'cook: %s\n' "$*" >&2; }

# reject_unknown_args <label> [args…]: fail closed if any argument remains.
# Used by the zero-arg verbs at the TOP of the command, BEFORE any side effect,
# so a stray flag/positional can never trigger activation or mutation (AC2/AC3).
# Names the first offending token per the AC6 idioms: dash-prefixed tokens are
# reported as "unknown option '--X'", anything else as "unexpected argument 'X'".
# Arg errors stay on die (exit 1): never routed through require_jq's exit 3.
reject_unknown_args() {
  local label="$1"; shift
  [ "$#" -eq 0 ] && return 0
  case "$1" in
    -*) die "$label: unknown option '$1'" ;;
    *)  die "$label: unexpected argument '$1'" ;;
  esac
}

# Echo the active mode: "lite" iff .jeff/config.json carries .mode == "lite";
# "full" otherwise (field absent, file absent, or any non-"lite" value). Existing
# full-mode stores have no .mode, so they read as "full" and validate byte-
# identically to today (back-compat). Reads with jq when present; degrades to
# "full" if jq is missing or the config is unparseable (fail back to the strict
# full-mode validator rather than silently dropping registry invariants).
bake_mode() {
  if [ -f "$BK/config.json" ] && command -v jq >/dev/null 2>&1 \
     && [ "$(jq -r '.mode // empty' "$BK/config.json" 2>/dev/null)" = "lite" ]; then
    printf 'lite'
  else
    printf 'full'
  fi
}

# Echo the effective voice flavor: one word, "kitchen" or "plain". Precedence:
# per-repo .jeff/config.json .flavor > JEFF_FLAVOR env > built-in default (kitchen).
# The live-request tier (an in-conversation instruction) is a model-level override
# applied on top of this answer, not a CLI concern. Reads the per-repo value with a
# NULL-ONLY guard, NOT `jq -r '.flavor // empty'`: jq's `//` treats a JSON `false`
# as absent, which would let a per-repo `flavor:false` fall through to env/default
# and break the override. The null-only form keeps a real `false` (mapping it to
# "plain") and lets only absent/null fall through. Degrades like bake_mode (no jq,
# no config, or an unparseable config => env/default; never hard-fails). A present,
# parseable, known per-repo value maps directly; absent/null/empty/malformed
# degrades to JEFF_FLAVOR then the kitchen default. Mapping at the case below:
# true|kitchen -> kitchen; any other non-empty token (false, unknown) -> plain.
cmd_flavor() {
  reject_unknown_args flavor "$@"
  local raw=""
  if [ -f "$BK/config.json" ] && command -v jq >/dev/null 2>&1; then
    raw="$(jq -r 'if .flavor == null then empty else .flavor end' "$BK/config.json" 2>/dev/null || true)"
  fi
  # No per-repo value (absent/null/jq-less): fall to the env, defaulting to kitchen.
  [ -n "$raw" ] || raw="${JEFF_FLAVOR:-kitchen}"
  case "$raw" in
    true|kitchen) printf 'kitchen\n' ;;
    *)            printf 'plain\n' ;;
  esac
}

# Gate a lite-only subcommand: `die` (non-zero) unless the store is in lite mode.
# Args: <cmd> = the subcommand word (e.g. "indiff"); <reason> = the why-full-
# mode-differs clause shown in parentheses. Centralizes the one canonical refusal
# message so every lite-only command refuses identically. Call at the top of the
# command, before any work.
require_lite() {
  [ "$(bake_mode)" = "lite" ] \
    || die "\`cook $1\` is a lite-mode command; run \`cook lite\` first ($2)."
}

require_jq() {
  if command -v jq >/dev/null 2>&1; then return 0; fi
  cat >&2 <<'EOF'
cook: `jq` is required but was not found on PATH.
Install it, then retry:
  macOS:          brew install jq
  Debian/Ubuntu:  sudo apt-get install -y jq
  Fedora/RHEL:    sudo dnf install -y jq
  Alpine:         sudo apk add jq
EOF
  exit 3
}

# Emit a JSON array of every task.json (each augmented with _dir), sorted by
# path, or [] if none. Returns non-zero (fail CLOSED) if ANY task.json is
# unparseable, so cmd_validate's rc check `die`s instead of treating a corrupt
# store as empty/clean.
#
# The list is read via process substitution (`< <(find … | sort)`), NOT a
# `find | sort | {…}` pipe: a pipe runs the loop in a subshell whose exit status
# is its trailing `printf ']'` (always 0), masking a per-file `jq` failure (the
# original fail-open bug). Reading via `< <(…)` keeps the loop in this function's
# own scope, so a per-file failure's `return 1` actually aborts collect_tasks.
collect_tasks() {
  local f out="" obj _rc
  if [ -d "$BK/tasks" ]; then
    while IFS= read -r f; do
      # One jq per file; capture its REAL rc (errexit-safe idiom: a plain
      # assignment of a failed substitution would abort under `set -e`, and
      # `local obj=…` would mask the rc behind the builtin's own 0).
      obj="$(jq -c --arg dir "${f#"$ROOT"/}" '. + {_dir:$dir}' "$f")" && _rc=0 || _rc=$?
      if [ "$_rc" -ne 0 ]; then
        warn "validation FAILED: unparseable task.json at ${f#"$ROOT"/}"
        return 1
      fi
      out="${out}${obj}"$'\n'
    done < <(find "$BK/tasks" -mindepth 2 -maxdepth 2 -name task.json 2>/dev/null | sort)
  fi
  # Slurp the per-file objects into one array (input/path order preserved); an
  # empty stream slurps to []. This pass reads already-validated objects.
  printf '%s' "$out" | jq -cs '.'
}

# Exit 0 (true) iff the work tree has changes OUTSIDE .jeff/.
# The store is jeff's own bookkeeping (run log, etc.); a change confined to
# it must not count as a dirty tree. `:(exclude).jeff` is a bash-3.2 /
# macOS-portable git pathspec: not a shell glob.
tree_dirty() {
  [ -n "$(git -C "$ROOT" status --porcelain -- ':(exclude).jeff' 2>/dev/null)" ]
}

# Exit 0 only when ROOT is the top level of a real Git work tree (ordinary or linked).
is_git_root() {
  local root top
  root="$(resolve_dir "$ROOT")" || return 1
  top="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" || return 1
  top="$(resolve_dir "$top")" || return 1
  [ "$root" = "$top" ]
}

# Echo Git's info/exclude path, anchoring ordinary repos' relative result at ROOT.
git_info_exclude() {
  local path
  path="$(git -C "$ROOT" rev-parse --git-path info/exclude 2>/dev/null)" || return 1
  [ -n "$path" ] || return 1
  case "$path" in
    /*) ;;
    *) path="$ROOT/$path" ;;
  esac
  printf '%s\n' "$path"
}

# profile_conformance <file>: single source of truth for profile schema checks.
# Checks:
#   1. Front-matter: a parseable fenced ```json block at the top of the file.
#   2. Required keys: mode (string), plan_store (string), ledger (string),
#      sources (array). Each sources entry must carry non-empty path + hash strings.
#   3. Size budget: whole file ≤ 40 lines AND ≤ 2000 bytes.
# Emits a reason to stderr on the first failure; returns non-zero on failure.
# jq-only; no external parser dependency.
profile_conformance() {
  local file="$1"

  # Size budget: check before parsing (fast, and catches bloat from any source).
  local line_count byte_count
  line_count="$(wc -l < "$file")"
  byte_count="$(wc -c < "$file")"
  if [ "$line_count" -gt 40 ]; then
    printf 'cook: profile.md exceeds 40-line budget (%s lines)\n' "$line_count" >&2
    return 1
  fi
  if [ "$byte_count" -gt 2000 ]; then
    printf 'cook: profile.md exceeds 2000-byte budget (%s bytes)\n' "$byte_count" >&2
    return 1
  fi

  # Extract JSON from the opening ```json fence to the next closing ``` line.
  # Uses a shell while-read loop rather than awk because literal backticks inside
  # $(...) are parsed as nested command substitution, making backtick patterns
  # unparseable. State machine: skip leading blank lines, require the first
  # non-blank line to be the opening fence, collect body lines until the closing
  # fence, break (leaving _found_open=0) on any other non-blank pre-fence line.
  local fm _found_open _found_close
  fm=""
  _found_open=0
  _found_close=0
  while IFS= read -r _line; do
    if [ "$_found_open" -eq 0 ]; then
      # Before the opening fence: blank lines are ok, any non-blank non-fence line fails.
      if [ "$_line" = '```json' ]; then
        _found_open=1
      elif [ -n "$_line" ]; then
        break
      fi
    elif [ "$_line" = '```' ]; then
      _found_close=1
      break
    else
      fm="${fm}${_line}"$'\n'
    fi
  done < "$file"

  if [ "$_found_open" -eq 0 ] || [ "$_found_close" -eq 0 ] || [ -z "$fm" ]; then
    printf 'cook: profile.md: no parseable ```json front-matter fence found at the top of the file\n' >&2
    return 1
  fi

  # Parse and validate the front-matter with jq.
  local violations _jq_rc
  violations="$(printf '%s\n' "$fm" | jq -r '
    def check_string($k): if (.[$k] | type) != "string" or (.[$k] // "") == "" then "missing or invalid key: \($k) (must be a non-empty string)" else empty end;
    check_string("mode"),
    check_string("plan_store"),
    check_string("ledger"),
    (if (.sources | type) != "array" then "missing or invalid key: sources (must be an array)" else empty end),
    (if (.sources | type) == "array" then
       .sources[] |
       (if (.path | type) != "string" or (.path // "") == "" then "sources entry missing non-empty path" else empty end),
       (if (.hash | type) != "string" or (.hash // "") == "" then "sources entry missing non-empty hash" else empty end)
     else empty end)
  ' 2>/dev/null)" && _jq_rc=0 || _jq_rc=$?

  if [ "$_jq_rc" -ne 0 ]; then
    printf 'cook: profile.md: front-matter JSON is unparseable\n' >&2
    return 1
  fi

  if [ -n "$violations" ]; then
    printf 'cook: profile.md conformance failure: %s\n' "$(printf '%s' "$violations" | head -1)" >&2
    return 1
  fi

  return 0
}

# Default profile template written by `cook profile init`.
# Must conform to profile_conformance: valid fenced JSON front-matter with all
# required keys + at least one sources entry, ≤ 40 lines, ≤ 2000 bytes.
PROFILE_TEMPLATE='```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "path": ".jeff/profile.md", "hash": "sha256:000000000000000000000000000000000000000000000000000000000000000" }
  ]
}
```

## Operating Profile

Task location: `.jeff/tasks/`; breakdown: one task per logical change.

Integration: feature branch → PR → team merges; jeff never pushes the protected base.

Handoff: specialist leaves tests green, `cook validate` passing, stage committed.

Test command: `make test`.

Standards: operator code-standards skill (baseline); language skill overrides.

Audit triggers: destructive ops, prompt-injection surfaces, security-sensitive paths.

Vocabulary:
- task = Jeff task (maps to team tracker issue)
- stage = pipeline phase (capture/plan/implement/refactor/review/audit/done)'

cmd_profile() {
  local sub="${1:-}"
  case "$sub" in
    init)
      [ "$#" -le 1 ] || die "profile init: unexpected argument '$2'"
      if [ -f "$BK/profile.md" ]; then
        die "profile already exists: $BK/profile.md (no-clobber; remove it manually to reinitialise)"
      fi
      mkdir -p "$BK"
      printf '%s\n' "$PROFILE_TEMPLATE" > "$BK/profile.md"
      printf 'cook: wrote default profile to .jeff/profile.md\n'
      ;;
    "")
      if [ ! -f "$BK/profile.md" ]; then
        die "no profile found: .jeff/profile.md does not exist (run \`cook profile init\` to create one)"
      fi
      cat "$BK/profile.md"
      profile_conformance "$BK/profile.md" || exit 1
      ;;
    *)
      die "unknown profile subcommand: $sub (try \`cook profile\` or \`cook profile init\`)"
      ;;
  esac
}

cmd_validate() {
  reject_unknown_args validate "$@"

  # Mode gate. Lite mode (config.mode == "lite") runs the quality-invariant
  # subset over the local run-ledger. Full/absent mode runs the full
  # registry+quality invariant set over the on-disk task dirs (the canonical
  # source). The single $lite flag threaded into the jq pass below switches off
  # the registry-only checks (id-type, inv5 dep DAG, duplicate-id) for lite while
  # keeping inv1–4 and the inv7–11 convergence block.
  local lite
  if [ "$(bake_mode)" = "lite" ]; then
    lite=true
  else
    lite=false
  fi
  require_jq

  # [gate] done-gate pre-flight (task 0044). The [gate] check is a done-gate
  # QUALITY invariant (like INV-4), NOT a registry invariant: so it must hold
  # regardless of store contents. Run it over the collected tasks BEFORE the
  # full-mode "empty tasks/ ⇒ nothing to validate" early-return so a `done` task
  # that records a red/dirty/hash-less gate is refused. NULL-TOLERANT: a done task
  # WITHOUT tests.gate (every legacy task) and any non-done task are skipped, so
  # this never trips the empty-store early-return guard (lite.bats) or the 19
  # historical done tasks. A clean/absent gate falls through; the main invariant pass below
  # re-checks it under the full/lite invariant set (no double-report: a violation
  # dies here first; a clean gate emits nothing here).
  local _pf_tasks _pf_rc _gate_violations
  _pf_tasks="$(collect_tasks)" && _pf_rc=0 || _pf_rc=$?
  [ "$_pf_rc" -eq 0 ] || die "validation FAILED: could not parse the task store (unreadable or malformed task path/JSON under .jeff/tasks/)."
  _gate_violations="$(printf '%s' "$_pf_tasks" | jq -r '
    .[] | select(.status == "done") | . as $t
    | ($t.tests.gate) as $g
    | if ($g == null) then empty else (
        ( if ($g.green != true) then "task \($t.id): done but tests.gate.green != true (tests.green not backed by a green full-suite gate) [gate]" else empty end),
        ( if ($g.clean != true) then "task \($t.id): done but tests.gate.clean != true (gate ran on a dirty tree) [gate]" else empty end),
        ( if (($g.hash | type) != "string" or ($g.hash // "") == "") then "task \($t.id): done but tests.gate.hash is missing/empty (a recorded gate must carry the gated hash) [gate]" else empty end),
        ( if ($t.tests.green == true and $g.green != true) then "task \($t.id): tests.green == true but not backed by tests.gate.green == true [gate]" else empty end)
      ) end
  ')" && _pf_rc=0 || _pf_rc=$?
  # Fail CLOSED on a jq failure here too (SEC-NL-B discipline). A malformed
  # tests.gate could make this jq abort; capture the rc and die so the validator
  # can never fall through to "validation OK" = a latent fail-OPEN.
  [ "$_pf_rc" -eq 0 ] || die "validation FAILED: could not evaluate the [gate] done-gate pre-flight (malformed tests.gate JSON?)."
  if [ -n "$_gate_violations" ]; then
    printf '%s\n' "$_gate_violations" >&2
    local _gn
    _gn="$(printf '%s\n' "$_gate_violations" | grep -c '.')"
    die "validation FAILED ($_gn issue(s))"
  fi

  # Full mode over an EMPTY store (no task dirs) has nothing to validate: a
  # fresh `cook init` repo stays exit 0. Reuse the already-collected, already
  # fail-closed-checked $_pf_tasks (the dirs are the canonical source; the index
  # registry is gone). Lite mode runs even when empty (it validates the run-ledger
  # subset and reports OK with 0 tasks).
  if [ "$lite" = false ] && [ "$(printf '%s' "$_pf_tasks" | jq 'length')" -eq 0 ]; then
    printf 'cook: no tasks under .jeff/tasks/: nothing to validate.\n'
    return 0
  fi

  # Fail CLOSED on any parse/collect failure (SEC-NL-B, defense-in-depth). A task
  # dir whose path carries a newline (or any otherwise-unparseable store) makes
  # collect_tasks' inner `jq` exit non-zero. We do not rely on `set -e` alone (a
  # caller could invoke us with errexit suppressed): capture the step's real rc
  # with the errexit-safe `… && rc=0 || rc=$?` idiom (a plain assignment of a
  # failed substitution would either abort under errexit or, once suppressed,
  # leave a following `$?` reading the assignment's own 0: masking the failure)
  # and `die` so the validator can NEVER reach the "validation OK" print on a
  # store it could not parse, however it is invoked.
  local tasks violations _v_rc
  tasks="$(collect_tasks)" && _v_rc=0 || _v_rc=$?
  [ "$_v_rc" -eq 0 ] || die "validation FAILED: could not parse the task store (unreadable or malformed task path/JSON under .jeff/tasks/)."

  violations="$(
    printf '%s' "$tasks" | jq -r --argjson lite "$lite" '
      . as $tasks |
      ["pending","in_progress","blocked","done","abandoned"] as $statuses |
      ["capture","plan","test","implement","refactor","review","audit","done"] as $stages |
      ["p0","p1","p2","p3","p4"] as $prios |
      ($tasks | map(.id)) as $ids |

      [
        # ---- per-task checks ----
        ( $tasks[] | . as $t |
          [
            # id-type: a registry invariant. Lite ledgers may carry a STRING id
            # (an external tracker ref, e.g. "JIRA-42"), so this check is dropped
            # under $lite. Full mode is unchanged (number required).
            (if ($lite | not) and (($t.id | type) != "number") then "\($t._dir): id must be a number" else empty end),
            (if (($t.slug // "") | type) != "string" or (($t.slug // "") == "") then "task \($t.id): slug is required" else empty end),
            (if (($t.title // "") == "") then "task \($t.id): title is required" else empty end),
            (if ($statuses | index($t.status)) == null then "task \($t.id): invalid status \"\($t.status)\"" else empty end),
            (if ($stages   | index($t.stage))  == null then "task \($t.id): invalid stage \"\($t.stage)\"" else empty end),
            (if ($prios    | index($t.priority)) == null then "task \($t.id): invalid priority \"\($t.priority)\"" else empty end),

            # inv 1: test author != implementer
            ( ($t.tests.authored_by_agent_id) as $ta | ($t.agents.implementer_agent_id) as $im
              | if ($ta != null and $im != null and $ta == $im)
                then "task \($t.id): test author == implementer (\($ta)) [inv1]" else empty end),

            # inv 2: implementer != every reviewer
            ( ($t.agents.implementer_agent_id) as $im
              | [$t.agents.reviewer_agent_id, $t.agents.reviewer2_agent_id] as $reviewers
              | if ($im != null and ($reviewers | index($im)) != null)
                then "task \($t.id): implementer == reviewer (\($im)) [inv2]" else empty end),

            # inv 4: done-gate: applies to every done task.
            ( if ($t.status == "done") then
                # tests.green: true (real green gate) OR "na" (task 0049 None/terminal
                # disposition: no consumer-observable behavior to test). "na" requires
                # non-empty tests.evidence (cited justification) + review.verdict==pass.
                # Only the literal "na" is accepted; false and any other value stay refused.
                ( ($t.tests.green) as $g
                  | if ($g != true and ($g != "na" or (($t.tests.evidence // []) | length) == 0 or $t.review.verdict != "pass"))
                    then "task \($t.id): done but tests.green != true (and not a justified \"na\" no-test state: needs tests.green==\"na\" + non-empty tests.evidence + review.verdict==\"pass\") [inv4]"
                    else empty end),
                # Non-implementer test-author check applies to the green==true path only;
                # an "na" task ran no tests and has no authored_by_agent_id.
                ( ($t.tests.authored_by_agent_id) as $ta | ($t.agents.implementer_agent_id) as $im
                  | if ($t.tests.green == true and ($ta == null or $ta == $im)) then "task \($t.id): done but tests not authored by a non-implementer [inv4]" else empty end),
                ( if ($t.review.verdict != "pass") then "task \($t.id): done but review.verdict != pass [inv4]" else empty end),
                ( (($t.audit.verdict) // "na") as $av | if ($av != "pass" and $av != "na") then "task \($t.id): done but audit.verdict not pass|na [inv4]" else empty end)
                # [gate]: the full-suite gate binding (task 0044) is a done-gate
                # quality invariant that must hold regardless of store contents, so
                # it runs in the `_gate_violations` PRE-FLIGHT above (before the
                # empty-store early-return), not in this pass.
                # NULL-TOLERANT: tests.gate absent ⇒ skipped (legacy done tasks).
              else empty end),

            # inv 5a: deps exist (registry invariant: dropped under $lite; the
            # team tracker owns the dep graph in lite mode).
            ( if ($lite | not) then ($t.deps // [])[] as $d | if ($ids | index($d)) == null then "task \($t.id): dep \($d) does not exist [inv5]" else empty end else empty end),

            # prune: a done/abandoned task dir must not rest in the canonical store
            # (registry invariant, full mode only; lite ledgers legitimately retain
            # a local done run-ledger). Done/abandoned tasks are pruned at completion:
            # the dir is removed, satisfied deps are stripped, and the removal is
            # committed; the archive is git history/tags, not a resting dir.
            ( if ($lite | not) and ($t.status == "done" or $t.status == "abandoned") then "task \($t.id): status \"\($t.status)\" task dir must not rest in the store; prune at completion: remove dir, strip deps, commit removal (archive is git history/tags) [prune]" else empty end),

            # ---- convergence block (INV-7..INV-11) ----
            # OPTIONAL: absent ⇒ skip all checks (null guard below).
            # Present ⇒ assert over the recorded state. All checks are pure
            # functions of $t (deterministic, fail-closed); a missing nested
            # field reads as null and trips the relevant shape check rather than
            # passing silently.
            ( ($t.convergence) as $c
              | ($c.council) as $cl
              | ($cl.convened == true) as $conv
              | if ($c == null) then empty else (

                  # inv 7: shape/range: cap int ≥1; each stage blockingKickbacks int in 0..cap.
                  # Integer-ness via `(x|floor)==x`; `or` short-circuits so `floor`
                  # is only reached after `type=="number"` is confirmed (a bare
                  # `floor` on a non-number aborts jq: which would fail CLOSED via
                  # the outer trap: rc≠0 → die). null/missing reads as non-number ⇒ fail CLOSED.
                  ( ($c.cap) as $cap
                    | if (($cap | type) != "number" or $cap < 1 or ($cap | floor) != $cap)
                      then "task \($t.id): convergence.cap must be an integer ≥ 1 [inv7]"
                      else ( ("review","audit") as $st
                             | ($c.stages[$st].blockingKickbacks) as $bk
                             | if (($bk | type) != "number" or $bk < 0 or $bk > $cap or ($bk | floor) != $bk)
                               then "task \($t.id): convergence.stages.\($st).blockingKickbacks must be an integer in 0..\($cap) [inv7]"
                               else empty end )
                      end ),

                  # inv 8 (F5): convergence present ⇒ council must be a non-null
                  # object. The documented pre-council state carries a full council
                  # object (convened:false, …), never null/absent. A null or missing
                  # council reads as a non-object here and trips this check (fail
                  # CLOSED), rather than silently skipping every council-shape guard
                  # below (all of which are object-guarded).
                  ( if (($cl | type) != "object")
                    then "task \($t.id): convergence present requires a non-null council object [inv8]" else empty end ),

                  # inv 8 (F4): closed enums on any non-null council object: verdict
                  # ∈ {null,ship,block}, outcome ∈ {null,shipped,scoped-fix-shipped,
                  # blocked-to-operator}. Enforced even when convened:false (the
                  # schema pins these fields, null pre-council). Object-guarded so an
                  # absent council defers to the F5 check above (fail CLOSED there).
                  ( if (($cl | type) == "object") then
                      ( ($cl.verdict) as $vd
                        | if ([null,"ship","block"] | index([$vd])) == null
                          then "task \($t.id): council.verdict must be one of null, ship, block [inv8]" else empty end ),
                      ( ($cl.outcome) as $oc
                        | if ([null,"shipped","scoped-fix-shipped","blocked-to-operator"] | index([$oc])) == null
                          then "task \($t.id): council.outcome must be one of null, shipped, scoped-fix-shipped, blocked-to-operator [inv8]" else empty end )
                    else empty end ),

                  # inv 8: council.convened must be a proper boolean (fail CLOSED).
                  # $conv (the convened gate above) uses jq type-strict `== true`,
                  # so a STRING "true" or NUMBER 1 would read as false and SILENTLY
                  # skip INV-8/9/10 and the convened-clauses of INV-11: letting a
                  # blocking council evade the done-gate (fail-OPEN). Reject any
                  # non-boolean convened so the gate can never be bypassed by
                  # coercion. Guarded to a non-null `council` object so an
                  # absent/null council defers to the F5/INV-8 null-object check
                  # above (task 0003), which fails CLOSED there instead.
                  ( if (($cl | type) == "object" and (($cl.convened) | type) != "boolean")
                    then "task \($t.id): council.convened must be a boolean [inv8]" else empty end ),

                  # inv 8 (task 0005): a non-convened council may not carry
                  # verdict == "block". An un-convened block is a contradiction
                  # (block is only reachable via a convened council); forbidding
                  # the shape here makes it unrepresentable, so it can never
                  # reach the $conv-gated INV-11 done-gate. Object-guarded +
                  # $conv|not treats any non-true convened (false/null/missing/
                  # coerced) as not-convened ⇒ fail CLOSED.
                  ( if (($cl | type) == "object" and ($conv | not) and ($cl.verdict == "block"))
                    then "task \($t.id): a non-convened council must not carry verdict == block [inv8]" else empty end ),

                  # inv 8: council distinctness (only when convened)
                  ( if $conv then
                      ($cl.members // []) as $mem
                      | ($mem | map(.agent_id)) as $mids
                      | ($mem | map(.lens)) as $lenses
                      | ($t.agents.reviewer_agent_id) as $rv
                      | ($t.agents.implementer_agent_id) as $im
                      | (
                          ( if ($mem | length) != 3 then "task \($t.id): convened council must have exactly 3 members [inv8]" else empty end ),
                          ( if (($mids | unique | length) != ($mids | length)) then "task \($t.id): council member agent_ids must be mutually distinct [inv8]" else empty end ),
                          ( $mids[] as $mid | if ($mid == $rv or $mid == $im) then "task \($t.id): council member \($mid) overlaps reviewer/implementer [inv8]" else empty end ),
                          ( if (($lenses | sort) != ["integrity","pragmatist","security"]) then "task \($t.id): council lenses must be exactly integrity, security, pragmatist [inv8]" else empty end ),
                          ( if (["review","audit"] | index($cl.stage)) == null then "task \($t.id): convened council.stage must be review or audit [inv8]" else empty end )
                        )
                    else empty end ),

                  # inv 9: per-finding determinism (only when convened)
                  ( if $conv then
                      ($cl.findings // []) as $fs
                      | (
                          # F3: convened ⇒ at least one finding (empty is incomplete shape).
                          ( if ($fs | length) < 1 then "task \($t.id): convened council must record at least one finding [inv9]" else empty end ),
                          # F2: each finding blockingVotes must be an integer in 0..3
                          # (independent of the survived determinism check below).
                          # `floor` guarded behind `type=="number"` via short-circuit
                          # `or`; null/missing reads as non-number ⇒ fail CLOSED.
                          ( $fs[] as $f
                            | ($f.blockingVotes) as $bv
                            | if (($bv | type) != "number" or $bv < 0 or $bv > 3 or ($bv | floor) != $bv)
                              then "task \($t.id): finding \($f.id) blockingVotes must be an integer in 0..3 [inv9]" else empty end ),
                          ( $fs[] as $f | if ($f.survived != (($f.blockingVotes // -1) >= 2)) then "task \($t.id): finding \($f.id) survived must equal (blockingVotes ≥ 2) [inv9]" else empty end ),
                          ( (if ($fs | any(.survived == true)) then "block" else "ship" end) as $expected
                            | if ($cl.verdict != $expected) then "task \($t.id): council verdict must be \"\($expected)\" given the per-finding survivals [inv9]" else empty end )
                        )
                    else empty end ),

                  # inv 10: follow-up tracking (only when convened)
                  ( if $conv then
                      ($cl.findings // [])[] as $f
                      | if ($f.survived == true)
                        then (if ($f.followupTaskId != null) then "task \($t.id): surviving finding \($f.id) must have followupTaskId == null [inv10]" else empty end)
                        else (if ($f.followupTaskId == null) then "task \($t.id): follow-up finding \($f.id) must record a followupTaskId [inv10]"
                              elif (($ids | index($f.followupTaskId)) == null) then "task \($t.id): finding \($f.id) followupTaskId \($f.followupTaskId) does not reference an existing task [inv10]"
                              else empty end)
                        end
                    else empty end ),

                  # inv 11: block resolution / done-gate
                  # 11a: blocked-to-operator ⇒ status == blocked
                  ( if ($conv and $cl.verdict == "block" and $cl.outcome == "blocked-to-operator" and $t.status != "blocked")
                    then "task \($t.id): council blocked-to-operator requires status == blocked [inv11]" else empty end ),
                  # 11b: a council-block may reach done ONLY via scoped-fix-shipped
                  ( if ($t.status == "done" and $conv and $cl.verdict == "block" and $cl.outcome != "scoped-fix-shipped")
                    then "task \($t.id): done with an unresolved council block (outcome != scoped-fix-shipped) [inv11]" else empty end )

                ) end ),

            # status-conditional required fields
            (if ($t.status == "blocked" and (($t.blockedReason // "") == "")) then "task \($t.id): blocked requires blockedReason" else empty end),
            (if ($t.status == "abandoned" and (($t.abandonReason // "") == "")) then "task \($t.id): abandoned requires abandonReason" else empty end)
          ] ),

        # ---- duplicate ids (registry invariant: dropped under $lite) ----
        ( if ($lite | not) then $ids | group_by(.) | map(select(length > 1)) | .[] | "duplicate task id \(.[0])" else empty end ),

        # ---- inv 5b: dependency cycle (Kahn) (registry invariant: dropped under $lite) ----
        ( if ($lite | not) then
            ( def step($remaining; $removed):
                ( $remaining | map(select((.deps // []) | all((. as $d | ($removed | index($d)) != null)))) | map(.id) ) as $ready
                | if ($ready | length) == 0
                  then (if ($remaining | length) > 0 then ["dependency cycle among tasks \($remaining | map(.id)) [inv5]"] else [] end)
                  else step( ($remaining | map(select(.id as $i | ($ready | index($i)) == null))); ($removed + $ready) )
                  end;
              step(($tasks | map({id, deps: ((.deps // []) | map(select(. as $d | ($ids | index($d)) != null)))})); []) )
          else empty end )
      ] | flatten | .[]
    '
  )" && _v_rc=0 || _v_rc=$?
  # The violations pass reads already-validated JSON ($tasks), so it should not
  # fail here: but if it ever does, fail closed rather than treat an empty
  # result as "no violations" and print OK.
  [ "$_v_rc" -eq 0 ] || die "validation FAILED: the invariant pass could not evaluate the task store."

  if [ -n "$violations" ]; then
    printf '%s\n' "$violations" >&2
    local n
    n="$(printf '%s\n' "$violations" | grep -c '.')"
    die "validation FAILED ($n issue(s))"
  fi

  # Profile conformance invariant (optional + present-means-conform): if
  # .jeff/profile.md exists it MUST conform; absence is fine (0012 cook bind
  # writes it; hand-written profiles are allowed until then). Fail CLOSED on
  # non-conformance, consistent with the surrounding die idioms.
  if [ -f "$BK/profile.md" ]; then
    local _p_rc
    profile_conformance "$BK/profile.md" && _p_rc=0 || _p_rc=$?
    [ "$_p_rc" -eq 0 ] || die "validation FAILED: .jeff/profile.md does not conform (fix it or remove it)"
  fi

  local count
  count="$(printf '%s' "$tasks" | jq 'length')"
  printf 'cook: validation OK (%s task(s))\n' "$count"
}

cmd_ls() {
  reject_unknown_args ls "$@"
  require_jq
  local tasks
  tasks="$(collect_tasks)"
  printf '%s' "$tasks" | jq -r '
    if length == 0 then "no tasks"
    else (sort_by(.id)[] | "\(.id)\t\(.status)\t\(.stage)\t\(.priority)\t\(.title)")
    end'
}

cmd_status() {
  reject_unknown_args status "$@"
  require_jq
  local tasks
  tasks="$(collect_tasks)"
  printf '%s' "$tasks" | jq -r '
    (map(select(.status == "in_progress"))) as $active |
    (map(select(.status == "pending"))) as $pending |
    "in flight: \($active | length)",
    ($active[] | "  #\(.id) \(.stage): \(.title)"),
    "ready/pending backlog: \($pending | length)" +
      (if ($pending | length) > 8 then "  ⚠ backlog is growing: consider finishing or pruning before adding more" else "" end),
    "done: \(map(select(.status == "done")) | length)  blocked: \(map(select(.status == "blocked")) | length)  abandoned: \(map(select(.status == "abandoned")) | length)"
  '
}

cmd_show() {
  require_jq
  local id="${1:-}"
  [ -n "$id" ] || die "usage: cook show <id>"
  [ "$#" -le 1 ] || die "show: unexpected argument '$2'"
  local f
  f="$(find "$BK/tasks" -mindepth 2 -maxdepth 2 -name task.json 2>/dev/null | while IFS= read -r p; do
        if [ "$(jq -r '.id' "$p")" = "$id" ]; then printf '%s' "$p"; break; fi
      done)"
  [ -n "$f" ] || die "no task with id $id"
  jq '.' "$f"
}

cmd_doctor() {
  reject_unknown_args doctor "$@"
  local mode
  mode="$(bake_mode)"
  printf 'cook doctor\n'
  printf '  root: %s\n' "$ROOT"
  if command -v jq >/dev/null 2>&1; then
    printf '  jq:   OK (%s)\n' "$(jq --version)"
  else
    printf '  jq:   MISSING: run `brew install jq` (macOS) / `apt-get install jq` (Debian)\n'
  fi
  printf '  mode: %s\n' "$mode"
  if [ -f "$BK/config.json" ] && command -v jq >/dev/null 2>&1 && [ "$(jq -r '.active // false' "$BK/config.json")" = "true" ]; then
    printf '  jeff: ACTIVE\n'
  else
    printf '  jeff: inactive (run `cook init` to activate)\n'
  fi
  if [ "$mode" = "lite" ]; then
    printf '  git hook: intentionally not installed (no mode installs a hook; team owns git policy)\n'
  fi
}

# Create the .jeff skeleton if absent and mark the project active.
ensure_scaffold() {
  require_jq
  mkdir -p "$BK/tasks" "$BK/memory"
  [ -f "$BK/tasks/.gitkeep" ] || : > "$BK/tasks/.gitkeep"
  if [ -f "$BK/config.json" ]; then
    local tmp; tmp="$(mktemp)"
    jq '.active = true' "$BK/config.json" > "$tmp" && mv "$tmp" "$BK/config.json"
  else
    jq -n '{schemaVersion:1, system:"jeff", active:true}' > "$BK/config.json"
  fi
}

cmd_init() {
  reject_unknown_args init "$@"
  is_git_root || die "not a git repository: $ROOT"
  ensure_scaffold
  printf 'cook: jeff activated in %s (scaffold + marked active).\n' "$ROOT"
}

cmd_deinit() {
  reject_unknown_args deinit "$@"
  if [ -f "$BK/config.json" ] && command -v jq >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    jq '.active = false' "$BK/config.json" > "$tmp" && mv "$tmp" "$BK/config.json"
    printf 'cook: marked inactive (active=false); .jeff/ task state preserved.\n'
  fi
  printf 'cook: jeff is inactive here. Run `cook init` to re-activate; remove .jeff/ manually to delete history.\n'
}

# Append a single line to a file idempotently, creating it (and its parent) if
# absent. Never touches the file if the exact line is already present. Used by
# cmd_lite to add .jeff/ to Git's info/exclude without ever duplicating it.
# The line is matched whole (fixed-string, anchored) so a substring or a longer
# pattern that merely contains it does not count as already-present.
append_line_once() {
  local file="$1" line="$2"
  mkdir -p "$(dirname "$file")"
  if [ -f "$file" ] && LC_ALL=C grep -qxF -- "$line" "$file" 2>/dev/null; then
    return 0
  fi
  printf '%s\n' "$line" >> "$file"
}

# cook lite: activate per-project LITE mode in the cwd repo.
#
# Lite mode runs Jeff's quality pipeline inside a SHARED repo without
# imposing its task registry: it scaffolds .jeff/, writes config.json with
# mode:"lite"+active:true, and git-excludes .jeff/ locally
# (Git's info/exclude: never a tracked file). No git hook is installed in any mode.
# Re-running is a safe no-op: config is re-stamped to the lite shape and the
# exclude line is added at most once.
cmd_lite() {
  reject_unknown_args lite "$@"
  is_git_root || die "not a git repository: $ROOT (cook lite needs git to exclude .jeff/ locally)"
  local exclude
  exclude="$(git_info_exclude)" || die "could not resolve Git info/exclude: $ROOT"
  require_jq
  mkdir -p "$BK/tasks" "$BK/memory"
  [ -f "$BK/tasks/.gitkeep" ] || : > "$BK/tasks/.gitkeep"

  # Write/re-stamp config.json to the lite shape. Merge onto any existing config
  # (preserve unrelated fields) but force mode:"lite" + active:true.
  local tmp
  tmp="$(mktemp)"
  if [ -f "$BK/config.json" ]; then
    jq '. + {schemaVersion: (.schemaVersion // 1), mode: "lite", active: true}' "$BK/config.json" > "$tmp"
  else
    jq -n '{schemaVersion: 1, system: "jeff", mode: "lite", active: true}' > "$tmp"
  fi
  mv -f "$tmp" "$BK/config.json"

  # Git-exclude .jeff/ locally and idempotently. Never edits a tracked file:
  # info/exclude is per-clone and never committed. Created if absent.
  append_line_once "$exclude" ".jeff/"

  printf 'cook: lite mode active in %s: quality pipeline on, registry off (.jeff/ git-excluded locally).\n' "$ROOT"
}

# Maximum length of a derived task dir name (nnnn-slug). Keeps the leaf well
# under the common NAME_MAX of 255 and prevents ENAMETOOLONG mid-build, which
# would leave a partial tasks/ without this bound. Consumer: adopt_dir_leaf.
TASK_NAME_MAX=200

# Upper bound on readlink hops when resolving a plan ref's symlink chain. A real
# chain is a handful of links; a much larger count means a symlink cycle, which we
# refuse (fail CLOSED) rather than spin on. Consumer: resolve_ref_path.
SYMLINK_MAX_HOPS=40

# ---------------------------------------------------------------------------
# adopt (`cook on`) + markdown plan-store (`cook plan …`).
#
# Adoption keys a lite run-ledger (0008 shape) to a markdown plan location. The
# plan-store helpers are deterministic, byte-preserving markdown operations: the
# inference-assisted half of adoption (phrasing todos in the team's voice, deciding
# which prose is "the section") lives in the orchestrator/specialist, not here.
# ---------------------------------------------------------------------------

# Heading-slug logic (GitHub-style: lowercase, trim, spaces→'-', drop chars
# outside [a-z0-9-]) lives only in the awk `slug()` of plan_section_bounds below,
# which is the sole consumer. awk can't call a bash function, so there is no
# shared shell copy to keep in sync: keep the canonical implementation in awk.

# Resolve the physical (symlink-free) absolute path of an EXISTING directory.
# Echoes the path; returns non-zero if the directory cannot be entered. Used by
# the containment check: directories must exist to be resolved, so the caller
# resolves a ref's PARENT dir (which it requires to exist) and re-attaches the
# leaf basename, avoiding any dependence on realpath's non-existent-path behavior.
resolve_dir() {
  ( cd "$1" 2>/dev/null && pwd -P ) || return 1
}

# Is PATH inside ROOTDIR (equal to it, or a descendant)? Both must be already
# physically resolved (no symlinks, no '..'). Fixed-string prefix test anchored on
# a trailing '/' so "/a/bc" is NOT considered inside "/a/b". Pure function.
path_is_inside() {
  local path="$1" rootdir="$2"
  [ "$path" = "$rootdir" ] && return 0
  case "$path" in
    "$rootdir"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Resolve a user-supplied plan ref to an absolute file path that is provably
# inside ROOT, and echo it. Fails CLOSED (non-zero, no output) on anything that
# cannot be resolved or that escapes ROOT: '../' traversal, an absolute path
# outside ROOT, a symlink whose target is outside ROOT, or a missing file.
#
# Strategy: the ref's PARENT directory must exist and resolve (physically) inside
# ROOT; the leaf is then re-attached. If the leaf is itself a symlink, its real
# target is resolved and checked for containment too. This avoids relying on
# realpath's handling of non-existent paths and catches every escape the tests probe.
resolve_ref_path() {
  local ref="$1" rootdir candidate parent base resolved_parent leaf
  rootdir="$(resolve_dir "$ROOT")" || return 1

  # Build the candidate absolute path (absolute refs kept as-is; relative refs
  # joined onto ROOT). Containment is enforced after resolution either way.
  case "$ref" in
    /*) candidate="$ref" ;;
    *)  candidate="$ROOT/$ref" ;;
  esac

  parent="$(dirname "$candidate")"
  base="$(basename "$candidate")"
  resolved_parent="$(resolve_dir "$parent")" || return 1
  path_is_inside "$resolved_parent" "$rootdir" || return 1

  leaf="$resolved_parent/$base"
  [ -e "$leaf" ] || return 1

  # Follow a symlink chain to its fixed point, re-checking containment at EVERY
  # hop. A single-hop check is not enough: a chain of in-ROOT symlinks whose
  # FINAL target lands outside ROOT escapes if we stop after one readlink. So we
  # loop: resolve each hop's target (relative targets against the link's own dir),
  # re-confirm the target's parent is inside ROOT, then continue while the new leaf
  # is itself a symlink. The hop counter bounds the walk so a symlink cycle
  # (a -> b -> a) fails CLOSED instead of spinning forever.
  local hops=0 link tparent tbase tresolved
  while [ -L "$leaf" ]; do
    hops=$((hops + 1))
    [ "$hops" -le "$SYMLINK_MAX_HOPS" ] || return 1
    link="$(readlink "$leaf")"
    tparent="$(dirname "$link")"
    tbase="$(basename "$link")"
    case "$tparent" in
      /*) : ;;
      # Relative target: resolve it against the link's OWN directory (which is
      # already physically resolved, since leaf = <resolved-dir>/<base> on every
      # iteration), not against the original candidate's parent.
      *)  tparent="$(dirname "$leaf")/$tparent" ;;
    esac
    tresolved="$(resolve_dir "$tparent")" || return 1
    path_is_inside "$tresolved" "$rootdir" || return 1
    leaf="$tresolved/$tbase"
    [ -e "$leaf" ] || return 1
  done

  [ -f "$leaf" ] || return 1
  printf '%s' "$leaf"
}

# Echo the line range "START END" (1-based, inclusive) of the section whose
# heading slug matches ANCHOR in FILE. The section runs from its heading through
# the line before the next heading of the same-or-higher level (depth ≤ matched),
# or EOF. Returns non-zero if no heading matches. Deterministic, read-only.
plan_section_bounds() {
  local file="$1" anchor="$2"
  awk -v want="$anchor" '
    function slug(s,   t) {
      t = tolower(s)
      gsub(/^[ \t]+|[ \t]+$/, "", t)
      gsub(/[ \t]+/, "-", t)
      gsub(/[^a-z0-9-]/, "", t)
      return t
    }
    # ponytail: naive open/close fence toggle, NOT a CommonMark parser (no
    # indented/length-matched/info-string fences); inputs are well-formed plan
    # and issue bodies. A fenced #-line is never a section boundary.
    /^```/ || /^~~~/ { infence = !infence; next }
    !infence && /^#+[ \t]/ {
      depth = 0
      while (substr($0, depth + 1, 1) == "#") depth++
      text = $0
      sub(/^#+[ \t]+/, "", text)
      if (found) {
        if (depth <= start_depth) { print start_line, NR - 1; done = 1; exit }
        next
      }
      if (slug(text) == want) { found = 1; start_line = NR; start_depth = depth }
    }
    END { if (found && !done) print start_line, NR }
  ' "$file"
}

# cook plan section <file> <anchor>
plan_section() {
  [ "$#" -eq 2 ] || die "usage: cook plan section <file> <anchor>"
  local file="$1" anchor="$2" out
  # Containment: the <file> arg must resolve (incl. symlinks, '..', absolute
  # paths) to a real file INSIDE ROOT. resolve_ref_path fails CLOSED otherwise,
  # so an out-of-ROOT read is refused before we ever open the file. The <file>
  # arg carries no '#anchor' (the anchor is a separate arg), so no stripping here.
  file="$(resolve_ref_path "$file")" \
    || die "plan section: file must resolve to an existing file inside the repo: $1"
  out="$(plan_section_bounds "$file" "$anchor")"
  [ -n "$out" ] || die "plan section: no heading matches anchor: $anchor"
  printf '%s\n' "$out"
}

# Tick the first checklist item ('- [ ]' / '- [x]') in the ALREADY-RESOLVED FILE
# whose text contains SUBSTRING, in place. Found unchecked → rewrite that one line
# '- [ ]'→'- [x]'. Found already checked → leave it, exit 0 (idempotent). No item
# matches at all → die. Every other line is byte-identical; the rewrite is atomic
# (mktemp + mv). This is the shared engine: both the markdown path (plan_check,
# after resolve_ref_path) and the issue path (plan_issue_op, on the fetched body)
# call it, so the awk lives in exactly one place.
plan_check_file() {
  local file="$1" sub="$2" tmp rc
  tmp="$(mktemp)"
  awk -v needle="$sub" '
    BEGIN { matched = 0 }
    # ponytail: naive open/close fence toggle, NOT a CommonMark parser (no
    # indented/length-matched/info-string fences); inputs are well-formed plan
    # and issue bodies. A fenced checklist item is never ticked.
    /^```/ || /^~~~/ { infence = !infence; print; next }
    {
      if (!matched && !infence && $0 ~ /^- \[[ xX]\] /) {
        text = substr($0, 7)
        if (index(text, needle) > 0) {
          matched = 1
          if ($0 ~ /^- \[ \] /) { sub(/^- \[ \] /, "- [x] ") }
        }
      }
      print
    }
    END { exit (matched ? 0 : 1) }
  ' "$file" > "$tmp" && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$tmp"
    die "plan check: no checklist item matches: $sub"
  fi
  mv -f "$tmp" "$file"
}

# cook plan check <file> <substring>
# Containment FIRST, before any mutation: an out-of-ROOT <file> is refused with no
# tmp written and no mv, so the victim file stays byte-unchanged. Then delegates to
# the shared plan_check_file engine on the resolved path.
plan_check() {
  [ "$#" -eq 2 ] || die "usage: cook plan check <file> <substring>"
  local file
  file="$(resolve_ref_path "$1")" \
    || die "plan check: file must resolve to an existing file inside the repo: $1"
  plan_check_file "$file" "$2"
}

# Insert TEXT as a new line at the END of the section anchored by ANCHOR in the
# ALREADY-RESOLVED FILE (immediately before the next same/higher heading, or at
# EOF). All other lines intact. die if the anchor is not found. Atomic (mktemp +
# mv). Shared engine: both the markdown path (plan_append, after resolve_ref_path)
# and the issue path (plan_issue_op, on the fetched body) call it.
plan_append_file() {
  local file="$1" anchor="$2" text="$3" bounds start end tmp rc
  bounds="$(plan_section_bounds "$file" "$anchor")"
  [ -n "$bounds" ] || die "plan append: no heading matches anchor: $anchor"
  start="${bounds%% *}"
  end="${bounds#* }"
  tmp="$(mktemp)"
  # Pass TEXT via the environment, NOT `-v text=...`: awk's -v assignment runs the
  # value through backslash-escape processing (\t→TAB, \n→newline, \\→\), which
  # would corrupt a literal path like 'C:\temp\new' or inject a stray newline.
  # ENVIRON[] is read verbatim, so the appended line is byte-identical to the arg.
  # rc guard before mv: a failed awk must never mv a bad/empty tmp over the file.
  # Two-pass: pass 1 (NR==FNR) finds the LAST non-blank line in [start, end];
  # the new line is inserted after it, so the section's trailing blank
  # separator before the next heading survives. Bounds are already
  # fence-corrected, so this index never lands inside a fenced region.
  COOK_APPEND_TEXT="$text" awk -v start="$start" -v end="$end" '
    NR == FNR {
      if (FNR >= start && FNR <= end && $0 ~ /[^ \t]/) ins = FNR
      next
    }
    { print }
    FNR == ins { print ENVIRON["COOK_APPEND_TEXT"] }
  ' "$file" "$file" > "$tmp" && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$tmp"
    die "plan append: failed to write update for: $file"
  fi
  mv -f "$tmp" "$file"
}

# cook plan append <file> <anchor> <text>
# Containment FIRST, before any mutation: an out-of-ROOT <file> is refused with no
# tmp written and no mv, so the victim file stays byte-unchanged. Then delegates to
# the shared plan_append_file engine on the resolved path.
plan_append() {
  [ "$#" -eq 3 ] || die "usage: cook plan append <file> <anchor> <text>"
  local file
  file="$(resolve_ref_path "$1")" \
    || die "plan append: file must resolve to an existing file inside the repo: $1"
  plan_append_file "$file" "$2" "$3"
}

# Dispatch a `cook plan <sub> <target> …` op. When <target> is an issue ref the op
# routes to the github-issues adapter (fetch body → same engine → gh issue edit);
# otherwise it stays on the markdown path EXACTLY as before. Issue-ref detection is
# the FIRST positional (the target); validation is fail-closed inside plan_issue_op.
cmd_plan() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    section|check|append) : ;;
    "")      die "usage: cook plan <section|check|append> …" ;;
    *)       die "unknown plan subcommand: $sub (try section|check|append)" ;;
  esac
  local target="${1:-}"
  if [ -n "$target" ] && is_issue_ref "$target"; then
    shift
    plan_issue_op "$sub" "$target" "$@"
    return
  fi
  case "$sub" in
    section) plan_section "$@" ;;
    check)   plan_check "$@" ;;
    append)  plan_append "$@" ;;
  esac
}

# Echo a stable, filesystem-safe directory leaf derived from a plan ref. The ref
# may contain '/', '#', and other characters; we reduce it to a readable [A-Za-z0-9-]
# base and append a short hash so distinct refs that reduce to the same base never
# collide. (This is NOT the heading-slug rule: it preserves case and is for dir
# names, not anchor matching.)
adopt_dir_leaf() {
  local ref="$1" base hash
  base="$(printf '%s' "$ref" | sed -E 's/[^A-Za-z0-9]+/-/g; s/^-+//; s/-+$//')"
  base="${base:0:$TASK_NAME_MAX}"
  hash="$(printf '%s' "$ref" | cksum | cut -d' ' -f1)"
  printf 'lite-%s-%s' "$base" "$hash"
}

# ---------------------------------------------------------------------------
# GitHub-issues plan-store adapter. A thin shim over the existing byte-preserving
# markdown engine (plan_section_bounds / the check + append awk): the issue body
# IS the plan store. `gh issue view --json body -q .body` fetches it, the SAME
# transforms run on that fetched body, and `gh issue edit --body-file <tmp>` writes
# it back: never any other gh flag (annotate-only; no lifecycle power). All refs
# are validated (digits-only `#<n>` or a strict issues URL) BEFORE any gh call, and
# every gh call uses `--`/`=`-form argv so an option-shaped value can never become
# a flag (cf. cmd_indiff F3). Nothing tool-authored is ever added to the issue.
# ---------------------------------------------------------------------------

# Is REF issue-SHAPED (routes to the issue adapter rather than the markdown path)?
# Anything starting with '#', or any http(s) URL, is issue-shaped. This is the
# ROUTING predicate only: a shaped ref is then strictly validated by
# issue_ref_validate, which fail-closes on a malformed one (e.g. '#--foo', '#',
# a non-issues URL). Markdown refs are relative/absolute file paths and never
# start with '#' (a bare '#anchor' has no file part and already dies in cmd_on),
# so this never steals a legitimate markdown ref. Pure predicate.
is_issue_ref() {
  case "$1" in
    '#'*|http://*|https://*) return 0 ;;
    *) return 1 ;;
  esac
}

# Validate an issue-shaped REF fail-closed. Accepts ONLY a digits-only `#<n>`
# (e.g. '#0', '#42', '#1234567': no lower bound) or a strict GitHub issues URL
# `https://github.com/<owner>/<repo>/issues/<n>`. Everything else (`#`, `#--foo`,
# `#1; rm -rf x`, `#1abc`, a `/pulls/` URL, any non-issues URL) `die`s before any
# gh call ever runs. Echoes nothing; the validated ref is the input verbatim.
issue_ref_validate() {
  local ref="$1"
  case "$ref" in
    '#'[0-9]*)
      # Reject anything after the digits (no trailing junk, no metachars).
      [[ "$ref" =~ ^#[0-9]+$ ]] \
        || die "cook: invalid issue ref: $ref (expected '#<digits>')." ;;
    http://*|https://*)
      [[ "$ref" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/issues/[0-9]+$ ]] \
        || die "cook: invalid issue URL: $ref (expected https://github.com/<owner>/<repo>/issues/<n>)." ;;
    *)
      die "cook: invalid issue ref: $ref (expected '#<digits>' or a github issues URL)." ;;
  esac
}

# Fetch the issue body for the (already-validated) REF to stdout via the body-only
# jq path. Degrades cleanly: `die` if gh is absent, or if `gh issue view` fails
# (e.g. unauthenticated). The `--` separator keeps a digits/URL ref from ever being
# reparsed as a gh flag. No token is printed or logged; the only egress is this
# call for the named issue.
gh_issue_fetch_body() {
  local ref="$1"
  command -v gh >/dev/null 2>&1 \
    || die "cook: \`gh\` is required to read issue $ref but was not found on PATH (install the GitHub CLI, then retry)."
  gh issue view "$ref" --json body -q .body -- \
    || die "cook: \`gh issue view\` failed for $ref (is gh authenticated? try \`gh auth status\`)."
}

# Write FILE back to the issue REF as its new body, using EXACTLY
# `gh issue edit <ref> --body-file <file>` and no other flag (annotate-only; never
# a state/label/assignee/milestone flag). The `=`-form `--body-file=` keeps the
# tmp path off the flag-parser path; `--` bounds the positional ref. `die`s if the
# edit fails (the caller is responsible for removing FILE on every path).
gh_issue_write_body() {
  local ref="$1" file="$2"
  command -v gh >/dev/null 2>&1 \
    || die "cook: \`gh\` is required to update issue $ref but was not found on PATH."
  gh issue edit "$ref" --body-file="$file" -- \
    || die "cook: \`gh issue edit\` failed for $ref."
}

# Run a plan op (section|check|append) against an ISSUE REF, reusing the markdown
# engine byte-for-byte on the FETCHED body. Lite-gated (writing a shared issue is a
# lite-only act). Validates REF before any gh call. Fetches the body to a tmp file,
# runs the SAME plan_* helper, and for check/append writes the result back via
# `gh issue edit --body-file`; section is read-only (prints bounds, no edit). The
# tmp file is removed on EVERY path including failure (no orphan, no partial write).
plan_issue_op() {
  local op="$1" ref="$2"; shift 2
  require_lite plan "writing a shared issue is a lite-only act"
  require_jq
  issue_ref_validate "$ref"

  local body
  body="$(mktemp)" || die "cook: could not create a temp file."
  # The temp body must be removed on EVERY exit path, including a `die` inside any
  # gh_issue_*/plan_*_file helper. `die` calls `exit`, which a RETURN trap would
  # NOT catch, so use an EXIT/INT/TERM trap and clear it on the success path.
  # No orphan temp, no partial write on failure.
  trap 'rm -f -- "$body"' EXIT INT TERM

  gh_issue_fetch_body "$ref" > "$body"

  case "$op" in
    section)
      # Read-only: print the bounds, no write-back, no gh edit.
      [ "$#" -eq 1 ] || die "usage: cook plan section <issue-ref> <anchor>"
      local out
      out="$(plan_section_bounds "$body" "$1")"
      [ -n "$out" ] || die "plan section: no heading matches anchor: $1"
      printf '%s\n' "$out"
      ;;
    check)
      [ "$#" -eq 1 ] || die "usage: cook plan check <issue-ref> <substring>"
      plan_check_file "$body" "$1"
      gh_issue_write_body "$ref" "$body"
      ;;
    append)
      [ "$#" -eq 2 ] || die "usage: cook plan append <issue-ref> <anchor> <text>"
      plan_append_file "$body" "$1" "$2"
      gh_issue_write_body "$ref" "$body"
      ;;
    *)
      die "unknown plan subcommand: $op"
      ;;
  esac

  rm -f -- "$body"
  trap - EXIT INT TERM
}

# Scan existing run-ledgers for one whose externalRef equals REF; echo its
# task.json path if found (idempotent re-adopt resume), else nothing.
find_ledger_by_external_ref() {
  local ref="$1" f
  [ -d "$BK/tasks" ] || return 1
  while IFS= read -r f; do
    if [ -f "$f" ] && jq -e --arg r "$ref" '.externalRef == $r' "$f" >/dev/null 2>&1; then
      printf '%s' "$f"
      return 0
    fi
  done < <(find "$BK/tasks" -name task.json 2>/dev/null)
  return 1
}

# Idempotent-resume helper for `cook on`: if a ledger already keys off REF, print
# the resume notice and return 0 (caller should then `return 0` and create nothing);
# otherwise return non-zero and print nothing. Both adopt paths (issue + markdown)
# resume identically by externalRef; only WHERE each calls this (relative to its own
# validation/fetch) differs, so the shared logic lives here while each branch keeps
# its own ordering.
resume_if_adopted() {
  local ref="$1" existing
  existing="$(find_ledger_by_external_ref "$ref")" || return 1
  printf 'cook: already adopted: resuming ledger for %s (%s).\n' "$ref" "${existing#"$ROOT"/}"
  return 0
}

# cook on <ref>: adopt a markdown plan location as a lite run-ledger.
#
# Lite mode only. Validates <ref> safely (strips '#anchor', requires the file to
# resolve inside ROOT: rejecting traversal, absolute escape, symlink escape, and
# missing files; fails CLOSED on anything unresolvable). On success creates a lite
# run-ledger keyed by externalRef. Idempotent: a ledger with the same externalRef
# is resumed, never duplicated.
cmd_on() {
  require_lite on "full mode tracks tasks in the registry"
  require_jq
  local ref="${1:-}"
  [ -n "$ref" ] || die "usage: cook on <ref>"
  [ "$#" -le 1 ] || die "on: unexpected argument '$2'"

  # Issue-ref path (github-issues adapter): validate fail-closed BEFORE any gh
  # call, then confirm the issue is reachable by fetching its body. The fetch
  # runs BEFORE any ledger dir/file is created, so an invalid ref, an absent gh,
  # or an unauth/404 view leaves ZERO partial state (no ledger, no remote write).
  # The ledger keys off the RAW ref verbatim, exactly like the markdown path.
  if is_issue_ref "$ref"; then
    issue_ref_validate "$ref"
    # Idempotent resume short-circuits before any gh call: a re-adopt of an
    # already-known issue resumes without re-reaching the remote.
    resume_if_adopted "$ref" && return 0
    # Fetch only to validate reachability + degrade cleanly; the body is discarded
    # (the plan ops fetch fresh on each call), so it goes straight to /dev/null,
    # no temp file, hence nothing to clean up or orphan. gh_issue_fetch_body `die`s
    # on an absent/unauth gh, and the ledger is created ONLY after a successful
    # fetch, so a degraded/unauth view leaves zero partial state.
    gh_issue_fetch_body "$ref" >/dev/null
    cmd_on_create_ledger "$ref"
    return 0
  fi

  # Strip any '#anchor' to get the file portion, then resolve it safely. We only
  # need confirmation it resolves inside ROOT; the ledger keys off the raw ref.
  local file_part
  file_part="${ref%%#*}"
  [ -n "$file_part" ] || die "cook on: invalid ref (no file part): $ref"
  resolve_ref_path "$file_part" >/dev/null \
    || die "cook on: ref must resolve to an existing file inside the repo: $ref"

  # Idempotent resume: an existing ledger with this externalRef wins.
  resume_if_adopted "$ref" && return 0

  cmd_on_create_ledger "$ref"
}

# Create the lite run-ledger (0008 shape: string id, externalRef, status pending,
# stage capture) for REF. Shared by the markdown and issue-ref adopt paths so the
# ledger JSON lives in exactly one place. Caller has already validated REF and
# confirmed there is no existing ledger for it (idempotent resume happens upstream).
cmd_on_create_ledger() {
  local ref="$1"

  mkdir -p "$BK/tasks"
  local leaf dir tmp now
  leaf="$(adopt_dir_leaf "$ref")"
  dir="$BK/tasks/$leaf"
  mkdir -p "$dir"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  tmp="$(mktemp)"
  jq -n --arg ref "$ref" --arg now "$now" '{
    schemaVersion: 1,
    id: $ref,
    externalRef: $ref,
    slug: "lite-adopt",
    title: $ref,
    status: "pending",
    stage: "capture",
    priority: "p2",
    deps: [],
    complexity: "complex",
    createdAt: $now,
    updatedAt: $now,
    agents: {
      implementer_agent_id: null,
      reviewer_agent_id:    null,
      reviewer2_agent_id:   null,
      audit_agent_id:       null
    },
    tests:  { authored_by_agent_id: null, green: false, evidence: [] },
    review: { verdict: null, reviewer_agent_id: null, evidence: [] },
    audit:  { required: false, verdict: "na", audit_agent_id: null, evidence: [] },
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$tmp"
  mv -f "$tmp" "$dir/task.json"
  printf 'cook: adopted %s → %s (lite, stage:capture).\n' "$ref" "${dir#"$ROOT"/}/task.json"
}

# ---------------------------------------------------------------------------
# Lite pipeline: in-diff refactor guard (`cook indiff`). Lite-only (refuses in
# full mode like `cook on`); it bounds refactor scope to the implement diff in a
# shared repo. The lite integration terminal is inference-driven (the orchestrator
# reads the profile's integration convention and produces the terminal in the
# team's shape), not a CLI verb.
# ---------------------------------------------------------------------------

# cook indiff <base-ref> <pre-ref>: in-diff refactor guard (lite-only).
#
# allowed = files changed from <base-ref> through implement (<pre-ref>):
#           git diff --name-only <base-ref> <pre-ref>
# actual  = files the refactor touched (working tree + index vs <pre-ref>):
#           git diff --name-only <pre-ref>
# Exit 0 iff actual ⊆ allowed; else exit non-zero, naming each offending path on
# stderr. The orchestrator runs this after the lite refactor stage so a refactor
# can never reach beyond the change's diff in someone else's repo.
cmd_indiff() {
  require_lite indiff "the in-diff guard bounds refactor in shared repos"

  local base_ref="${1:-}" pre_ref="${2:-}"
  [ -n "$base_ref" ] && [ -n "$pre_ref" ] || die "usage: cook indiff <base-ref> <pre-ref>"
  [ "$#" -le 2 ] || die "indiff: unexpected argument '$3'"

  git -C "$ROOT" rev-parse --show-toplevel >/dev/null 2>&1 \
    || die "not a git repository: $ROOT (indiff compares git diffs)."

  # `--end-of-options` marks the end of git options, so a user-supplied ref can
  # never be reparsed as a git diff option (F3): e.g. `--output=<path>` writing an
  # arbitrary file. An option-shaped ref then errors as a bad revision (caught by
  # `|| die`) instead. The trailing `--` keeps the empty pathspec list explicit.
  # (Refs must stay BEFORE the pathspec `--`: a ref placed after it is read as a
  # path, not a revision.)
  local allowed actual offending
  allowed="$(git -C "$ROOT" diff --name-only --end-of-options "$base_ref" "$pre_ref" -- 2>/dev/null | LC_ALL=C sort -u)" \
    || die "indiff: could not diff $base_ref..$pre_ref (bad ref?)."
  actual="$(git -C "$ROOT" diff --name-only --end-of-options "$pre_ref" -- 2>/dev/null | LC_ALL=C sort -u)" \
    || die "indiff: could not diff $pre_ref against the working tree (bad ref?)."

  # Offending = paths in actual that are NOT in allowed (set difference).
  offending="$(LC_ALL=C comm -23 <(printf '%s' "$actual") <(printf '%s' "$allowed"))"
  if [ -n "$offending" ]; then
    warn "indiff: refactor touched files outside the implement diff (base $base_ref → pre $pre_ref):"
    printf '%s\n' "$offending" | while IFS= read -r p; do
      [ -n "$p" ] && warn "  $p"
    done
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# verify: config-driven full-suite gate runner + hash-keyed run log.
#
# `cook verify` resolves the project's test command from config (full mode) or
# the operating profile prose (lite mode), runs it as `sh -c "$cmd"` (the same
# trust model as a Makefile recipe: the only author of the config already owns
# the repo), and uses the command's exit code as the verdict (0 = green). It
# takes NO positional that flows into the command (SEC: args never alter what
# runs). Unconfigured ⇒ FAIL CLOSED: a clear "no test command configured" error
# and a non-zero exit, NEVER an empty `sh -c ""` (which exits 0 = a silent green)
# and NEVER a hardcoded default (`make test`).
#
# `cook baseline check [<hash>]` answers "is <hash> (default HEAD) a known
# green+clean baseline?" purely from the run log: used by the entry-state
# carry-forward so a task can skip re-running a suite the tree already passed at.
# ---------------------------------------------------------------------------

# Echo the resolved test command for the active mode, or nothing.
# Full mode: `.testCommand` from .jeff/config.json (jq). Lite mode: the
# first backtick-delimited span on the profile prose line `Test command: \`…\`.`.
# A missing file/key/line, or an empty value, echoes NOTHING: the caller then
# fails closed. Read-only; never executes the command.
verify_resolve_command() {
  if [ "$(bake_mode)" = "lite" ]; then
    [ -f "$BK/profile.md" ] || return 0
    # Pull the first `…`-delimited span on the `Test command:` prose line.
    # POSIX sed: match the documented prefix, capture between the first pair of
    # backticks. Anchored on `Test command:` so no other backticked prose matches.
    sed -n 's/^Test command:[^`]*`\([^`]*\)`.*/\1/p' "$BK/profile.md" | head -1
  else
    [ -f "$BK/config.json" ] || return 0
    jq -r '.testCommand // empty' "$BK/config.json" 2>/dev/null
  fi
}

cmd_verify() {
  reject_unknown_args verify "$@"
  require_jq
  local cmd
  cmd="$(verify_resolve_command)"
  # Fail CLOSED on an unconfigured/empty/no-op command: die BEFORE any `sh -c`.
  # `[ -z "$cmd" ]` alone catches only "". Two more configured-but-no-op shapes
  # must fail closed too, or `sh -c "$cmd"` exits 0 = a SILENT GREEN:
  #   - whitespace-only (`"   "`)        → `sh -c "   "` is a no-op, exits 0.
  #   - comment-only (`"# nope"`)        → a leading `#` makes the whole line a
  #     shell comment, so `sh -c "# nope"` runs nothing and exits 0.
  # Trim leading/trailing whitespace (bash-3.2 parameter expansion, no GNU sed)
  # and treat the trimmed value as unconfigured when it is empty OR its first
  # char is `#`. Only the *first* non-whitespace char matters: `bats # all` is a
  # real command with a trailing comment and must NOT be rejected.
  local _trimmed="$cmd"
  _trimmed="${_trimmed#"${_trimmed%%[![:space:]]*}"}"   # strip leading ws
  _trimmed="${_trimmed%"${_trimmed##*[![:space:]]}"}"   # strip trailing ws
  if [ -z "$_trimmed" ] || [ "${_trimmed#\#}" != "$_trimmed" ]; then
    if [ "$(bake_mode)" = "lite" ]; then
      die "no test command configured (set a \`Test command: \`…\`.\` line in .jeff/profile.md): refusing to run a default (fail-closed)."
    else
      die "no test command configured (set \"testCommand\" in .jeff/config.json): refusing to run a default (fail-closed)."
    fi
  fi

  # Run the resolved command. Its exit code is the verdict (0 = green). The
  # `… && rc=0 || rc=$?` idiom captures the real rc under errexit.
  local rc
  sh -c "$cmd" && rc=0 || rc=$?

  local result
  if [ "$rc" -eq 0 ]; then
    result="green"
    printf 'cook: verify green (%s)\n' "$cmd"
  else
    result="red"
    warn "verify red (exit $rc): $cmd"
  fi

  # Full-mode run log: append exactly ONE jsonl line recording the verdict keyed
  # by the current git HEAD + tree-dirty flag, so `cook baseline check` can later
  # answer "is this hash a known green+clean baseline?" without re-running. Lite
  # mode's whole .jeff/ is already git-excluded and the team owns tracking,
  # so the log is a full-mode entry-state mechanism only.
  if [ "$(bake_mode)" != "lite" ] \
     && git -C "$ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
    local head dirty at log exclude
    head="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" || head=""
    if [ -n "$head" ]; then
      tree_dirty && dirty=true || dirty=false
      at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      log="$BK/test-runs.jsonl"
      # NO stdout/stderr field is ever recorded (only the verdict + provenance).
      jq -nc \
        --arg hash "$head" \
        --argjson dirty "$dirty" \
        --arg result "$result" \
        --arg suite "$cmd" \
        --arg at "$at" \
        '{hash:$hash, dirty:$dirty, result:$result, suite:$suite, at:$at}' \
        >> "$log"
      # Git-exclude the log locally + idempotently (per-clone, never committed).
      exclude="$(git_info_exclude)" || exclude=""
      [ -z "$exclude" ] || append_line_once "$exclude" ".jeff/test-runs.jsonl"
    fi
  fi

  return "$rc"
}

# cook baseline check [<hash>]
# Exit 0 IFF the run log carries a line { hash == <hash>, dirty == false,
# result == "green" } AND the tree is currently clean AND current HEAD == <hash>.
# Default hash = current HEAD. Any miss ⇒ non-zero + a one-line reason on stderr.
# Absent/empty log ⇒ non-zero cleanly (nothing anchored), never a crash.
cmd_baseline() {
  require_jq
  local sub="${1:-}"
  case "$sub" in
    check) shift ;;
    "")    die "usage: cook baseline check [<hash>]" ;;
    *)     die "unknown baseline subcommand: $sub (try \`cook baseline check\`)" ;;
  esac
  [ "$#" -le 1 ] || die "baseline check: unexpected argument '$2'"

  git -C "$ROOT" rev-parse --show-toplevel >/dev/null 2>&1 \
    || die "not a git repository: $ROOT (baseline check reads the git HEAD + tree state)."

  local head
  head="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" \
    || die "baseline check: could not determine the current HEAD."

  local want="${1:-$head}"

  # The tree must currently be at <hash> (asking about a hash the tree is not at
  # cannot be a baseline for the current work).
  [ "$head" = "$want" ] \
    || die "baseline check: HEAD ($head) is not at the requested hash ($want): not a baseline."

  # Tree must be clean OUTSIDE .jeff/: same probe tree_dirty uses, so
  # "clean here" matches "dirty:false logged" in the run log.
  tree_dirty \
    && die "baseline check: working tree is currently dirty: not a clean baseline." \
    || true

  local log="$BK/test-runs.jsonl"
  [ -s "$log" ] \
    || die "baseline check: no run log (.jeff/test-runs.jsonl absent or empty): nothing anchored at $want."

  # A green+clean line for <hash> must exist. Read line-by-line so a malformed
  # line cannot abort the scan; the slurp-free `-e` exit code is the verdict.
  if jq -e -s --arg h "$want" \
       'any(.[]; .hash == $h and .dirty == false and .result == "green")' \
       "$log" >/dev/null 2>&1; then
    printf 'cook: baseline OK: %s is a green+clean baseline.\n' "$want"
    return 0
  fi
  die "baseline check: no green+clean run logged for $want: not a baseline."
}

usage() {
  cat <<'EOF'
cook: Jeff v1-lean CLI.

Subcommands:
  validate     Check .jeff state against the schema + invariants (skips if not a jeff project).
  verify       Run the configured test command (full-suite gate); exit code is the verdict. Full mode appends a hash-keyed line to .jeff/test-runs.jsonl.
  baseline check [<hash>]  Exit 0 iff <hash> (default HEAD) is a green+clean baseline in the run log AND the tree is currently clean at it.
  ls           List tasks (id, status, stage, priority, title).
  status       In-flight tasks + backlog health.
  show <id>    Print one task's task.json.
  init         Activate jeff here: scaffold .jeff/ + mark active.
  lite         Activate LITE mode here: scaffold + git-exclude .jeff/ locally; no registry (for shared repos).
  on <ref>     [lite] Adopt a plan location as a run-ledger: a markdown file/PLAN.md#anchor, or a github issue (#<n> or an issues URL). Idempotent.
  plan <sub>   Plan-store helpers (target = file OR github issue #<n>/issues-URL): section <target> <anchor> | check <target> <substr> | append <target> <anchor> <text>.
  indiff <base-ref> <pre-ref>  [lite] In-diff refactor guard: fail if the refactor touched files outside the implement diff.
  deinit       Deactivate jeff here: mark inactive (keeps .jeff/).
  flavor       Resolve the effective voice (kitchen|plain): per-repo .jeff/config.json flavor > JEFF_FLAVOR env > default kitchen.
  profile      Print the active .jeff/profile.md and check it against the schema + size budget.
  profile init Write the default profile template to .jeff/profile.md (no-clobber).
  doctor       Report environment (jq) and active state.
  help         This help.
EOF
}

main() {
  local sub="${1:-help}"; shift || true
  case "$sub" in
    validate) cmd_validate "$@" ;;
    verify)   cmd_verify "$@" ;;
    baseline) cmd_baseline "$@" ;;
    ls)       cmd_ls "$@" ;;
    status)   cmd_status "$@" ;;
    show)     cmd_show "$@" ;;
    doctor)   cmd_doctor "$@" ;;
    init)     cmd_init "$@" ;;
    lite)     cmd_lite "$@" ;;
    on)       cmd_on "$@" ;;
    plan)     cmd_plan "$@" ;;
    indiff)   cmd_indiff "$@" ;;
    deinit)   cmd_deinit "$@" ;;
    flavor)   cmd_flavor "$@" ;;
    profile)  cmd_profile "$@" ;;
    help|-h|--help) usage ;;
    *) die "unknown subcommand: $sub (try \`cook help\`)" ;;
  esac
}

main "$@"
