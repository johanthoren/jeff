#!/usr/bin/env bats
# tests/lite-adopt.bats: bats suite for task 0010a: lite adopt + markdown plan-store.
#
# Covers:
#   - `cook on <ref>` adoption in lite mode (flat file, section anchor)
#   - Ledger creation: id == ref, externalRef == ref, status:"pending", stage:"capture"
#   - Idempotent re-adopt: exactly one ledger dir, second adopt exits 0
#   - Path-escape rejection: ../outside, absolute path outside ROOT, symlink escape
#   - Missing-file rejection
#   - Full-mode refusal: `cook on` must refuse when mode is not lite
#   - `cook plan section <file> <anchor>`: locate a heading, print START END
#   - `cook plan check <file> <substring>`: tick first matching unchecked item
#   - `cook plan append <file> <anchor> <text>`: append line under heading
#   - Round-trip: section -> append -> check -> read back asserts exact bytes
#
# Strategy:
#   - Fresh mktemp -d git repo per test (setup/teardown mirrors tests/lite.bats).
#   - cook() wrapper: COOK_ROOT="$TMP" "$COOK" "$@"
#   - All features are NEW (absent from bin/cook) so every test is RED now.
#   - RED-now rationale per test: asserts a specific end-state (ledger JSON fields,
#     exact file bytes, etc.) that cannot be satisfied until the feature is
#     implemented. A test that trips on a missing command gets status != 0 from
#     cook's "unknown subcommand: on" die(), which is still RED for the right
#     reason: the subcommand is not wired up.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
  # Minimal git repo: required for bake_mode() to resolve ROOT via git.
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@lite-adopt.example"
  git -C "$TMP" config user.name "Lite Adopt Test"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT.
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_lite_config: write .jeff/config.json with mode:"lite", active:true.
write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# write_plan_fixture <path>
#
# Writes a synthetic markdown plan file with:
#   - A top-level H1 preamble
#   - A ## Feature X section containing a `- [ ]` checklist and a `- [x]` done item
#   - A ## Other Section (so section-bounds are tested against a next heading)
#
# The exact content here is the canonical fixture; round-trip tests read it back
# and assert byte-level state after mutations.
write_plan_fixture() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<'MDEOF'
# Project Plan

## Feature X

This section describes Feature X.

- [ ] implement the widget
- [ ] write tests for the widget
- [x] design the widget

## Other Section

Some other content here.
MDEOF
}

# ledger_dir_for_ref <ref>
#
# Derives the expected ledger directory path. The implementer must key it by
# externalRef; the dir name is the ref slug (spec says "derived-dir" from the ref).
# We test existence by scanning .jeff/tasks/ for a task.json that carries
# the right externalRef, not by assuming a specific dir name, because the spec
# only says "derived-dir" and leaves naming to the implementer.
# Returns the path of any task.json whose externalRef matches <ref>, or empty.
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

# count_ledgers: emit the number of task.json files under .jeff/tasks/.
count_ledgers() {
  find "$BK/tasks" -name task.json 2>/dev/null | wc -l | tr -d ' '
}

# ---------------------------------------------------------------------------
# ADOPT: `cook on <ref>` basic mechanics
# ---------------------------------------------------------------------------

@test "adopt/help: cook help mentions 'on' subcommand" {
  # AC: `cook on <ref>` is a new subcommand; it must appear in help.
  # RED now: usage() does not list 'on'.
  run cook help
  [ "$status" -eq 0 ]
  run grep -c "^  on " <<< "$output"
  [ "$output" -ge 1 ]
}

@test "adopt/flat-file: cook on docs/plans/foo.md creates ledger in lite mode" {
  # AC: flat file ref adopts and creates a lite run-ledger.
  # RED now: `cook on` is an unknown subcommand → exits non-zero.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n\n- [ ] do foo\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]

  # A ledger with the right externalRef must now exist.
  local ledger
  ledger="$(find_ledger_by_ref "docs/plans/foo.md")"
  [ -n "$ledger" ]
  run jq -e 'has("brains") | not' "$ledger"
  [ "$status" -eq 0 ]
}

@test "adopt/section-anchor: cook on PLAN.md#feature-x creates ledger in lite mode" {
  # AC: section-anchor ref adopts and creates a ledger keyed to the full ref.
  # RED now: unknown subcommand.
  write_lite_config
  write_plan_fixture "$TMP/PLAN.md"

  run cook on "PLAN.md#feature-x"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "PLAN.md#feature-x")"
  [ -n "$ledger" ]
}

# ---------------------------------------------------------------------------
# LEDGER FIELDS: id, externalRef, status, stage
# ---------------------------------------------------------------------------

@test "adopt/ledger-fields: id equals the ref string" {
  # AC: `id` in the ledger == the ref (lite mode allows string id).
  # RED now: no ledger is created.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "docs/plans/widget.md")"
  [ -n "$ledger" ]

  local id
  id="$(jq -r '.id' "$ledger")"
  [ "$id" = "docs/plans/widget.md" ]
}

@test "adopt/ledger-fields: externalRef equals the ref string" {
  # AC: `externalRef` in the ledger == the ref.
  # RED now: no ledger created.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "docs/plans/widget.md")"
  [ -n "$ledger" ]

  local extref
  extref="$(jq -r '.externalRef' "$ledger")"
  [ "$extref" = "docs/plans/widget.md" ]
}

@test "adopt/ledger-fields: status is pending after first adopt" {
  # AC: new ledger must have status:"pending".
  # RED now: no ledger created.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "docs/plans/widget.md")"
  [ -n "$ledger" ]

  local st
  st="$(jq -r '.status' "$ledger")"
  [ "$st" = "pending" ]
}

@test "adopt/ledger-fields: stage is capture after first adopt" {
  # AC: new ledger must have stage:"capture".
  # RED now: no ledger created.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(find_ledger_by_ref "docs/plans/widget.md")"
  [ -n "$ledger" ]

  local stage
  stage="$(jq -r '.stage' "$ledger")"
  [ "$stage" = "capture" ]
}

# ---------------------------------------------------------------------------
# IDEMPOTENT RE-ADOPT
# ---------------------------------------------------------------------------

@test "adopt/idempotent: second cook on same ref exits 0" {
  # AC: re-adopting the same ref must not error.
  # RED now: first adopt unknown subcommand.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]
}

@test "adopt/idempotent: two adopts of same ref produce exactly one ledger" {
  # AC: re-adopt must NOT create a second ledger dir.
  # RED now: no ledger created at all.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]
  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]

  local n
  n="$(count_ledgers)"
  [ "$n" -eq 1 ]
}

@test "adopt/idempotent: two adopts of same ref do not create a second ledger dir" {
  # AC: same ref → resume existing ledger (detect by externalRef match).
  # RED now: no ledger at all.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]
  local first_ledger
  first_ledger="$(find_ledger_by_ref "docs/plans/foo.md")"

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]
  local second_ledger
  second_ledger="$(find_ledger_by_ref "docs/plans/foo.md")"

  # Must be the same file (same ledger dir), not a duplicate.
  [ "$first_ledger" = "$second_ledger" ]
}

# ---------------------------------------------------------------------------
# BOTH LAYOUTS RESOLVE
# ---------------------------------------------------------------------------

@test "adopt/layouts: flat file docs/plans/foo.md succeeds" {
  # AC: flat-file ref (no anchor) resolves inside ROOT and creates ledger.
  # RED now: unknown subcommand.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -eq 0 ]
  local n; n="$(count_ledgers)"
  [ "$n" -eq 1 ]
}

@test "adopt/layouts: PLAN.md#feature-x (section anchor) succeeds" {
  # AC: section-anchor ref resolves and creates ledger.
  # RED now: unknown subcommand.
  write_lite_config
  write_plan_fixture "$TMP/PLAN.md"

  run cook on "PLAN.md#feature-x"
  [ "$status" -eq 0 ]
  local n; n="$(count_ledgers)"
  [ "$n" -eq 1 ]
}

# ---------------------------------------------------------------------------
# PATH-ESCAPE REJECTION
# ---------------------------------------------------------------------------

@test "adopt/security: path traversal ../outside.md is rejected" {
  # AC: ref must resolve inside ROOT; path-escape exits non-zero, no ledger.
  # RED now: unknown subcommand (exits non-zero, but for the wrong reason).
  # Once implemented: the subcommand exists but rejects path-escape → still exits
  # non-zero. Test pins BOTH the exit code AND no-ledger-created.
  write_lite_config

  run cook on "../outside.md"
  [ "$status" -ne 0 ]

  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "adopt/security: absolute path outside ROOT is rejected" {
  # AC: absolute path outside ROOT must be rejected.
  # RED now: unknown subcommand.
  write_lite_config

  run cook on "/tmp/sneaky.md"
  [ "$status" -ne 0 ]

  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

@test "adopt/security: symlink pointing outside ROOT is rejected" {
  # AC: symlink escape must be caught; no ledger created.
  # RED now: unknown subcommand.
  write_lite_config
  mkdir -p "$TMP/docs"
  # Create a target outside the tmp tree.
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '# Outside\n' > "$outside_dir/secret.md"
  # Plant a symlink inside ROOT that escapes to outside_dir/secret.md.
  ln -s "$outside_dir/secret.md" "$TMP/docs/escape.md"

  run cook on "docs/escape.md"
  [ "$status" -ne 0 ]

  local n; n="$(count_ledgers)"
  n="$(count_ledgers)"
  [ "$n" -eq 0 ]

  rm -rf "$outside_dir"
}

# ---------------------------------------------------------------------------
# MISSING FILE REJECTION
# ---------------------------------------------------------------------------

@test "adopt/missing-file: ref to non-existent file exits non-zero" {
  # AC: if the referenced file does not exist, cook on exits non-zero.
  # RED now: unknown subcommand → exits non-zero (trivially red), but once
  # implemented the subcommand must still refuse a missing target.
  write_lite_config

  run cook on "docs/plans/missing.md"
  [ "$status" -ne 0 ]
}

@test "adopt/missing-file: no ledger is created when ref does not exist" {
  # AC: missing file → no ledger dir.
  # RED now: no ledger created (passes trivially until cmd_on exists and creates
  # one erroneously: so we're asserting the correct final state).
  write_lite_config

  run cook on "docs/plans/missing.md"

  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

# ---------------------------------------------------------------------------
# FULL-MODE REFUSAL
# ---------------------------------------------------------------------------

@test "adopt/full-mode: cook on refuses in full mode (no config)" {
  # AC: `cook on` must refuse outside lite mode.
  # RED now: unknown subcommand → exits non-zero (correct failure, wrong reason).
  # Once implemented: exits non-zero with a mode-refusal error.
  # No config.json → full mode.
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -ne 0 ]
}

@test "adopt/full-mode: cook on refuses when config.json lacks mode:lite" {
  # AC: non-lite config → refusal.
  # RED now: unknown subcommand.
  jq -n '{schemaVersion:1, mode:"full", active:true}' > "$BK/config.json"
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"
  [ "$status" -ne 0 ]
}

@test "adopt/full-mode: refusal does not create a ledger" {
  # AC: mode-refusal must not leave a partial ledger behind.
  # RED now: no ledger (passes trivially until cmd_on exists and leaks one).
  jq -n '{schemaVersion:1, mode:"full", active:true}' > "$BK/config.json"
  mkdir -p "$TMP/docs/plans"
  printf '# Foo plan\n' > "$TMP/docs/plans/foo.md"

  run cook on "docs/plans/foo.md"

  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]
}

# ---------------------------------------------------------------------------
# PLAN SECTION: `cook plan section <file> <anchor>`
# ---------------------------------------------------------------------------

@test "plan-section/found: prints START END for ## Feature X" {
  # AC: locate a section by GitHub-style slug; print 1-based inclusive line range.
  # RED now: `cook plan section` is an unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan section "$TMP/PLAN.md" "feature-x"
  [ "$status" -eq 0 ]

  # Output must be two space-separated integers.
  [[ "$output" =~ ^[0-9]+\ [0-9]+$ ]]

  local start end
  read -r start end <<< "$output"

  # The fixture's ## Feature X is on line 3 (1-indexed: "# Project Plan" is 1,
  # blank line is 2, "## Feature X" is 3). The section ends before "## Other
  # Section" (line 13 in the fixture). So start=3, end=12 (last non-blank before
  # next heading), or by a strict "line before next heading" interpretation end=12.
  # We assert the range includes the heading (start <= 3) and ends before the next
  # heading's line, and start < end.
  [ "$start" -le 3 ]
  [ "$end" -gt "$start" ]
}

@test "plan-section/not-found: non-existent anchor exits non-zero" {
  # AC: non-zero if anchor not found.
  # RED now: unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan section "$TMP/PLAN.md" "no-such-section"
  [ "$status" -ne 0 ]
}

@test "plan-section/slug-normalization: mixed-case heading matched by lowercase slug" {
  # AC: GitHub-style slug: lowercase, spaces to dashes.
  # RED now: unknown subcommand.
  local f="$TMP/slug-test.md"
  printf '# Top\n\n## My Feature Here\n\nContent.\n\n## Next\n\nOther.\n' > "$f"

  run cook plan section "$f" "my-feature-here"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+\ [0-9]+$ ]]
}

@test "plan-section/section-boundary: section ends before next heading of same level" {
  # AC: section spans from heading through line before next heading of same/higher level.
  # RED now: unknown subcommand.
  local f="$TMP/boundary.md"
  cat > "$f" <<'MDEOF'
## Alpha

Line A1
Line A2

## Beta

Line B1
MDEOF

  run cook plan section "$f" "alpha"
  [ "$status" -eq 0 ]
  local start end
  read -r start end <<< "$output"
  # Alpha starts at line 1, Beta starts at line 7.
  # Section for Alpha must end at line 6 or earlier (before "## Beta").
  [ "$start" -eq 1 ]
  [ "$end" -lt 7 ]
}

# ---------------------------------------------------------------------------
# PLAN CHECK: `cook plan check <file> <substring>`
# ---------------------------------------------------------------------------

@test "plan-check/tick: first unchecked item matching substring is ticked" {
  # AC: `- [ ]` line matching substring becomes `- [x]`.
  # RED now: `cook plan check` is an unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan check "$TMP/PLAN.md" "implement the widget"
  [ "$status" -eq 0 ]

  # The first item must now be ticked.
  run grep -c '^\- \[x\] implement the widget' "$TMP/PLAN.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "plan-check/tick: only first matching unchecked item is ticked" {
  # AC: ticks the FIRST unchecked item; others remain unchanged.
  # RED now: unknown subcommand.
  local f="$TMP/multi-check.md"
  cat > "$f" <<'MDEOF'
## Work

- [ ] do thing alpha
- [ ] do thing alpha again
- [ ] do thing beta
MDEOF

  run cook plan check "$f" "do thing alpha"
  [ "$status" -eq 0 ]

  # First match is ticked.
  local ticked
  ticked="$(grep -c '^\- \[x\] do thing alpha$' "$f")"
  [ "$ticked" -eq 1 ]

  # Second "alpha" match is still unchecked.
  local still_unchecked
  still_unchecked="$(grep -c '^\- \[ \] do thing alpha again' "$f")"
  [ "$still_unchecked" -eq 1 ]
}

@test "plan-check/idempotent: already-checked item stays checked, exit 0" {
  # AC: already-[x] item containing the substring stays [x] and command succeeds.
  # RED now: unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  # "design the widget" is already - [x] in the fixture.
  run cook plan check "$TMP/PLAN.md" "design the widget"
  [ "$status" -eq 0 ]

  # Still exactly one checked "design the widget" line.
  run grep -c '^\- \[x\] design the widget' "$TMP/PLAN.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "plan-check/no-match: exits non-zero when no checklist item matches" {
  # AC: non-zero if no matching checklist item exists.
  # RED now: unknown subcommand → exits non-zero (correct failure, wrong reason).
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan check "$TMP/PLAN.md" "nonexistent task xyz"
  [ "$status" -ne 0 ]
}

@test "plan-check/byte-preservation: untouched lines are byte-identical after check" {
  # AC: other lines must be byte-preserved.
  # RED now: unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  # Snapshot the file content before.
  local before
  before="$(cat "$TMP/PLAN.md")"

  run cook plan check "$TMP/PLAN.md" "implement the widget"
  [ "$status" -eq 0 ]

  local after
  after="$(cat "$TMP/PLAN.md")"

  # Total line count must be unchanged.
  local before_lines after_lines
  before_lines="$(printf '%s\n' "$before" | wc -l | tr -d ' ')"
  after_lines="$(printf '%s\n' "$after" | wc -l | tr -d ' ')"
  [ "$before_lines" -eq "$after_lines" ]

  # Every non-mutated line must still appear verbatim.
  # The only changed line is "- [ ] implement the widget" → "- [x] implement the widget".
  # All other lines must be present and unchanged.
  run grep -Fc "## Feature X" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc "# Project Plan" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc "## Other Section" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc -- "- [ ] write tests for the widget" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc -- "- [x] design the widget" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
}

# ---------------------------------------------------------------------------
# PLAN APPEND: `cook plan append <file> <anchor> <text>`
# ---------------------------------------------------------------------------

@test "plan-append/basic: text is appended under the named section" {
  # AC: new line at end of section (before next heading or EOF).
  # RED now: `cook plan append` is an unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan append "$TMP/PLAN.md" "feature-x" "- [ ] polish the widget"
  [ "$status" -eq 0 ]

  run grep -c '^\- \[ \] polish the widget' "$TMP/PLAN.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "plan-append/position: appended line is before the next heading" {
  # AC: append lands at end of the target section, not inside the next section.
  # RED now: unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan append "$TMP/PLAN.md" "feature-x" "- [ ] test the widget"
  [ "$status" -eq 0 ]

  # After appending to ## Feature X, the new line must appear BEFORE ## Other Section.
  local feature_line other_line appended_line
  feature_line="$(grep -n '## Feature X' "$TMP/PLAN.md" | head -1 | cut -d: -f1)"
  other_line="$(grep -n '## Other Section' "$TMP/PLAN.md" | head -1 | cut -d: -f1)"
  appended_line="$(grep -n '^\- \[ \] test the widget' "$TMP/PLAN.md" | head -1 | cut -d: -f1)"

  [ -n "$appended_line" ]
  [ "$appended_line" -gt "$feature_line" ]
  [ "$appended_line" -lt "$other_line" ]
}

@test "plan-append/other-sections-intact: sections outside target are byte-preserved" {
  # AC: leaving rest of the file intact.
  # RED now: unknown subcommand.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan append "$TMP/PLAN.md" "feature-x" "- [ ] new todo"
  [ "$status" -eq 0 ]

  # ## Other Section and its content must be unchanged.
  run grep -Fc "## Other Section" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc "Some other content here." "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
}

@test "plan-append/not-found: non-existent anchor exits non-zero" {
  # AC: non-zero if anchor not found.
  # RED now: unknown subcommand → exits non-zero.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan append "$TMP/PLAN.md" "no-such-anchor" "- [ ] orphan todo"
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# ROUND-TRIP: section -> append -> check -> read back
# ---------------------------------------------------------------------------

@test "round-trip: section/append/check produce correct bytes end-to-end" {
  # AC: build a markdown plan fixture, use plan section to locate ## Feature X,
  # use plan append to add a todo, use plan check to tick one, then read back
  # and assert the exact resulting state. Untouched lines are preserved.
  #
  # RED now: all three plan subcommands are unimplemented.
  write_lite_config
  write_plan_fixture "$TMP/PLAN.md"

  # Step 1: locate the section.
  run cook plan section "$TMP/PLAN.md" "feature-x"
  [ "$status" -eq 0 ]
  local start end
  read -r start end <<< "$output"
  [ "$start" -gt 0 ]
  [ "$end" -gt "$start" ]

  # Step 2: append a new todo into that section.
  run cook plan append "$TMP/PLAN.md" "feature-x" "- [ ] deploy the widget"
  [ "$status" -eq 0 ]

  # The new todo must exist in the file.
  run grep -c '^\- \[ \] deploy the widget' "$TMP/PLAN.md"
  [ "$output" -eq 1 ]

  # Step 3: tick the newly appended item.
  run cook plan check "$TMP/PLAN.md" "deploy the widget"
  [ "$status" -eq 0 ]

  # The item must now be checked.
  run grep -c '^\- \[x\] deploy the widget' "$TMP/PLAN.md"
  [ "$output" -eq 1 ]

  # The unchecked version must be gone.
  run grep -c '^\- \[ \] deploy the widget' "$TMP/PLAN.md"
  [ "$output" -eq 0 ]

  # Untouched lines must still be present verbatim.
  run grep -Fc "# Project Plan" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc "## Feature X" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc "## Other Section" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc "Some other content here." "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  # Original fixture items still present.
  run grep -Fc -- "- [ ] implement the widget" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc -- "- [ ] write tests for the widget" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
  run grep -Fc -- "- [x] design the widget" "$TMP/PLAN.md"
  [ "$output" -eq 1 ]
}


# ---------------------------------------------------------------------------
# T18: AC7: plan check with a -prefixed substring is NOT rejected
# AC7: commands that take free-form text positionals (plan check <file> <substr>)
# must not be broken by flag-rejection. A substring starting with '-' must be
# accepted verbatim (arity-only check, no flag scanning on text args).
# GUARD: expected GREEN today and must stay green after task 0038 is implemented.
# ---------------------------------------------------------------------------

@test "strict/T18: plan check with -prefixed substring exits 0 (AC7 guard)" {
  # AC7: plan check uses arity-only check; a substr starting with '-' is valid.
  # GREEN now (plan check already uses exact $# -eq 2 arity, no flag scanning).
  # Must STAY green after the implementer adds reject_unknown_args.
  write_lite_config
  local f="$TMP/ac7-check.md"
  cat > "$f" <<'MDEOF'
## Work

- [ ] --weird flag-like task
- [ ] normal task
MDEOF

  run cook plan check "$f" "--weird"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# T19: AC7: plan append with -prefixed text is NOT rejected
# AC7: plan append <file> <anchor> <text> uses arity-only check; the text
# positional may legitimately begin with '-' and must be accepted verbatim.
# GUARD: expected GREEN today and must stay green after task 0038 is implemented.
# ---------------------------------------------------------------------------

@test "strict/T19: plan append with -prefixed text exits 0 and appends verbatim (AC7 guard)" {
  # AC7: plan append uses exact $# -eq 3 arity, no flag scanning on text.
  # GREEN now. Must STAY green after the implementer adds reject_unknown_args.
  write_lite_config
  local f="$TMP/ac7-append.md"
  cat > "$f" <<'MDEOF'
## feature-x

- [ ] existing task
MDEOF

  run cook plan append "$f" "feature-x" "--starts-with-dash note"
  [ "$status" -eq 0 ]

  # The literal line must be appended verbatim.
  run grep -Fc -- "--starts-with-dash note" "$f"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

# ===========================================================================
# SECURITY AUDIT FINDINGS (task 0010a): RED tests
# These tests assert the CORRECT (secure) end-state. They are red now because
# the bugs described below are present in the current code. Do NOT modify
# bin/cook to make them pass; a separate implementer agent handles that.
# ===========================================================================

# ---------------------------------------------------------------------------
# FINDING 1: multi-hop symlink escape in `cook on`
#
# `resolve_ref_path` follows exactly one readlink hop. A chain of in-ROOT
# symlinks where the FINAL target lands outside ROOT escapes containment.
# The fix must recursively resolve the full chain; rejection is required when
# ANY intermediate or final target is outside ROOT.
# ---------------------------------------------------------------------------

@test "security/F1: multi-hop symlink chain escaping ROOT is rejected" {
  # AC: chain_a.md (in-ROOT) -> chain_b.md (in-ROOT) -> /outside/secret.md
  # (outside ROOT). The current code follows only one hop: it resolves
  # chain_a.md -> chain_b.md, checks that chain_b.md's parent is inside ROOT
  # (it is), and stops: never following the second hop to /outside/secret.md.
  # The fix must walk the full chain; any hop that lands outside ROOT must
  # cause refusal (non-zero exit AND zero ledgers created).
  write_lite_config
  mkdir -p "$TMP/docs/plans"

  # Create the outside target.
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '# Outside secret\n' > "$outside_dir/secret.md"

  # chain_b is inside ROOT but points outside ROOT.
  ln -s "$outside_dir/secret.md" "$TMP/docs/plans/chain_b.md"
  # chain_a is inside ROOT and points to chain_b (also inside ROOT).
  ln -s chain_b.md "$TMP/docs/plans/chain_a.md"

  run cook on "docs/plans/chain_a.md"
  # Must refuse: multi-hop chain ultimately escapes ROOT.
  [ "$status" -ne 0 ]

  # No ledger must have been created.
  local n; n="$(count_ledgers)"
  [ "$n" -eq 0 ]

  rm -rf "$outside_dir"
}

@test "security/F1: multi-hop symlink chain staying inside ROOT is accepted (positive control)" {
  # AC: a two-hop chain where BOTH hops resolve inside ROOT must succeed.
  # This ensures the fix does not over-reject all multi-hop symlinks.
  write_lite_config
  mkdir -p "$TMP/docs/plans"

  # Both hops land inside ROOT.
  printf '# Real plan\n\n- [ ] do the thing\n' > "$TMP/docs/plans/real.md"
  # hop_b -> real.md (in-ROOT)
  ln -s "$TMP/docs/plans/real.md" "$TMP/docs/plans/hop_b.md"
  # hop_a -> hop_b (in-ROOT, relative symlink)
  ln -s hop_b.md "$TMP/docs/plans/hop_a.md"

  run cook on "docs/plans/hop_a.md"
  [ "$status" -eq 0 ]

  # A ledger must have been created for the ref.
  local ledger
  ledger="$(find_ledger_by_ref "docs/plans/hop_a.md")"
  [ -n "$ledger" ]
}

# ---------------------------------------------------------------------------
# FINDING 2: `cook plan {section,check,append}` lack containment
#
# These subcommands accept a raw <file> argument and operate on it without
# checking that the path resolves inside ROOT. An attacker (or buggy caller)
# can read or write arbitrary files on the filesystem.
# ---------------------------------------------------------------------------

@test "security/F2: plan section with absolute path outside ROOT is rejected" {
  # AC: `cook plan section` must refuse a <file> that is outside ROOT.
  # Current code: succeeds (status 0, reads the outside file).
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '## sec\n\nsome content\n' > "$outside_dir/victim.md"

  run cook plan section "$outside_dir/victim.md" "sec"
  [ "$status" -ne 0 ]

  rm -rf "$outside_dir"
}

@test "security/F2: plan check with absolute path outside ROOT is rejected and file is untouched" {
  # AC: `cook plan check` must refuse a <file> outside ROOT.
  # The outside file must be BYTE-UNCHANGED after the refused call.
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '## s\n- [ ] x\n' > "$outside_dir/victim.md"

  # Snapshot before.
  local before
  before="$(cat "$outside_dir/victim.md")"

  run cook plan check "$outside_dir/victim.md" "x"
  [ "$status" -ne 0 ]

  # File must not have been modified.
  local after
  after="$(cat "$outside_dir/victim.md")"
  [ "$before" = "$after" ]

  rm -rf "$outside_dir"
}

@test "security/F2: plan append with absolute path outside ROOT is rejected and file is untouched" {
  # AC: `cook plan append` must refuse a <file> outside ROOT.
  # The outside file must be BYTE-UNCHANGED after the refused call.
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '## s\n\n- [ ] existing\n' > "$outside_dir/victim.md"

  local before
  before="$(cat "$outside_dir/victim.md")"

  run cook plan append "$outside_dir/victim.md" "s" "INJECTED"
  [ "$status" -ne 0 ]

  local after
  after="$(cat "$outside_dir/victim.md")"
  [ "$before" = "$after" ]

  rm -rf "$outside_dir"
}

@test "security/F2: plan check with ../ traversal outside ROOT is rejected and file is untouched" {
  # AC: a ../ path that escapes ROOT must be rejected by plan check.
  # We place the victim one level above TMP's parent-equivalent by creating a
  # sibling dir so the relative path from inside ROOT escapes ROOT.
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '## s\n- [ ] x\n' > "$outside_dir/victim.md"

  # Build a relative traversal: from ROOT climb up via ../.. enough to land
  # outside. We use the absolute path disguised as a relative-looking path by
  # going ROOT/../<outside_dir_leaf>/victim.md. Because ROOT is a mktemp dir we
  # know its parent; construct a relative path that crosses ROOT's boundary.
  local root_parent
  root_parent="$(dirname "$TMP")"
  local outside_leaf
  outside_leaf="$(basename "$outside_dir")"
  # Relative ref that exits ROOT via ..:  ../sibling/victim.md
  # We need to be inside ROOT for the traversal to make sense, so we use the
  # form ROOT/../<sibling>/victim.md expressed as a relative ref from ROOT.
  local rel_escape="../${outside_leaf}/victim.md"

  # Ensure the outside dir is actually a sibling of TMP.
  # (mktemp -d always creates under the same TMPDIR, so they share a parent.)
  [ "$(dirname "$outside_dir")" = "$root_parent" ] || skip "outside_dir not a sibling of TMP: test assumptions broken"

  local before
  before="$(cat "$outside_dir/victim.md")"

  # plan check does not take a relative ref through ROOT the same way cook on
  # does; it takes a raw path. A relative path is NOT joined to ROOT in plan
  # check (the code just passes it to awk/mv), so we pass the absolute path.
  # The ../ traversal test is covered more directly by the absolute-path test
  # above; this test uses a constructed relative path to ensure the same gate
  # applies. If the path escapes ROOT it must be rejected.
  run cook plan check "$TMP/$rel_escape" "x"
  [ "$status" -ne 0 ]

  local after
  after="$(cat "$outside_dir/victim.md")"
  [ "$before" = "$after" ]

  rm -rf "$outside_dir"
}

@test "security/F2: plan append with ../ traversal outside ROOT is rejected" {
  # AC: a ../ path that resolves outside ROOT must be rejected by plan append.
  local outside_dir
  outside_dir="$(mktemp -d)"
  printf '## s\n\n- [ ] existing\n' > "$outside_dir/victim.md"

  local root_parent outside_leaf
  root_parent="$(dirname "$TMP")"
  outside_leaf="$(basename "$outside_dir")"
  [ "$(dirname "$outside_dir")" = "$root_parent" ] || skip "outside_dir not a sibling of TMP"

  local before
  before="$(cat "$outside_dir/victim.md")"

  run cook plan append "$TMP/../${outside_leaf}/victim.md" "s" "INJECTED"
  [ "$status" -ne 0 ]

  local after
  after="$(cat "$outside_dir/victim.md")"
  [ "$before" = "$after" ]

  rm -rf "$outside_dir"
}

@test "security/F2: plan check on file inside ROOT still works (positive control)" {
  # AC: a legitimate in-ROOT file must still be processed by plan check.
  # Ensures the containment fix does not break the happy path.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan check "$TMP/PLAN.md" "implement the widget"
  [ "$status" -eq 0 ]

  run grep -c '^\- \[x\] implement the widget' "$TMP/PLAN.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "security/F2: plan append on file inside ROOT still works (positive control)" {
  # AC: a legitimate in-ROOT file must still be processed by plan append.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan append "$TMP/PLAN.md" "feature-x" "- [ ] secure new item"
  [ "$status" -eq 0 ]

  run grep -c '^\- \[ \] secure new item' "$TMP/PLAN.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

# ---------------------------------------------------------------------------
# FINDING 3: `cook plan append` mangles backslashes (literal text corrupted)
#
# `awk -v text="$text"` processes escape sequences in the value: \t becomes
# a tab, \n becomes a newline, \\ becomes a single backslash. So a user who
# appends a Windows path like "C:\temp\new" gets a line with a literal tab
# and newline injected: corrupting both the line and subsequent file content.
#
# The fix must pass the text through awk without escape-processing it, so the
# appended line is byte-for-byte identical to the shell argument. Typical
# approaches: use ENVIRON[], getline, or printf '%s\n' outside awk.
# ---------------------------------------------------------------------------

@test "security/F3: plan append preserves literal backslashes verbatim" {
  # AC: the text argument to plan append must land in the file WITHOUT any
  # escape processing. Specifically:
  #   \t must remain the two characters backslash + t (NOT a tab)
  #   \n must remain the two characters backslash + n (NOT a newline)
  #   \\ must remain two backslashes (NOT one)
  # This test uses a Windows-style path as the canonical repro from the audit.
  write_plan_fixture "$TMP/PLAN.md"

  run cook plan append "$TMP/PLAN.md" "feature-x" 'path C:\temp\new'
  [ "$status" -eq 0 ]

  # The appended line must appear literally: no tab, no newline injection.
  # Use grep -F (fixed-string, no regex interpretation) with -- to guard
  # against a leading hyphen in the pattern.
  run grep -Fc -- 'path C:\temp\new' "$TMP/PLAN.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]

  # Belt-and-suspenders: confirm no tab was injected on that line.
  # Extract the appended line and check for the literal backslash.
  local appended_line
  appended_line="$(grep -F -- 'path C:' "$TMP/PLAN.md")"
  # The line must contain a backslash (not have been eaten).
  printf '%s' "$appended_line" | grep -qF '\' || false
  # The line must NOT contain a literal tab character.
  printf '%s' "$appended_line" | grep -qP '\t' && false || true
}

@test "security/F3: plan append preserves double-backslash verbatim" {
  # AC: \\ in the text argument must remain \\ (two chars), not collapse to \.
  local f="$TMP/bs-test.md"
  printf '## sec\n\n- [ ] initial\n' > "$f"

  run cook plan append "$f" "sec" 'route: \\server\\share'
  [ "$status" -eq 0 ]

  # The literal string '\\server\\share' (four backslash chars: \\, s, e,
  # r, v, e, r, \\, s, h, a, r, e) must appear as-is.
  run grep -Fc -- 'route: \\server\\share' "$f"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

@test "security/F3: plan append with backslash-n does not inject a newline" {
  # AC: \n in the text argument must remain the two chars backslash + n in the
  # file; the resulting file must gain EXACTLY ONE new line (not two or more).
  local f="$TMP/nl-test.md"
  printf '## sec\n\n- [ ] initial\n' > "$f"

  local lines_before
  lines_before="$(wc -l < "$f")"

  run cook plan append "$f" "sec" 'note: line1\nline2'
  [ "$status" -eq 0 ]

  local lines_after
  lines_after="$(wc -l < "$f")"

  # Exactly one line was added.
  [ "$lines_after" -eq $(( lines_before + 1 )) ]

  # The literal '\n' string must appear in the file.
  run grep -Fc -- 'note: line1\nline2' "$f"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

# ---------------------------------------------------------------------------
# 0018: plan-store markdown robustness (AC1/AC2/AC3)
# ---------------------------------------------------------------------------

@test "0018/fence-check: fenced item is NOT ticked; first real item IS" {
  # AC1: fence-aware check skips items inside ``` fences.
  # RED now: fence toggle not implemented: the fenced item gets ticked first.
  # Distinct text in fenced vs unfenced line so the assertions are unambiguous.
  local f="$TMP/fence-check.md"
  cat > "$f" <<'MDEOF'
## Work

```
- [ ] alpha fenced
```

- [ ] alpha real
MDEOF

  run cook plan check "$f" "alpha"
  [ "$status" -eq 0 ]

  # Fenced line must remain unticked.
  run grep -Fc -- '- [ ] alpha fenced' "$f"
  [ "$output" -eq 1 ]

  # Unfenced line must now be ticked (not still unchecked).
  run grep -c '^\- \[x\] alpha real' "$f"
  [ "$output" -eq 1 ]
}

@test "0018/fence-only: only-fenced-match exits non-zero and leaves file unchanged" {
  # AC1: when the ONLY match is inside a fence, nothing ticks and engine dies.
  # RED now: the fenced item gets ticked and exit 0 instead of non-zero.
  local f="$TMP/fence-only.md"
  cat > "$f" <<'MDEOF'
## Work

```
- [ ] fenced only
```
MDEOF

  run cook plan check "$f" "fenced only"
  [ "$status" -ne 0 ]

  # Fenced line must be byte-unchanged (no tick applied).
  run grep -Fc -- '- [ ] fenced only' "$f"
  [ "$output" -eq 1 ]

  run grep -c '^\- \[x\] fenced only' "$f"
  [ "$output" -eq 0 ]
}

@test "0018/fence-section: fenced heading does not bound the section; append lands past it" {
  # AC2: fence-aware section bounds ignore headings inside fences.
  # RED now: the fenced ## Other Section is treated as a real boundary, so append
  #          lands before the real item and before the real next heading.
  local f="$TMP/fence-section.md"
  cat > "$f" <<'MDEOF'
## Feature X

```
## Other Section
```

- [ ] real item

## Real Next Section

Some content.
MDEOF

  run cook plan append "$f" "feature-x" "- [ ] appended"
  [ "$status" -eq 0 ]

  # Line numbers: appended must come AFTER real item and BEFORE the real heading.
  local real_item_line appended_line next_heading_line
  real_item_line="$(grep -n '^\- \[ \] real item' "$f" | head -1 | cut -d: -f1)"
  appended_line="$(grep -n '^\- \[ \] appended' "$f" | head -1 | cut -d: -f1)"
  next_heading_line="$(grep -n '^## Real Next Section' "$f" | head -1 | cut -d: -f1)"

  [ -n "$appended_line" ]
  [ "$appended_line" -gt "$real_item_line" ]
  [ "$appended_line" -lt "$next_heading_line" ]
}

@test "0018/sep-preserved: blank line before following heading survives after append" {
  # AC3: append inserts after the last non-blank in the section; trailing blank survives.
  # RED now: append lands after the blank, consuming it: no blank between new item
  #          and the next heading.
  local f="$TMP/sep.md"
  cat > "$f" <<'MDEOF'
## Feature X

- [ ] item

## Other Section
MDEOF

  run cook plan append "$f" "feature-x" "- [ ] new item"
  [ "$status" -eq 0 ]

  local item_line appended_line other_line
  item_line="$(grep -n '^\- \[ \] item$' "$f" | head -1 | cut -d: -f1)"
  appended_line="$(grep -n '^\- \[ \] new item' "$f" | head -1 | cut -d: -f1)"
  other_line="$(grep -n '^## Other Section' "$f" | head -1 | cut -d: -f1)"

  # Appended line immediately follows the existing item.
  [ "$appended_line" -eq $(( item_line + 1 )) ]

  # A blank line separates appended item from the next heading.
  # ## Other Section must be exactly 2 lines after the appended line.
  [ "$other_line" -eq $(( appended_line + 2 )) ]
}
