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

Each category is either:
- `covered_with_hits`
- `covered_no_hits`
- `not_covered`

`PASS` is disallowed when any category is `not_covered`.

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
- `REVIEW`: any `high/medium`, coverage debt, or dependency audit gaps
- `PASS`: zero findings + zero coverage debt

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
