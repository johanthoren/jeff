#!/usr/bin/env bats
# tests/precommit-gate.bats: task 0035: PreToolUse validator hook.
#
# Covers (all RED until hooks/cook-precommit-gate.sh is authored):
#   AC1a: git commit + active full-mode invalid store → deny (exit 0, permissionDecision=="deny", non-empty reason)
#   AC1b: git commit + active full-mode valid store   → allow (exit 0, no deny on stdout)
#   AC2a: non-commit Bash command in active project   → pass-through, validator NOT run
#   AC2b: git commit + no .jeff/config.json      → pass-through allow
#   AC3 : git commit + active lite-mode invalid store → deny (mode-aware; same deny contract)
#   AC4-open-jq     : jq unavailable to validator    → fail-open allow
#   AC4-open-missing: cook.sh missing from PLUGIN_ROOT → fail-open allow
#   AC6-mut: fixture FS unchanged after deny + allow runs
#
# Cycle-2 additions (audit F1/F2/F3 findings):
#   F1-suppress : invalid task + malformed task.json → deny (was fail-open)
#   F1-malformed: only a malformed task.json → deny (was fail-open)
#   F2-benign-path: valid store, task dir name contains forgery string → allow (regression guard)
#   F3-dashC: git -C <dir> commit on invalid store → deny (was missed)
#   F3-dashc: git -c k=v commit on invalid store → deny (was missed)
#   F3-nonmatch: git log --grep=commit → pass-through, validator NOT run (regression guard)
#
# Seam: the hook is a pure stdin(JSON) → stdout(decision) + exit-code function.
# Each test:
#   - builds a per-test mktemp -d project (parallel-safe)
#   - writes the needed .jeff/config.json + task store
#   - pipes a crafted payload JSON into the hook with CLAUDE_PLUGIN_ROOT="$REPO"
#     and payload .cwd pointing at the fixture project (no COOK_ROOT env override;
#     the hook must derive the project root from payload .cwd, as production delivers)
#   - asserts exit status + stdout permissionDecision field
#
# Deny contract: exit 0 + stdout JSON with
#   .hookSpecificOutput.permissionDecision == "deny"
#   .hookSpecificOutput.permissionDecisionReason (non-empty string)
# Pass-through contract: exit 0, empty stdout.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HOOK="$REPO/hooks/cook-precommit-gate.sh"
load test_helper
setup_file() { cook_hermetic_git; }

# ---------------------------------------------------------------------------
# Setup / teardown: one fresh mktemp project per test (parallel-safe)
# ---------------------------------------------------------------------------

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks"
}

teardown() {
  rm -rf "$TMP"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_config_full: full-mode active config.json
write_config_full() {
  jq -n '{schemaVersion:1, active:true}' > "$BK/config.json"
}

# write_config_lite: lite-mode active config.json
write_config_lite() {
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

# write_valid_done_task <dir>: a task.json that passes every invariant
write_valid_done_task() {
  local dir="$1"
  mkdir -p "$dir"
  jq -n '{
    schemaVersion: 1,
    id: 1,
    slug: "gate-valid-task",
    title: "Valid done task for gate tests",
    status: "done",
    stage: "done",
    priority: "p2",
    deps: [],
    complexity: "simple",
    branch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    brains: {
      capture:   {model:"opus",   effort:"xhigh"},
      plan:      {model:"opus",   effort:"xhigh"},
      test:      {model:"sonnet", effort:"med"},
      implement: {model:"opus",   effort:"high"},
      refactor:  {model:"opus",   effort:"high"},
      review:    {model:"opus",   effort:"xhigh"},
      audit:     {model:"opus",   effort:"xhigh"}
    },
    agents: {
      plan_agent_id:        "agent-plan-001",
      test_author_agent_id: "agent-tester-002",
      implementer_agent_id: "agent-impl-003",
      reviewer_agent_id:    "agent-reviewer-004",
      audit_agent_id:       null
    },
    tests: {
      authored_by_agent_id: "agent-tester-002",
      green: true,
      evidence: ["green suite gate recorded"]
    },
    review: {
      verdict: "pass",
      reviewer_agent_id: "agent-reviewer-004",
      evidence: ["review passed"]
    },
    audit: {
      required: false,
      verdict: "na",
      audit_agent_id: null,
      evidence: []
    },
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$dir/task.json"
}

# write_invalid_done_task <dir>: a done task with review.verdict != "pass" (inv4 violation)
write_invalid_done_task() {
  local dir="$1"
  write_valid_done_task "$dir"
  local tmp
  tmp="$(mktemp)"
  jq '.review.verdict = "block"' "$dir/task.json" > "$tmp"
  mv "$tmp" "$dir/task.json"
}

# payload <command>: craft the PreToolUse stdin JSON for a Bash command
payload() {
  local cmd="$1"
  jq -n --arg cmd "$cmd" --arg cwd "$TMP" \
    '{"tool_name":"Bash","tool_input":{"command":$cmd},"cwd":$cwd}'
}

# ---------------------------------------------------------------------------
# AC1a: git commit + active full-mode invalid store → deny
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC1a: git commit on invalid full-mode store is denied" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  # Hook must exit 0 (deny is signalled via stdout JSON, not non-zero exit)
  [ "$status" -eq 0 ]

  # stdout must carry permissionDecision == "deny"
  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" = "deny" ]

  # reason must be non-empty
  local reason
  reason="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)"
  [ -n "$reason" ]
}

# ---------------------------------------------------------------------------
# AC1b: git commit + active full-mode valid store → allow (no deny)
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC1b: git commit on valid full-mode store is allowed (no deny)" {
  write_config_full
  write_valid_done_task "$BK/tasks/0001-valid"
  jq '.status = "in_progress" | .stage = "review"' "$BK/tasks/0001-valid/task.json" > "$BK/tasks/0001-valid/task.json.tmp" && mv "$BK/tasks/0001-valid/task.json.tmp" "$BK/tasks/0001-valid/task.json"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  # stdout must be empty (pass-through; no deny JSON)
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC2a: non-commit Bash command in active project → pass-through, validator NOT run
# Proof of non-invocation: a shim cook.sh writes a marker file when called;
# assert the marker was NOT created.
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC2a: non-commit Bash command passes through without running validator" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  # Create a fake PLUGIN_ROOT with a shim cook.sh that writes a marker when called
  local fake_root
  fake_root="$(mktemp -d)"
  mkdir -p "$fake_root/skills/cook/scripts"
  local marker="$fake_root/validate_was_called"
  cat > "$fake_root/skills/cook/scripts/cook.sh" <<EOF
#!/bin/sh
touch "$marker"
exit 0
EOF
  chmod +x "$fake_root/skills/cook/scripts/cook.sh"

  local p
  p="$(payload "ls -la")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$fake_root\" \"$HOOK\""

  # Must exit 0 and produce no deny output
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  # Validator must NOT have been invoked
  [ ! -f "$marker" ]

  rm -rf "$fake_root"
}

# ---------------------------------------------------------------------------
# AC2b: git commit + no active .jeff/config.json → pass-through allow
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC2b: git commit in non-jeff dir passes through without deny" {
  # TMP has no .jeff/config.json: not an active jeff project
  local p
  p="$(payload "git commit -m 'some change'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# AC3: git commit + active lite-mode invalid store → deny
# Proves the hook runs the mode-aware validator (lite path, no index.json).
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC3: git commit on invalid lite-mode store is denied" {
  write_config_lite
  # No index.json: lite mode validates without it
  write_invalid_done_task "$BK/tasks/0001-invalid"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" = "deny" ]

  local reason
  reason="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)"
  [ -n "$reason" ]
}

# ---------------------------------------------------------------------------
# AC4-open-jq: jq unavailable → fail-open allow
# Stub cook.sh that exits 3 (mimics require_jq path: no terminal verdict).
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC4-open-jq: validator exits 3 (jq unavailable) -> fail-open allow" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  # Stub cook.sh that exits 3 (mimics require_jq failure: no terminal verdict)
  local fake_root
  fake_root="$(mktemp -d)"
  mkdir -p "$fake_root/skills/cook/scripts"
  cat > "$fake_root/skills/cook/scripts/cook.sh" <<'EOF'
#!/bin/sh
echo "cook: \`jq\` is required but was not found on PATH." >&2
exit 3
EOF
  chmod +x "$fake_root/skills/cook/scripts/cook.sh"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$fake_root\" \"$HOOK\""

  # Fail-open: hook must exit 0 with no deny
  [ "$status" -eq 0 ]
  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" != "deny" ]

  rm -rf "$fake_root"
}

# ---------------------------------------------------------------------------
# AC4-open-missing: cook.sh absent from PLUGIN_ROOT → fail-open allow (exec 127)
# RED: hook script does not exist yet
# ---------------------------------------------------------------------------

@test "gate/AC4-open-missing: cook.sh missing from PLUGIN_ROOT -> fail-open allow" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  # Point PLUGIN_ROOT at a dir that has no cook.sh: exec → exit 127
  local empty_root
  empty_root="$(mktemp -d)"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$empty_root\" \"$HOOK\""

  # Fail-open: hook must exit 0 with no deny
  [ "$status" -eq 0 ]
  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" != "deny" ]

  rm -rf "$empty_root"
}

# ---------------------------------------------------------------------------
# AC6-mut: fixture FS unchanged after deny + allow runs
#
# The first assertion is structural: the hook must exist and be executable.
# This makes the test RED before the implementer creates the hook.
# Once the hook exists, the behavioral assertion confirms it writes nothing
# to the fixture project tree (no .git/ dir created, no files outside .jeff/).
# RED: hook script does not exist yet ([ -x "$HOOK" ] fails immediately)
# ---------------------------------------------------------------------------

@test "gate/AC6-mut: hook writes nothing to the fixture project after deny and allow" {
  # Structural pre-condition: hook must be present and executable.
  # RED now: hooks/cook-precommit-gate.sh does not exist.
  [ -x "$HOOK" ]

  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  # Run a deny case (invalid store)
  local p_deny
  p_deny="$(payload "git commit -m 'release'")"
  bash -c "printf '%s' '$p_deny' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  # Run an allow case (valid store: swap the task to a valid one)
  local tmp_patch
  tmp_patch="$(mktemp)"
  jq '.review.verdict = "pass"' "$BK/tasks/0001-invalid/task.json" > "$tmp_patch"
  mv "$tmp_patch" "$BK/tasks/0001-invalid/task.json"

  local p_allow
  p_allow="$(payload "git commit -m 'release'")"
  bash -c "printf '%s' '$p_allow' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  # No .git/ directory was created (hook installs nothing)
  [ ! -d "$TMP/.git" ]

  # No files outside .jeff/ were written by the hook
  local unexpected
  unexpected="$(find "$TMP" -type f ! -path "$TMP/.jeff/*" | sort)"
  [ -z "$unexpected" ]
}

# ---------------------------------------------------------------------------
# Cycle-2 additions: audit findings F1, F2, F3
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# F1-suppress: invalid task + second malformed task.json → deny
#
# Fixture: full-mode active store with two tasks on disk:
#   - 0001-invalid: a valid task.json with review.verdict="block" (inv4 violation)
#   - 0002-malformed: task.json containing "not json {" (unparseable)
# cook validate exits 1 + prints "cook: validation FAILED: could not parse..."
# (colon form). The refined discriminator (^cook: validation FAILED) must deny.
# RED now: cycle-1 hook only matches the parenthesised form, so the colon-die
# path is treated as infra → fail-open allow.
# ---------------------------------------------------------------------------

@test "gate/F1-suppress: invalid + malformed store is denied (not fail-opened)" {
  write_config_full

  write_invalid_done_task "$BK/tasks/0001-invalid"

  # A second task with genuinely malformed JSON
  mkdir -p "$BK/tasks/0002-malformed"
  printf 'not json {' > "$BK/tasks/0002-malformed/task.json"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" = "deny" ]

  local reason
  reason="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)"
  [ -n "$reason" ]
}

# ---------------------------------------------------------------------------
# F1-malformed: store with only one malformed task.json → deny
#
# Fixture: full-mode active store, single task on disk with malformed JSON.
# cook validate exits 1 + prints the colon form.
# RED now: cycle-1 hook fail-opens on the colon die path.
# ---------------------------------------------------------------------------

@test "gate/F1-malformed: store with a single malformed task.json is denied" {
  write_config_full

  mkdir -p "$BK/tasks/0001-malformed"
  printf 'not json {' > "$BK/tasks/0001-malformed/task.json"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" = "deny" ]

  local reason
  reason="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)"
  [ -n "$reason" ]
}

# ---------------------------------------------------------------------------
# F2-benign-path: valid store whose task DIR NAME contains the forgery string → allow
#
# Fixture: full-mode active store, one task registered at a path whose
# directory name contains the literal "validation FAILED (3 issue(s))".
# The task.json inside is fully valid. cook validate exits 0.
# Regression guard: the anchored discriminator must NOT trigger on a path
# substring: the hook must allow.
# GREEN now and after fix (tests the no-regression invariant of the F2 anchor fix).
# ---------------------------------------------------------------------------

@test "gate/F2-benign-path: valid store with forgery-substring dir name is allowed" {
  write_config_full

  # Dir name embeds the old unanchored-forgery string
  local funny_dir="0001-validation FAILED (3 issue(s))-task"
  mkdir -p "$BK/tasks/$funny_dir"

  # Write a fully-valid task.json inside the funny-named directory
  jq -n '{
    schemaVersion: 1, id: 1, slug: "gate-valid-task",
    title: "Valid done task for gate tests",
    status: "in_progress", stage: "review", priority: "p2", deps: [], complexity: "simple",
    branch: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
    brains: {
      capture:{model:"opus",effort:"xhigh"}, plan:{model:"opus",effort:"xhigh"},
      test:{model:"sonnet",effort:"med"}, implement:{model:"opus",effort:"high"},
      refactor:{model:"opus",effort:"high"}, review:{model:"opus",effort:"xhigh"},
      audit:{model:"opus",effort:"xhigh"}
    },
    agents: {
      plan_agent_id:"agent-plan-001", test_author_agent_id:"agent-tester-002",
      implementer_agent_id:"agent-impl-003", reviewer_agent_id:"agent-reviewer-004",
      audit_agent_id:null
    },
    tests: {authored_by_agent_id:"agent-tester-002", green:true, evidence:["green suite gate recorded"]},
    review: {verdict:"pass", reviewer_agent_id:"agent-reviewer-004", evidence:["review passed"]},
    audit: {required:false, verdict:"na", audit_agent_id:null, evidence:[]},
    commits:[], kickbacks:[], blockedReason:null, abandonReason:null
  }' > "$BK/tasks/$funny_dir/task.json"

  local p
  p="$(payload "git commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  # Must pass through: no deny (valid store, no FAILED line in validate output)
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# F3-dashC: `git -C <dir> commit -m x` on an invalid store → deny
#
# The cycle-1 commit matcher `git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit`
# only handles single-token flags; `-C <dir>` has a value token following `-C`
# (two tokens) so the matcher misses it. The updated regex must catch this form.
# RED now: the current hook fails to detect `git -C ...` as a commit command.
# ---------------------------------------------------------------------------

@test "gate/F3-dashC: git -C <dir> commit on invalid store is denied" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  local p
  p="$(payload "git -C /some/workdir commit -m 'squash release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" = "deny" ]

  local reason
  reason="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)"
  [ -n "$reason" ]
}

# ---------------------------------------------------------------------------
# F3-dashc: `git -c user.name=x commit -m y` on an invalid store → deny
#
# `-c key=value` is a value-bearing flag (two tokens: `-c` and `key=value`).
# Same cycle-1 gap as F3-dashC. The orchestrator's identity-override form.
# RED now: the current hook misses this form.
# ---------------------------------------------------------------------------

@test "gate/F3-dashc: git -c k=v commit on invalid store is denied" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  local p
  p="$(payload "git -c user.name=Tester commit -m 'release'")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$REPO\" \"$HOOK\""

  [ "$status" -eq 0 ]

  local decision
  decision="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  [ "$decision" = "deny" ]

  local reason
  reason="$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)"
  [ -n "$reason" ]
}

# ---------------------------------------------------------------------------
# F3-nonmatch: `git log --grep=commit` → pass-through, validator NOT run
#
# Regression guard: the broadened F3 regex must NOT over-match a git subcommand
# that merely contains the substring "commit". A shim proves the validator is
# never invoked.
# GREEN now and after fix (tests the no-over-match invariant of the F3 broadening).
# ---------------------------------------------------------------------------

@test "gate/F3-nonmatch: git log --grep=commit passes through without running validator" {
  write_config_full
  write_invalid_done_task "$BK/tasks/0001-invalid"

  # Shim cook.sh writes a marker if invoked: proves non-invocation
  local fake_root
  fake_root="$(mktemp -d)"
  mkdir -p "$fake_root/skills/cook/scripts"
  local marker="$fake_root/validate_was_called"
  cat > "$fake_root/skills/cook/scripts/cook.sh" <<EOF
#!/bin/sh
touch "$marker"
exit 0
EOF
  chmod +x "$fake_root/skills/cook/scripts/cook.sh"

  local p
  p="$(payload "git log --grep=commit")"
  run bash -c "printf '%s' '$p' | CLAUDE_PLUGIN_ROOT=\"$fake_root\" \"$HOOK\""

  [ "$status" -eq 0 ]
  [ -z "$output" ]

  # Validator must NOT have been invoked
  [ ! -f "$marker" ]

  rm -rf "$fake_root"
}
