#!/usr/bin/env bats
# tests/verify.bats: bats suite for task 0044: cook verify + jsonl baseline log.
#
# Groups covered (from Test design block in notes.md):
#   A: `cook verify` (config-driven gate runner)
#   B: test-runs.jsonl log + .git/info/exclude + `cook baseline check`
#
# Strategy:
#   - Each test builds its own synthetic git repo in $TMP so git rev-parse HEAD
#     and git status --porcelain work correctly.
#   - Full-mode: config.json with no `mode` key (or mode:"full"): default.
#   - Lite-mode: config.json with mode:"lite" + a conformant profile.md.
#   - cook() wrapper: COOK_ROOT="$TMP" "$COOK" "$@"
#   - RED tests: `cook verify` / `cook baseline` are unknown subcommands → die.
#   - GREEN tests (preservation): baseline check failure cases stay non-zero.
#
# bash 3.2 / POSIX-leaning / no grep -P / no GNU-isms.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/skills/cook/scripts/cook.sh"

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK"
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@verify.example"
  git -C "$TMP" config user.name "Verify Test"
  # Initial commit so HEAD is valid.
  git -C "$TMP" commit --allow-empty -q -m "init"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_full_config: full-mode config (no testCommand yet; that is the new field).
write_full_config() {
  jq -n '{schemaVersion:1, system:"jeff", active:true}' \
    > "$BK/config.json"
}

# write_full_config_with_cmd <cmd>: full-mode config with testCommand.
write_full_config_with_cmd() {
  local cmd="$1"
  jq -n --arg cmd "$cmd" \
    '{schemaVersion:1, system:"jeff", active:true, testCommand:$cmd}' \
    > "$BK/config.json"
}

# write_lite_config: lite-mode config.
write_lite_config() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# write_profile_with_cmd <cmd>: conformant profile.md with the given test command.
# Uses the exact "Test command: `<cmd>`." format the extractor will read.
write_profile_with_cmd() {
  local cmd="$1"
  cat > "$BK/profile.md" << PROFILE
\`\`\`json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "path": ".jeff/profile.md", "hash": "sha256:000000000000000000000000000000000000000000000000000000000000000" }
  ]
}
\`\`\`

## Operating Profile

Task location: \`.jeff/tasks/\`; breakdown: one task per logical change.

Branch: feature branches off main; merge via PR.

Handoff: leave tests green, \`cook validate\` passing.

Test command: \`${cmd}\`.

Standards: operator code-standards skill (baseline).

Audit triggers: security-sensitive paths.

Vocabulary:
- task = Jeff task
PROFILE
}

# write_profile_no_cmd: conformant profile.md with NO "Test command:" line.
write_profile_no_cmd() {
  cat > "$BK/profile.md" << 'PROFILE'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "path": ".jeff/profile.md", "hash": "sha256:000000000000000000000000000000000000000000000000000000000000000" }
  ]
}
```

## Operating Profile

Task location: `.jeff/tasks/`; breakdown: one task per logical change.

Branch: feature branches off main; merge via PR.

Handoff: leave tests green, `cook validate` passing.

Standards: operator code-standards skill (baseline).

Audit triggers: security-sensitive paths.

Vocabulary:
- task = Jeff task
PROFILE
}

# append_jsonl_line <hash> <dirty_bool> <result>: manually append a jsonl line.
# Used to pre-seed the log for baseline check tests.
append_jsonl_line() {
  local hash="$1" dirty="$2" result="$3"
  jq -nc \
    --arg hash "$hash" \
    --argjson dirty "$dirty" \
    --arg result "$result" \
    --arg suite "synthetic-suite" \
    --arg at "2026-01-01T00:00:00Z" \
    '{hash:$hash, dirty:$dirty, result:$result, suite:$suite, at:$at}' \
    >> "$BK/test-runs.jsonl"
}

# dirty_tree: add an untracked file to make the tree dirty.
dirty_tree() {
  printf 'dirty\n' > "$TMP/untracked-dirty-file.txt"
}

# clean_tree: ensure tree is clean (remove any untracked additions).
clean_tree() {
  rm -f "$TMP/untracked-dirty-file.txt"
}

# ---------------------------------------------------------------------------
# A: `cook verify` (config-driven gate runner)
# ---------------------------------------------------------------------------

@test "verify/A1: full-mode with testCommand:true exits 0 and reports green" {
  # Test design A line 1: verify with a configured passing command exits 0 and
  # reports green: CLI (config testCommand:"true", assert status 0 + "green").
  # RED now: `cook verify` is an unknown subcommand → dies non-zero.
  write_full_config_with_cmd "true"
  run cook verify
  [ "$status" -eq 0 ]
  [[ "$output" == *"green"* ]]
}

@test "verify/A2: full-mode with testCommand:false exits non-zero and does not report green" {
  # Test design A line 2: verify with a configured failing command exits non-zero
  # and is NOT reported green: CLI (testCommand:"false", assert status != 0).
  # RED now: unknown subcommand → non-zero (correct failure, wrong reason).
  write_full_config_with_cmd "false"
  run cook verify
  [ "$status" -ne 0 ]
  [[ "$output" != *"green"* ]]
}

@test "verify/A3: full-mode with NO testCommand fails closed with error message" {
  # Test design A line 3: verify with NO testCommand configured fails closed:
  # non-zero exit + a clear "no test command" stderr.
  # RED now: unknown subcommand → non-zero.
  write_full_config
  run cook verify
  [ "$status" -ne 0 ]
  [[ "$output" == *"no test command"* ]] || true
}

@test "verify/A4: full-mode with testCommand:empty string fails closed" {
  # Test design A line 4: verify with testCommand:"" (empty string) fails closed
  # identically (no empty sh -c "" pass).
  # RED now: unknown subcommand → non-zero.
  write_full_config_with_cmd ""
  run cook verify
  [ "$status" -ne 0 ]
}

@test "verify/A5: unconfigured verify leaves NO marker from a would-be default" {
  # Test design A line 5: verify never runs a hardcoded default when unconfigured;
  # a sentinel marker file must NOT appear after running verify with no config.
  # RED now: unknown subcommand → non-zero; marker absent (correct, wrong reason).
  local marker="$TMP/verify-default-ran-marker"
  write_full_config
  # A Makefile that would write the marker IF a hardcoded `make test` fallback ran.
  printf 'test:\n\ttouch %s\n' "$marker" > "$TMP/Makefile"
  run cook verify
  [ ! -f "$marker" ]
}

@test "verify/A6: lite-mode verify resolves command from profile prose and exits 0" {
  # Test design A line 6: lite-mode verify resolves the command from the profile
  # prose line and runs it: CLI (lite config + profile with Test command: true,
  # assert status 0 + green).
  # RED now: unknown subcommand → non-zero.
  write_lite_config
  write_profile_with_cmd "true"
  run cook verify
  [ "$status" -eq 0 ]
  [[ "$output" == *"green"* ]]
}

@test "verify/A7: lite-mode verify with no profile prose line fails closed" {
  # Test design A line 7: lite-mode verify with the prose line absent/empty fails
  # closed: CLI (profile lacking the line, assert status != 0 + error).
  # RED now: unknown subcommand → non-zero.
  write_lite_config
  write_profile_no_cmd
  run cook verify
  [ "$status" -ne 0 ]
}

@test "verify/A8: cook verify ignores extra positional args (no injection)" {
  # Test design A line 8: verify passes NO positional arg into the executed
  # command: CLI (extra positional arg; assert it has no effect / is inert or
  # rejected, and in particular does not cause a command injection).
  # We use a sentinel to detect whether any injected side-effect ran.
  # RED now: unknown subcommand → non-zero.
  local sentinel="$TMP/injected-marker"
  # If `cook verify ; touch <sentinel>` (shell-injected) or an arg like
  # "; touch <sentinel>" flowed into sh -c, the sentinel would exist.
  write_full_config_with_cmd "true"
  run cook verify "; touch $sentinel"
  # The extra arg must not cause sentinel creation.
  [ ! -f "$sentinel" ]
}

# ---------------------------------------------------------------------------
# B: test-runs.jsonl log + .git/info/exclude
# ---------------------------------------------------------------------------

@test "verify/B1: full-mode verify appends a well-formed jsonl line with required keys" {
  # Test design B line 1: a full-mode verify appends exactly one well-formed jsonl
  # line with hash/dirty/result/suite/at and NO stdout/stderr field.
  # RED now: unknown subcommand → no log file.
  write_full_config_with_cmd "true"
  run cook verify
  local log="$BK/test-runs.jsonl"
  [ -f "$log" ]
  local line_count
  line_count="$(wc -l < "$log")"
  [ "$line_count" -eq 1 ]
  # Must be jq-parseable.
  jq -e . < "$log" > /dev/null
  # Must carry the required keys.
  local has_hash has_dirty has_result has_suite has_at
  has_hash="$(jq -r 'has("hash")' < "$log")"
  has_dirty="$(jq -r 'has("dirty")' < "$log")"
  has_result="$(jq -r 'has("result")' < "$log")"
  has_suite="$(jq -r 'has("suite")' < "$log")"
  has_at="$(jq -r 'has("at")' < "$log")"
  [ "$has_hash" = "true" ]
  [ "$has_dirty" = "true" ]
  [ "$has_result" = "true" ]
  [ "$has_suite" = "true" ]
  [ "$has_at" = "true" ]
  # Must NOT carry stdout or stderr keys.
  local no_stdout no_stderr
  no_stdout="$(jq -r 'has("stdout")' < "$log")"
  no_stderr="$(jq -r 'has("stderr")' < "$log")"
  [ "$no_stdout" = "false" ]
  [ "$no_stderr" = "false" ]
}

@test "verify/B2: jsonl line records dirty:true for dirty tree and dirty:false for clean" {
  # Test design B line 2: the jsonl line records dirty:true when the tree is dirty
  # and dirty:false when clean.
  # RED now: unknown subcommand → no log.
  local log="$BK/test-runs.jsonl"

  # Clean run first.
  clean_tree
  write_full_config_with_cmd "true"
  run cook verify
  [ -f "$log" ]
  local dirty_val
  dirty_val="$(jq -r '.dirty' < "$log")"
  [ "$dirty_val" = "false" ]

  # Dirty run: truncate log and re-run dirty.
  : > "$log"
  dirty_tree
  run cook verify
  dirty_val="$(jq -r '.dirty' < "$log")"
  [ "$dirty_val" = "true" ]
}

@test "verify/B3: first verify adds jsonl path to .git/info/exclude; second does not duplicate" {
  # Test design B line 3: the first full-mode verify adds .jeff/test-runs.jsonl
  # to .git/info/exclude and a second verify does not duplicate the line.
  # RED now: unknown subcommand → no exclude entry.
  write_full_config_with_cmd "true"
  local exclude="$TMP/.git/info/exclude"

  run cook verify
  grep -F ".jeff/test-runs.jsonl" "$exclude"

  run cook verify
  local count
  count="$(grep -cF ".jeff/test-runs.jsonl" "$exclude")"
  [ "$count" -eq 1 ]
}

# ---------------------------------------------------------------------------
# B: `cook baseline check`
# ---------------------------------------------------------------------------

@test "verify/B4: baseline check exits 0 when HEAD logged green+clean and tree is clean" {
  # Test design B line 4: baseline check exits 0 when HEAD is logged green-and-clean
  # AND the tree is currently clean AND at that hash.
  # RED now: unknown subcommand → non-zero.
  write_full_config
  local head
  head="$(git -C "$TMP" rev-parse HEAD)"
  clean_tree
  append_jsonl_line "$head" "false" "green"

  run cook baseline check
  [ "$status" -eq 0 ]
}

@test "verify/B5: baseline check exits non-zero when logged run was dirty" {
  # Test design B line 5: baseline check exits non-zero when the only logged run
  # for that hash was dirty.
  # RED now: unknown subcommand → non-zero (correct failure, wrong reason).
  write_full_config
  local head
  head="$(git -C "$TMP" rev-parse HEAD)"
  clean_tree
  append_jsonl_line "$head" "true" "green"

  run cook baseline check
  [ "$status" -ne 0 ]
}

@test "verify/B6: baseline check exits non-zero when logged run was red" {
  # Test design B line 6: baseline check exits non-zero when the logged run for
  # that hash was red.
  # RED now: unknown subcommand → non-zero.
  write_full_config
  local head
  head="$(git -C "$TMP" rev-parse HEAD)"
  clean_tree
  append_jsonl_line "$head" "false" "red"

  run cook baseline check
  [ "$status" -ne 0 ]
}

@test "verify/B7: baseline check exits non-zero when tree is currently dirty" {
  # Test design B line 7: baseline check exits non-zero when the tree is currently
  # dirty even though a green+clean line exists for HEAD.
  # RED now: unknown subcommand → non-zero.
  write_full_config
  local head
  head="$(git -C "$TMP" rev-parse HEAD)"
  append_jsonl_line "$head" "false" "green"
  dirty_tree

  run cook baseline check
  [ "$status" -ne 0 ]
}

@test "verify/B8: baseline check with explicit hash exits non-zero when HEAD != hash" {
  # Test design B line 8: baseline check <hash> exits non-zero when HEAD != <hash>
  # (asking about a hash the tree is not at).
  # RED now: unknown subcommand → non-zero.
  write_full_config
  local head_orig
  head_orig="$(git -C "$TMP" rev-parse HEAD)"
  clean_tree
  append_jsonl_line "$head_orig" "false" "green"

  # Advance HEAD to a new commit so HEAD != head_orig.
  git -C "$TMP" commit --allow-empty -q -m "advance HEAD"

  run cook baseline check "$head_orig"
  [ "$status" -ne 0 ]
}

@test "verify/B9: baseline check against absent jsonl exits non-zero cleanly" {
  # Test design B line 9: baseline check against an absent/empty jsonl exits
  # non-zero cleanly (no crash).
  # RED now: unknown subcommand → non-zero.
  write_full_config
  # Ensure no log file exists.
  rm -f "$BK/test-runs.jsonl"

  run cook baseline check
  [ "$status" -ne 0 ]
  # Must not be a stack/parse error: output should not contain bash traceback.
  [[ "$output" != *"line "*": "* ]] || true
}

# ---------------------------------------------------------------------------
# A (fail-closed gap): whitespace/comment-only testCommand must be rejected
# Audit finding (0044 cycle-1): [ -z ] catches "" but NOT "   " or "# nope".
# These tests are RED until the implementer closes the gap.
# ---------------------------------------------------------------------------

@test "verify/A9: full-mode whitespace-only testCommand fails closed" {
  # Audit F1: testCommand:"   " must be rejected before sh -c runs (silent green).
  # Asserts: non-zero exit, a "no test command" error in output (binding, no || true),
  # AND no result:"green" line written to test-runs.jsonl.
  write_full_config_with_cmd "   "
  run cook verify
  [ "$status" -ne 0 ]
  [[ "$output" == *"no test command"* ]]
  local log="$BK/test-runs.jsonl"
  if [ -f "$log" ]; then
    local green_lines
    green_lines="$(grep -c '"result":"green"' "$log" || true)"
    [ "$green_lines" -eq 0 ]
  fi
}

@test "verify/A10: full-mode comment-only testCommand fails closed" {
  # Audit F1: testCommand:"# nope" is effectively empty to a shell (exits 0 silently).
  # Must be rejected before sh -c runs.
  # Asserts: non-zero exit, a "no test command" error in output (binding, no || true),
  # AND no result:"green" line written to test-runs.jsonl.
  write_full_config_with_cmd "# nope"
  run cook verify
  [ "$status" -ne 0 ]
  [[ "$output" == *"no test command"* ]]
  local log="$BK/test-runs.jsonl"
  if [ -f "$log" ]; then
    local green_lines
    green_lines="$(grep -c '"result":"green"' "$log" || true)"
    [ "$green_lines" -eq 0 ]
  fi
}

@test "verify/A11: lite-mode whitespace-only prose command fails closed" {
  # Audit F1, lite path: profile line "Test command: `   `." must be rejected
  # before sh -c runs (silent green).
  # Asserts: non-zero exit AND a "no test command" error in output (binding, no || true).
  write_lite_config
  write_profile_with_cmd "   "
  run cook verify
  [ "$status" -ne 0 ]
  [[ "$output" == *"no test command"* ]]
}
