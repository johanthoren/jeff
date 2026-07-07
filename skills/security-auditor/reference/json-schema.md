# review-security `--json` result schema

`review-security.sh <scope> --json` prints one JSON object to stdout. The
markdown report is still written to `--report-dir` (its path rides inside the
JSON as `report_path`), and the human-readable `security_audit_result:` stdout
block is replaced by this object. Exit codes are unchanged: `2` for BLOCK, `1`
for REVIEW, `0` for PASS.

This is the stable field contract a downstream audit agent parses. Field names
are load-bearing; the object may gain fields over time but existing names and
meanings do not change.

## Top-level object

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | number | Contract version. Currently `1`. |
| `scope` | string | Resolved scope label: `full-codebase`, `changes`, `staged`, or the joined scope arguments. |
| `introduced_only` | boolean | Whether `--introduced-only` was set. |
| `files_scanned` | number | Count of files the scanner read. |
| `findings` | array | Zero or more finding objects (see below), sorted by severity then category, file, line. |
| `suppressions` | array | Zero or more suppression objects (see below): every `# security-ok:` marker encountered, honored or rejected. |
| `coverage` | object | Per-category coverage: category name to a `{status, engines}` object (see below). |
| `tools` | array | Amplifier tool-status ledger: one entry per registry engine (see below). Informational: an applicable but absent tool is never coverage debt and never downgrades the recommendation. |
| `counts` | object | Aggregate counts (see below). |
| `recommendation` | string | `BLOCK`, `REVIEW`, or `PASS`. |
| `risk_points` | number | Weighted adversarial risk score. |
| `strict` | boolean | Whether `--strict` was set. |
| `report_path` | string | Absolute path to the written markdown report. |

## Finding object

| Field | Type | Meaning |
|---|---|---|
| `fingerprint` | string | Stable 16-char identity: `sha256(rule_id, file, normalized_evidence)` truncated. Normalized evidence collapses whitespace and excludes the line number, so the fingerprint survives a within-file move and stays distinct across a different rule, file, or evidence. Present in this JSON and in the markdown report. |
| `rule_id` | string | Rule that matched (for example `os-system`), or `dependency-audit` for dependency findings. |
| `category` | string | Finding category (for example `injection_command`). |
| `severity` | string | `critical`, `high`, `medium`, or `low`. |
| `cwe` | string | CWE identifier. |
| `title` | string | Human-readable rule title. |
| `file` | string | Repository-relative path (or `dependency-manifest` for dependency findings). |
| `line` | number | 1-based line number of the match. |
| `evidence` | string | The matched source line, trimmed and length-capped. |
| `confidence` | string | Rule confidence: `high` or `medium`. |
| `in_tests` | boolean | `true` when the finding sits in a test path (`tests/`, `test_*`, `*_test.*`, `*.test.*`, `spec/`, and similar). Test-path findings are tagged, never filtered: they still count toward the recommendation. |
| `introduced` | boolean | Present only in `--changes`/`--staged` mode. `true` when the finding sits on a diff-added line, `false` otherwise. |

`risk` and `fix` are intentionally not in the finding object: they are static
per `rule_id` and render in the markdown report for humans. The machine object
stays lean and stable so downstream links can add fields without breaking
parsers.

## Coverage object

Each `coverage` value is an object, not a bare string:

| Field | Type | Meaning |
|---|---|---|
| `status` | string | One of `not_covered`, `covered_no_hits`, `covered_with_hits`. `not_covered` means no file whose type the category applies to was in scope AND no finding hit the category (a hit proves evaluation), not a scan gap. |
| `engines` | array | Engine names that evaluated the category. `builtin` is always present for a covered category; a contributing amplifier adds its own name (for example `["builtin", "shellcheck"]`). Empty for `not_covered`. |

## Tool object

Each `tools` entry describes one amplifier engine from the registry:

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Engine name (for example `shellcheck`, `gitleaks`, `semgrep`). |
| `applicable` | boolean | Whether the scope triggers the engine (an in-scope file extension it handles, or a manifest such as `.git` at the repo root). |
| `installed` | boolean | Whether the engine binary is resolvable on `PATH`. |
| `status` | string | `not_applicable`, `absent` (applicable but not installed), `active` (ran and contributed), `parse_failure` (output drift; degraded, never a crash), or `timeout`. Only `absent`/`active`/`parse_failure`/`timeout` occur for applicable engines. |
| `detail` | string | Human-readable note about the status. |

Amplifiers are optional external scanners. An `absent` amplifier is informational
only: it never becomes coverage debt and never downgrades the recommendation.
Dependency-audit gaps remain coverage debt (see `adversarial-audit.md`).

## Suppression object

| Field | Type | Meaning |
|---|---|---|
| `status` | string | `honored` (finding removed) or `rejected` (finding stands). |
| `rule_id` | string | The rule id named in the `# security-ok:` marker. |
| `file` | string | Repository-relative path of the marker. |
| `line` | number | 1-based line of the marker. |
| `reason` | string | The free-text justification (empty when the marker had none). |
| `fingerprint` | string | Present on `honored` entries: the fingerprint of the removed finding. |
| `reason_code` | string | Present on `rejected` entries: `missing_reason` (no justification; the finding stands and a `suppression-without-reason` finding is emitted) or `no_matching_finding` (the named rule matched no finding on that line). |

## Counts object

| Field | Type | Meaning |
|---|---|---|
| `total` | number | Total findings. |
| `by_severity` | object | Counts keyed by `critical`, `high`, `medium`, `low`. |
| `introduced` | number | Findings on diff-added lines. Present only in `--changes`/`--staged` mode. |
| `pre_existing` | number | Findings not on diff-added lines. Present only in `--changes`/`--staged` mode. `introduced + pre_existing == total`. |

## `--introduced-only`

Meaningful with `--changes`/`--staged`. When set, the recommendation counts
only introduced findings and excludes repo-global coverage and dependency-audit
debt, so a change that adds nothing new passes even in a repository that carries
pre-existing findings. The default path (flag absent) is unchanged: coverage and
dependency debt still feed the recommendation.

## `--list-tools`

A read-only mode: it computes amplifier applicability/installed for the resolved
scope, prints a single JSON object, and exits `0` without scanning or writing a
report. The object has exactly one key:

```json
{
  "tools": [
    { "name": "shellcheck", "applicable": true, "installed": false },
    { "name": "gitleaks", "applicable": false, "installed": false },
    { "name": "semgrep", "applicable": false, "installed": false }
  ]
}
```

Each entry carries `name`, `applicable`, and `installed` (no `status`/`detail`,
since nothing runs). There is no `findings` key: this mode never scans.
