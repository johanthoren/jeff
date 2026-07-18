#!/usr/bin/env bash
# cook-precommit-gate.sh: task 0035: PreToolUse/Bash validator backstop.
#
# Pure stdin(JSON) to stdout(decision) hook. It runs the Node validator only for
# git commits in an active Jeff project. Infrastructure failures allow the tool;
# a validator-confirmed invalid state denies it.

set -euo pipefail

payload="$(cat)"
cwd="$(printf '%s' "$payload" | node -e '
  const fs = require("fs");
  const path = require("path");
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const command = typeof payload.tool_input?.command === "string" ? payload.tool_input.command : "";
    const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
    const isCommit = /(^|[^A-Za-z0-9_-])git(?:\s+\S+)*\s+commit(?:\s|$)/.test(command);
    if (!isCommit || cwd === "") process.exit(0);
    const config = JSON.parse(fs.readFileSync(path.join(cwd, ".jeff", "config.json"), "utf8"));
    if (config?.active === true) process.stdout.write(cwd);
  } catch {}
')" || exit 0
[ -n "$cwd" ] || exit 0

out="$(cd "$cwd" && node "${CLAUDE_PLUGIN_ROOT:-}/src/cli/cook.js" validate 2>&1)" && rc=0 || rc=$?

if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -Eq '^cook: validation FAILED'; then
  verdict="$(printf '%s\n' "$out" | grep -E '^cook: validation FAILED' | tail -n1)"
  reason="$verdict: commit blocked. Run 'cook validate' to see the issues and fix the task state before committing."
  REASON="$reason" node -e '
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: process.env.REASON,
      },
    }));
  '
fi

exit 0
