#!/usr/bin/env bats
# tests/release-check.bats: bats suite for task 0022: plugin version-drift guard.
#
# Tests the standalone script scripts/release-check (relocated from bin/ by task 0034),
# which fails when payload files changed since the last plain-semver release tag but
# plugin.json version was not bumped strictly above that tag.
#
# Interface contract (from locked plan):
#   - Env: RELEASE_CHECK_ROOT = repo to inspect (test seam: throwaway git fixture)
#   - last_tag = highest tag matching ^[0-9]+\.[0-9]+\.[0-9]+$
#   - version from .claude-plugin/plugin.json
#   - Payload prefixes: skills/ agents/ commands/ hooks/ .claude-plugin/
#     (bin/ dropped by task 0034; skills/ covers the CLI at its new location)
#   - Payload files: AGENTS.md package.json
#   - Excluded: .jeff/ tests/ .github/ docs/ README.md Makefile dotfiles
#   - Exit 0 = pass; non-zero = fail; reason on stderr
#
# Cases:
#   (a) payload changed, version == tag       → fail; stderr names path + mismatch
#   (b) payload changed, version > tag        → pass
#   (c) only excluded paths changed           → pass
#   (d) version strictly below last tag       → fail
#   (e) no plain-semver tag in repo           → pass (pre-release)
#   (f) boundary: version == tag with payload → fail (explicit equal-version case)

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
SCRIPT="$REPO/scripts/release-check"

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# init_fixture_repo <dir> <version>
#
# Initialises a minimal git repo with a .claude-plugin/plugin.json at <version>,
# commits it, and tags the commit with the version string (plain semver).
# Sets local git user so commits work without global config.
init_fixture_repo() {
  local dir="$1" version="$2"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@fixture.example"
  git -C "$dir" config user.name "Fixture Test"
  mkdir -p "$dir/.claude-plugin"
  printf '{"version":"%s"}\n' "$version" > "$dir/.claude-plugin/plugin.json"
  git -C "$dir" add .claude-plugin/plugin.json
  git -C "$dir" commit -q -m "initial"
  git -C "$dir" tag "$version"
}

# commit_file <dir> <relpath> <content>
#
# Writes <content> to <relpath> (relative to <dir>), stages, and commits it.
commit_file() {
  local dir="$1" relpath="$2" content="$3"
  local parent
  parent="$(dirname "$dir/$relpath")"
  mkdir -p "$parent"
  printf '%s\n' "$content" > "$dir/$relpath"
  git -C "$dir" add "$relpath"
  git -C "$dir" commit -q -m "add $relpath"
}

# bump_version <dir> <new_version>
#
# Updates .claude-plugin/plugin.json to <new_version> and commits the change.
bump_version() {
  local dir="$1" new_version="$2"
  printf '{"version":"%s"}\n' "$new_version" > "$dir/.claude-plugin/plugin.json"
  git -C "$dir" add .claude-plugin/plugin.json
  git -C "$dir" commit -q -m "bump version to $new_version"
}

# run_script <dir>
#
# Runs the script with RELEASE_CHECK_ROOT="<dir>" and captures stdout+stderr
# into $output. Uses `run bash -c "... 2>&1"` so bats captures both streams.
run_script() {
  local dir="$1"
  run bash -c "RELEASE_CHECK_ROOT=$(printf '%q' "$dir") $(printf '%q' "$SCRIPT") 2>&1"
}

# ---------------------------------------------------------------------------
# Setup / teardown: one mktemp -d per test
# ---------------------------------------------------------------------------

setup() {
  FIX="$(mktemp -d)"
}

teardown() {
  rm -rf "$FIX"
}

# ---------------------------------------------------------------------------
# (a) payload changed since tag, version == tag → fail
#     stderr must name the changed payload path AND signal version is not above tag
#
# After task 0034 the real CLI payload lives under skills/cook/scripts/cook.sh,
# so we use that path as the payload fixture in these tests.  The old bin/cook
# fixture path is dropped along with the bin/ directory.
# ---------------------------------------------------------------------------

@test "(a) payload changed since tag and version == tag: exits non-zero" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "skills/cook/scripts/cook.sh" "#!/bin/sh"

  run_script "$FIX"

  [ "$status" -ne 0 ]
}

@test "(a) payload changed since tag and version == tag: output names the specific payload path" {
  # The script must report the specific changed file (skills/cook/scripts/cook.sh),
  # not just any skills/ path.  Uses a precise match so the shell's own
  # "not found: scripts/release-check" message cannot satisfy it.
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "skills/cook/scripts/cook.sh" "#!/bin/sh"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  [[ "$output" == *"skills/cook/scripts/cook.sh"* ]]
}

@test "(a) payload changed since tag and version == tag: output signals version not above tag" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "skills/cook/scripts/cook.sh" "#!/bin/sh"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  # Output (stderr) must signal the version/tag mismatch
  local lower
  lower="$(echo "$output" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"not above"* ]] || [[ "$lower" == *"not bumped"* ]] || [[ "$lower" == *"1.0.0"* ]]
}

# ---------------------------------------------------------------------------
# (b) payload changed since tag, version bumped strictly above tag → pass
# ---------------------------------------------------------------------------

@test "(b) payload changed and version bumped above tag: exits 0" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "skills/cook/scripts/cook.sh" "#!/bin/sh"
  bump_version "$FIX" "1.0.1"

  run_script "$FIX"

  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# (c) only excluded paths changed (tests/ and .jeff/) → pass
# ---------------------------------------------------------------------------

@test "(c) only excluded paths changed since tag: exits 0" {
  init_fixture_repo "$FIX" "2.0.0"
  commit_file "$FIX" "tests/some-test.bats" "# test"
  commit_file "$FIX" ".jeff/tasks/001-foo/task.json" '{"id":1}'

  run_script "$FIX"

  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Version metadata must stay in lockstep across shell package manifests.
# ---------------------------------------------------------------------------

@test "version mismatch: package.json version differs from plugin version" {
  init_fixture_repo "$FIX" "1.0.0"
  printf '{"version":"1.0.1"}\n' > "$FIX/package.json"
  git -C "$FIX" add package.json
  git -C "$FIX" commit -q -m "add mismatched package version"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  [[ "$output" == *"version mismatch"* ]]
  [[ "$output" == *"package.json"* ]]
}

@test "package.json metadata change requires a version bump" {
  init_fixture_repo "$FIX" "1.0.0"
  printf '{"version":"1.0.0","description":"updated package metadata"}\n' > "$FIX/package.json"
  git -C "$FIX" add package.json
  git -C "$FIX" commit -q -m "update package metadata"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  [[ "$output" == *"package.json"* ]]
}

# ---------------------------------------------------------------------------
# (d) version strictly below last tag (regression) → fail
# ---------------------------------------------------------------------------

@test "(d) version below last tag (regression): exits non-zero" {
  init_fixture_repo "$FIX" "2.0.0"
  bump_version "$FIX" "1.9.9"

  run_script "$FIX"

  [ "$status" -ne 0 ]
}

@test "(d) version below last tag (regression): output mentions version or regression" {
  init_fixture_repo "$FIX" "2.0.0"
  bump_version "$FIX" "1.9.9"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  local lower
  lower="$(echo "$output" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"version"* ]] || [[ "$lower" == *"below"* ]] || [[ "$lower" == *"1.9.9"* ]]
}

# ---------------------------------------------------------------------------
# (e) repo has NO plain-semver tag → pass (pre-release)
# ---------------------------------------------------------------------------

@test "(e) no plain-semver tag in repo: exits 0 (pre-release)" {
  git -C "$FIX" init -q
  git -C "$FIX" config user.email "test@fixture.example"
  git -C "$FIX" config user.name "Fixture Test"
  mkdir -p "$FIX/.claude-plugin"
  printf '{"version":"0.0.1"}\n' > "$FIX/.claude-plugin/plugin.json"
  git -C "$FIX" add .claude-plugin/plugin.json
  git -C "$FIX" commit -q -m "initial"
  # Tag with legacy-style tag only: does NOT match ^[0-9]+\.[0-9]+\.[0-9]+$
  git -C "$FIX" tag "v0.0.1"

  run_script "$FIX"

  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# (f) boundary: version == tag with payload change is NOT sufficient (explicit)
#     Distinct from (a): uses a different payload prefix (skills/) to confirm
#     the strictly-greater boundary applies across all payload paths, not just
#     the CLI fixture path used in (a).
# ---------------------------------------------------------------------------

@test "(f) boundary: version equals tag with skills/ payload change: exits non-zero" {
  init_fixture_repo "$FIX" "0.2.0"
  commit_file "$FIX" "skills/SKILL.md" "# New skill content"
  # version stays 0.2.0 (equal to tag, not strictly greater)

  run_script "$FIX"

  [ "$status" -ne 0 ]
}

@test "(f) boundary: version equals tag with skills/ payload change: output names the specific path" {
  # Uses skills/SKILL.md: this exact string cannot appear in the shell's
  # "no such file or directory: scripts/release-check" not-found message.
  init_fixture_repo "$FIX" "0.2.0"
  commit_file "$FIX" "skills/SKILL.md" "# New skill content"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  local lower
  lower="$(echo "$output" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"skills/skill.md"* ]] || [[ "$lower" == *"skills"* ]]
}

# ---------------------------------------------------------------------------
# Additional payload prefix coverage.
# Each test asserts status AND output content that cannot be satisfied by the
# shell's "no such file or directory: scripts/release-check" not-found message.
# ---------------------------------------------------------------------------

@test "payload/agents: change under agents/ triggers fail and output names the path" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "agents/AGENTS.md" "# agent doc"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  # "agents/agents.md" cannot appear in the not-found shell error
  local lower
  lower="$(echo "$output" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"agents/agents.md"* ]] || [[ "$lower" == *"agents/"* ]]
}

@test "payload/src: Pi runtime change requires a version bump" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "src/pi/extension.js" "export function activate() {}"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  [[ "$output" == *"src/pi/extension.js"* ]]
}

@test "payload/claude-plugin: non-version field change triggers fail and output names the path" {
  init_fixture_repo "$FIX" "1.0.0"
  printf '{"version":"1.0.0","name":"jeff"}\n' > "$FIX/.claude-plugin/plugin.json"
  git -C "$FIX" add .claude-plugin/plugin.json
  git -C "$FIX" commit -q -m "add name field"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  # ".claude-plugin/plugin.json" cannot appear in the scripts/release-check not-found error
  [[ "$output" == *".claude-plugin/plugin.json"* ]] || [[ "$output" == *".claude-plugin"* ]]
}

@test "README-only docs change does not require a version bump" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "README.md" "# Updated readme"

  run_script "$FIX"

  [ "$status" -eq 0 ]
}

@test "payload/AGENTS.md: change triggers fail and output names the file" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "AGENTS.md" "# Agent roster"

  run_script "$FIX"

  [ "$status" -ne 0 ]
  local lower
  lower="$(echo "$output" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"agents.md"* ]]
}

@test "excluded/docs: change under docs/ exits 0 (not a payload path)" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "docs/release-procedure.md" "# Release steps"

  run_script "$FIX"

  [ "$status" -eq 0 ]
}

@test "excluded/Makefile: change to Makefile exits 0 (not a payload file)" {
  init_fixture_repo "$FIX" "1.0.0"
  commit_file "$FIX" "Makefile" "test:\n\t@bats tests/"

  run_script "$FIX"

  [ "$status" -eq 0 ]
}
