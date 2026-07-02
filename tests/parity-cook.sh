#!/usr/bin/env bash
# tests/parity-cook.sh: differential wrapper for `cook validate` parity (AC2, AC3).
#
# Selected via COOK_OVERRIDE in the 9 validate-touching bats files. On `validate`,
# runs BOTH `skills/cook/scripts/cook.sh validate` and `node src/cli/cook.js
# validate` over the same COOK_ROOT store, and asserts equal exit code + equal
# sorted merged (stdout+stderr) output. On mismatch: prints a diagnostic and exits
# with a distinctive non-zero (a loud bats failure). On match: faithfully replays
# cook.sh's merged output + exit code, so the existing bats assertions (which run
# against cook.sh's output shape) stay meaningful. For any OTHER verb it delegates
# straight to cook.sh, unchanged, so unported-verb tests run exactly as before.
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SH_COOK="$REPO/skills/cook/scripts/cook.sh"
JS_COOK="$REPO/src/cli/cook.js"

if [ "${1:-}" != "validate" ]; then
  exec "$SH_COOK" "$@"
fi

sh_out="$("$SH_COOK" "$@" 2>&1)"
sh_rc=$?
js_out="$(node "$JS_COOK" "$@" 2>&1)"
js_rc=$?

sh_sorted="$(printf '%s\n' "$sh_out" | sort)"
js_sorted="$(printf '%s\n' "$js_out" | sort)"

if [ "$sh_rc" -ne "$js_rc" ] || [ "$sh_sorted" != "$js_sorted" ]; then
  {
    printf 'parity-cook.sh: PARITY MISMATCH on `validate`\n'
    printf -- '--- cook.sh (rc=%s) ---\n%s\n' "$sh_rc" "$sh_out"
    printf -- '--- cook.js (rc=%s) ---\n%s\n' "$js_rc" "$js_out"
  } >&2
  exit 99
fi

printf '%s\n' "$sh_out"
exit "$sh_rc"
