---
name: security-auditor
description: "Adversarial security auditing workflow for source changes. Make sure to use this skill whenever reviewing code before merge, hunting for vulnerabilities, auditing dependencies, or assessing security exposure of new features, even if the user doesn't explicitly ask for a security review. Includes OWASP-focused scans, dependency-audit attempts, coverage accounting, and strict pass/block recommendations."
---

# Security Auditor

Adversarial security-audit skill for the jeff pipeline.

Use this skill when you need an adversarial review that tries to break assumptions and surface exploitable weaknesses.

## Load Order

For code work, load these first:
1. `code-standards`
2. language-specific skills, if present
3. `testing` (when modifying checks)

Then load `security-auditor`.

## Adversarial Posture (Anti-Shirk Contract)

- Assume vulnerabilities exist until disproven by evidence.
- Treat missing evidence as a risk signal, not a clean bill of health.
- Never return `PASS` without full coverage ledger output.
- Do not stop at regex hits: confirm exploit path context when possible.
- Keep findings actionable with CWE mapping, exploit risk, and concrete remediation.
- **The implementer must never be the auditor.** Whoever wrote or changed the code under review cannot sign off on its security; delegate the audit to an independent agent and never self-assess inline.

## Deterministic Entry Point

The audit runner is **`scripts/review-security.sh`**, bundled in this skill's own directory. When this skill loads, its absolute location is given to you as the skill's **base directory** (the `Base directory for this skill: …` line in the skill preamble). Run the script by that absolute path, keeping your working directory in the target repo so the scan resolves the code under review from the cwd:

```bash
"<base-directory>/scripts/review-security.sh" [scope] [flags]
```

Do not filesystem-search for the script; resolve it from the announced base directory.

## Default Checks

- Hardcoded secrets and key material
- Injection sinks (SQL, shell/command, path traversal)
- Insecure deserialization
- Weak crypto/hash usage
- Dangerous dynamic execution (`eval`, `exec`, deserialization gadgets)
- TLS verification disabled / insecure transport
- XSS-prone patterns
- Sensitive data logging
- Dependency audit attempts (when manifest + tool exist)

## Expected Output

```yaml
security_audit_result:
  scope: "<resolved-scope>"
  files_scanned: <n>
  findings:
    total: <n>
    critical: <n>
    high: <n>
    medium: <n>
    low: <n>
  coverage:
    categories: <n>
    uncovered: <n>
    audit_tool_failures: <n>
  recommendation: "PASS|REVIEW|BLOCK"
  report_path: "scratchpads/security-audit-<timestamp>.md"
```

## Gate Defaults

- `BLOCK`: any `critical` finding
- `REVIEW`: any `high/medium` finding, category coverage gaps, or dependency audit execution failures
- `PASS`: only when no findings and no coverage gaps/tool failures

## Common Flags

- `--changes` / `--staged` (audit changed / staged files only)
- `--strict` (escalate any finding or coverage/tool debt to `BLOCK`)
- `--force` (emit an empty audit report even when no scannable files resolve)
- `--skip-deps` (skip dependency audit commands)
- `--report-dir <dir>` / `--max-file-kb <n>`

## References

- `reference/adversarial-audit.md`
- `scripts/review_security.py`
