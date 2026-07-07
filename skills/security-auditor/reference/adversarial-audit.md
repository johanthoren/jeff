# Adversarial Security Audit Reference

## Objective

Bias toward finding exploitable risk, not proving code is safe.

## Coverage Ledger (Required)

Every run must show coverage status for each category:
- `secrets`
- `injection_sql`
- `injection_command`
- `path_traversal`
- `insecure_deserialization`
- `weak_crypto`
- `dynamic_execution`
- `tls_transport`
- `xss`
- `sensitive_logging`
- `insecure_permissions`

Each category carries a `{status, engines}` object. Status is one of:
- `covered_with_hits`
- `covered_no_hits`
- `not_covered`

`not_covered` means no file whose type the category applies to was in scope
(for example `xss` over a config-only scope) AND no finding hit the category: a
hit proves the category was evaluated, so a category with a hit is never
`not_covered`. It is inapplicable, not a scan gap, and does not by itself forbid
`PASS`. `engines` lists the engines that evaluated the category: `builtin` is
always present for a covered category, and a contributing amplifier (for example
`shellcheck`) adds its own name. `engines` is empty for `not_covered`.

## Amplifier Engines (Optional)

The scanner ships a declarative registry of external amplifier tools
(`shellcheck`, `gitleaks`, `semgrep`, with more to follow). An amplifier fires
only when it is both applicable (an in-scope file extension it handles, or a
manifest such as `.git` at the repo root) and installed on `PATH`. Its findings
merge into the normal finding set and its name is attributed to the hit
category's `engines`.

Amplifier absence is informational, NOT coverage debt. An applicable but absent
tool is recorded as an `absent` line in the `tools` ledger; it never increments
audit failures and never downgrades the recommendation. This is the deliberate
contrast with dependency audits below: a missing dependency-audit tool IS
coverage debt, a missing amplifier is not. Parsers are defensive: tool output
drift degrades to an informational `parse_failure`/`timeout` status, never a
crashed audit.

## Dependency Audit Handling

Attempt ecosystem-appropriate audit commands when possible.

If tool missing, command fails, or timeout occurs:
- record as coverage debt
- include in report
- prevent `PASS` unless user explicitly accepts the gap

## Severity Model

- `critical`: likely exploitable with high impact, immediate block
- `high`: strong exploit signal, unsafe defaults, exposed attack surface
- `medium`: plausible risk needing hardening
- `low`: hygiene issue with security relevance

## Recommendation Logic

- `BLOCK`: any `critical`
- `REVIEW`: any `high/medium` or dependency audit gaps
- `PASS`: zero findings + zero dependency-audit debt (`not_covered` categories are inapplicable, not debt)

## Reporting Rules

Each finding includes:
- severity
- CWE
- file and line
- matched evidence/pattern
- exploit narrative (what attacker does)
- concrete remediation
- confidence (high/medium/low)

## Non-Shirking Rules

- Never end after first finding; continue full sweep.
- Never skip categories silently.
- Never emit empty findings without coverage evidence.
- If uncertain, surface as `low/medium` with verification steps instead of discarding.
