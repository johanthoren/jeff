#!/usr/bin/env bash
# tests/parity-cook.sh: differential wrapper for `cook validate` parity (AC2, AC3).
#
# Selected via COOK_OVERRIDE in the validate-touching Bats files. On `validate`,
# runs both the retained Bash transition oracle and shipped `cook validate` over
# the same COOK_ROOT store, then asserts equal exit code + equal sorted merged
# (stdout+stderr) output. On mismatch it prints a diagnostic and exits with a
# distinctive non-zero. On match it faithfully replays the oracle's merged output
# + exit code, so the existing Bats assertions stay meaningful. For any other verb
# it delegates straight to cook.sh, unchanged.
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SH_COOK="$REPO/skills/cook/scripts/cook.sh"

# Invoke the retained Bash validator as a transition oracle without routing
# through the shipped `cook validate` entry. cook.sh's source-only guard keeps
# this seam independently callable by differential tests, not by live users.
run_bash_oracle() {
  COOK_SOURCE_ONLY=1 bash -c '. "$1"; shift; cmd_validate "$@"' _ "$SH_COOK" "$@"
}

if [ "${1:-}" = "_validate-oracle" ]; then
  shift
  run_bash_oracle "$@"
  exit $?
fi

if [ "${1:-}" != "validate" ]; then
  exec "$SH_COOK" "$@"
fi

sh_out="$(run_bash_oracle 2>&1)"
sh_rc=$?
js_out="$("$SH_COOK" "$@" 2>&1)"
js_rc=$?

# Known ceiling (deliberate): comparing the SORTED merged (stdout+stderr) streams
# cannot detect a stdout-vs-stderr swap or intra-stream reordering : only the set of
# lines and the exit code. Sufficient for the validator's parity (line identity +
# exit code are the contract); a stream-faithful diff would be the upgrade path.
sh_sorted="$(printf '%s\n' "$sh_out" | sort)"
js_sorted="$(printf '%s\n' "$js_out" | sort)"

if [ "$sh_rc" -ne "$js_rc" ] || [ "$sh_sorted" != "$js_sorted" ]; then
  {
    printf 'parity-cook.sh: PARITY MISMATCH on `validate`\n'
    printf -- '--- cook.sh (rc=%s) ---\n%s\n' "$sh_rc" "$sh_out"
    printf -- '--- live cook validate (rc=%s) ---\n%s\n' "$js_rc" "$js_out"
  } >&2
  exit 99
fi

printf '%s\n' "$sh_out"
exit "$sh_rc"
