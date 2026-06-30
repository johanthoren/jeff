#!/usr/bin/env bats
# tests/command-routing.bats: packaging-fact guard for the skill-only cook.
#
# History: this file once held a "content-contract suite" that grep-ed
# skills/cook/SKILL.md and AGENTS.md prose for routing/CLI-resolution tokens
# ("scripts/cook.sh", "base directory", "${CLAUDE_SKILL_DIR}", "bin/cook",
# "Activating jeff", "control verb", "without a leading", …) and token
# absences.
#
# Task 0050 deleted all of those: per skills/testing/SKILL.md's
# consumer-observable discriminator, grepping instruction-surface prose for a
# string is a change-detector: no consumer observes the source wording, the
# assertion only goes red when someone edits the prose, and it catches no
# regression that edit would not. The real contract those greps shadowed (the
# skill actually triggers + resolves the CLI on a live install) was verified by
# the ~/code/jeff install smoke test, not by these in-repo string matches, and
# there is no in-repo behavioral seam for "the skill triggers".
#
# What remains is the ONE genuinely behavioral assertion: a packaging fact a
# consumer/installer observes: the slash command file was removed in 0.5.1, so
# the plugin is skill-only. Its presence/absence changes how the plugin installs
# and activates.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

# ---------------------------------------------------------------------------
# Command removed (0.5.1): no commands/cook.md, no commands/ slash command.
# This is a packaging fact, not source prose: kept (behavioral).
# ---------------------------------------------------------------------------

@test "0.5.1: commands/cook.md is removed (skill-only invocation)" {
  [ ! -f "$REPO/commands/cook.md" ]
}
