#!/usr/bin/env bats
# tests/profile.bats: bats suite for task 0009: operating profile schema + cook profile.
#
# Covers:
#   - `cook profile init` writes .jeff/profile.md; no-clobber on second run.
#   - Shipped template conforms (cook profile exits 0) and is within size budget.
#   - `cook profile` prints file content to stdout.
#   - `cook profile` with no profile present exits non-zero.
#   - Conformance failures: missing required key, bad sources entry (missing hash),
#     malformed/absent JSON fence, over-budget file (lines and bytes).
#   - `cook validate` new invariant: present-but-malformed profile fails; absent
#     profile leaves validate unaffected; valid profile leaves validate OK.
#   - shellcheck guard (pinned from AC: `shellcheck --severity=warning bin/cook` clean).
#
# Strategy mirrors lite.bats:
#   - REPO/COOK vars; setup() creates a fresh mktemp -d git repo; teardown() rm -rf.
#   - cook() wrapper uses COOK_ROOT="$TMP".
#   - Status -ne 0 for expected FAIL; -eq 0 for expected PASS.
#   - All fixtures are wholly synthetic.
#   - Tests are RED now (cmd_profile not implemented); they must fail for the right
#     reason (unknown subcommand / feature absent) not due to a syntax/import error.

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
  mkdir -p "$BK/tasks"
  git -C "$TMP" init -q
  git -C "$TMP" config user.email "test@profile.example"
  git -C "$TMP" config user.name "Profile Test"
}

teardown() {
  rm -rf "$TMP"
}

# Shorthand: run cook with $TMP as COOK_ROOT
cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# write_lite_config <bk_dir>
# Writes .jeff/config.json with mode:"lite" and active:true.
write_lite_config() {
  local bk="$1"
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$bk/config.json"
}

# write_valid_profile <profile_path>
# Writes a conforming .jeff/profile.md (within 40 lines + 2000 bytes).
# The front-matter is a fenced JSON block with all required keys:
#   mode, plan_store, ledger, sources (array; each entry has path + hash).
write_valid_profile() {
  local dest="$1"
  cat > "$dest" <<'PROFILE'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "path": ".jeff/profile.md", "hash": "sha256:aabbccdd" }
  ]
}
```

## Operating Profile

This project runs Jeff in lite mode. Task location: `.jeff/tasks/`.

Branch: feature branches; merge via PR; no direct pushes to main.

Test command: `make test`.

Standards: code-standards skill (operator level).

Audit triggers: destructive ops, prompt-injection surfaces.

Vocabulary: "order" = task, "cook" = run the pipeline.
PROFILE
}

# write_profile_missing_key <profile_path> <key_to_drop>
# Writes a profile that is missing one of the required top-level keys.
# Uses jq to delete the key from the JSON front-matter.
write_profile_missing_key() {
  local dest="$1" drop_key="$2"
  local fm
  fm="$(jq -c --arg k "$drop_key" 'del(.[$k])' <<'FMEOF'
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": []
}
FMEOF
)"
  printf '```json\n%s\n```\n\n## Body\n\nMinimal body.\n' "$fm" > "$dest"
}

# write_profile_bad_source_missing_hash <profile_path>
# Writes a profile whose sources entry is missing the required "hash" field.
write_profile_bad_source_missing_hash() {
  local dest="$1"
  cat > "$dest" <<'PROFILE'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "path": ".jeff/profile.md" }
  ]
}
```

## Body

Minimal body; source entry lacks hash.
PROFILE
}

# write_profile_bad_source_missing_path <profile_path>
# Writes a profile whose sources entry is missing the required "path" field.
write_profile_bad_source_missing_path() {
  local dest="$1"
  cat > "$dest" <<'PROFILE'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "hash": "sha256:aabbccdd" }
  ]
}
```

## Body

Minimal body; source entry lacks path.
PROFILE
}

# write_profile_no_fence <profile_path>
# Writes a profile with NO ```json fence (plain markdown, no machine front-matter).
write_profile_no_fence() {
  local dest="$1"
  cat > "$dest" <<'PROFILE'
## Operating Profile

mode: lite
plan_store: .jeff/tasks
ledger: .jeff/run-ledger.json

No JSON fence present. Should fail conformance.
PROFILE
}

# write_profile_malformed_json <profile_path>
# Writes a profile with a ```json fence that contains invalid JSON.
write_profile_malformed_json() {
  local dest="$1"
  cat > "$dest" <<'PROFILE'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": INVALID_JSON_HERE
```

## Body

Fence present but JSON is unparseable.
PROFILE
}

# write_profile_over_line_budget <profile_path>
# Writes a conforming-JSON profile that exceeds the 40-line limit.
write_profile_over_line_budget() {
  local dest="$1"
  # Start with the valid front-matter, then pad to >40 lines.
  cat > "$dest" <<'FMPART'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": []
}
```

## Body
FMPART
  # Pad with blank/comment lines until we exceed 40 lines.
  local i
  for i in $(seq 1 35); do
    printf 'Padding line %d to exceed 40-line budget.\n' "$i" >> "$dest"
  done
}

# write_profile_over_byte_budget <profile_path>
# Writes a conforming-JSON profile that exceeds the 2000-byte limit while staying
# under 40 lines (achieved by one very long line in the body).
write_profile_over_byte_budget() {
  local dest="$1"
  cat > "$dest" <<'FMPART'
```json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": []
}
```

## Body

FMPART
  # Add a single very long line that pushes the file over 2000 bytes.
  python3 -c "print('x' * 2100)" >> "$dest"
}

# write_baseline_task_numeric <bk_dir> <id> <slug>
# Writes a quality-clean v1 task.json with a numeric id (mirrors lite.bats).
write_baseline_task_numeric() {
  local bk="$1" id="$2" slug="$3"
  local task_dir="$bk/tasks/${id}-${slug}"
  mkdir -p "$task_dir"
  jq -n \
    --argjson id "$id" \
    --arg slug "$slug" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: $slug,
      title: ("Profile synthetic task: " + $slug),
      status: "done",
      stage: "done",
      priority: "p2",
      deps: [],
      trivial: false,
      branch: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      brains: {
        capture:   { model: "opus",   effort: "xhigh" },
        plan:      { model: "opus",   effort: "high"  },
        test:      { model: "sonnet", effort: "med"   },
        implement: { model: "sonnet", effort: "med"   },
        refactor:  { model: "sonnet", effort: "med"   },
        review:    { model: "opus",   effort: "high"  },
        audit:     { model: "opus",   effort: "high"  }
      },
      agents: {
        test_author_agent_id: "agent-tester-001",
        implementer_agent_id: "agent-impl-002",
        reviewer_agent_id:    "agent-reviewer-003",
        audit_agent_id:       null
      },
      tests: {
        authored_by_agent_id: "agent-tester-001",
        green: true,
        evidence: ["synthetic evidence"]
      },
      review: {
        verdict: "pass",
        reviewer_agent_id: "agent-reviewer-003",
        evidence: ["synthetic review pass"]
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
    }' > "$task_dir/task.json"
}

# ---------------------------------------------------------------------------
# PROFILE INIT: `cook profile init`
# ---------------------------------------------------------------------------

@test "profile init: cook profile init writes .jeff/profile.md" {
  # Feature absent: cook profile init does not yet exist → non-zero.
  # RED: will fail because cook does not recognise `profile` subcommand yet.
  run cook profile init
  [ "$status" -eq 0 ]
  [ -f "$BK/profile.md" ]
}

@test "profile init: second cook profile init is refused (no-clobber, non-zero)" {
  # First init may fail too (feature absent): we use write_valid_profile as a
  # stand-in to simulate an already-present file, then assert the second call
  # is non-zero AND does not modify the file.
  write_valid_profile "$BK/profile.md"
  local before
  before="$(cat "$BK/profile.md")"
  run cook profile init
  # Must be non-zero: a profile already exists, must not clobber.
  [ "$status" -ne 0 ]
  # Content must be unchanged.
  [ "$(cat "$BK/profile.md")" = "$before" ]
}

# ---------------------------------------------------------------------------
# SHIPPED TEMPLATE: conformance + size budget
# ---------------------------------------------------------------------------

@test "profile init: shipped template passes cook profile (exit 0)" {
  # After init the template must itself conform.
  # RED: cook profile init and cook profile are not implemented yet.
  run cook profile init
  [ "$status" -eq 0 ]
  run cook profile
  [ "$status" -eq 0 ]
}

@test "profile init: shipped template is within 40-line budget" {
  # RED: cook profile init not implemented yet.
  run cook profile init
  [ "$status" -eq 0 ]
  local line_count
  line_count="$(wc -l < "$BK/profile.md")"
  [ "$line_count" -le 40 ]
}

@test "profile init: shipped template is within 2000-byte budget" {
  # RED: cook profile init not implemented yet.
  run cook profile init
  [ "$status" -eq 0 ]
  local byte_count
  byte_count="$(wc -c < "$BK/profile.md")"
  [ "$byte_count" -le 2000 ]
}

# ---------------------------------------------------------------------------
# PROFILE PRINT: `cook profile` stdout
# ---------------------------------------------------------------------------

@test "profile: cook profile prints the profile file content to stdout" {
  # We write a valid profile manually; cook profile should print it.
  # RED: cook profile not implemented yet.
  write_valid_profile "$BK/profile.md"
  run cook profile
  [ "$status" -eq 0 ]
  # The valid profile contains a stable line we can assert against.
  [[ "$output" == *'plan_store'* ]]
}

@test "profile: cook profile stdout contains the JSON fence opening line" {
  write_valid_profile "$BK/profile.md"
  run cook profile
  [ "$status" -eq 0 ]
  [[ "$output" == *'```json'* ]]
}

# ---------------------------------------------------------------------------
# MISSING PROFILE: `cook profile` with no file
# ---------------------------------------------------------------------------

@test "profile: cook profile with no profile.md present exits non-zero" {
  # No profile written: absence must be an error for cook profile.
  # RED: cook profile not implemented yet (also will fail for wrong reason now
  # but once implemented, absence → non-zero is the correct contract).
  [ ! -f "$BK/profile.md" ]
  run cook profile
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# CONFORMANCE FAILURES
# ---------------------------------------------------------------------------

@test "conformance: missing required key 'ledger' fails cook profile" {
  # RED: cook profile not implemented yet.
  write_profile_missing_key "$BK/profile.md" "ledger"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: missing required key 'mode' fails cook profile" {
  write_profile_missing_key "$BK/profile.md" "mode"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: missing required key 'plan_store' fails cook profile" {
  write_profile_missing_key "$BK/profile.md" "plan_store"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: sources entry missing 'hash' fails cook profile (provenance enforcement)" {
  # RED: cook profile not implemented yet.
  write_profile_bad_source_missing_hash "$BK/profile.md"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: sources entry missing 'path' fails cook profile (provenance enforcement)" {
  write_profile_bad_source_missing_path "$BK/profile.md"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: no JSON fence in profile fails cook profile" {
  # RED: cook profile not implemented yet.
  write_profile_no_fence "$BK/profile.md"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: malformed JSON inside fence fails cook profile" {
  # RED: cook profile not implemented yet.
  write_profile_malformed_json "$BK/profile.md"
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: profile exceeding 40-line budget fails cook profile" {
  # RED: cook profile not implemented yet.
  write_profile_over_line_budget "$BK/profile.md"
  # Verify the fixture actually exceeds the budget before asserting.
  local lc
  lc="$(wc -l < "$BK/profile.md")"
  [ "$lc" -gt 40 ]
  run cook profile
  [ "$status" -ne 0 ]
}

@test "conformance: profile exceeding 2000-byte budget fails cook profile" {
  # RED: cook profile not implemented yet.
  write_profile_over_byte_budget "$BK/profile.md"
  local bc
  bc="$(wc -c < "$BK/profile.md")"
  [ "$bc" -gt 2000 ]
  run cook profile
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# VALIDATE INVARIANT: `cook validate` + profile.md
#
# Contract (optional + present-means-conform):
#   - present + malformed  → validate non-zero
#   - absent               → validate unaffected (skips; absence OK)
#   - present + valid      → validate OK (no regression)
#
# For the "otherwise-pass" baseline we build a minimal full-mode valid store
# (one clean task dir) so validate would pass absent the profile check.
# ---------------------------------------------------------------------------

# Build a minimal full-mode baseline store under $BK that would pass cook validate.
# Shared by the three validate tests below.
_setup_valid_store() {
  write_baseline_task_numeric "$BK" 1 "profile-validate-clean"
  # Lite mode for the synthetic $TMP store: these tests assert profile.md's
  # effect on validate (conformance runs in BOTH modes, unconditionally). The
  # baseline fixture is a done task; lite drops the registry-only [prune] check
  # (task 0063) so the resting done fixture does not trip [prune], leaving the
  # profile-conformance outcome these tests assert unchanged.
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
}

@test "validate: present but malformed profile (missing key) causes validate to fail" {
  # RED: cook validate does not yet check profile.md.
  _setup_valid_store
  write_profile_missing_key "$BK/profile.md" "ledger"
  run cook validate
  [ "$status" -ne 0 ]
}

@test "validate: present but malformed profile (no JSON fence) causes validate to fail" {
  _setup_valid_store
  write_profile_no_fence "$BK/profile.md"
  run cook validate
  [ "$status" -ne 0 ]
}

@test "validate: absent profile.md leaves validate unaffected (exits 0)" {
  # Absence is allowed; validate must not regress to non-zero purely because
  # profile.md is missing.
  _setup_valid_store
  [ ! -f "$BK/profile.md" ]
  run cook validate
  [ "$status" -eq 0 ]
}

@test "validate: present valid profile does not cause validate to fail" {
  # A conforming profile must not break an otherwise-clean store.
  _setup_valid_store
  write_valid_profile "$BK/profile.md"
  run cook validate
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# SHELLCHECK GUARD
# ---------------------------------------------------------------------------

@test "shellcheck: skills/cook/scripts/cook.sh passes shellcheck --severity=warning" {
  if ! command -v shellcheck >/dev/null 2>&1; then
    skip "shellcheck not installed"
  fi
  run shellcheck --severity=warning "$COOK"
  [ "$status" -eq 0 ]
}
