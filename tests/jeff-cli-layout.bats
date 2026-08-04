#!/usr/bin/env bats
# tests/jeff-cli-layout.bats: task #179 — harness hygiene for the Rust jeff CLI.
#
# Johan: do not use bats to test Rust CLI apps. assert_cmd owns argv behavior
# (`cargo test --manifest-path control/Cargo.toml --test cli`). This file locks
# the method-suite boundaries around that split: default `make test` never pulls
# cargo for the CLI contract, and the path-filtered Rust workflow is what does.
#   - tests/jeff-cli.bats is retired
#   - Makefile make test does not list jeff-cli.bats
#   - control/jeff declares assert_cmd under [dev-dependencies]
#   - control/jeff/tests/cli.rs is the assert_cmd integration suite
#   - control/jeff crate version string equals package.json product version
#   - .github/workflows/rust.yml runs the cargo gates make test refuses to
#
# Parallel-safe: read-only path and grep checks. No cargo, network, or clock.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

RUST_WORKFLOW="$REPO/.github/workflows/rust.yml"

# Print the Rust workflow command line that invokes `cargo <subcommand>`.
# Reads both the `run: cargo ...` spelling and a bare line inside a `run: |`
# block, so moving a step into a block scalar cannot fake a missing gate.
rust_workflow_gate() {
  awk -v want="$1" '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      sub(/^run:[[:space:]]*/, "", line)
      if (line !~ /^cargo[[:space:]]/) next
      split(line, field, " ")
      if (field[2] == want) print line
    }
  ' "$RUST_WORKFLOW"
}

# Fail unless the workflow runs `cargo <subcommand>` carrying every token that
# lets that step fail. A removed step and a step stripped of its enforcing flag
# have the same consequence: unverified control/ code merges green.
assert_rust_gate() {
  local subcommand="$1" gate token
  shift
  gate="$(rust_workflow_gate "$subcommand")"
  if [ -z "$gate" ]; then
    echo "rust.yml runs no cargo $subcommand step; that gate stopped running"
    return 1
  fi
  for token in "$@"; do
    if [[ " $gate " != *" $token "* ]]; then
      echo "cargo $subcommand step cannot fail without '$token': $gate"
      return 1
    fi
  done
}

@test "#179 harness: tests/jeff-cli.bats is retired" {
  if [ -e "$REPO/tests/jeff-cli.bats" ]; then
    echo "tests/jeff-cli.bats must be deleted; assert_cmd owns the CLI contract"
    return 1
  fi
}

@test "#179 harness: Makefile make test does not list jeff-cli.bats" {
  if grep -E '(^|[[:space:]])tests/jeff-cli\.bats([[:space:]]|$)' "$REPO/Makefile" >/dev/null; then
    echo "Makefile still lists tests/jeff-cli.bats"
    grep -n 'jeff-cli\.bats' "$REPO/Makefile" || true
    return 1
  fi
}

@test "#179 AC7: control/jeff/tests/cli.rs assert_cmd suite exists" {
  [ -f "$REPO/control/jeff/tests/cli.rs" ] \
    || { echo "missing control/jeff/tests/cli.rs"; return 1; }
  grep -q 'assert_cmd' "$REPO/control/jeff/tests/cli.rs" \
    || { echo "cli.rs does not use assert_cmd"; return 1; }
}

@test "#179 AC7: control/jeff dev-depends on assert_cmd" {
  local toml="$REPO/control/jeff/Cargo.toml"
  [ -f "$toml" ] || { echo "missing $toml"; return 1; }
  awk '
    /^\[dev-dependencies\]/ { in_dev=1; next }
    /^\[/ { in_dev=0 }
    in_dev && $0 ~ /^assert_cmd[[:space:]]*=/ { found=1 }
    END { exit found ? 0 : 1 }
  ' "$toml" \
    || { echo "control/jeff/Cargo.toml missing assert_cmd under [dev-dependencies]"; return 1; }
}

@test "#186 AC5: make test invokes no cargo command" {
  # A contributor working only on the Node side must be able to run the default
  # suite with no Rust toolchain installed. The Rust suite belongs to the
  # path-filtered cargo workflow, never to make test.
  #
  # Reads the recipe make would run (variables expanded) rather than the
  # Makefile text, so it survives a behavior-preserving Makefile refactor.
  # kiss: covers the make recipe only, not a bats case that shells out to
  # cargo itself; widen the probe if a suite file ever needs the toolchain.
  run env -u MAKEFLAGS make -C "$REPO" -n test
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  if grep -Eq '(^|[[:space:]])cargo([[:space:]]|$)' <<<"$output"; then
    echo "make test invokes cargo; the default suite must stay toolchain-free"
    grep -En '(^|[[:space:]])cargo([[:space:]]|$)' <<<"$output"
    return 1
  fi
}

@test "#188 AC2: rust.yml gates control/ on fmt, clippy and locked cargo test" {
  # Complement of the case above. make test refuses to run cargo, so this
  # workflow is the only thing that ever compiles, lints or tests control/.
  # Delete the file, drop a step, or strip the flag that lets a step fail, and
  # nothing else in the repository notices: that is the consumer-observable
  # behavior asserted here, not the YAML shape that expresses it. The case is
  # deliberately blind to step names, step order, --manifest-path and every
  # other incidental detail, so switching to `working-directory: control` or
  # reordering the steps keeps it green.
  #
  # --locked on clippy is load-bearing, not cosmetic. Cargo rewrites
  # control/Cargo.lock in place whenever it disagrees with a manifest and the
  # steps share one checkout, so an unlocked lint step repairs a stale lockfile
  # and the locked test step then finds nothing left to refuse. control/Cargo.lock
  # is the one version-bearing location scripts/release-check does not cover.
  #
  # cargo fmt is asserted without --locked on purpose: it resolves no
  # dependencies, and it rejects the flag outright with `error: unexpected
  # argument '--locked' found`.
  [ -f "$RUST_WORKFLOW" ] || { echo "missing $RUST_WORKFLOW"; return 1; }
  assert_rust_gate fmt --check
  assert_rust_gate clippy --locked '-D warnings'
  assert_rust_gate test --locked
}

@test "#179 AC12: control/jeff crate version matches package.json" {
  # Checked-in lockstep only (no build-script injection). assert_cmd still
  # asserts env!(CARGO_PKG_VERSION); this guards the source string itself.
  local pkg crate_ver
  pkg="$(jq -r .version "$REPO/package.json")"
  [ -n "$pkg" ] && [ "$pkg" != "null" ] \
    || { echo "package.json missing version"; return 1; }
  crate_ver="$(
    awk '
      /^\[package\]/ { in_pkg=1; next }
      /^\[/ { in_pkg=0 }
      in_pkg && $0 ~ /^version[[:space:]]*=/ {
        if (match($0, /"[^"]+"/)) {
          print substr($0, RSTART+1, RLENGTH-2)
          exit
        }
      }
    ' "$REPO/control/jeff/Cargo.toml"
  )"
  [ -n "$crate_ver" ] \
    || { echo "could not read version from control/jeff/Cargo.toml"; return 1; }
  if [ "$crate_ver" != "$pkg" ]; then
    echo "control/jeff version ($crate_ver) != package.json ($pkg)"
    return 1
  fi
}
