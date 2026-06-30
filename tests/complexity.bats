#!/usr/bin/env bats
# tests/complexity.bats: task 0029: retire `trivial` (easy-axis), replace with
# `"complexity": "simple" | "complex"` in every task-template emitter.
#
# Concerns covered:
#   1. Emission/adopt: `cook on <ref>` emits `complexity` field, not `trivial`.
#
# The vocab-guard tests (five source/instruction-surface word greps) were removed
# in task 0050 as change-detectors. The emit/adopt tests below cover the only
# consumer-observable seam: the produced task.json field.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

# ---------------------------------------------------------------------------
# Setup / teardown: mirrors lite-adopt.bats
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@complexity.example"
  git -C "$TMP" config user.name "Complexity Test"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# write_lite_config: write .jeff/config.json with mode:"lite", active:true.
write_lite_config() {
  mkdir -p "$BK"
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# ---------------------------------------------------------------------------
# EMISSION: adopt path (`cook on <ref>`)
#
# The adopt emitter (cmd_on / adopt_ledger, skills/cook/scripts/cook.sh ~line
# 1191) is only reachable via `cook on <ref>` in lite mode. We drive it through
# the subcommand and inspect the written task.json.
# ---------------------------------------------------------------------------

@test "emit/adopt: cook on emits complexity field (not trivial) in ledger" {
  # RED now: cook.sh ~1191 emits `trivial: false`; no `complexity` field exists.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n\n- [ ] build it\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  # Find the emitted ledger by scanning for the externalRef.
  local ledger
  ledger="$(
    find "$BK/tasks" -name task.json 2>/dev/null | while IFS= read -r f; do
      if jq -e '.externalRef == "docs/plans/widget.md"' "$f" >/dev/null 2>&1; then
        printf '%s\n' "$f"
        break
      fi
    done
  )"
  [ -n "$ledger" ]

  # Must have a `complexity` field.
  run jq -r 'has("complexity")' "$ledger"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}

@test "emit/adopt: cook on emits complexity:complex as default in ledger" {
  # RED now: no `complexity` field; default-complex-when-unsure is unimplemented.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n\n- [ ] build it\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(
    find "$BK/tasks" -name task.json 2>/dev/null | while IFS= read -r f; do
      if jq -e '.externalRef == "docs/plans/widget.md"' "$f" >/dev/null 2>&1; then
        printf '%s\n' "$f"
        break
      fi
    done
  )"
  [ -n "$ledger" ]

  run jq -r '.complexity' "$ledger"
  [ "$status" -eq 0 ]
  [ "$output" = "complex" ]
}

@test "emit/adopt: cook on does NOT emit trivial field in ledger" {
  # RED now: cook.sh ~1191 still emits `trivial: false`.
  write_lite_config
  mkdir -p "$TMP/docs/plans"
  printf '# Widget plan\n\n- [ ] build it\n' > "$TMP/docs/plans/widget.md"

  run cook on "docs/plans/widget.md"
  [ "$status" -eq 0 ]

  local ledger
  ledger="$(
    find "$BK/tasks" -name task.json 2>/dev/null | while IFS= read -r f; do
      if jq -e '.externalRef == "docs/plans/widget.md"' "$f" >/dev/null 2>&1; then
        printf '%s\n' "$f"
        break
      fi
    done
  )"
  [ -n "$ledger" ]

  # `trivial` must be absent.
  run jq -r 'has("trivial")' "$ledger"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

# ---------------------------------------------------------------------------
# VOCABULARY GUARD: REMOVED (task 0050)
#
# The five vocab-guard tests were change-detectors: four grep-ed
# instruction-surface markdown (skills/cook/SKILL.md, AGENTS.md, agents/*.md,
# README.md) asserting the retired word "trivial" is ABSENT, and the fifth
# grep-ed the production CLI source (skills/cook/scripts/cook.sh) the same way.
# Per skills/testing/SKILL.md's consumer-observable discriminator, "assert a
# retired vocabulary word is absent across instruction-surface markdown" is the
# named banned smell: no consumer observes the source prose, the assertions go
# red only on a prose edit, and they catch no regression that edit would not.
#
# The behavior that actually matters: the `trivial` field is retired and
# `complexity` is emitted instead: is fully guarded at the consumer-observable
# seam by the emit/adopt tests above: they run `cook on` and assert the PRODUCED
# task.json has `complexity:"complex"` and `has("trivial") == false`. That is
# where a real regression (the field coming back) would surface; the prose/source
# greps added no signal a consumer observes. Deleted (git is the archive).
#
# The CLI's existence at its new location remains guarded behaviorally by
# tests/cli-location.bats ("structural: skills/cook/scripts/cook.sh exists").
# ---------------------------------------------------------------------------
