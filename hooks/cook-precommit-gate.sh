#!/usr/bin/env bash
# cook-precommit-gate.sh: task 0035: PreToolUse/Bash validator backstop.
#
# Pure stdin(JSON) -> stdout(decision) + exit-code function. Reads the
# PreToolUse payload, and ONLY when the agent is making a `git commit` in an
# active jeff project does it run `cook.sh validate`. It blocks the commit
# (deny-via-JSON) IFF validate reports a genuine invalid task state; every other
# outcome (happy path, or any infra failure) is a bare exit-0 fail-open allow.
#
# Failure semantics (locked decision): fail-OPEN on infra-error (validator
# cannot run / crashes / non-validation failure), fail-CLOSED only on a real
# invalid state. The command string is ONLY ever string-matched, never eval'd.
#
# Writes nothing: reads stdin + one config file + runs the read-only validator.

set -euo pipefail

# Read the whole payload once. If jq is missing or the JSON is unparseable,
# fail-open (a bare exit 0): never wedge the agent on our own infra error.
payload="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
cwd="$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null)" || exit 0

# Gate 1 (cheapest, no FS): is this a `git commit`? Match the `git … commit`
# verb anywhere in the command, allowing any flag/value tokens between `git` and
# `commit` (catches bare, `&&`-compound, `--amend`, `-C dir`, `-c k=v`, and the
# squash-merge commit) while keeping `commit` in subcommand position so
# `git log --grep=commit` / `git commit-graph` do NOT match. A harmless
# over-match of an obscure non-commit `git` line is acceptable; under-matching a
# real commit is the failure to avoid. The command is only string-matched here,
# never executed.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' || exit 0

# Gate 2: is <cwd>/.jeff/config.json present with active == true? Resolve
# the project root solely from the payload .cwd (production contract).
[ -n "$cwd" ] || exit 0
config="$cwd/.jeff/config.json"
[ -f "$config" ] || exit 0
active="$(jq -r '.active // false' "$config" 2>/dev/null)" || exit 0
[ "$active" = "true" ] || exit 0

# Only now run the (read-only) validator. Resolve it via ${CLAUDE_PLUGIN_ROOT}
# (double-quoted, space-safe) and execute it from the payload .cwd so the
# validator detects the same project. The errexit-safe idiom keeps a non-zero
# validate from aborting the hook before it decides allow-vs-deny.
out="$(cd "$cwd" && "${CLAUDE_PLUGIN_ROOT:-}/skills/cook/scripts/cook.sh" validate 2>&1)" && rc=0 || rc=$?

# Discriminator (the crux): deny IFF validate exited non-zero AND its output
# carries a LINE-ANCHORED `cook: validation FAILED` verdict. That single anchor
# matches BOTH the parenthesised count form `cook: validation FAILED (N
# issue(s))` (a genuinely-invalid store) AND the colon infra-die form `cook:
# validation FAILED: <reason>` (a malformed/unparseable store: the validator
# ran and determined the store is broken, which is invalid → deny). The true
# can't-run paths emit NO `cook: validation FAILED` line: `require_jq` prints
# "jq is required" (exit 3), a missing cook.sh exec-fails (exit 127, no output),
# an unparseable payload fail-opens before validate: all stay fail-open allow.
# Line-anchoring (^cook: validation FAILED) means a path/dir-name that merely
# contains the verdict text inside a longer line can never forge a match. Do NOT
# key the deny off a bare exit 1.
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -Eq '^cook: validation FAILED'; then
  verdict="$(printf '%s\n' "$out" | grep -E '^cook: validation FAILED' | tail -n1)"
  reason="$verdict: commit blocked. Run 'cook validate' to see the issues and fix the task state before committing."
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

# Allow / pass-through: bare exit 0, no stdout.
exit 0
