#!/usr/bin/env python3
"""Deterministic adversarial security audit runner for jeff."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IGNORE_DIRS = {
    ".git",
    ".worktrees",
    ".idea",
    ".vscode",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    "DerivedData",
    "Pods",
    "target",
}

SCAN_EXTENSIONS = {
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".go",
    ".rb",
    ".java",
    ".kt",
    ".swift",
    ".rs",
    ".php",
    ".cs",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".yaml",
    ".yml",
    ".json",
    ".toml",
    ".ini",
    ".cfg",
    ".env",
}

MAX_REPORT_FINDINGS = 400
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@dataclass(frozen=True)
class Rule:
    id: str
    category: str
    severity: str
    cwe: str
    title: str
    regex: str
    risk: str
    fix: str
    confidence: str = "high"


@dataclass
class Finding:
    severity: str
    category: str
    title: str
    cwe: str
    file: str
    line: int
    evidence: str
    risk: str
    fix: str
    confidence: str


@dataclass
class DependencyAuditResult:
    ecosystem: str
    status: str
    command: str
    details: str
    vulnerabilities: dict[str, int]


RULES: list[Rule] = [
    Rule(
        id="secret-assignment",
        category="secrets",
        severity="critical",
        cwe="CWE-798",
        title="Potential hardcoded credential",
        regex=r"(?i)(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['\"][A-Za-z0-9_\-\/=+]{12,}['\"]",
        risk="Credentials in source can be harvested and reused for unauthorized access.",
        fix="Move secrets to environment/secret manager and rotate exposed values.",
    ),
    Rule(
        id="aws-access-key",
        category="secrets",
        severity="critical",
        cwe="CWE-798",
        title="AWS access key pattern in source",
        regex=r"AKIA[0-9A-Z]{16}",
        risk="Leaked AWS keys can enable direct compromise of cloud resources.",
        fix="Remove keys from source, rotate credentials, and enforce secret scanning in CI.",
    ),
    Rule(
        id="private-key-material",
        category="secrets",
        severity="critical",
        cwe="CWE-321",
        title="Private key material committed",
        regex=r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        risk="Private key disclosure enables impersonation and decryption attacks.",
        fix="Revoke and replace affected keys. Store private keys outside repository.",
    ),
    Rule(
        id="sql-fstring",
        category="injection_sql",
        severity="high",
        cwe="CWE-89",
        title="SQL query built via string interpolation",
        regex=r"(?i)(execute|query)\s*\(\s*f['\"]",
        risk="User-influenced interpolation can enable SQL injection.",
        fix="Use parameterized queries/placeholders with bound parameters.",
    ),
    Rule(
        id="sql-template-literal",
        category="injection_sql",
        severity="high",
        cwe="CWE-89",
        title="SQL template literal interpolation",
        regex=r"(?i)(SELECT|INSERT|UPDATE|DELETE).*(\$\{)",
        risk="Template literal interpolation may inject untrusted SQL fragments.",
        fix="Use query parameter APIs instead of string/template concatenation.",
    ),
    Rule(
        id="subprocess-shell-true",
        category="injection_command",
        severity="critical",
        cwe="CWE-78",
        title="subprocess with shell=True",
        regex=r"(?i)subprocess\.(run|Popen|call|check_output|check_call)\s*\(.*shell\s*=\s*True",
        risk="Shell invocation with unsanitized input can enable remote command execution.",
        fix="Avoid shell=True. Pass command arguments as structured array and validate input.",
    ),
    Rule(
        id="os-system",
        category="injection_command",
        severity="high",
        cwe="CWE-78",
        title="os.system command execution",
        regex=r"(?i)os\.system\s*\(",
        risk="Direct shell execution is unsafe when input is attacker-controlled.",
        fix="Replace with safe subprocess argument arrays and strict allow-list validation.",
    ),
    Rule(
        id="node-exec-concat",
        category="injection_command",
        severity="high",
        cwe="CWE-78",
        title="child_process exec/execSync usage",
        regex=r"(?i)(exec|execSync)\s*\(",
        risk="Shell command execution via exec can lead to command injection.",
        fix="Use spawn/execFile with fixed binaries and validated argument vectors.",
    ),
    Rule(
        id="path-join-request",
        category="path_traversal",
        severity="high",
        cwe="CWE-22",
        title="Path composition with request input",
        regex=r"(?i)path\.(join|resolve)\s*\(.*(req\.|request\.|params\[|query\[)",
        risk="Attacker-controlled path segments can escape intended directories.",
        fix="Canonicalize and enforce root containment; reject traversal sequences.",
    ),
    Rule(
        id="pickle-load",
        category="insecure_deserialization",
        severity="critical",
        cwe="CWE-502",
        title="pickle deserialization",
        regex=r"(?i)pickle\.(load|loads)\s*\(",
        risk="Untrusted pickle payloads can execute arbitrary code.",
        fix="Avoid pickle for untrusted data. Use safe formats (JSON) with schema validation.",
    ),
    Rule(
        id="yaml-load",
        category="insecure_deserialization",
        severity="high",
        cwe="CWE-502",
        title="Unsafe yaml.load usage",
        regex=r"(?i)yaml\.load\s*\(",
        risk="Unsafe YAML loaders can instantiate arbitrary objects.",
        fix="Use yaml.safe_load and validate shape against expected schema.",
    ),
    Rule(
        id="weak-hash",
        category="weak_crypto",
        severity="medium",
        cwe="CWE-327",
        title="Weak hash primitive",
        regex=r"(?i)(md5|sha1)\s*\(",
        risk="Weak hash primitives are vulnerable to collision or preimage attacks.",
        fix="Use modern primitives (SHA-256/512, BLAKE2, Argon2, scrypt, bcrypt as appropriate).",
    ),
    Rule(
        id="insecure-random",
        category="weak_crypto",
        severity="medium",
        cwe="CWE-338",
        title="Non-cryptographic randomness for security context",
        regex=r"(?i)(Math\.random\(|random\.random\()",
        risk="Predictable randomness weakens tokens, IDs, and security boundaries.",
        fix="Use cryptographically secure randomness APIs.",
        confidence="medium",
    ),
    Rule(
        id="dynamic-eval",
        category="dynamic_execution",
        severity="high",
        cwe="CWE-95",
        title="Dynamic evaluation primitive",
        regex=r"(?i)(eval\s*\(|new\s+Function\s*\(|exec\s*\()",
        risk="Dynamic execution with untrusted input can lead to code execution.",
        fix="Remove dynamic evaluation or isolate with strict allow-lists and sandboxing.",
    ),
    Rule(
        id="tls-verify-disabled",
        category="tls_transport",
        severity="high",
        cwe="CWE-295",
        title="TLS verification disabled",
        regex=r"(?i)(verify\s*=\s*False|rejectUnauthorized\s*:\s*false|CURLOPT_SSL_VERIFYPEER\s*,\s*0)",
        risk="Disabling certificate verification enables MITM interception.",
        fix="Enable certificate verification and pin/validate trust roots as needed.",
    ),
    Rule(
        id="dangerous-innerhtml",
        category="xss",
        severity="high",
        cwe="CWE-79",
        title="Unsafe HTML sink",
        regex=r"(?i)(innerHTML\s*=|dangerouslySetInnerHTML|v-html\s*=)",
        risk="Rendering unsanitized HTML can allow script injection.",
        fix="Use safe templating/escaping and sanitize trusted HTML explicitly.",
    ),
    Rule(
        id="sensitive-log",
        category="sensitive_logging",
        severity="medium",
        cwe="CWE-532",
        title="Potential sensitive data logging",
        regex=r"(?i)(log|logger|console\.log|print)\s*\(.*(password|token|secret|authorization|api[_-]?key)",
        risk="Sensitive logs can leak credentials and session material.",
        fix="Redact sensitive fields before logging; use structured safe logging policies.",
    ),
]

CATEGORIES = sorted({rule.category for rule in RULES})
RULES_BY_CATEGORY = {category: [r for r in RULES if r.category == category] for category in CATEGORIES}


def run_cmd(args: list[str], cwd: Path, timeout_s: int = 40) -> tuple[str, int, str, str]:
    tool = args[0]
    if not shutil_which(tool):
        return ("missing", 127, "", f"{tool} not found in PATH")

    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd),
            text=True,
            capture_output=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr if isinstance(exc.stderr, str) else ""
        return ("timeout", 124, stdout, stderr)

    return ("ok", proc.returncode, proc.stdout or "", proc.stderr or "")


def shutil_which(cmd: str) -> str | None:
    from shutil import which

    return which(cmd)


def detect_repo_root(cwd: Path) -> Path | None:
    status, code, out, _ = run_cmd(["git", "rev-parse", "--show-toplevel"], cwd, timeout_s=5)
    if status == "ok" and code == 0 and out.strip():
        return Path(out.strip())
    return None


def is_scannable_file(path: Path, max_kb: int) -> bool:
    if not path.is_file():
        return False
    if any(part in IGNORE_DIRS for part in path.parts):
        return False

    if path.name in {"Dockerfile", "Containerfile"}:
        pass
    elif path.suffix.lower() not in SCAN_EXTENSIONS:
        return False

    try:
        size = path.stat().st_size
    except OSError:
        return False

    return size <= max_kb * 1024


def walk_scope(scope_dir: Path, max_kb: int) -> list[Path]:
    files: list[Path] = []
    for path in scope_dir.rglob("*"):
        if is_scannable_file(path, max_kb):
            files.append(path)
    return files


def resolve_changed_files(repo_root: Path, staged: bool, changes: bool, max_kb: int) -> list[Path]:
    rel_paths: set[str] = set()

    if staged:
        status, code, out, _ = run_cmd(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"],
            repo_root,
            timeout_s=10,
        )
        if status == "ok" and code == 0:
            rel_paths.update(line.strip() for line in out.splitlines() if line.strip())

    if changes:
        status, code, out, _ = run_cmd(
            ["git", "diff", "--name-only", "--diff-filter=ACMRTUXB"],
            repo_root,
            timeout_s=10,
        )
        if status == "ok" and code == 0:
            rel_paths.update(line.strip() for line in out.splitlines() if line.strip())

        status, code, out, _ = run_cmd(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"],
            repo_root,
            timeout_s=10,
        )
        if status == "ok" and code == 0:
            rel_paths.update(line.strip() for line in out.splitlines() if line.strip())

    files: list[Path] = []
    for rel in sorted(rel_paths):
        full = (repo_root / rel).resolve()
        if is_scannable_file(full, max_kb):
            files.append(full)
    return files


def resolve_files(args: argparse.Namespace, cwd: Path, repo_root: Path) -> list[Path]:
    if args.staged or args.changes:
        return resolve_changed_files(repo_root, args.staged, args.changes, args.max_file_kb)

    if args.scope:
        files: list[Path] = []
        for item in args.scope:
            path = (cwd / item).resolve()
            if path.is_file() and is_scannable_file(path, args.max_file_kb):
                files.append(path)
                continue
            if path.is_dir():
                files.extend(walk_scope(path, args.max_file_kb))
        return sorted(set(files))

    return sorted(set(walk_scope(repo_root, args.max_file_kb)))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Adversarial security review with deterministic coverage and vulnerability scans.",
    )
    parser.add_argument("scope", nargs="*", help="Optional file or directory scope")
    parser.add_argument("--changes", action="store_true", help="Audit changed files")
    parser.add_argument("--staged", action="store_true", help="Audit staged files")
    parser.add_argument("--strict", action="store_true", help="Escalate REVIEW to BLOCK")
    parser.add_argument("--force", action="store_true", help="Run even if no files are resolved")
    parser.add_argument("--skip-deps", action="store_true", help="Skip dependency audit commands")
    parser.add_argument("--report-dir", default="scratchpads", help="Report directory")
    parser.add_argument("--max-file-kb", type=int, default=512, help="Max file size to scan (KB)")
    return parser.parse_args(argv)


def scan_file(path: Path, compiled_rules: list[tuple[Rule, re.Pattern[str]]], repo_root: Path) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[tuple[str, int, str]] = set()

    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return findings

    lines = text.splitlines()

    for idx, line in enumerate(lines, start=1):
        for rule, pattern in compiled_rules:
            if not pattern.search(line):
                continue
            key = (rule.id, idx, line.strip())
            if key in seen:
                continue
            seen.add(key)
            findings.append(
                Finding(
                    severity=rule.severity,
                    category=rule.category,
                    title=rule.title,
                    cwe=rule.cwe,
                    file=str(path.relative_to(repo_root)) if path.is_relative_to(repo_root) else str(path),
                    line=idx,
                    evidence=line.strip()[:220],
                    risk=rule.risk,
                    fix=rule.fix,
                    confidence=rule.confidence,
                )
            )

    return findings


def parse_npm_vulns(stdout: str) -> dict[str, int]:
    try:
        payload = json.loads(stdout)
    except Exception:
        return {}

    meta = payload.get("metadata", {}) if isinstance(payload, dict) else {}
    vulns = meta.get("vulnerabilities", {}) if isinstance(meta, dict) else {}
    out: dict[str, int] = {}
    for sev in ("critical", "high", "moderate", "medium", "low"):
        val = vulns.get(sev)
        if isinstance(val, int) and val > 0:
            normalized = "medium" if sev == "moderate" else sev
            out[normalized] = out.get(normalized, 0) + val
    return out


def parse_pip_audit(stdout: str) -> dict[str, int]:
    try:
        payload = json.loads(stdout)
    except Exception:
        return {}

    sev_map = {"critical": 0, "high": 0, "medium": 0, "low": 0}

    if isinstance(payload, list):
        total = 0
        for dep in payload:
            vulns = dep.get("vulns", []) if isinstance(dep, dict) else []
            total += len(vulns)
        if total > 0:
            sev_map["high"] = total

    return {k: v for k, v in sev_map.items() if v > 0}


def parse_cargo_audit(stdout: str) -> dict[str, int]:
    try:
        payload = json.loads(stdout)
    except Exception:
        return {}

    vulns = payload.get("vulnerabilities", {}) if isinstance(payload, dict) else {}
    found = vulns.get("found") if isinstance(vulns, dict) else None
    if isinstance(found, bool) and not found:
        return {}

    list_items = vulns.get("list", []) if isinstance(vulns, dict) else []
    count = len(list_items) if isinstance(list_items, list) else 0
    return {"high": count} if count > 0 else {}


def parse_bundle_audit(stdout: str) -> dict[str, int]:
    try:
        payload = json.loads(stdout)
    except Exception:
        return {}

    advisories = payload.get("advisories") if isinstance(payload, dict) else None
    if isinstance(advisories, list) and len(advisories) > 0:
        return {"high": len(advisories)}
    return {}


def parse_govuln(stdout: str, stderr: str) -> dict[str, int]:
    text = f"{stdout}\n{stderr}"
    count = len(re.findall(r"(?im)^Vulnerability", text))
    if count == 0:
        count = len(re.findall(r"\bGO-\d{4}-\d+\b", text))
    return {"high": count} if count > 0 else {}


def detect_dependency_audits(repo_root: Path) -> list[tuple[str, list[str], str]]:
    checks: list[tuple[str, list[str], str]] = []

    if (repo_root / "package.json").exists():
        if (repo_root / "pnpm-lock.yaml").exists():
            checks.append(("pnpm", ["pnpm", "audit", "--json"], "npm-like dependency audit"))
        else:
            checks.append(("npm", ["npm", "audit", "--json"], "npm dependency audit"))

    if (repo_root / "requirements.txt").exists() or (repo_root / "pyproject.toml").exists():
        checks.append(("pip-audit", ["pip-audit", "--format", "json"], "Python dependency audit"))

    if (repo_root / "Cargo.toml").exists():
        checks.append(("cargo-audit", ["cargo", "audit", "--json"], "Rust dependency audit"))

    if (repo_root / "Gemfile").exists():
        checks.append(("bundle-audit", ["bundle", "audit", "--format", "json"], "Ruby dependency audit"))

    if (repo_root / "go.mod").exists():
        checks.append(("govulncheck", ["govulncheck", "./..."], "Go vulnerability audit"))

    return checks


def run_dependency_audits(repo_root: Path, skip: bool) -> tuple[list[DependencyAuditResult], list[Finding], int]:
    if skip:
        return ([], [], 0)

    manifests = detect_dependency_audits(repo_root)
    results: list[DependencyAuditResult] = []
    findings: list[Finding] = []
    failures = 0

    for ecosystem, cmd, desc in manifests:
        status, code, stdout, stderr = run_cmd(cmd, repo_root, timeout_s=45)
        command_str = " ".join(cmd)

        if status == "missing":
            failures += 1
            results.append(
                DependencyAuditResult(
                    ecosystem=ecosystem,
                    status="tool-missing",
                    command=command_str,
                    details=stderr,
                    vulnerabilities={},
                )
            )
            continue

        if status == "timeout":
            failures += 1
            results.append(
                DependencyAuditResult(
                    ecosystem=ecosystem,
                    status="timeout",
                    command=command_str,
                    details="dependency audit command timed out",
                    vulnerabilities={},
                )
            )
            continue

        if ecosystem in {"npm", "pnpm"}:
            vulns = parse_npm_vulns(stdout)
        elif ecosystem == "pip-audit":
            vulns = parse_pip_audit(stdout)
        elif ecosystem == "cargo-audit":
            vulns = parse_cargo_audit(stdout)
        elif ecosystem == "bundle-audit":
            vulns = parse_bundle_audit(stdout)
        else:
            vulns = parse_govuln(stdout, stderr)

        bad_exec = code not in (0, 1, 3)
        if bad_exec:
            failures += 1
            results.append(
                DependencyAuditResult(
                    ecosystem=ecosystem,
                    status="failed",
                    command=command_str,
                    details=(stderr or stdout or f"command exited with {code}")[:3000],
                    vulnerabilities=vulns,
                )
            )
        else:
            results.append(
                DependencyAuditResult(
                    ecosystem=ecosystem,
                    status="ok",
                    command=command_str,
                    details=desc,
                    vulnerabilities=vulns,
                )
            )

        for severity in ("critical", "high", "medium", "low"):
            count = vulns.get(severity, 0)
            if count <= 0:
                continue
            findings.append(
                Finding(
                    severity=severity,
                    category="dependency_audit",
                    title=f"{ecosystem} reported {count} {severity} dependency vulnerabilities",
                    cwe="CWE-1104",
                    file="dependency-manifest",
                    line=1,
                    evidence=f"{ecosystem} audit vulnerability count: {count} ({severity})",
                    risk="Known vulnerable dependencies can be exploited through published CVEs.",
                    fix="Upgrade or replace affected packages and verify no vulnerable transitive dependencies remain.",
                    confidence="high",
                )
            )

    return (results, findings, failures)


def make_recommendation(
    counts: dict[str, int],
    uncovered_categories: int,
    audit_failures: int,
    strict: bool,
) -> str:
    if counts.get("critical", 0) > 0:
        return "BLOCK"

    has_findings = sum(counts.values()) > 0
    has_debt = uncovered_categories > 0 or audit_failures > 0

    if strict and (has_findings or has_debt):
        return "BLOCK"

    if has_findings or has_debt:
        return "REVIEW"

    return "PASS"


def scope_label(args: argparse.Namespace) -> str:
    if args.staged:
        return "staged"
    if args.changes:
        return "changes"
    if args.scope:
        return ",".join(args.scope)
    return "full-codebase"


def sanitize_md(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def write_report(
    report_path: Path,
    scope: str,
    files_scanned: int,
    findings: list[Finding],
    coverage: dict[str, str],
    dep_results: list[DependencyAuditResult],
    recommendation: str,
    strict: bool,
    audit_failures: int,
    risk_points: int,
) -> None:
    sorted_findings = sorted(
        findings,
        key=lambda f: (
            SEVERITY_ORDER.get(f.severity, 99),
            f.category,
            f.file,
            f.line,
        ),
    )

    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for item in findings:
        counts[item.severity] = counts.get(item.severity, 0) + 1

    shown = sorted_findings[:MAX_REPORT_FINDINGS]
    truncated = max(0, len(sorted_findings) - len(shown))

    lines: list[str] = []
    lines.append("# Security Audit Report")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Scope: `{scope}`")
    lines.append(f"- Files scanned: {files_scanned}")
    lines.append(f"- Findings: {len(findings)}")
    lines.append(f"- Critical: {counts['critical']}")
    lines.append(f"- High: {counts['high']}")
    lines.append(f"- Medium: {counts['medium']}")
    lines.append(f"- Low: {counts['low']}")
    lines.append(f"- Dependency audit failures: {audit_failures}")
    lines.append(f"- Adversarial risk points: {risk_points}")
    lines.append(f"- Strict mode: `{str(strict).lower()}`")
    lines.append(f"- Recommendation: **{recommendation}**")
    lines.append("")

    lines.append("## Coverage Ledger")
    lines.append("| Category | Status |")
    lines.append("|---|---|")
    for category in sorted(coverage.keys()):
        lines.append(f"| `{category}` | `{coverage[category]}` |")
    lines.append("")

    lines.append("## Dependency Audit")
    if dep_results:
        lines.append("| Ecosystem | Status | Command | Details | Vulnerabilities |")
        lines.append("|---|---|---|---|---|")
        for result in dep_results:
            vuln_text = (
                ", ".join(f"{k}:{v}" for k, v in sorted(result.vulnerabilities.items()))
                if result.vulnerabilities
                else "none"
            )
            lines.append(
                "| "
                + " | ".join(
                    [
                        sanitize_md(result.ecosystem),
                        sanitize_md(result.status),
                        sanitize_md(result.command),
                        sanitize_md(result.details[:200]),
                        sanitize_md(vuln_text),
                    ]
                )
                + " |"
            )
    else:
        lines.append("- No dependency manifests detected or dependency audits skipped.")
    lines.append("")

    lines.append("## Findings")
    if shown:
        for finding in shown:
            lines.append(f"### [{finding.severity.upper()}] {finding.title}")
            lines.append(f"- CWE: {finding.cwe}")
            lines.append(f"- File: `{finding.file}:{finding.line}`")
            lines.append(f"- Category: `{finding.category}`")
            lines.append(f"- Evidence: `{finding.evidence}`")
            lines.append(f"- Risk: {finding.risk}")
            lines.append(f"- Fix: {finding.fix}")
            lines.append(f"- Confidence: `{finding.confidence}`")
            lines.append("")
    else:
        lines.append("No findings.")
        lines.append("")

    if truncated > 0:
        lines.append(f"_Truncated {truncated} findings from report output._")
        lines.append("")

    lines.append("## Decision Logic")
    lines.append("- BLOCK: any critical finding")
    lines.append("- REVIEW: any non-critical findings or audit/coverage debt")
    lines.append("- PASS: zero findings + zero debt")
    lines.append("")

    report_path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    cwd = Path.cwd().resolve()
    repo_root = detect_repo_root(cwd) or cwd

    files = resolve_files(args, cwd, repo_root)
    resolved_scope = scope_label(args)

    if not files and not args.force:
        print("No scannable files resolved for security review. Use --force to emit an empty audit report.")
        return 0

    compiled_rules = [(rule, re.compile(rule.regex)) for rule in RULES]

    findings: list[Finding] = []
    coverage_hits = {category: 0 for category in CATEGORIES}
    coverage_eval = {category: False for category in CATEGORIES}

    for path in files:
        file_findings = scan_file(path, compiled_rules, repo_root)
        findings.extend(file_findings)

        # Every file gets all categories evaluated to prevent silent category skips.
        for category in CATEGORIES:
            coverage_eval[category] = True

    for finding in findings:
        if finding.category in coverage_hits:
            coverage_hits[finding.category] += 1

    dep_results, dep_findings, audit_failures = run_dependency_audits(repo_root, args.skip_deps)
    findings.extend(dep_findings)

    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for item in findings:
        if item.severity in counts:
            counts[item.severity] += 1

    coverage_status: dict[str, str] = {}
    for category in CATEGORIES:
        if not coverage_eval.get(category, False):
            coverage_status[category] = "not_covered"
        elif coverage_hits.get(category, 0) > 0:
            coverage_status[category] = "covered_with_hits"
        else:
            coverage_status[category] = "covered_no_hits"

    uncovered = sum(1 for status in coverage_status.values() if status == "not_covered")

    risk_weights = {"critical": 25, "high": 10, "medium": 4, "low": 1}
    risk_points = sum(counts[level] * weight for level, weight in risk_weights.items())
    risk_points += uncovered * 12 + audit_failures * 8

    recommendation = make_recommendation(counts, uncovered, audit_failures, args.strict)

    report_dir = (cwd / args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    report_path = report_dir / f"security-audit-{stamp}.md"

    write_report(
        report_path=report_path,
        scope=resolved_scope,
        files_scanned=len(files),
        findings=findings,
        coverage=coverage_status,
        dep_results=dep_results,
        recommendation=recommendation,
        strict=args.strict,
        audit_failures=audit_failures,
        risk_points=risk_points,
    )

    total = sum(counts.values())
    print("security_audit_result:")
    print(f"  scope: \"{resolved_scope}\"")
    print(f"  files_scanned: {len(files)}")
    print("  findings:")
    print(f"    total: {total}")
    print(f"    critical: {counts['critical']}")
    print(f"    high: {counts['high']}")
    print(f"    medium: {counts['medium']}")
    print(f"    low: {counts['low']}")
    print("  coverage:")
    print(f"    categories: {len(CATEGORIES)}")
    print(f"    uncovered: {uncovered}")
    print(f"    audit_tool_failures: {audit_failures}")
    print(f"  recommendation: \"{recommendation}\"")
    print(f"  risk_points: {risk_points}")
    print(f"  report_path: \"{report_path}\"")

    if recommendation == "BLOCK":
        return 2
    if recommendation == "REVIEW":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
