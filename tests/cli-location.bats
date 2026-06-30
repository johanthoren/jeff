#!/usr/bin/env bats
# tests/cli-location.bats: task 0034: CLI relocation + hook removal assertions.
#
# Covers:
#   AC1: skills/cook/scripts/cook.sh exists and is executable; bin/cook absent.
#   AC2: The plugin-root bin/ directory is entirely absent (no auto-PATH entry).
#   AC4: cook init no longer writes a git pre-commit hook.
#   AC4: cook deinit no longer removes a git pre-commit hook (no-op; exits 0).
#   AC4: cook init still scaffolds .jeff/ and marks active:true.
#   AC4: cook deinit still marks inactive (active:false) and preserves history.
#
# Strategy:
#   Structural assertions (AC1, AC2) are read-only checks on the repo tree.
#   Behavioral assertions (AC4) use a fresh mktemp -d git repo per test,
#   mirroring the setup/teardown pattern from tests/lite.bats.
#
# All tests in this file are RED against the current tree:
#   - skills/cook/scripts/cook.sh does not exist yet (binary not moved).
#   - bin/ directory currently exists (bin/cook + bin/release-check).
#   - cook init currently writes a pre-commit hook.
#   - cook deinit currently removes the hook (and reports "removed pre-commit hook").

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

# ---------------------------------------------------------------------------
# Setup / teardown: one fresh mktemp git repo per behavioral test
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@cli-location.example"
  git -C "$TMP" config user.name "CLI Location Test"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT.
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# AC1: Structural: CLI at new location, executable
#
# RED now: skills/cook/scripts/cook.sh does not exist (bin/cook has not been
# moved yet by the implementer).
# ---------------------------------------------------------------------------

@test "structural: skills/cook/scripts/cook.sh exists" {
  # RED now: the file does not exist until the implementer runs git mv.
  [ -f "$REPO/skills/cook/scripts/cook.sh" ]
}

@test "structural: skills/cook/scripts/cook.sh is executable" {
  # RED now: file absent, so -x is also false.
  [ -x "$REPO/skills/cook/scripts/cook.sh" ]
}

# ---------------------------------------------------------------------------
# AC2: Structural: plugin-root bin/ directory is entirely absent
#
# After task 0034, bin/cook and bin/release-check are both moved out of bin/;
# no files remain, and the directory itself is removed.  A surviving bin/
# directory would auto-PATH the plugin on install: the exact fail-loud hazard
# the task removes.
#
# RED now: $REPO/bin/ currently exists (contains bin/cook + bin/release-check).
# ---------------------------------------------------------------------------

@test "structural: plugin-root bin/ directory is absent" {
  # RED now: the bin/ directory currently exists.
  [ ! -d "$REPO/bin" ]
}

# ---------------------------------------------------------------------------
# AC4: Behavioral: cook init installs NO git pre-commit hook
#
# After task 0034, cmd_init scaffolds .jeff/ and marks the project active,
# but does NOT write .git/hooks/pre-commit.  The interim enforcement is the
# orchestrator's validate-before-commit + CI (ci.yml).
#
# RED now for two reasons:
#   (1) COOK points to the not-yet-existing skills/cook/scripts/cook.sh, so
#       the invocation fails with "no such file".
#   (2) Even if we ran the current bin/cook, cmd_init writes the hook.
# ---------------------------------------------------------------------------

@test "init: cook init exits 0 in a fresh git repo" {
  # RED now: COOK does not exist yet; run will get "no such file or directory".
  run cook init
  [ "$status" -eq 0 ]
}

@test "init: cook init scaffolds .jeff/ directory" {
  # RED now: COOK absent; even on error, directory may be absent.
  run cook init
  [ "$status" -eq 0 ]
  [ -d "$BK" ]
}

@test "init: cook init writes .jeff/config.json with active:true" {
  run cook init
  [ "$status" -eq 0 ]
  [ -f "$BK/config.json" ]
  run jq -r '.active' "$BK/config.json"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}

@test "init: cook init does NOT install a git pre-commit hook" {
  # Core AC4 assertion: after init, no pre-commit hook exists.
  # RED now: current cmd_init writes .git/hooks/pre-commit unconditionally.
  run cook init
  [ "$status" -eq 0 ]
  # The hook file must be absent.
  [ ! -f "$TMP/.git/hooks/pre-commit" ]
}

@test "init: cook init does NOT write any jeff-validate-hook marker" {
  # Belt-and-suspenders: even if a pre-commit file somehow exists (e.g. was there
  # before init), it must not contain the jeff hook marker after init runs.
  run cook init
  [ "$status" -eq 0 ]
  if [ -f "$TMP/.git/hooks/pre-commit" ]; then
    run grep -c 'jeff-validate-hook' "$TMP/.git/hooks/pre-commit"
    [ "$output" = "0" ] || [ "$status" -ne 0 ]
  fi
}

# ---------------------------------------------------------------------------
# AC4: Behavioral: cook deinit leaves no jeff hook (and removing is no-op)
#
# After task 0034, cmd_deinit marks the project inactive and preserves task
# history, but does not remove a hook (there is none to remove).  Deinit must
# still exit 0 whether or not a hook is present.
#
# RED now: current cmd_deinit looks for and reports removing/not-removing a hook.
# (And COOK points to the non-existent path, so status != 0 for wrong reason too.)
# ---------------------------------------------------------------------------

@test "deinit: cook deinit exits 0 after init (no hook to remove)" {
  # Setup: init first, then deinit.  After 0034, deinit is a no-op w.r.t. hooks.
  run cook init
  [ "$status" -eq 0 ]
  run cook deinit
  [ "$status" -eq 0 ]
}

@test "deinit: cook deinit marks config.json active:false" {
  run cook init
  [ "$status" -eq 0 ]
  run cook deinit
  [ "$status" -eq 0 ]
  [ -f "$BK/config.json" ]
  run jq -r '.active' "$BK/config.json"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

@test "deinit: cook deinit leaves .jeff/ task state intact" {
  run cook init
  [ "$status" -eq 0 ]
  # Write a sentinel task file to confirm deinit preserves history.
  mkdir -p "$BK/tasks/1-sentinel"
  printf '{"id":1,"slug":"sentinel"}\n' > "$BK/tasks/1-sentinel/task.json"
  run cook deinit
  [ "$status" -eq 0 ]
  [ -f "$BK/tasks/1-sentinel/task.json" ]
}

@test "deinit: cook deinit does NOT install or leave a pre-commit hook" {
  # Run init then deinit; confirm no hook exists after either step.
  run cook init
  [ "$status" -eq 0 ]
  [ ! -f "$TMP/.git/hooks/pre-commit" ]
  run cook deinit
  [ "$status" -eq 0 ]
  [ ! -f "$TMP/.git/hooks/pre-commit" ]
}

@test "deinit: cook deinit without prior init exits 0 (no-op, no hook present)" {
  # Deinit on a fresh repo with no prior init must exit 0 cleanly.
  run cook deinit
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# T7 (task 0065): cook init produces NO .jeff/index.json, and a
# subsequent cook validate exits 0 (store is well-formed without index.json).
# RED now: current cmd_init writes index.json, so the "absent" assertion fails.
# ---------------------------------------------------------------------------

@test "init: cook init does NOT create .jeff/index.json (task 0065)" {
  # T7a [0065 AC2, AC3]: after init, index.json must be absent [AC2].
  # RED now: current ensure_scaffold unconditionally creates index.json.
  run cook init
  [ "$status" -eq 0 ]
  [ ! -f "$BK/index.json" ]
}

@test "init: cook validate exits 0 after init with no index.json (task 0065)" {
  # T7b [0065 AC1, AC3]: validate on a post-init empty store (no index.json,
  # no task dirs) exits 0 with "nothing to validate" [AC1 empty-store path].
  # RED now: init creates index.json, then validate finds it and may behave
  # differently: but the chain is what matters; after 0065 both steps clean.
  run cook init
  [ "$status" -eq 0 ]
  run cook validate
  [ "$status" -eq 0 ]
}
