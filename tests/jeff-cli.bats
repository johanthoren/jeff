#!/usr/bin/env bats
# tests/jeff-cli.bats: task #179 — minimal jeff CLI front door under control/.
#
# Covers (see .jeff/tasks/lite-179-3190743360/task.md):
#   AC1: Cargo workspace under control/ (never in npm files allowlist)
#   AC2: Binary crate jeff builds (cargo test / cargo build in control/)
#   AC3: Clap with derive API
#   AC4: --help / -h print help and exit 0
#   AC5: --version / -V print version and exit 0
#   AC6: bare jeff prints help (arg_required_else_help or equivalent)
#   AC7: integration tests prove bare-help, --help, --version
#   AC8: control/target/ (or workspace target) is gitignored
#   AC9: no required subcommands / TUI / jeffd for this task
#
# Seam: operators run the jeff binary from the control/ workspace. Behavior is
# observed on argv exit codes and stdout. Structural guards keep Rust out of the
# npm payload and keep build artifacts untracked.
#
# Parallel-safe: read-only structural checks; cargo/binary runs use the repo
# control/ tree only (cargo's own target dir). No network, clock, or shared
# mutable host state beyond the workspace target cache.
#
# RED now: control/ does not exist yet.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

CONTROL="$REPO/control"
WORKSPACE_TOML="$CONTROL/Cargo.toml"
JEFF_TOML="$CONTROL/jeff/Cargo.toml"
JEFF_BIN="$CONTROL/target/debug/jeff"

# ---------------------------------------------------------------------------
# AC1 / AC8 / npm boundary: workspace layout and ignore rules
# ---------------------------------------------------------------------------

@test "#179 AC1: control/ Cargo workspace manifest exists" {
  [ -f "$WORKSPACE_TOML" ] \
    || { echo "missing $WORKSPACE_TOML"; return 1; }
  grep -qE '^\[workspace\]' "$WORKSPACE_TOML" \
    || { echo "control/Cargo.toml is not a [workspace]"; return 1; }
  grep -qE 'jeff' "$WORKSPACE_TOML" \
    || { echo "workspace does not name the jeff member"; return 1; }
}

@test "#179 AC1: package.json files allowlist does not include control/" {
  # Consumer-observable: npm pack must never ship the Rust workspace.
  run jq -e '
    (.files // [])
    | map(tostring)
    | any(test("^control(/|$)") or test("(^|/)control(/|$)"))
    | not
  ' "$REPO/package.json"
  [ "$status" -eq 0 ] \
    || { echo "package.json files allowlist admits control/"; return 1; }
}

@test "#179 AC8: control target directory is gitignored" {
  # Accept control/target/, /control/target/, or a target/ rule that covers it.
  run git -C "$REPO" check-ignore -v -- control/target/debug/jeff
  [ "$status" -eq 0 ] \
    || { echo "control/target/ is not gitignored"; return 1; }
}

# ---------------------------------------------------------------------------
# AC2 / AC3: crate builds and uses Clap derive
# ---------------------------------------------------------------------------

@test "#179 AC2: jeff binary crate manifest exists" {
  [ -f "$JEFF_TOML" ] \
    || { echo "missing $JEFF_TOML"; return 1; }
  grep -qE '^name[[:space:]]*=[[:space:]]*"jeff"' "$JEFF_TOML" \
    || { echo "jeff crate name is not jeff"; return 1; }
}

@test "#179 AC3: jeff sources use Clap derive API" {
  # Marker is the derive surface operators depend on via Cargo.toml + source.
  local hits
  hits="$(
    grep -R --include='*.rs' -nE '#\[derive\([^\]]*Parser' "$CONTROL/jeff" 2>/dev/null || true
  )"
  [ -n "$hits" ] \
    || { echo "no Clap derive Parser in control/jeff"; return 1; }
  grep -qE 'clap' "$JEFF_TOML" \
    || { echo "jeff Cargo.toml does not depend on clap"; return 1; }
}

@test "#179 AC2 / AC7: cargo test --manifest-path control/Cargo.toml exits 0" {
  [ -f "$WORKSPACE_TOML" ] || { echo "missing workspace; cargo test cannot run"; return 1; }
  run cargo test --manifest-path "$WORKSPACE_TOML" --quiet
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; return 1; }
}

# ---------------------------------------------------------------------------
# AC4 / AC5 / AC6 / AC7: argv contract on the built binary
# ---------------------------------------------------------------------------

build_jeff() {
  cargo build --manifest-path "$WORKSPACE_TOML" --quiet
  [ -x "$JEFF_BIN" ] || { echo "missing built binary at $JEFF_BIN"; return 1; }
}

crate_version() {
  # Prefer the jeff package version; fall back to workspace package version.
  local v
  v="$(grep -E '^version[[:space:]]*=' "$JEFF_TOML" | head -n1 | sed -E 's/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')"
  if [ -z "$v" ] && [ -f "$WORKSPACE_TOML" ]; then
    v="$(grep -E '^version[[:space:]]*=' "$WORKSPACE_TOML" | head -n1 | sed -E 's/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')"
  fi
  printf '%s' "$v"
}

@test "#179 AC4 / AC7: jeff --help exits 0 and prints Usage" {
  build_jeff
  run "$JEFF_BIN" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]] || { echo "help missing Usage"; printf '%s\n' "$output"; return 1; }
}

@test "#179 AC4: jeff -h exits 0 and prints Usage" {
  build_jeff
  run "$JEFF_BIN" -h
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]] || { echo "-h missing Usage"; printf '%s\n' "$output"; return 1; }
}

@test "#179 AC5 / AC7: jeff --version exits 0 and includes crate version" {
  build_jeff
  local ver
  ver="$(crate_version)"
  [ -n "$ver" ] || { echo "could not read crate version"; return 1; }
  run "$JEFF_BIN" --version
  [ "$status" -eq 0 ]
  [[ "$output" == *"$ver"* ]] \
    || { echo "--version missing $ver"; printf '%s\n' "$output"; return 1; }
}

@test "#179 AC5: jeff -V exits 0 and includes crate version" {
  build_jeff
  local ver
  ver="$(crate_version)"
  [ -n "$ver" ] || { echo "could not read crate version"; return 1; }
  run "$JEFF_BIN" -V
  [ "$status" -eq 0 ]
  [[ "$output" == *"$ver"* ]] \
    || { echo "-V missing $ver"; printf '%s\n' "$output"; return 1; }
}

@test "#179 AC6 / AC7: bare jeff exits 0 and prints help" {
  # Until multi-pane exists, bare argv must not drop into a missing app.
  build_jeff
  run "$JEFF_BIN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]] \
    || { echo "bare jeff did not print help"; printf '%s\n' "$output"; return 1; }
}

@test "#179 AC9: jeff crate has no required subcommands beyond help/version for this task" {
  # Guard against premature graph/backlog/jeffd surface in this minimal front door.
  build_jeff
  run "$JEFF_BIN" --help
  [ "$status" -eq 0 ]
  if grep -qiE '[[:space:]](graph|backlog|jeffd)([[:space:]]|$)' <<<"$output"; then
    echo "minimal front door help advertises out-of-scope subcommands:"
    printf '%s\n' "$output"
    return 1
  fi
}
