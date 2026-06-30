#!/usr/bin/env bats
# tests/gh-issues.bats: bats suite for task 0011: GitHub-issues plan-store adapter.
#
# Covers (notes.md 12-item test list):
#   1.  cook on #<n>  → ledger: externalRef==#<n>, string id, status pending, stage capture.
#   2.  cook on <issue-url> → ledger keyed to the URL.
#   3.  Idempotent: second cook on #<n> resumes; exactly one ledger dir.
#   4.  Degraded: gh absent: clear message, non-zero, NO ledger created.
#   5.  Degraded: gh issue view fails (unauth): clear message, no partial ledger.
#   6.  cook plan append #<n> <heading> '- [ ] item' → body gains the item under
#       heading; written via gh issue edit --body-file; rest of body byte-preserved.
#   7.  cook plan check #<n> <substring> → ticks - [ ] → - [x]; idempotent re-tick.
#   8.  cook plan section #<n> <heading> → reads bounds; NO gh issue edit call.
#   9.  Structural gating: across adopt + write-back the gh log holds ONLY
#       `issue view` and `issue edit --body-file`: never close/state/label.
#   10. No-crumbs: appended body contains exactly the caller's text; no
#       "jeff"/tool boilerplate added by the adapter.
#   11. Ref validation: #--foo, #1; rm, #, a non-issues URL → rejected fail-closed,
#       never reach gh as a flag/arg.
#   12. Lite gating: issue-ref cook plan / cook on refused in full mode.
#
# Strategy:
#   - Fresh mktemp -d git repo per test (setup/teardown mirrors lite-adopt.bats).
#   - cook() wrapper: COOK_ROOT="$TMP" "$COOK" "$@"
#   - write_lite_config / write_full_config helpers.
#   - gh stub on a controlled PATH: logs argv, serves a fixture issue, captures
#     body-file for assertions. A failing variant (view exits non-zero) for #5.
#   - All tests RED now because the issue-ref path is NOT implemented in bin/cook:
#     cook on #<n> hits `resolve_ref_path` which treats #42 as a local file
#     ("" file part after stripping anchor from an empty string, or the hash char
#     itself), fails with die() → non-zero; cook plan section/check/append #<n>
#     passes "#42" as the <file> argument, resolve_ref_path fails → non-zero.
#     Tests asserting exit 0 + ledger creation / body-write are therefore red.
#     Tests asserting non-zero in degraded/validation paths are also red because
#     the correct failure message / no-ledger constraint can't hold until the
#     feature is implemented and the stub is wired.
#   - RED-now rationale added per test.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

# Fixture issue number and URL used throughout.
FIXTURE_ISSUE_NUM=42
FIXTURE_ISSUE_URL="https://github.com/test-owner/test-repo/issues/42"

# Fixture issue body (the markdown body the stub gh serves for issue view).
FIXTURE_BODY='# Issue title

## Plan

- [ ] implement the feature
- [ ] write tests for the feature
- [x] design the feature

## Notes

Some other content here.
'

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
  # Minimal git repo: required for bake_mode() / cook to resolve ROOT via git.
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@gh-issues.example"
  git -C "$TMP" config user.name "GH Issues Test"

  # Per-test log files for stub assertions.
  GH_ARGV_LOG="$TMP/gh-argv.log"
  GH_BODY_CAPTURE="$TMP/gh-body-capture.txt"

  # Write the stub gh binary. It serves two roles:
  #   - issue view <ref> --json body -q .body  → prints FIXTURE_BODY
  #   - issue view <ref> --json number,title,url  → prints fixture JSON
  #   - issue edit <ref> --body-file <path>  → copies body-file to capture, exits 0
  #   - every invocation appends its full argv (space-joined, one per line) to log
  #
  # The stub reads FIXTURE_BODY via an env var (GH_STUB_BODY) so it does not need
  # to locate the bats test dir at runtime. It also honours GH_STUB_FAIL_VIEW: when
  # set to "1", the `issue view` path exits 1 (simulating an auth failure).
  GH_STUB_DIR="$(mktemp -d)"
  # Export variables the stub needs.
  export GH_ARGV_LOG GH_BODY_CAPTURE GH_STUB_FAIL_VIEW="${GH_STUB_FAIL_VIEW:-0}"
  # The stub body is written to a file (env var can't hold newlines reliably across
  # all sh implementations; a file is portable and hermetic).
  printf '%s' "$FIXTURE_BODY" > "$TMP/gh-fixture-body.txt"
  export GH_STUB_BODY_FILE="$TMP/gh-fixture-body.txt"

  # Export fixture values for the stub to serve.
  export FIXTURE_ISSUE_NUM FIXTURE_ISSUE_URL

  cat > "$GH_STUB_DIR/gh" <<'GHSTUB'
#!/bin/sh
# Stub gh: logs argv, serves fixture data, captures body-file writes.
# Reads: GH_ARGV_LOG, GH_BODY_CAPTURE, GH_STUB_FAIL_VIEW, GH_STUB_BODY_FILE,
#        FIXTURE_ISSUE_NUM, FIXTURE_ISSUE_URL.

# Log full argv (space-joined).
printf '%s\n' "$*" >> "${GH_ARGV_LOG:-/dev/null}"

# Dispatch on subcommand.
subcmd="$1"; shift
[ "$subcmd" = "issue" ] || exit 1
action="$1"; shift

case "$action" in
  view)
    # Reject if stub is set to fail view (simulates unauth).
    [ "${GH_STUB_FAIL_VIEW:-0}" = "1" ] && {
      printf 'gh: error: HTTP 401: Unauthorized\n' >&2
      exit 1
    }
    # Consume the ref (first positional after 'view').
    _ref="$1"; shift
    # Serve body or JSON depending on flags.
    _body_only=0
    _want_json=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --json)   _want_json=1 ;;
        -q|--jq)  _body_only=1 ;;
        *)        ;;
      esac
      shift
    done
    if [ "$_body_only" -eq 1 ]; then
      # jq filter was -q .body or --jq .body → just emit the body text.
      cat "${GH_STUB_BODY_FILE}"
    else
      # --json without -q → emit a JSON object.
      body_content="$(cat "${GH_STUB_BODY_FILE}")"
      printf '{"number":%s,"title":"Fixture issue","url":"%s","body":"%s"}\n' \
        "${FIXTURE_ISSUE_NUM}" "${FIXTURE_ISSUE_URL}" \
        "$(printf '%s' "$body_content" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//')"
    fi
    exit 0
    ;;
  edit)
    # Consume ref.
    _ref="$1"; shift
    # Find --body-file <path> in remaining args.
    _body_path=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --body-file)  _body_path="$2"; shift ;;
        --body-file=*) _body_path="${1#--body-file=}" ;;
      esac
      shift
    done
    if [ -n "$_body_path" ] && [ -f "$_body_path" ]; then
      cat "$_body_path" > "${GH_BODY_CAPTURE}"
    fi
    exit 0
    ;;
  *)
    printf 'gh stub: unknown action: %s\n' "$action" >&2
    exit 1
    ;;
esac
GHSTUB
  chmod +x "$GH_STUB_DIR/gh"
  GH_STUB_PATH="$GH_STUB_DIR:$(command -v git | xargs dirname):/usr/bin:/bin"
}

teardown() {
  rm -rf "$TMP" "${GH_STUB_DIR:-}"
}

# Shorthand: run cook with $TMP as COOK_ROOT and stub gh on PATH.
cook() {
  PATH="$GH_STUB_PATH" COOK_ROOT="$TMP" "$COOK" "$@"
}

# bake_no_gh: run cook with NO gh on PATH (for degraded-absent tests).
bake_no_gh() {
  local no_gh_path
  no_gh_path="$(mktemp -d)"
  PATH="$no_gh_path:/usr/bin:/bin" COOK_ROOT="$TMP" "$COOK" "$@"
  local rc=$?
  rm -rf "$no_gh_path"
  return $rc
}

# bake_fail_view: run cook with gh stub that exits non-zero on issue view.
bake_fail_view() {
  GH_STUB_FAIL_VIEW=1 PATH="$GH_STUB_PATH" COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

write_full_config() {
  jq -n '{schemaVersion:1, mode:"full", active:true}' > "$BK/config.json"
}

# find_ledger_by_ref: find a task.json whose externalRef equals <ref>.
# Does not assume a dir name. Returns the path or empty.
find_ledger_by_ref() {
  local ref="$1" f
  while IFS= read -r f; do
    if [ -f "$f" ] && jq -e --arg r "$ref" '.externalRef == $r' "$f" >/dev/null 2>&1; then
      printf '%s\n' "$f"
      return 0
    fi
  done < <(find "$BK/tasks" -name task.json 2>/dev/null)
  return 1
}

# count_ledgers: number of task.json files under .jeff/tasks/.
count_ledgers() {
  find "$BK/tasks" -name task.json 2>/dev/null | wc -l | tr -d ' '
}

# gh_log_contains: true iff GH_ARGV_LOG contains a line matching the fixed string.
gh_log_contains() {
  grep -qF -- "$1" "$GH_ARGV_LOG" 2>/dev/null
}

# gh_log_not_contains: true iff GH_ARGV_LOG does NOT contain the fixed string.
gh_log_not_contains() {
  ! grep -qF -- "$1" "$GH_ARGV_LOG" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Test 1: cook on #<n> creates a ledger with the right fields
# ---------------------------------------------------------------------------

@test "adopt-gh/basic: cook on #42 creates a lite ledger with externalRef=#42" {
  # AC: cook on #<n> adopts the issue → lite run-ledger keyed to the raw ref.
  # RED now: cmd_on strips the '#anchor' from the ref, leaving an empty file_part
  # ("" for a bare "#42" where file_part = ref%%#* = ""), then dies with
  # "invalid ref (no file part)" → exits non-zero. The ledger is never created.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"
  [ -n "$ledger" ]
}

@test "adopt-gh/ledger-fields: externalRef equals the raw #<n> ref" {
  # AC: externalRef in the ledger == "#42".
  # RED now: no ledger created (cmd_on dies on empty file_part).
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  local ledger extref
  ledger="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"
  [ -n "$ledger" ]
  extref="$(jq -r '.externalRef' "$ledger")"
  [ "$extref" = "#${FIXTURE_ISSUE_NUM}" ]
}

@test "adopt-gh/ledger-fields: id equals the raw #<n> ref string" {
  # AC: id in the ledger == "#42" (string id, lite mode).
  # RED now: no ledger created.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  local ledger id
  ledger="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"
  [ -n "$ledger" ]
  id="$(jq -r '.id' "$ledger")"
  [ "$id" = "#${FIXTURE_ISSUE_NUM}" ]
}

@test "adopt-gh/ledger-fields: status is pending after first adopt" {
  # AC: new ledger has status:"pending".
  # RED now: no ledger created.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  local ledger st
  ledger="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"
  [ -n "$ledger" ]
  st="$(jq -r '.status' "$ledger")"
  [ "$st" = "pending" ]
}

@test "adopt-gh/ledger-fields: stage is capture after first adopt" {
  # AC: new ledger has stage:"capture".
  # RED now: no ledger created.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  local ledger stage
  ledger="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"
  [ -n "$ledger" ]
  stage="$(jq -r '.stage' "$ledger")"
  [ "$stage" = "capture" ]
}

# ---------------------------------------------------------------------------
# Test 2: cook on <issue-url> creates a ledger keyed to the URL
# ---------------------------------------------------------------------------

@test "adopt-gh/url: cook on <issue-url> creates ledger keyed to the URL" {
  # AC: cook on <issue-url> adopts the issue → ledger with externalRef == URL.
  # RED now: resolve_ref_path treats the https:// URL as a relative path from ROOT
  # and fails when that path does not exist → exits non-zero.
  write_lite_config

  run cook on "$FIXTURE_ISSUE_URL"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "$FIXTURE_ISSUE_URL")"
  [ -n "$ledger" ]
}

@test "adopt-gh/url: ledger externalRef equals the full URL" {
  # AC: externalRef in the ledger == the full issue URL.
  # RED now: no ledger created.
  write_lite_config

  run cook on "$FIXTURE_ISSUE_URL"
  [ "$status" -eq 0 ]

  local ledger extref
  ledger="$(find_ledger_by_ref "$FIXTURE_ISSUE_URL")"
  [ -n "$ledger" ]
  extref="$(jq -r '.externalRef' "$ledger")"
  [ "$extref" = "$FIXTURE_ISSUE_URL" ]
}

# ---------------------------------------------------------------------------
# Test 3: Idempotent re-adopt
# ---------------------------------------------------------------------------

@test "adopt-gh/idempotent: second cook on #<n> exits 0" {
  # AC: re-adopt must not error.
  # RED now: first adopt fails → second never reached.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]
}

@test "adopt-gh/idempotent: two adopts of #<n> produce exactly one ledger" {
  # AC: re-adopt must NOT create a second ledger dir.
  # RED now: no ledger created at all.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]
  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]

  local n
  n="$(count_ledgers)"
  [ "$n" -eq 1 ]
}

@test "adopt-gh/idempotent: second adopt returns the same ledger path" {
  # AC: same ref → resume existing ledger (detect by externalRef match).
  # RED now: no ledger at all.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]
  local first
  first="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]
  local second
  second="$(find_ledger_by_ref "#${FIXTURE_ISSUE_NUM}")"

  # Must be the same file (same ledger dir), not a duplicate.
  [ "$first" = "$second" ]
}

# ---------------------------------------------------------------------------
# Test 4: Degraded: gh absent → clear message, non-zero, no ledger
# ---------------------------------------------------------------------------

@test "adopt-gh/degraded-absent: gh absent → exits non-zero" {
  # AC: gh absent from PATH → non-zero.
  # RED now: the current cmd_on does not call gh at all for file refs; for issue
  # refs, the feature is unimplemented so cmd_on dies before any gh call anyway.
  # Once implemented, the gh-absent path must die with a clear message.
  write_lite_config

  run bake_no_gh on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -ne 0 ]
}

@test "adopt-gh/degraded-absent: gh absent → no ledger created" {
  # AC: gh absent → no partial ledger.
  # RED now: no ledger (trivially passing, but pins the no-partial-write guarantee).
  write_lite_config

  run bake_no_gh on "#${FIXTURE_ISSUE_NUM}"

  local n
  n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "adopt-gh/degraded-absent: gh absent → clear message on stderr" {
  # AC: a human-readable error message must appear (not a silent non-zero).
  # RED now: cook currently dies with "invalid ref (no file part)" which is wrong.
  # Once implemented: the message must mention gh or the issue or explain the problem.
  write_lite_config

  run bake_no_gh on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -ne 0 ]
  # The output must not be empty: a message is required.
  [ -n "$output" ]
}

# ---------------------------------------------------------------------------
# Test 5: Degraded: gh issue view fails (unauth)
# ---------------------------------------------------------------------------

@test "adopt-gh/degraded-unauth: gh issue view failure → exits non-zero" {
  # AC: gh issue view failing → non-zero, clear message.
  # RED now: the feature is unimplemented; cmd_on doesn't call gh for issue refs.
  write_lite_config

  run bake_fail_view on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -ne 0 ]
}

@test "adopt-gh/degraded-unauth: gh issue view failure → no partial ledger" {
  # AC: unauth → no partial write.
  # RED now: no ledger (trivially passing, pins the no-partial-write guarantee).
  write_lite_config

  run bake_fail_view on "#${FIXTURE_ISSUE_NUM}"

  local n
  n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Test 6: cook plan append #<n> <heading> <item>
# ---------------------------------------------------------------------------

@test "plan-append-gh/basic: item appears in captured body under the heading" {
  # AC: cook plan append #<n> <heading> <item> → fetches body, appends item under
  # heading, writes back via gh issue edit --body-file.
  # RED now: plan_append receives "#42" as the <file> argument, calls
  # resolve_ref_path("#42") which looks for a local file named "#42" inside ROOT
  # (which doesn't exist) → dies with a file-not-found error → exits non-zero.
  write_lite_config
  # Clear the capture file before the test.
  : > "$GH_BODY_CAPTURE"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] new task item"
  [ "$status" -eq 0 ]

  # The captured body must contain the new item.
  grep -qF -- "- [ ] new task item" "$GH_BODY_CAPTURE"
}

@test "plan-append-gh/byte-preservation: content outside the heading is preserved" {
  # AC: rest of body is byte-preserved; only the target section gains the new item.
  # RED now: same resolution failure as above.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] appended task"
  [ "$status" -eq 0 ]

  # ## Notes section and its content must survive.
  grep -qF "## Notes" "$GH_BODY_CAPTURE"
  grep -qF "Some other content here." "$GH_BODY_CAPTURE"
}

@test "plan-append-gh/position: appended item lands before the next heading" {
  # AC: the appended line appears inside the ## Plan section, before ## Notes.
  # RED now: unimplemented path.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] positioned item"
  [ "$status" -eq 0 ]

  # ## Plan must appear before ## Notes; appended item between them.
  local plan_line notes_line item_line
  plan_line="$(grep -n '## Plan' "$GH_BODY_CAPTURE" | head -1 | cut -d: -f1)"
  notes_line="$(grep -n '## Notes' "$GH_BODY_CAPTURE" | head -1 | cut -d: -f1)"
  item_line="$(grep -n '^\- \[ \] positioned item' "$GH_BODY_CAPTURE" | head -1 | cut -d: -f1)"

  [ -n "$item_line" ]
  [ "$item_line" -gt "$plan_line" ]
  [ "$item_line" -lt "$notes_line" ]
}

@test "plan-append-gh/write-back: gh issue edit --body-file is invoked" {
  # AC: each issue-ref write is 'gh issue edit <ref> --body-file <tmp>'.
  # RED now: no gh call is made (feature not implemented).
  write_lite_config

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] check-write-back"
  [ "$status" -eq 0 ]

  # The gh argv log must contain 'issue edit' with '--body-file'.
  gh_log_contains "issue edit"
  gh_log_contains "--body-file"
}

# ---------------------------------------------------------------------------
# Test 7: cook plan check #<n> <substring>
# ---------------------------------------------------------------------------

@test "plan-check-gh/tick: first unchecked item matching substring is ticked" {
  # AC: cook plan check #<n> <substring> → ticks - [ ] → - [x] in the issue body.
  # RED now: plan_check receives "#42" as <file>, resolve_ref_path fails → non-zero.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan check "#${FIXTURE_ISSUE_NUM}" "implement the feature"
  [ "$status" -eq 0 ]

  # The captured body must have the item ticked.
  grep -qF -- "- [x] implement the feature" "$GH_BODY_CAPTURE"
}

@test "plan-check-gh/idempotent: already-checked item stays checked, exits 0" {
  # AC: already-[x] item containing the substring stays [x] and command succeeds.
  # RED now: unimplemented path.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  # "design the feature" is already - [x] in the fixture body.
  run cook plan check "#${FIXTURE_ISSUE_NUM}" "design the feature"
  [ "$status" -eq 0 ]
}

@test "plan-check-gh/write-back: ticking invokes gh issue edit --body-file" {
  # AC: write-back uses only gh issue edit <ref> --body-file <tmp>.
  # RED now: no gh call.
  write_lite_config

  run cook plan check "#${FIXTURE_ISSUE_NUM}" "implement the feature"
  [ "$status" -eq 0 ]

  gh_log_contains "issue edit"
  gh_log_contains "--body-file"
}

# ---------------------------------------------------------------------------
# Test 8: cook plan section #<n> <heading> (read-only, no edit call)
# ---------------------------------------------------------------------------

@test "plan-section-gh/basic: prints START END for ## Plan" {
  # AC: cook plan section #<n> <anchor> → fetches body, prints line range, NO edit.
  # RED now: plan_section receives "#42" as <file>, resolve_ref_path fails → non-zero.
  write_lite_config

  run cook plan section "#${FIXTURE_ISSUE_NUM}" "plan"
  [ "$status" -eq 0 ]

  # Output must be two space-separated integers.
  [[ "$output" =~ ^[0-9]+\ [0-9]+$ ]]
  local start end
  read -r start end <<< "$output"
  [ "$start" -gt 0 ]
  [ "$end" -gt "$start" ]
}

@test "plan-section-gh/no-edit-call: section is read-only (no gh issue edit)" {
  # AC: cook plan section must NOT emit a gh issue edit call; it is read-only.
  # RED now: unimplemented: no gh calls at all, but once implemented the read
  # path must specifically not write.
  write_lite_config
  # Clear the log so we can assert absence.
  : > "$GH_ARGV_LOG"

  run cook plan section "#${FIXTURE_ISSUE_NUM}" "plan"
  [ "$status" -eq 0 ]

  # The gh argv log must NOT contain 'issue edit'.
  gh_log_not_contains "issue edit"
}

# ---------------------------------------------------------------------------
# Test 9: Structural gating: only issue view + issue edit --body-file
# ---------------------------------------------------------------------------

@test "structural-gating: gh log has no issue close across adopt + write-back" {
  # AC: the adapter can only read and write the body; it must NEVER close an issue.
  # RED now: feature unimplemented; but once it is, this asserts the structural limit.
  write_lite_config
  : > "$GH_ARGV_LOG"

  # Adopt.
  run cook on "#${FIXTURE_ISSUE_NUM}"
  # Write-back: append an item.
  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] structural gating item"
  # Tick it.
  run cook plan check "#${FIXTURE_ISSUE_NUM}" "structural gating item"

  # The gh log must contain 'issue view' and 'issue edit' but NOT 'issue close'.
  gh_log_contains "issue view"
  gh_log_not_contains "issue close"
}

@test "structural-gating: gh log has no --add-label across adopt + write-back" {
  # AC: the adapter must NEVER add labels to an issue.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#${FIXTURE_ISSUE_NUM}"
  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] label-gating item"

  # gh_log_contains "issue view" guards the negative assertion: without this,
  # the "no --add-label" check passes trivially when gh is never called (wrong reason).
  # RED now: gh is not called → "issue view" absent from log → this fails.
  gh_log_contains "issue view"
  gh_log_not_contains "--add-label"
}

@test "structural-gating: gh log has no --remove-label across adopt + write-back" {
  # AC: no label removal.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#${FIXTURE_ISSUE_NUM}"
  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] remove-label-gating item"

  # gh_log_contains "issue view" guards the negative assertion: without this,
  # the "no --remove-label" check passes trivially when gh is never called (wrong reason).
  # RED now: gh is not called → "issue view" absent from log → this fails.
  gh_log_contains "issue view"
  gh_log_not_contains "--remove-label"
}

@test "structural-gating: gh log has no --state flag across adopt + write-back" {
  # AC: no state transitions (open/closed) via the adapter.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#${FIXTURE_ISSUE_NUM}"
  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] state-gating item"

  # gh_log_contains "issue view" guards the negative assertion: without this,
  # the "no --state" check passes trivially when gh is never called (wrong reason).
  # RED now: gh is not called → "issue view" absent from log → this fails.
  gh_log_contains "issue view"
  gh_log_not_contains "--state"
}

@test "structural-gating: gh log has no --assignee flag across adopt + write-back" {
  # AC: no assignee changes via the adapter.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#${FIXTURE_ISSUE_NUM}"
  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] assignee-gating item"

  # gh_log_contains "issue view" guards the negative assertion: without this,
  # the "no --assignee" check passes trivially when gh is never called (wrong reason).
  # RED now: gh is not called → "issue view" absent from log → this fails.
  gh_log_contains "issue view"
  gh_log_not_contains "--assignee"
}

@test "structural-gating: gh log has no --milestone flag across adopt + write-back" {
  # AC: no milestone changes via the adapter.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#${FIXTURE_ISSUE_NUM}"
  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] milestone-gating item"

  # gh_log_contains "issue view" guards the negative assertion: without this,
  # the "no --milestone" check passes trivially when gh is never called (wrong reason).
  # RED now: gh is not called → "issue view" absent from log → this fails.
  gh_log_contains "issue view"
  gh_log_not_contains "--milestone"
}

@test "structural-gating: gh edit call uses --body-file (not --body) for write-back" {
  # AC: write-back must use --body-file (a tmp path), never --body= with inline content
  # (which would embed content in the process table / argv log).
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] body-file-form item"
  [ "$status" -eq 0 ]

  # Must use --body-file, not --body (which would expose content in argv).
  gh_log_contains "--body-file"
  gh_log_not_contains " --body "
}

# ---------------------------------------------------------------------------
# Test 10: No crumbs: written body contains no "jeff" string
# ---------------------------------------------------------------------------

@test "no-crumbs: appended body has no 'jeff' string" {
  # AC: nothing written to the issue may contain the literal string "jeff"
  # or any tool marker. Write-back emits only caller-supplied content.
  # RED now: feature unimplemented; but once it is, the captured body must be clean.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] crumb-free item"
  [ "$status" -eq 0 ]

  # The captured body must not contain "jeff" in any casing.
  ! grep -qiF "jeff" "$GH_BODY_CAPTURE"
}

@test "no-crumbs: appended body has no 'cook:' tool marker" {
  # AC: no tool-authored boilerplate line (e.g. cook: adopted …) in the write-back.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] marker-free item"
  [ "$status" -eq 0 ]

  # No "cook:" prefix lines (the cook CLI prints these to stdout, never to the issue).
  ! grep -qF "cook:" "$GH_BODY_CAPTURE"
}

@test "no-crumbs: appended body contains exactly the caller-supplied item text" {
  # AC: write-back emits only caller-supplied content; no boilerplate header/footer.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] exact-content item"
  [ "$status" -eq 0 ]

  # The item must appear verbatim.
  grep -qF -- "- [ ] exact-content item" "$GH_BODY_CAPTURE"
}

@test "no-crumbs: ticked body has no 'jeff' string" {
  # AC: same no-crumbs invariant applies to the check (tick) write-back path.
  # RED now: feature unimplemented.
  write_lite_config
  : > "$GH_BODY_CAPTURE"

  run cook plan check "#${FIXTURE_ISSUE_NUM}" "implement the feature"
  [ "$status" -eq 0 ]

  ! grep -qiF "jeff" "$GH_BODY_CAPTURE"
}

# ---------------------------------------------------------------------------
# Test 11: Ref validation (fail-closed)
# ---------------------------------------------------------------------------

@test "ref-validation: bare # is rejected, never reaches gh" {
  # AC: bare '#' is not a valid issue ref; must be rejected before any gh call.
  # RED now: cmd_on strips '#anchor' leaving empty file_part → dies with
  # "invalid ref (no file part)": non-zero, correct exit, wrong message.
  # Once implemented: must reject specifically as invalid issue ref.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#"
  [ "$status" -ne 0 ]

  # No gh call must have been made.
  [ ! -s "$GH_ARGV_LOG" ]
  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "ref-validation: option-shaped #--foo is rejected, never reaches gh" {
  # AC: option-shaped issue ref must be rejected fail-closed before any gh call.
  # This prevents the ref from becoming a gh flag.
  # RED now: cmd_on strips '#--foo' leaving empty file_part → dies.
  # Once implemented: must detect and reject option-shaped refs.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#--foo"
  [ "$status" -ne 0 ]

  # gh must NOT have been called (no argv logged).
  [ ! -s "$GH_ARGV_LOG" ]
  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "ref-validation: shell-injection #1; rm -rf x is rejected" {
  # AC: semicolon / shell metacharacters in the ref are rejected before gh.
  # RED now: dies on file_part resolution.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#1; rm -rf x"
  [ "$status" -ne 0 ]

  [ ! -s "$GH_ARGV_LOG" ]
  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "ref-validation: non-issues URL is rejected" {
  # AC: a URL that is not a GitHub issues URL must be rejected.
  # RED now: resolve_ref_path treats it as a relative path that doesn't exist → dies.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "https://github.com/owner/repo/pulls/42"
  [ "$status" -ne 0 ]

  [ ! -s "$GH_ARGV_LOG" ]
  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "ref-validation: option-shaped ref does not appear as gh flag in argv" {
  # AC: argv discipline: an option-shaped ref (#--foo or similar) must NEVER
  # be passed as a positional that gh would interpret as a flag.
  # RED now: the ref never reaches gh (cmd_on dies earlier), which satisfies the
  # no-gh-call constraint; once implemented the validation gate enforces this.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#--json"
  [ "$status" -ne 0 ]

  # gh must not have received any call where "--json" was a positional (bare ref).
  # If gh was called, it would log argv containing "--json" passed as the ref.
  # The key assertion: no ledger, and no gh invocation.
  [ ! -s "$GH_ARGV_LOG" ]
}

@test "ref-validation: plan append with option-shaped #--foo is rejected" {
  # AC: cook plan append with an option-shaped issue ref → rejected before gh.
  # RED now: resolve_ref_path fails on "#--foo" as a local file name → non-zero.
  # Once implemented: the issue-ref validator must specifically catch this.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook plan append "#--foo" "plan" "- [ ] injection item"
  [ "$status" -ne 0 ]

  [ ! -s "$GH_ARGV_LOG" ]
}

@test "ref-validation: plan check with option-shaped #--foo is rejected" {
  # AC: cook plan check with option-shaped ref → rejected.
  # RED now: same resolution failure.
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook plan check "#--foo" "some item"
  [ "$status" -ne 0 ]

  [ ! -s "$GH_ARGV_LOG" ]
}

# ---------------------------------------------------------------------------
# Test 12: Lite gating: issue-ref ops refused in full mode
# ---------------------------------------------------------------------------

@test "lite-gating: cook on #<n> refused in full mode (no config)" {
  # AC: cook on is a lite-only command; must refuse in full mode.
  # RED now: cmd_on already calls require_lite → exits non-zero in full mode.
  # This test will go GREEN with the current code for the wrong reason
  # (die("unknown subcommand") is replaced by require_lite), but it pins the
  # behavior that must hold after implementation too.
  # We still include it because after implementation the error message must change
  # from "no file part" / "invalid ref" to the require_lite message.
  # No config.json → full mode.

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -ne 0 ]

  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "lite-gating: cook on #<n> refused with explicit mode:full config" {
  # AC: explicit full mode config → refusal, no ledger.
  # RED now: cmd_on already calls require_lite → non-zero. Same reasoning as above.
  write_full_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -ne 0 ]

  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "lite-gating: cook plan append #<n> refused in full mode" {
  # AC: issue-ref cook plan is a lite-only act; refused in full mode.
  # RED now: plan_append doesn't have a lite gate yet, but resolve_ref_path
  # will fail on the issue ref anyway → non-zero for the wrong reason.
  # Once implemented, the issue-ref detection must fire the lite gate.
  # No config.json → full mode.

  run cook plan append "#${FIXTURE_ISSUE_NUM}" "plan" "- [ ] full-mode item"
  [ "$status" -ne 0 ]
}

@test "lite-gating: cook plan check #<n> refused in full mode" {
  # AC: issue-ref plan check is lite-only.
  # RED now: resolve_ref_path fails → non-zero for wrong reason.

  run cook plan check "#${FIXTURE_ISSUE_NUM}" "some item"
  [ "$status" -ne 0 ]
}

@test "lite-gating: cook plan section #<n> refused in full mode" {
  # AC: issue-ref plan section is lite-only.
  # RED now: resolve_ref_path fails → non-zero for wrong reason.

  run cook plan section "#${FIXTURE_ISSUE_NUM}" "plan"
  [ "$status" -ne 0 ]
}

@test "lite-gating: in lite mode, cook on #<n> succeeds (positive control)" {
  # AC: the lite gate must pass in lite mode (positive control for the gate tests).
  # RED now: cmd_on dies on issue-ref handling → exits non-zero even in lite mode.
  write_lite_config

  run cook on "#${FIXTURE_ISSUE_NUM}"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Additional: valid #<n>: digits-only check (accept) vs non-digits (reject)
# ---------------------------------------------------------------------------

@test "ref-validation: #0 (zero) is accepted as a valid issue ref" {
  # AC: digits-only issue numbers are valid, including edge case #0.
  # RED now: cmd_on dies on issue-ref resolution.
  write_lite_config

  run cook on "#0"
  [ "$status" -eq 0 ]
}

@test "ref-validation: #1234567 (large number) is accepted as a valid issue ref" {
  # AC: large-digit issue numbers are valid.
  # RED now: cmd_on dies on issue-ref resolution.
  write_lite_config

  run cook on "#1234567"
  [ "$status" -eq 0 ]
}

@test "ref-validation: #1abc (mixed alphanumeric) is rejected" {
  # AC: non-digits-only issue ref must be rejected. The spec says digits-only #<n>.
  # RED now: cmd_on dies either way, but once implemented it must specifically reject
  # alphanumeric refs (not just option-shaped ones).
  write_lite_config
  : > "$GH_ARGV_LOG"

  run cook on "#1abc"
  [ "$status" -ne 0 ]

  # Must not reach gh.
  [ ! -s "$GH_ARGV_LOG" ]
}
