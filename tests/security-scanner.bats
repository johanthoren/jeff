#!/usr/bin/env bats
# tests/security-scanner.bats: bats suite for task #23: review-security
# --json / fingerprints / introduced-by-change.
#
# Source of truth: .jeff/tasks/lite-23-521526977/notes.md, "## Test design".
#
# Seam: skills/security-auditor/scripts/review-security.sh (wraps
# review_security.py) invoked over a hermetic per-test fixture (mktemp -d,
# --skip-deps). Assertions are process exit code plus JSON parsed with jq
# and/or the written markdown report. Non-changes tests use a plain temp
# fixture with an explicit scope arg; changes/introduced tests use a
# hermetic git repo (HEAD commit + working-tree edit), via cook_hermetic_git.
#
# Status against current (pre-#23) code:
#   AC1 (--json shape)              RED  - --json is not a recognized flag yet
#   AC1 (fingerprint stable/distinct) RED - no fingerprint field yet
#   AC1 (fingerprint in json+md)      RED - no fingerprint field yet
#   AC2 (introduced true/false)      RED - no --changes json / introduced field
#   AC2 (counts.introduced split)    RED - no counts.introduced/pre_existing
#   AC2 (--introduced-only exit)     RED - flag not recognized yet
#   back-compat (no --json)         GREEN - guards the existing default path
#     against #23 regressing it; expected green now and after implementation.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
SCANNER="$REPO/skills/security-auditor/scripts/review-security.sh"

setup() {
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/empty-engine-fixtures"
  export JEFF_SECURITY_ENGINE_FIXTURES="$TMP/empty-engine-fixtures"
}

teardown() {
  rm -rf "$TMP"
}

# ---------------------------------------------------------------------------
# AC1: --json prints one parseable JSON object with the documented shape.
# ---------------------------------------------------------------------------

@test "AC1: --json emits one result object with the documented top-level and finding keys" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)
EOF

  fakebin="$TMP/bin"
  mkdir -p "$fakebin"
  cat >"$fakebin/semgrep" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' '{"results":[{"path":"vuln.py","start":{"line":5},"extra":{"severity":"ERROR","message":"fake semgrep","metadata":{"cwe":["CWE-78"]},"lines":"os.system(cmd)"},"check_id":"fake.semgrep"}]}'
EOF
  chmod +x "$fakebin/semgrep"

  run env PATH="$fakebin:$PATH" JEFF_SECURITY_ENGINE_FIXTURES="$JEFF_SECURITY_ENGINE_FIXTURES" "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]

  echo "$output" | jq -e '
    (.schema_version | type) == "number" and
    (.scope | type) == "string" and
    (.files_scanned | type) == "number" and
    (.findings | type) == "array" and
    (.findings | length) == 1 and
    (.findings[0].fingerprint | type) == "string" and
    (.findings[0].rule_id) == "os-system" and
    (.findings[0].category) == "injection_command" and
    (.findings[0].severity) == "high" and
    (.findings[0].file | type) == "string" and
    (.findings[0].line) == 5 and
    (.findings[0].evidence | type) == "string" and
    (.coverage | type) == "object" and
    (.counts.total) == 1 and
    (.counts.by_severity.high) == 1 and
    (.recommendation | type) == "string" and
    (.report_path | type) == "string"
  '
}

# ---------------------------------------------------------------------------
# AC1: fingerprint stability across a within-file move, distinctness across
# unlike findings.
# ---------------------------------------------------------------------------

@test "AC1: fingerprint is stable when the finding's code moves to a new line" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]
  fp_before="$(echo "$output" | jq -r '.findings[0].fingerprint')"

  # Relocate the same finding by inserting blank lines above it.
  cat >"$TMP/vuln.py" <<'EOF'
import os



def run(cmd):

    os.system(cmd)
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]
  fp_after="$(echo "$output" | jq -r '.findings[0].fingerprint')"

  [ -n "$fp_before" ]
  [ "$fp_before" != "null" ]
  [ "$fp_before" = "$fp_after" ]
}

@test "AC1: two unlike findings get distinct fingerprints" {
  cat >"$TMP/two_vulns.py" <<'EOF'
import hashlib
import os


def run(cmd):
    os.system(cmd)


def hash_it(x):
    return hashlib.md5(x).hexdigest()
EOF

  run "$SCANNER" "$TMP/two_vulns.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]

  fp1="$(echo "$output" | jq -r '.findings[0].fingerprint')"
  fp2="$(echo "$output" | jq -r '.findings[1].fingerprint')"

  [ -n "$fp1" ]
  [ "$fp1" != "null" ]
  [ -n "$fp2" ]
  [ "$fp2" != "null" ]
  [ "$fp1" != "$fp2" ]
}

# ---------------------------------------------------------------------------
# AC1: fingerprint appears in BOTH the json and the written markdown report.
# ---------------------------------------------------------------------------

@test "AC1: fingerprint from --json stdout also appears in the markdown report" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]

  fp="$(echo "$output" | jq -r '.findings[0].fingerprint')"
  [ -n "$fp" ]
  [ "$fp" != "null" ]

  report_path="$(echo "$output" | jq -r '.report_path')"
  [ -f "$report_path" ]
  grep -qF "$fp" "$report_path"
}

# ---------------------------------------------------------------------------
# AC2: --changes mode tags findings introduced:true / introduced:false.
# ---------------------------------------------------------------------------

setup_changes_fixture() {
  git -C "$TMP" init -q -b master
  cat >"$TMP/app.py" <<'EOF'
import hashlib


def hash_it(x):
    return hashlib.md5(x).hexdigest()
EOF
  git -C "$TMP" add app.py
  git -C "$TMP" commit -q -m "initial"

  cat >"$TMP/app.py" <<'EOF'
import hashlib
import os


def run(cmd):
    os.system(cmd)


def hash_it(x):
    return hashlib.md5(x).hexdigest()
EOF
}

@test "AC2: a diff-added finding is introduced:true, an untouched one is introduced:false" {
  setup_changes_fixture

  run bash -c "cd '$TMP' && '$SCANNER' --changes --json --skip-deps --report-dir reports"
  [ "$status" -eq 1 ]

  echo "$output" | jq -e '
    ([.findings[] | select(.rule_id == "os-system") | .introduced] | first) == true and
    ([.findings[] | select(.rule_id == "weak-hash") | .introduced] | first) == false
  '
}

@test "AC2: counts.introduced and counts.pre_existing sum to counts.total" {
  setup_changes_fixture

  run bash -c "cd '$TMP' && '$SCANNER' --changes --json --skip-deps --report-dir reports"
  [ "$status" -eq 1 ]

  echo "$output" | jq -e '
    .counts.introduced == 1 and
    .counts.pre_existing == 1 and
    .counts.total == 2 and
    (.counts.introduced + .counts.pre_existing) == .counts.total
  '
}

# ---------------------------------------------------------------------------
# AC2: --introduced-only restricts the recommendation to introduced findings.
# ---------------------------------------------------------------------------

@test "AC2: --introduced-only passes when the only finding is pre-existing, default run still blocks" {
  git -C "$TMP" init -q -b master
  printf 'import subprocess\nsubprocess.run(cmd, shell=True)\n' >"$TMP/app.py"
  git -C "$TMP" add app.py
  git -C "$TMP" commit -q -m "initial"
  printf '\n# benign comment\n' >>"$TMP/app.py"

  run bash -c "cd '$TMP' && '$SCANNER' --changes --json --skip-deps --report-dir reports"
  [ "$status" -eq 2 ]

  run bash -c "cd '$TMP' && '$SCANNER' --changes --introduced-only --json --skip-deps --report-dir reports"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Back-compat guard: default path (no --json) is unchanged. Expected GREEN
# now; guards #23 against regressing the existing behavior.
# ---------------------------------------------------------------------------

@test "back-compat: default path (no --json) still writes the report and exits 0 on a clean scope" {
  cat >"$TMP/clean.py" <<'EOF'
def add(a, b):
    return a + b
EOF

  run "$SCANNER" "$TMP/clean.py" --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 0 ]
  [[ "$output" == *"security_audit_result:"* ]]

  report_count="$(find "$TMP/reports" -name '*.md' | wc -l | tr -d ' ')"
  [ "$report_count" -ge 1 ]
}

# ---------------------------------------------------------------------------
# Regression (audit kickback, CWE-755): a non-UTF8 byte on a changed line must
# not crash --staged/--changes mode. Source: notes.md Cycle 1 review/audit.
# ---------------------------------------------------------------------------

@test "regression: a non-UTF8 byte on a changed line does not crash --staged/--changes and the secret is still found" {
  git -C "$TMP" init -q -b master
  printf 'def add(a, b):\n    return a + b\n' >"$TMP/app.py"
  git -C "$TMP" add app.py
  git -C "$TMP" commit -q -m "initial"

  printf 'def add(a, b):\n    return a + b\n\n\nAPI_KEY = "sk-live-0123456789abcdef0123456789abcdef"\nAUTHOR="Andr\xe9 Gide"\n' >"$TMP/app.py"
  git -C "$TMP" add app.py

  run bash -c "cd '$TMP' && '$SCANNER' --staged --json --skip-deps --report-dir reports"
  echo "$output" | jq -e '.counts.total >= 1'

  run bash -c "cd '$TMP' && '$SCANNER' --changes --json --skip-deps --report-dir reports"
  echo "$output" | jq -e '.counts.total >= 1'
}

# ---------------------------------------------------------------------------
# Regression (audit kickback, follow-up): --introduced-only without
# --changes/--staged must fail loudly, not silently PASS a real critical
# finding. Source: notes.md Cycle 1 review/audit.
# ---------------------------------------------------------------------------

@test "regression: --introduced-only without --changes or --staged errors instead of silently passing" {
  printf 'import subprocess\nsubprocess.run(cmd, shell=True)\n' >"$TMP/app.py"

  run "$SCANNER" "$TMP/app.py" --skip-deps --json --report-dir "$TMP/reports"
  [ "$status" -eq 2 ]

  run "$SCANNER" "$TMP/app.py" --introduced-only --skip-deps --json --report-dir "$TMP/reports"
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# task #24: suppressions, test-path tagging, honest coverage ledger.
#
# Source of truth: .jeff/tasks/lite-24-685416635/notes.md, "## Test design".
#
# Status against current (pre-#24) code:
#   AC1 (honored suppression)         RED - security-ok is a plain comment,
#     the finding still fires and there is no suppressions[] key
#   AC1 (reasonless suppression)      RED - no suppression-without-reason
#     finding, no suppressions[] key
#   AC1 (rule-id mismatch)            RED - no suppressions[] key
#   AC2 (in_tests tagging)            RED - Finding has no in_tests field
#   AC3 (not_covered when inapplicable) RED - the vacuous eval loop marks
#     every category evaluated as soon as any file is scanned
#   AC3 (covered category engines)    RED - coverage value is a bare status
#     string today, not an {status, engines} object
# ---------------------------------------------------------------------------

@test "AC1: a same-line security-ok suppression with matching rule-id and a reason removes the finding and is recorded honored" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)  # security-ok: os-system trusted operator-only wrapper, no untrusted input reaches this call
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 0 ]

  echo "$output" | jq -e '
    ([.findings[] | select(.rule_id == "os-system")] | length) == 0 and
    ([.suppressions[] | select(.status == "honored" and .rule_id == "os-system")] | length) == 1
  '
}

@test "AC1: a same-line security-ok suppression without a reason does not suppress and emits its own finding" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)  # security-ok: os-system
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]

  echo "$output" | jq -e '
    ([.findings[] | select(.rule_id == "os-system")] | length) == 1 and
    ([.findings[] | select(.rule_id == "suppression-without-reason")] | length) == 1 and
    ([.suppressions[] | select(.reason_code == "missing_reason")] | length) == 1
  '
}

@test "AC1: a security-ok suppression naming a different rule-id does not suppress the finding and is recorded rejected" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)  # security-ok: weak-hash unrelated rule-id, must not suppress this finding
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]

  echo "$output" | jq -e '
    ([.findings[] | select(.rule_id == "os-system")] | length) == 1 and
    ([.suppressions[] | select(.status == "rejected" and .reason_code == "no_matching_finding")] | length) == 1
  '
}

@test "AC2: a finding in a test path is tagged in_tests true and still counts toward the recommendation" {
  mkdir -p "$TMP/tests"
  cat >"$TMP/tests/test_vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)
EOF

  run "$SCANNER" "$TMP/tests/test_vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]

  echo "$output" | jq -e '
    .findings[0].in_tests == true and
    .counts.total == 1
  '
}

@test "AC3: a category with no applicable file in scope reads not_covered" {
  cat >"$TMP/config.toml" <<'EOF'
[tool]
name = "example"
EOF

  run "$SCANNER" "$TMP/config.toml" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 0 ]

  echo "$output" | jq -e '.coverage.xss.status == "not_covered"'
}

@test "AC3: a covered category records its contributing engines" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"

  echo "$output" | jq -e '
    .coverage.injection_command.status == "covered_with_hits" and
    .coverage.injection_command.engines == ["builtin"]
  '
}

# ---------------------------------------------------------------------------
# task #25: scanner registry (amplifiers), shell rule pack, --list-tools,
# CWE-116 unquote fix, coverage-honesty fix, plus two carried green-guards.
#
# Source of truth: .jeff/tasks/lite-25-4207108455/notes.md, "## Test design".
#
# Status against current (pre-#25) code:
#   AC1 (--list-tools applicability)   RED - --list-tools is not a recognized
#     flag yet, no registry
#   AC2 (absent amplifier informational) RED - no tools ledger key yet
#   AC2 (defensive parser survives drift) RED - no fixture seam, no parser
#   AC3 (shell rule pack, 7 rules)      RED - none of the rule_ids exist yet
#   AC4 (shellcheck/gitleaks/semgrep wired) RED - no registry rows, no fixture
#     seam, no engines attribution beyond builtin
#   AC5 (--list-tools read-only)        RED - flag not recognized yet
#   CWE-116 (non-ASCII changed filename) RED - raw quoted git token is not
#     unquoted, so the file is skipped under --staged/--changes
#   Audit-F1 (hit implies covered)      RED - coverage_eval is set from file
#     class alone, so an inapplicable-class hit still reads not_covered
#   R1-F1 (over-suppression guard)      GREEN - already correct from #24
#   R1-F2 (markdown Suppressions render) GREEN - already correct from #24
# ---------------------------------------------------------------------------

@test "AC1: registry detects amplifier applicability from scope (extensions/manifest)" {
  cat >"$TMP/x.sh" <<'EOF'
echo hi
EOF

  run "$SCANNER" "$TMP/x.sh" --list-tools
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .applicable==true'

  cat >"$TMP/config.toml" <<'EOF'
[tool]
name = "example"
EOF

  run "$SCANNER" "$TMP/config.toml" --list-tools
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .applicable==false'
}

@test "AC2: an applicable but absent amplifier is an informational tool-status line, never coverage debt" {
  cat >"$TMP/clean.sh" <<'EOF'
echo hi
EOF

  # Force absence via the fixture seam (no shellcheck.json dropped), never
  # host PATH: the host may or may not have shellcheck installed, so relying
  # on shutil.which would make this test's outcome depend on the machine it
  # runs on. The env-unset -> shutil.which(None) branch is trivial and
  # covered by diff review, not this test.
  fx="$TMP/fx"
  mkdir -p "$fx"

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/clean.sh" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 0 ]

  echo "$output" | jq -e '
    .recommendation=="PASS" and
    (.tools[] | select(.name=="shellcheck") | .applicable==true and .installed==false and .status=="absent")
  '
}

@test "AC2: a defensive parser survives shellcheck output drift as an informational status, never a crash" {
  cat >"$TMP/x.sh" <<'EOF'
echo hi
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"

  # garbage text
  printf 'not json at all {{{' >"$fx/shellcheck.json"
  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  [[ "$output" != *"Traceback"* ]]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .status | test("parse_failure|timeout")'

  # empty output
  printf '' >"$fx/shellcheck.json"
  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  [[ "$output" != *"Traceback"* ]]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .status | test("parse_failure|timeout")'

  # valid json, wrong schema
  printf '{"unexpected":"shape"}' >"$fx/shellcheck.json"
  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  [[ "$output" != *"Traceback"* ]]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .status | test("parse_failure|timeout")'

  # non-zero exit
  printf '[]' >"$fx/shellcheck.json"
  printf '2' >"$fx/shellcheck.exit"
  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  [[ "$output" != *"Traceback"* ]]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .status | test("parse_failure|timeout")'
  rm -f "$fx/shellcheck.exit"

  # simulated timeout
  : >"$fx/shellcheck.timeout"
  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  [[ "$output" != *"Traceback"* ]]
  echo "$output" | jq -e '.tools[] | select(.name=="shellcheck") | .status | test("parse_failure|timeout")'
}

@test "AC2 regression: malformed amplifier arrays are parse failures, not active" {
  cat >"$TMP/x.sh" <<'EOF'
echo hi
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"
  printf '[{"foo":"bar"}]' >"$fx/shellcheck.json"

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="shellcheck") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("shellcheck-"))] | length == 0'

  printf '[{"file":"x.sh","line":1,"level":"error","code":{},"message":"wrong typed code"}]' >"$fx/shellcheck.json"
  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="shellcheck") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("shellcheck-"))] | length == 0'

  rm -rf "$TMP/.git" "$TMP/reports" "$fx"
  git -C "$TMP" init -q -b master
  mkdir -p "$fx"
  printf '[{}]' >"$fx/gitleaks.json"

  run bash -c "cd '$TMP' && JEFF_SECURITY_ENGINE_FIXTURES='$fx' '$SCANNER' --json --skip-deps --report-dir reports --force"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="gitleaks") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("gitleaks-"))] | length == 0'

  printf '[{"File":"app.py","StartLine":1}]' >"$fx/gitleaks.json"
  run bash -c "cd '$TMP' && JEFF_SECURITY_ENGINE_FIXTURES='$fx' '$SCANNER' --json --skip-deps --report-dir reports --force"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="gitleaks") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("gitleaks-"))] | length == 0'

}

@test "AC2 regression: boolean shellcheck line is a parse failure, not an active finding" {
  cat >"$TMP/x.sh" <<'EOF'
echo hi
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"
  printf '[{"file":"x.sh","line":true,"level":"error","code":2148,"message":"boolean line is drift"}]' >"$fx/shellcheck.json"

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="shellcheck") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("shellcheck-"))] | length == 0'
}

@test "AC2 regression: boolean gitleaks StartLine is a parse failure, not an active finding" {
  git -C "$TMP" init -q -b master

  fx="$TMP/fx"
  mkdir -p "$fx"
  printf '[{"File":"app.py","StartLine":true,"RuleID":"generic-api-key","Description":"bool line drift","Match":"API_KEY=sk-live-0123456789abcdef0123456789abcdef"}]' >"$fx/gitleaks.json"

  run bash -c "cd '$TMP' && JEFF_SECURITY_ENGINE_FIXTURES='$fx' '$SCANNER' --json --skip-deps --report-dir reports --force"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="gitleaks") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("gitleaks-"))] | length == 0'
}

@test "AC2 regression: malformed semgrep results are parse failures, not fabricated findings" {
  cat >"$TMP/app.py" <<'EOF'
print("hi")
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$fx/semgrep.json" <<'EOF'
{
  "results": [
    {
      "path": "app.py",
      "start": {"line": 1},
      "extra": {"severity": "ERROR"}
    },
    {
      "check_id": {"bad": "id"},
      "path": "app.py",
      "start": {"line": 1},
      "extra": {"severity": "ERROR", "message": {"bad": "msg"}}
    }
  ]
}
EOF

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/app.py" --json --skip-deps --report-dir "$TMP/reports"
  [[ "$status" -eq 0 || "$status" -eq 1 || "$status" -eq 2 ]]
  echo "$output" | jq -e '(.tools[] | select(.name=="semgrep") | .status)=="parse_failure"'
  echo "$output" | jq -e '[.findings[] | select(.rule_id | startswith("semgrep-"))] | length == 0'
}

@test "AC2 regression: missing dependency-audit tooling remains REVIEW debt, unlike absent amplifiers" {
  cat >"$TMP/package.json" <<'EOF'
{"scripts":{"test":"true"}}
EOF
  cat >"$TMP/clean.sh" <<'EOF'
echo hi
EOF
  fx="$TMP/fx"
  bin="$TMP/bin"
  mkdir -p "$fx" "$bin"
  cat >"$bin/dirname" <<'EOF'
#!/bin/sh
case "$1" in
  */*) printf '%s\n' "${1%/*}" ;;
  *) printf '.\n' ;;
esac
EOF
  chmod +x "$bin/dirname"
  python_bin="$(command -v python3)"

  run env PATH="$bin" PYTHON_BIN="$python_bin" JEFF_SECURITY_ENGINE_FIXTURES="$fx" /bin/bash -c "cd '$TMP' && /bin/bash '$SCANNER' package.json clean.sh --json --report-dir reports"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.recommendation=="REVIEW"'

  report_path="$(echo "$output" | jq -r '.report_path')"
  grep -q 'tool-missing' "$report_path"
  echo "$output" | jq -e '[.tools[]] | any(.[]; .status=="absent" and .installed==false)'
}

@test "AC3: shell-eval fires on parenless shell eval of a variable (the paren-bound-regex fix)" {
  cat >"$TMP/x.sh" <<'EOF'
CMD="ls"
eval $CMD
evaluate x
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '([.findings[] | select(.rule_id=="shell-eval")] | length) == 1'
  echo "$output" | jq -e '([.findings[] | select(.rule_id=="shell-eval")][0].line) == 2'
}

@test "AC3: curl-pipe-shell fires on curl piped to a shell" {
  cat >"$TMP/x.sh" <<'EOF'
curl https://example.com/install.sh | sh
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="curl-pipe-shell" and .severity=="high")] | length >= 1'
}

@test "AC3: unquoted-rm-var fires on rm with an unquoted path variable" {
  cat >"$TMP/x.sh" <<'EOF'
DIR=/tmp/foo
rm -rf $DIR
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="unquoted-rm-var")] | length >= 1'
}

@test "AC3: bash-c-interpolation fires on bash -c with an interpolated variable" {
  cat >"$TMP/x.sh" <<'EOF'
x=ls
bash -c "run $x"
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="bash-c-interpolation")] | length >= 1'
}

@test "AC3: insecure-tls-flag fires on --insecure and --no-check-certificate" {
  cat >"$TMP/x.sh" <<'EOF'
curl --insecure https://x
wget --no-check-certificate https://y
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="insecure-tls-flag" and .severity=="high")] | length >= 1'
}

@test "AC3 regression: shell TLS coverage is covered for clean files and hits" {
  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$TMP/clean.sh" <<'EOF'
echo hi
EOF

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/clean.sh" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.coverage.tls_transport.status=="covered_no_hits"'

  cat >"$TMP/hit.sh" <<'EOF'
curl --insecure https://example.com
EOF

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/hit.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '.coverage.tls_transport.status=="covered_with_hits"'
}

@test "AC3: chmod-777 fires on a world-writable chmod" {
  cat >"$TMP/x.sh" <<'EOF'
chmod 777 /srv/app
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="chmod-777")] | length >= 1'
}

@test "AC3: missing-arg-separator fires without -- and is silent when -- is present" {
  cat >"$TMP/x.sh" <<'EOF'
file=/tmp/f
rm "$file"
rm "$file" --
rm -- "$file"
EOF

  run "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="missing-arg-separator" and .line==2)] | length >= 1'
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="missing-arg-separator" and .line==3)] | length >= 1'
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="missing-arg-separator" and .line==4)] | length == 0'
}

@test "AC4 regression: amplifier findings under tests paths are tagged in_tests true" {
  mkdir -p "$TMP/tests"
  cat >"$TMP/tests/x.sh" <<'EOF'
echo $UNQUOTED
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$fx/shellcheck.json" <<'EOF'
[
  {
    "file": "tests/x.sh",
    "line": 1,
    "level": "warning",
    "code": 2086,
    "message": "Double quote to prevent globbing and word splitting."
  }
]
EOF

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/tests/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '[.findings[] | select(.rule_id=="shellcheck-SC2086" and .file=="tests/x.sh" and .in_tests==true)] | length == 1'
}

@test "AC4: shellcheck row wired: parses recorded output, severity-maps, and attributes the engine" {
  cat >"$TMP/x.sh" <<'EOF'
echo $UNQUOTED
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$fx/shellcheck.json" <<'EOF'
[
  {
    "file": "x.sh",
    "line": 1,
    "endLine": 1,
    "column": 6,
    "endColumn": 16,
    "level": "error",
    "code": 2148,
    "message": "Simulated recorded error finding.",
    "fix": null
  },
  {
    "file": "x.sh",
    "line": 1,
    "endLine": 1,
    "column": 6,
    "endColumn": 16,
    "level": "warning",
    "code": 2086,
    "message": "Double quote to prevent globbing and word splitting.",
    "fix": null
  },
  {
    "file": "x.sh",
    "line": 1,
    "endLine": 1,
    "column": 1,
    "endColumn": 5,
    "level": "info",
    "code": 2034,
    "message": "Simulated recorded info finding.",
    "fix": null
  }
]
EOF

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/x.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '
    ([.findings[] | select(.severity=="high")] | length >= 1) and
    ([.findings[] | select(.severity=="medium")] | length >= 1) and
    ([.findings[] | select(.severity=="low")] | length >= 1) and
    (.tools[] | select(.name=="shellcheck") | .status=="active") and
    ([.coverage[].engines[]] | contains(["shellcheck"]))
  '
}

@test "AC4 regression: absolute shellcheck paths are matched by --introduced-only" {
  git -C "$TMP" init -q -b master
  printf '#!/usr/bin/env bash\n' >"$TMP/x.sh"
  git -C "$TMP" add x.sh
  git -C "$TMP" commit -q -m initial
  printf 'echo $UNQUOTED\n' >>"$TMP/x.sh"
  git -C "$TMP" add x.sh

  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$fx/shellcheck.json" <<EOF
[
  {
    "file": "$TMP/x.sh",
    "line": 2,
    "level": "warning",
    "code": 2086,
    "message": "Double quote to prevent globbing and word splitting."
  }
]
EOF

  run bash -c "cd '$TMP' && JEFF_SECURITY_ENGINE_FIXTURES='$fx' '$SCANNER' --staged --introduced-only --json --skip-deps --report-dir reports"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '
    .recommendation=="REVIEW" and
    .counts.introduced==1 and
    ([.findings[] | select(.rule_id=="shellcheck-SC2086" and .introduced==true)] | length)==1
  '
}

@test "AC4: gitleaks row wired: a recorded secret finding parses to critical and attributes gitleaks" {
  git -C "$TMP" init -q -b master

  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$fx/gitleaks.json" <<'EOF'
[
  {
    "Description": "Generic API Key",
    "StartLine": 1,
    "EndLine": 1,
    "StartColumn": 1,
    "EndColumn": 40,
    "Match": "API_KEY = \"sk-live-0123456789abcdef0123456789abcdef\"",
    "Secret": "sk-live-0123456789abcdef0123456789abcdef",
    "File": "config.py",
    "RuleID": "generic-api-key",
    "Commit": "0000000000000000000000000000000000000000"
  }
]
EOF

  run bash -c "cd '$TMP' && JEFF_SECURITY_ENGINE_FIXTURES='$fx' '$SCANNER' --json --skip-deps --report-dir reports --force"
  echo "$output" | jq -e '
    ([.findings[] | select(.severity=="critical")] | length >= 1) and
    ([.coverage[].engines[]] | contains(["gitleaks"]))
  '
}

@test "AC4: semgrep row wired: a recorded ERROR result parses and severity-maps to high" {
  cat >"$TMP/app.py" <<'EOF'
import os


def run(cmd):
    pass
EOF

  fx="$TMP/fx"
  mkdir -p "$fx"
  cat >"$fx/semgrep.json" <<'EOF'
{
  "results": [
    {
      "check_id": "python.lang.security.audit.dangerous-eval",
      "path": "app.py",
      "start": {"line": 4, "col": 1},
      "end": {"line": 4, "col": 10},
      "extra": {
        "message": "Simulated recorded semgrep finding.",
        "severity": "ERROR",
        "metadata": {}
      }
    }
  ],
  "errors": []
}
EOF

  run env JEFF_SECURITY_ENGINE_FIXTURES="$fx" "$SCANNER" "$TMP/app.py" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '
    ([.findings[] | select(.severity=="high")] | length >= 1) and
    ([.coverage[].engines[]] | contains(["semgrep"]))
  '
}

@test "AC5: --list-tools is read-only: applicable/installed per tool, no scan, no findings, no report" {
  cat >"$TMP/x.sh" <<'EOF'
echo hi
EOF

  run "$SCANNER" "$TMP/x.sh" --list-tools --report-dir "$TMP/reports"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '(.tools|type)=="array" and (has("findings")|not)'

  report_count="$(find "$TMP/reports" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$report_count" -eq 0 ]
}

@test "CWE-116: a secret in a non-ASCII-named changed file is found under --staged and --changes" {
  git -C "$TMP" init -q -b master
  printf 'def add(a, b):\n    return a + b\n' >"$TMP/app.py"
  git -C "$TMP" add app.py
  git -C "$TMP" commit -q -m "initial"

  fn="$(printf 'secret_caf\303\251.py')"
  printf 'API_KEY = "sk-live-0123456789abcdef0123456789abcdef"\n' >"$TMP/$fn"
  git -C "$TMP" add "$fn"

  run bash -c "cd '$TMP' && '$SCANNER' --staged --json --skip-deps --report-dir reports"
  [ "$status" -eq 2 ]
  echo "$output" | jq -e '.counts.total >= 1 and ([.findings[] | select(.category=="secrets")] | length >= 1)'

  run bash -c "cd '$TMP' && '$SCANNER' --changes --json --skip-deps --report-dir reports"
  echo "$output" | jq -e '.counts.total >= 1 and ([.findings[] | select(.category=="secrets")] | length >= 1)'
}

@test "Audit-F1: a category with a hit is never labelled not_covered" {
  cat >"$TMP/hack.sh" <<'EOF'
el.innerHTML = userInput
EOF

  run "$SCANNER" "$TMP/hack.sh" --json --skip-deps --report-dir "$TMP/reports"
  echo "$output" | jq -e '.coverage.xss.status=="covered_with_hits"'
}

@test "R1-F1 [green-guard]: over-suppression naming one rule leaves the sibling finding to survive and still BLOCK" {
  cat >"$TMP/vuln.py" <<'EOF'
token = "abcdef1234567890"; eval(payload)  # security-ok: dynamic-eval operator-only path
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"
  [ "$status" -eq 2 ]

  echo "$output" | jq -e '
    ([.findings[] | select(.rule_id=="secret-assignment")] | length) == 1 and
    ([.findings[] | select(.rule_id=="dynamic-eval")] | length) == 0 and
    ([.suppressions[] | select(.status=="honored" and .rule_id=="dynamic-eval")] | length) == 1
  '
}

@test "R1-F2 [green-guard]: the markdown Suppressions section enumerates honored and rejected entries" {
  cat >"$TMP/vuln.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)  # security-ok: os-system trusted operator-only wrapper, no untrusted input reaches this call


def other(cmd):
    os.system(cmd)  # security-ok: weak-hash no-match
EOF

  run "$SCANNER" "$TMP/vuln.py" --json --skip-deps --report-dir "$TMP/reports"

  report_path="$(echo "$output" | jq -r '.report_path')"
  [ -f "$report_path" ]
  grep -q '^## Suppressions' "$report_path"
  grep -q 'honored' "$report_path"
  grep -q 'rejected' "$report_path"
}
