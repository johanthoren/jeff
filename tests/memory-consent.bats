#!/usr/bin/env bats
# tests/memory-consent.bats: task #77 — consent boundary for tracked memory writes.
#
# Covers (see task notes):
#   AC1 write: explicit Remember authorizes durable/tracked memory write
#   AC2 write: ordinary work without explicit persistence does not write durable memory
#   AC3 reuse guard: preserve purpose and format (already on SKILL + design)
#   AC4 reuse guard: AGENTS.md / README / product docs are not memory dumps
#   AC5 revise: operator guidance (README) and design align with cook Entry
#
# Seam: shipped Entry/Remember prose is the product surface (no runtime).
# Parallel-safe: read-only greps over fixed repo paths; no network/clock/FS writes.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

SKILL="$REPO/skills/cook/SKILL.md"
DESIGN="$REPO/docs/specs/jeff-design.md"
README="$REPO/README.md"

# ---------------------------------------------------------------------------
# AC1: explicit Remember authorizes updating durable / tracked memory
# RED until Entry Remember states that authorization on each aligned surface.
# ---------------------------------------------------------------------------

@test "AC1 skill: explicit Remember authorizes durable memory write" {
  # Consumer-observable: operators/agents reading Entry Remember must see that
  # an explicit Remember request is consent to write durable memory (including
  # a suitable existing tracked memory file outside full mode).
  run grep -E \
    'explicit Remember[^[:cntrl:]]{0,120}(authoriz|consent)[^[:cntrl:]]{0,120}(durable memory|tracked memory)|Remember request is the consent to write durable memory' \
    "$SKILL"
  [ "$status" -eq 0 ]
}

@test "AC1 design: explicit Remember authorizes durable memory write" {
  run grep -E \
    'explicit Remember[^[:cntrl:]]{0,120}(authoriz|consent)[^[:cntrl:]]{0,120}(durable memory|tracked memory)|Remember request is the consent to write durable memory' \
    "$DESIGN"
  [ "$status" -eq 0 ]
}

@test "AC1 readme: explicit Remember authorizes durable memory write" {
  run grep -E \
    'explicit Remember[^[:cntrl:]]{0,120}(authoriz|consent)[^[:cntrl:]]{0,120}(durable memory|tracked memory)|Remember request is the consent to write durable memory' \
    "$README"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC2: without explicit persistence request, ordinary work does not write memory
# RED until each surface states the negative duty.
# ---------------------------------------------------------------------------

@test "AC2 skill: ordinary work without explicit Remember does not write durable memory" {
  run grep -E \
    'does not write durable memory' \
    "$SKILL"
  [ "$status" -eq 0 ]
}

@test "AC2 design: ordinary work without explicit Remember does not write durable memory" {
  run grep -E \
    'does not write durable memory' \
    "$DESIGN"
  [ "$status" -eq 0 ]
}

@test "AC2 readme: ordinary work without explicit Remember does not write durable memory" {
  run grep -E \
    'does not write durable memory' \
    "$README"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC3 reuse guard: purpose and format preserved (green now on skill + design)
# ---------------------------------------------------------------------------

@test "AC3 skill: Remember preserves purpose and format" {
  run grep -F 'purpose and format' "$SKILL"
  [ "$status" -eq 0 ]
}

@test "AC3 design: Remember preserves purpose and format" {
  run grep -F 'purpose and format' "$DESIGN"
  [ "$status" -eq 0 ]
}

@test "AC3 readme: Remember preserves purpose and format" {
  # README Use→Remember currently omits this; AC5 alignment must carry it.
  run grep -F 'purpose and format' "$README"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC4 reuse/revise: AGENTS.md / README / product docs are not memory stores
# Skill + design already green; README gains the ban under AC5 alignment.
# ---------------------------------------------------------------------------

@test "AC4 skill: AGENTS.md / README are not memory dumps" {
  run grep -E 'Never use `AGENTS\.md`|AGENTS\.md.*not memory|not memory dump' "$SKILL"
  [ "$status" -eq 0 ]
}

@test "AC4 design: AGENTS.md / READMEs are not memory stores" {
  run grep -E 'AGENTS\.md.*not memory|not memory stores' "$DESIGN"
  [ "$status" -eq 0 ]
}

@test "AC4 readme: AGENTS.md / README / product docs stay out of the memory path" {
  # RED until README Remember carries the same exclusion as Entry/design.
  # Require AGENTS.md (or product documentation) in a memory-path ban clause,
  # not a bare AGENTS.md link elsewhere in the README.
  run grep -E \
    'AGENTS\.md[^[:cntrl:]]{0,160}(not memory|memory dump|memory store)|Never use `AGENTS\.md`|product documentation are not memory' \
    "$README"
  [ "$status" -eq 0 ]
}
