#!/usr/bin/env bats
# tests/flavor.bats: cook flavor resolver — 7 behavioral cases (T1–T7).
# Seam: cook flavor CLI stdout (exit 0, one word from {kitchen,plain}).
# All RED until Slice 1 adds cmd_flavor() to cook.sh.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/src/cli/cook.js"

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK"
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@flavor.example"
  git -C "$TMP" config user.name "Flavor Test"
}

teardown() {
  unset JEFF_FLAVOR
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# T1: env=plain, no per-repo config -> plain  (AC1)
@test "T1: JEFF_FLAVOR=plain, no per-repo config -> plain" {
  export JEFF_FLAVOR=plain
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "plain" ]
}

# T2: env=kitchen, no per-repo config -> kitchen  (AC1)
@test "T2: JEFF_FLAVOR=kitchen, no per-repo config -> kitchen" {
  export JEFF_FLAVOR=kitchen
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "kitchen" ]
}

# T3: per-repo flavor:true + env=plain -> kitchen (per-repo wins)  (AC2, AC3)
@test "T3: per-repo flavor:true + JEFF_FLAVOR=plain -> kitchen" {
  jq -n --argjson flavor true '{flavor: $flavor}' > "$BK/config.json"
  export JEFF_FLAVOR=plain
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "kitchen" ]
}

# T4: per-repo flavor:false (real JSON bool) + env=kitchen -> plain  (AC2, AC3, AC5)
# Guards the // empty false-swallow bug: false must not fall through to env/default.
@test "T4: per-repo flavor:false (real JSON bool) + JEFF_FLAVOR=kitchen -> plain" {
  jq -n --argjson flavor false '{flavor: $flavor}' > "$BK/config.json"
  export JEFF_FLAVOR=kitchen
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "plain" ]
}

# T5: env unset, no per-repo config -> kitchen (built-in default)  (AC3, AC4)
@test "T5: JEFF_FLAVOR unset, no per-repo config -> kitchen (default)" {
  unset JEFF_FLAVOR
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "kitchen" ]
}

# T6: env=garbage (unknown), no per-repo config -> plain  (AC4)
@test "T6: JEFF_FLAVOR=garbage, no per-repo config -> plain" {
  export JEFF_FLAVOR=garbage
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "plain" ]
}

# T7: per-repo flavor:"weird" (present, unrecognized) + env=kitchen -> plain  (AC4, AC2)
# Unknown per-repo value maps plain AND does not fall through to env.
@test "T7: per-repo flavor:\"weird\" + JEFF_FLAVOR=kitchen -> plain" {
  jq -n '{flavor: "weird"}' > "$BK/config.json"
  export JEFF_FLAVOR=kitchen
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "plain" ]
}

# T8: malformed config.json + JEFF_FLAVOR=kitchen -> degrade to env (kitchen)  (AC4)
# jq parse failure must not hard-fail the resolver; degrade to env/default.
@test "T8: malformed config.json + JEFF_FLAVOR=kitchen -> kitchen (degrade, no hard-fail)" {
  printf '%s' '{bad json' > "$BK/config.json"
  export JEFF_FLAVOR=kitchen
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "kitchen" ]
}

# T9: malformed config.json + JEFF_FLAVOR unset -> degrade to built-in default (kitchen)  (AC4)
# Distinct from T8 (env absent) and T5 (no file; here file is present but unparseable).
@test "T9: malformed config.json + JEFF_FLAVOR unset -> kitchen (degrade to default)" {
  printf '%s' '{bad json' > "$BK/config.json"
  unset JEFF_FLAVOR
  run cook flavor
  [ "$status" -eq 0 ]
  [ "$output" = "kitchen" ]
}
