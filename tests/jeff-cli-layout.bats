#!/usr/bin/env bats
# tests/jeff-cli-layout.bats: task #179 — harness hygiene for the Rust jeff CLI.
#
# Johan: do not use bats to test Rust CLI apps. assert_cmd owns argv behavior
# (`cargo test --manifest-path control/Cargo.toml --test cli`). This file only
# locks method-suite boundaries so default `make test` never pulls cargo for
# the CLI contract:
#   - tests/jeff-cli.bats is retired
#   - Makefile make test does not list jeff-cli.bats
#   - control/jeff declares assert_cmd under [dev-dependencies]
#   - control/jeff/tests/cli.rs is the assert_cmd integration suite
#
# Parallel-safe: read-only path and grep checks. No cargo, network, or clock.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

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
