#!/usr/bin/env python3
"""Deterministic adversarial security audit runner for jeff."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

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
    rule_id: str
    introduced: bool | None = None
    in_tests: bool = False


@dataclass
class Suppression:
    status: str  # honored | rejected
    rule_id: str
    file: str
    line: int
    reason: str
    fingerprint: str | None = None  # honored: the removed finding's fingerprint
    reason_code: str | None = None  # rejected: missing_reason | no_matching_finding


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
    # --- Shell rule pack (task #25). Builtin regex rules; run on every file
    # under the same suppression / in_tests / coverage machinery as the rules
    # above. `shell-eval` fixes the paren-bound `eval\s*\(` blind spot: it
    # matches parenless shell eval of a variable / command substitution, which
    # `dynamic-eval` (paren-bound) never sees.
    Rule(
        id="shell-eval",
        category="injection_command",
        severity="high",
        cwe="CWE-78",
        title="Shell eval of a variable or command substitution",
        regex=r"(?i)\beval\s+[\"']?[\$`]",
        risk="Shell eval of interpolated data enables arbitrary command execution.",
        fix="Avoid eval. Use arrays and explicit argument vectors; validate input strictly.",
    ),
    Rule(
        id="curl-pipe-shell",
        category="injection_command",
        severity="high",
        cwe="CWE-78",
        title="Remote script piped into a shell",
        regex=r"(?i)\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|dash)\b",
        risk="Piping a downloaded script into a shell runs unverified remote code.",
        fix="Download, checksum/verify, and review the script before executing it.",
    ),
    Rule(
        id="unquoted-rm-var",
        category="injection_command",
        severity="medium",
        cwe="CWE-78",
        title="Unquoted path variable in a destructive command",
        regex=r"(?i)\brm\b\s+[^\n]*(?<![\"'])\$\{?\w+",
        risk="An unquoted variable can word-split or glob and delete unintended paths.",
        fix="Quote the variable (\"$var\") and add a `--` separator before path operands.",
    ),
    Rule(
        id="bash-c-interpolation",
        category="injection_command",
        severity="high",
        cwe="CWE-78",
        title="Interpolated variable inside bash -c",
        regex=r"(?i)\b(bash|sh|zsh)\s+-c\s+[\"'][^\"']*\$",
        risk="Interpolating a variable into `bash -c` mixes code and data, enabling injection.",
        fix="Pass data as positional arguments to the inline script, not string-interpolated.",
    ),
    Rule(
        id="insecure-tls-flag",
        category="tls_transport",
        severity="high",
        cwe="CWE-295",
        title="TLS certificate verification disabled via flag",
        regex=r"(?i)(--insecure\b|--no-check-certificate\b)",
        risk="Disabling certificate verification enables man-in-the-middle interception.",
        fix="Remove the flag and trust the system CA store or pin a known certificate.",
    ),
    Rule(
        id="chmod-777",
        category="insecure_permissions",
        severity="medium",
        cwe="CWE-732",
        title="World-writable permissions via chmod 777",
        regex=r"(?i)\bchmod\s+(-\S+\s+)*0?777\b",
        risk="World-writable files let any local user tamper with code or data.",
        fix="Grant the least privilege needed (for example 750/640); never use 777.",
    ),
    Rule(
        id="missing-arg-separator",
        category="injection_command",
        severity="medium",
        cwe="CWE-88",
        title="Path variable operand with no `--` separator",
        regex=r"(?i)\b(rm|cp|mv|ln|chown|chmod|rsync|tar)\b(?![^\n$]*\s--(\s|$))[^\n]*[\"']?\$\{?\w+",
        risk="Without a `--` separator, a value beginning with `-` is parsed as an option.",
        fix="Insert `--` before path operands: `rm -- \"$file\"`.",
    ),
]

CATEGORIES = sorted({rule.category for rule in RULES})
RULES_BY_CATEGORY = {category: [r for r in RULES if r.category == category] for category in CATEGORIES}

# Coverage engines available under task #24 (external engines are #25/#26).
COVERAGE_ENGINES = ["builtin"]

# File-extension class for coverage applicability. Extensions not listed fall
# back to "compiled" (a generic source-code class).
FILE_CLASSES: dict[str, str] = {
    ".py": "python",
    ".js": "js",
    ".ts": "js",
    ".tsx": "js",
    ".jsx": "js",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".ps1": "shell",
    ".go": "compiled",
    ".rb": "compiled",
    ".java": "compiled",
    ".kt": "compiled",
    ".swift": "compiled",
    ".rs": "compiled",
    ".php": "compiled",
    ".cs": "compiled",
    ".yaml": "config",
    ".yml": "config",
    ".json": "config",
    ".toml": "config",
    ".ini": "config",
    ".cfg": "config",
    ".env": "config",
}

_ALL_CODE = {"python", "js", "shell", "compiled"}

# Category -> the file-extension classes it applies to. A category with no
# applicable file in scope reads not_covered (inapplicable, not debt).
CATEGORY_APPLICABILITY: dict[str, set[str]] = {
    "secrets": {"python", "js", "shell", "compiled", "config"},
    "injection_sql": {"python", "js", "compiled"},
    "injection_command": {"python", "js", "shell"},
    "path_traversal": {"python", "js", "compiled"},
    "insecure_deserialization": {"python", "js", "compiled"},
    "weak_crypto": {"python", "js", "compiled"},
    "dynamic_execution": {"python", "js", "compiled"},
    "tls_transport": {"python", "js", "shell", "compiled"},
    "xss": {"js"},
    "sensitive_logging": {"python", "js", "compiled"},
    "insecure_permissions": {"python", "js", "shell", "compiled", "config"},
}


def file_class(path: Path) -> str:
    if path.name in {"Dockerfile", "Containerfile"}:
        return "shell"
    return FILE_CLASSES.get(path.suffix.lower(), "compiled")


def is_test_path(rel_path: str) -> bool:
    """True when a relative path is a test artifact (tagged, never filtered)."""
    p = Path(rel_path)
    parts = {part.lower() for part in p.parts}
    if parts & {"tests", "test", "spec", "__tests__", "testdata"}:
        return True
    name = p.name.lower()
    if name.startswith("test_"):
        return True
    stem = p.stem.lower()
    return (
        stem.endswith("_test")
        or ".test." in name
        or ".spec." in name
        or stem.endswith(".test")
        or stem.endswith(".spec")
    )


def parse_suppression(line: str) -> tuple[str, str] | None:
    """Parse a same-line `# security-ok: <rule-id> <reason>` marker.

    Returns (rule_id, reason) with reason stripped (possibly empty), or None
    when the line carries no marker.
    """
    match = re.search(r"#\s*security-ok:\s*(\S+)(.*)$", line)
    if not match:
        return None
    return (match.group(1), match.group(2).strip())


def run_cmd(args: list[str], cwd: Path, timeout_s: int = 40) -> tuple[str, int, str, str]:
    tool = args[0]
    if not shutil_which(tool):
        return ("missing", 127, "", f"{tool} not found in PATH")

    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd),
            text=True,
            encoding="utf-8",
            errors="replace",
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


def unquote_git_path(token: str) -> str:
    """Decode a git diff path token, undoing C-style quoting (CWE-116 fix).

    When a path contains non-ASCII, control, or special characters, git wraps it
    in double quotes and C-escapes the bytes (octal `\\ooo`, plus `\\t \\n \\" \\\\`
    and friends). The raw quoted token does not name a real file, so the scanned
    set silently drops such a changed file. This decoder collects the escaped
    bytes and UTF-8 decodes them, regardless of `core.quotePath`. Unquoted ASCII
    tokens pass through unchanged.
    """
    token = token.strip()
    if len(token) < 2 or not (token.startswith('"') and token.endswith('"')):
        return token

    inner = token[1:-1]
    simple = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13, '"': 0x22, "\\": 0x5C}
    out = bytearray()
    i = 0
    while i < len(inner):
        char = inner[i]
        if char == "\\" and i + 1 < len(inner):
            nxt = inner[i + 1]
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
            octal = re.match(r"[0-7]{1,3}", inner[i + 1 :])
            if octal:
                out.append(int(octal.group(0), 8) & 0xFF)
                i += 1 + len(octal.group(0))
                continue
            out.extend(nxt.encode("utf-8"))
            i += 2
            continue
        out.extend(char.encode("utf-8"))
        i += 1
    return out.decode("utf-8", errors="replace")


def _diff_names(out: str) -> list[str]:
    return [unquote_git_path(line) for line in out.splitlines() if line.strip()]


def resolve_changed_files(repo_root: Path, staged: bool, changes: bool, max_kb: int) -> list[Path]:
    rel_paths: set[str] = set()

    if staged:
        status, code, out, _ = run_cmd(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"],
            repo_root,
            timeout_s=10,
        )
        if status == "ok" and code == 0:
            rel_paths.update(_diff_names(out))

    if changes:
        status, code, out, _ = run_cmd(
            ["git", "diff", "--name-only", "--diff-filter=ACMRTUXB"],
            repo_root,
            timeout_s=10,
        )
        if status == "ok" and code == 0:
            rel_paths.update(_diff_names(out))

        status, code, out, _ = run_cmd(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"],
            repo_root,
            timeout_s=10,
        )
        if status == "ok" and code == 0:
            rel_paths.update(_diff_names(out))

    files: list[Path] = []
    for rel in sorted(rel_paths):
        full = (repo_root / rel).resolve()
        if is_scannable_file(full, max_kb):
            files.append(full)
    return files


def added_lines_by_file(repo_root: Path, staged: bool) -> dict[str, set[int]]:
    """Map each changed file to the set of line numbers the diff adds.

    Base matches resolve_changed_files: staged compares the index to HEAD,
    otherwise the working tree to HEAD. Parses `git diff -U0` hunk headers
    (`@@ -a,b +c,d @@`); a `+c` with no count spans one line. New, deleted,
    and binary files fall out naturally (no added hunks or no `+++ b/` path).
    """
    cmd = ["git", "diff", "-U0"]
    if staged:
        cmd.append("--cached")
    cmd.append("HEAD")

    status, code, out, _ = run_cmd(cmd, repo_root, timeout_s=15)
    added: dict[str, set[int]] = {}
    if status != "ok" or code != 0:
        return added

    current_file: str | None = None
    for line in out.splitlines():
        if line.startswith("+++ "):
            path = unquote_git_path(line[4:].strip())
            if path == "/dev/null":
                current_file = None
            elif path.startswith("b/"):
                current_file = path[2:]
            else:
                current_file = path
        elif line.startswith("@@") and current_file is not None:
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if not match:
                continue
            start = int(match.group(1))
            count = int(match.group(2)) if match.group(2) is not None else 1
            for num in range(start, start + count):
                added.setdefault(current_file, set()).add(num)
    return added


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
    parser.add_argument("--json", action="store_true", help="Emit the machine-readable result to stdout")
    parser.add_argument(
        "--list-tools",
        action="store_true",
        help="List amplifier tools (applicable/installed) for the scope, then exit without scanning",
    )
    parser.add_argument(
        "--introduced-only",
        action="store_true",
        help="Restrict the recommendation to findings introduced by the change (needs --changes/--staged)",
    )
    parser.add_argument("--report-dir", default="scratchpads", help="Report directory")
    parser.add_argument("--max-file-kb", type=int, default=512, help="Max file size to scan (KB)")
    args = parser.parse_args(argv)
    if args.introduced_only and not (args.changes or args.staged):
        parser.error("--introduced-only requires --changes or --staged")
    return args


def resolve_suppression(
    marker: tuple[str, str],
    line_findings: list[Finding],
    line: str,
    idx: int,
    rel: str,
    in_tests: bool,
) -> tuple[list[Finding], Suppression]:
    """Apply a `security-ok` marker to one line's findings.

    Returns the line's effective findings and the suppression record:
    - matched finding + reason: drop it, record honored.
    - matched finding + no reason: keep a synthesized `suppression-without-reason`
      finding in its place, record rejected (missing_reason).
    - no matched finding: keep the findings unchanged, record rejected
      (no_matching_finding).
    """
    rule_id, reason = marker
    match = next((f for f in line_findings if f.rule_id == rule_id), None)

    if match is not None and reason:
        kept = [f for f in line_findings if f is not match]
        return kept, Suppression(
            status="honored",
            rule_id=rule_id,
            file=rel,
            line=idx,
            reason=reason,
            fingerprint=fingerprint(match.rule_id, match.file, match.evidence),
        )

    if match is not None:
        without_reason = Finding(
            severity="medium",
            category="suppression",
            title="Suppression without a reason",
            cwe="CWE-710",
            file=rel,
            line=idx,
            evidence=line.strip()[:220],
            risk="A reasonless suppression can silently hide a real vulnerability from review.",
            fix="Add a concrete justification: `# security-ok: <rule-id> <reason>`.",
            confidence="high",
            rule_id="suppression-without-reason",
            in_tests=in_tests,
        )
        return line_findings + [without_reason], Suppression(
            status="rejected",
            rule_id=rule_id,
            file=rel,
            line=idx,
            reason="",
            reason_code="missing_reason",
        )

    return line_findings, Suppression(
        status="rejected",
        rule_id=rule_id,
        file=rel,
        line=idx,
        reason=reason,
        reason_code="no_matching_finding",
    )


def scan_file(
    path: Path, compiled_rules: list[tuple[Rule, re.Pattern[str]]], repo_root: Path
) -> tuple[list[Finding], list[Suppression]]:
    findings: list[Finding] = []
    suppressions: list[Suppression] = []
    seen: set[tuple[str, int, str]] = set()

    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return findings, suppressions

    rel = str(path.relative_to(repo_root)) if path.is_relative_to(repo_root) else str(path)
    in_tests = is_test_path(rel)
    lines = text.splitlines()

    for idx, line in enumerate(lines, start=1):
        line_findings: list[Finding] = []
        for rule, pattern in compiled_rules:
            if not pattern.search(line):
                continue
            key = (rule.id, idx, line.strip())
            if key in seen:
                continue
            seen.add(key)
            line_findings.append(
                Finding(
                    severity=rule.severity,
                    category=rule.category,
                    title=rule.title,
                    cwe=rule.cwe,
                    file=rel,
                    line=idx,
                    evidence=line.strip()[:220],
                    risk=rule.risk,
                    fix=rule.fix,
                    confidence=rule.confidence,
                    rule_id=rule.id,
                    in_tests=in_tests,
                )
            )

        marker = parse_suppression(line)
        if marker is not None:
            line_findings, suppression = resolve_suppression(marker, line_findings, line, idx, rel, in_tests)
            suppressions.append(suppression)

        findings.extend(line_findings)

    return findings, suppressions


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

    severities = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    results = payload.get("results") if isinstance(payload, dict) else None
    if isinstance(results, list):
        for result in results:
            advisory = result.get("advisory") if isinstance(result, dict) else None
            if not isinstance(advisory, dict):
                continue
            criticality = advisory.get("criticality")
            severity = criticality if criticality in severities else "high"
            severities[severity] += 1

        current_results = {severity: count for severity, count in severities.items() if count > 0}
        if current_results:
            return current_results

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
        checks.append(("bundle-audit", ["bundle", "exec", "bundle-audit", "check", "--format", "json"], "Ruby dependency audit"))

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
                    rule_id="dependency-audit",
                )
            )

    return (results, findings, failures)


# ---------------------------------------------------------------------------
# Amplifier registry (task #25). A declarative table of optional external
# scanners. Detection and invocation iterate AMPLIFIERS mechanically: adding a
# language is appending one Amplifier row plus its `parse` function, with no
# edit to the scan/attribution loop. Every field is DATA except `parse` (each
# tool's output format is genuinely different). Amplifiers are optional: their
# absence is informational, never coverage debt.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Amplifier:
    name: str  # engine name; used for attribution and the fixture filename
    extensions: frozenset[str]  # applies if any in-scope file carries one
    manifests: tuple[str, ...]  # applies if any exists at repo root
    command: tuple[str, ...]  # argv template; scan targets are appended
    parse: Callable[[str, dict[str, str]], "list[Finding] | None"]  # (stdout, severity_map); None => parse failure
    severity_map: dict[str, str]  # tool severity token -> scanner band
    timeout: int


SHELLCHECK_SEVERITY = {"error": "high", "warning": "medium", "info": "low", "style": "low"}
SEMGREP_SEVERITY = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
GITLEAKS_SEVERITY = {"secret": "critical"}


def amplifier_finding(
    engine: str,
    rule_id: str,
    category: str,
    severity: str,
    cwe: str,
    title: str,
    file: str,
    line: int,
    evidence: str,
) -> Finding:
    """Build an ordinary Finding from an amplifier result.

    Amplifier findings differ from builtin findings only in their `rule_id`
    prefix and the engine attributed to their category; they otherwise flow
    through the same counts / recommendation / report machinery.
    """
    return Finding(
        severity=severity,
        category=category,
        title=title or f"{engine} finding",
        cwe=cwe,
        file=file or engine,
        line=line,
        evidence=(evidence or "")[:220],
        risk=f"Reported by the {engine} engine.",
        fix=f"Review the {engine} finding and remediate the underlying issue.",
        confidence="medium",
        rule_id=rule_id,
        in_tests=False,
    )


def _load_json(text: str) -> Any:
    """Parse JSON, returning None on any error so a parser degrades, never raises."""
    try:
        return json.loads(text)
    except Exception:
        return None


def _positive_line(value: Any) -> int | None:
    """Return a positive JSON integer line number, rejecting booleans."""
    return value if type(value) is int and value > 0 else None


def _nonempty_str(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value


def parse_shellcheck(stdout: str, severity_map: dict[str, str]) -> "list[Finding] | None":
    """Parse shellcheck `--format=json` output. Defensive: returns None on drift."""
    payload = _load_json(stdout)
    # `--format=json` is a bare array; `--format=json1` wraps in {"comments": [...]}.
    if isinstance(payload, dict):
        payload = payload.get("comments")
    if not isinstance(payload, list):
        return None
    findings: list[Finding] = []
    for item in payload:
        if not isinstance(item, dict):
            return None
        file = _nonempty_str(item.get("file"))
        message = _nonempty_str(item.get("message"))
        code_val = item.get("code")
        line = _positive_line(item.get("line"))
        severity = severity_map.get(str(item.get("level", "")).lower())
        if (
            file is None
            or message is None
            or severity is None
            or type(code_val) is not int
            or code_val <= 0
            or line is None
        ):
            return None
        findings.append(
            amplifier_finding(
                "shellcheck",
                f"shellcheck-SC{code_val}",
                "injection_command",
                severity,
                "CWE-710",
                message,
                file,
                line,
                message,
            )
        )
    return findings


def parse_gitleaks(stdout: str, severity_map: dict[str, str]) -> "list[Finding] | None":
    """Parse gitleaks JSON report output. Defensive: returns None on drift.

    Every gitleaks hit is a secret, so severity comes from the row's map under
    the fixed `secret` key (falling back to critical), keeping the band editable
    in the declarative table like the other parsers.
    """
    payload = _load_json(stdout)
    if not isinstance(payload, list):
        return None
    severity = severity_map.get("secret", "critical")
    findings: list[Finding] = []
    for item in payload:
        if not isinstance(item, dict):
            return None
        file = _nonempty_str(item.get("File"))
        line = _positive_line(item.get("StartLine"))
        rule = _nonempty_str(item.get("RuleID"))
        description = _nonempty_str(item.get("Description"))
        match = _nonempty_str(item.get("Match"))
        if file is None or rule is None or description is None or match is None or line is None:
            return None
        findings.append(
            amplifier_finding(
                "gitleaks",
                f"gitleaks-{rule}",
                "secrets",
                severity,
                "CWE-798",
                description,
                file,
                line,
                match,
            )
        )
    return findings


def parse_semgrep(stdout: str, severity_map: dict[str, str]) -> "list[Finding] | None":
    """Parse semgrep `--json` output. Defensive: returns None on drift."""
    payload = _load_json(stdout)
    if not isinstance(payload, dict):
        return None
    results = payload.get("results")
    if not isinstance(results, list):
        return None
    findings: list[Finding] = []
    for item in results:
        if not isinstance(item, dict):
            return None
        extra = item.get("extra")
        start = item.get("start")
        if not isinstance(extra, dict) or not isinstance(start, dict):
            return None
        path = _nonempty_str(item.get("path"))
        line = _positive_line(start.get("line"))
        severity = severity_map.get(str(extra.get("severity", "")).upper())
        check = _nonempty_str(item.get("check_id"))
        message = _nonempty_str(extra.get("message"))
        if path is None or severity is None or line is None or check is None or message is None:
            return None
        findings.append(
            amplifier_finding(
                "semgrep",
                f"semgrep-{check}",
                "dynamic_execution",
                severity,
                "CWE-95",
                message,
                path,
                line,
                message,
            )
        )
    return findings


AMPLIFIERS: list[Amplifier] = [
    Amplifier(
        name="shellcheck",
        extensions=frozenset({".sh", ".bash", ".zsh"}),
        manifests=(),
        command=("shellcheck", "--format=json"),
        parse=parse_shellcheck,
        severity_map=SHELLCHECK_SEVERITY,
        timeout=60,
    ),
    Amplifier(
        name="gitleaks",
        extensions=frozenset(),
        manifests=(".git",),
        command=("gitleaks", "detect", "--no-banner", "--report-format", "json", "--report-path", "/dev/stdout", "--source"),
        parse=parse_gitleaks,
        severity_map=GITLEAKS_SEVERITY,
        timeout=90,
    ),
    Amplifier(
        name="semgrep",
        extensions=frozenset({".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rb", ".java", ".php"}),
        manifests=(),
        command=("semgrep", "--json", "--quiet", "--config", "auto"),
        parse=parse_semgrep,
        severity_map=SEMGREP_SEVERITY,
        timeout=120,
    ),
]


def amplifier_fixtures_dir() -> Path | None:
    """The test-only recorded-output seam.

    When JEFF_SECURITY_ENGINE_FIXTURES points at a directory, an engine E is
    treated as installed iff `<dir>/E.json` exists, and that file is read as E's
    recorded stdout INSTEAD of invoking the binary. Strictly read-only and inert
    when unset: production resolves installed-ness via `shutil.which` and invokes
    the real tool. The engine name always comes from the fixed AMPLIFIERS table,
    never from traversing the directory.
    """
    val = os.environ.get("JEFF_SECURITY_ENGINE_FIXTURES")
    return Path(val) if val else None


def amplifier_applies(row: Amplifier, exts_in_scope: set[str], repo_root: Path) -> bool:
    if row.extensions & exts_in_scope:
        return True
    return any((repo_root / manifest).exists() for manifest in row.manifests)


def engine_installed(row: Amplifier, fixtures_dir: Path | None) -> bool:
    if fixtures_dir is not None:
        return (fixtures_dir / f"{row.name}.json").exists()
    return shutil_which(row.command[0]) is not None


def amplifier_argv(row: Amplifier, files: list[Path], repo_root: Path) -> list[str]:
    targets = [str(f) for f in files if f.suffix.lower() in row.extensions]
    if not targets:  # manifest-based engines (gitleaks) scan the repo root
        targets = [str(repo_root)]
    return list(row.command) + targets


def repo_relative_file(file: str, repo_root: Path) -> str:
    path = Path(file)
    if not path.is_absolute():
        return str(path)
    try:
        return str(path.resolve().relative_to(repo_root.resolve()))
    except (OSError, ValueError):
        return file


def run_amplifier(
    row: Amplifier, files: list[Path], repo_root: Path, fixtures_dir: Path | None
) -> tuple[list[Finding], str, str]:
    """Run one applicable+installed amplifier and parse its output.

    Returns (findings, status, detail). Status is one of `active`,
    `parse_failure`, `timeout`. Never raises: any drift degrades to an
    informational status. When the fixture seam is set the recorded output
    replaces invocation; otherwise the binary runs via `run_cmd` with the row's
    timeout.
    """
    if fixtures_dir is not None:
        if (fixtures_dir / f"{row.name}.timeout").exists():
            return [], "timeout", "recorded timeout marker"
        try:
            stdout = (fixtures_dir / f"{row.name}.json").read_text(encoding="utf-8", errors="replace")
        except OSError:
            return [], "parse_failure", "unreadable fixture"
        exit_path = fixtures_dir / f"{row.name}.exit"
        code = 0
        if exit_path.exists():
            try:
                code = int(exit_path.read_text(encoding="utf-8", errors="replace").strip() or "0")
            except ValueError:
                code = 0
    else:
        status, code, stdout, _ = run_cmd(amplifier_argv(row, files, repo_root), repo_root, timeout_s=row.timeout)
        if status == "missing":
            return [], "absent", "not installed"
        if status == "timeout":
            return [], "timeout", "tool timed out"

    # Exit 0 (clean) and 1 (findings reported) are normal for these tools; any
    # other code means the tool itself errored, not a finding set.
    if code not in (0, 1):
        return [], "parse_failure", f"tool exited with {code}"

    try:
        parsed = row.parse(stdout, row.severity_map)
    except Exception as exc:  # defensive: a parser must never abort the audit
        return [], "parse_failure", f"parser error: {exc}"[:200]
    if parsed is None:
        return [], "parse_failure", "unrecognized tool output"
    return parsed, "active", f"{len(parsed)} finding(s)"


def _ledger_row(name: str, applicable: bool, installed: bool, status: str, detail: str) -> dict[str, Any]:
    """One tool-status ledger line; the single shape shared by every branch."""
    return {"name": name, "applicable": applicable, "installed": installed, "status": status, "detail": detail}


def run_amplifiers(
    files: list[Path], repo_root: Path
) -> tuple[list[Finding], list[dict[str, Any]], dict[str, set[str]]]:
    """Run every applicable+installed amplifier, building the tool-status ledger.

    Returns (findings, tools_ledger, engine_contributions). An applicable but
    absent tool is an informational ledger line only: it never contributes a
    finding, never appears in a category's engines[], and never becomes debt.
    """
    exts = {p.suffix.lower() for p in files}
    fixtures_dir = amplifier_fixtures_dir()
    ledger: list[dict[str, Any]] = []
    findings: list[Finding] = []
    contributions: dict[str, set[str]] = {}

    for row in AMPLIFIERS:
        applicable = amplifier_applies(row, exts, repo_root)
        installed = engine_installed(row, fixtures_dir)
        if not applicable:
            ledger.append(_ledger_row(row.name, False, installed, "not_applicable", ""))
            continue
        if not installed:
            ledger.append(_ledger_row(row.name, True, False, "absent", "applicable but not installed"))
            continue
        row_findings, status, detail = run_amplifier(row, files, repo_root, fixtures_dir)
        for finding in row_findings:
            finding.file = repo_relative_file(finding.file, repo_root)
            finding.in_tests = is_test_path(finding.file)
            contributions.setdefault(finding.category, set()).add(row.name)
        findings.extend(row_findings)
        ledger.append(_ledger_row(row.name, True, True, status, detail))

    return findings, ledger, contributions


def list_tools_result(files: list[Path], repo_root: Path) -> dict[str, Any]:
    """Read-only `--list-tools` payload: applicable/installed per registry tool."""
    exts = {p.suffix.lower() for p in files}
    fixtures_dir = amplifier_fixtures_dir()
    tools = [
        {
            "name": row.name,
            "applicable": amplifier_applies(row, exts, repo_root),
            "installed": engine_installed(row, fixtures_dir),
        }
        for row in AMPLIFIERS
    ]
    return {"tools": tools}


def make_recommendation(
    counts: dict[str, int],
    audit_failures: int,
    strict: bool,
) -> str:
    if counts.get("critical", 0) > 0:
        return "BLOCK"

    has_findings = sum(counts.values()) > 0
    # not_covered now means "no applicable file in scope" (inapplicable), which
    # is informational, not debt. Only real audit failures remain coverage debt.
    has_debt = audit_failures > 0

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


def fingerprint(rule_id: str, file: str, evidence: str) -> str:
    """Stable finding identity: sha256(rule_id, file, normalized evidence) truncated.

    Evidence is whitespace-collapsed and the line number is excluded by
    construction, so the fingerprint survives a within-file move and stays
    distinct across a different rule, file, or evidence.
    """
    normalized_evidence = re.sub(r"\s+", " ", evidence).strip()
    raw = f"{rule_id}\x1f{file}\x1f{normalized_evidence}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def sanitize_md(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def sort_findings(findings: list[Finding]) -> list[Finding]:
    """Order findings by severity, then category, file, and line."""
    return sorted(
        findings,
        key=lambda f: (SEVERITY_ORDER.get(f.severity, 99), f.category, f.file, f.line),
    )


def count_severities(findings: list[Finding]) -> dict[str, int]:
    """Tally findings into the four severity buckets, ignoring any other value."""
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for finding in findings:
        if finding.severity in counts:
            counts[finding.severity] += 1
    return counts


def exit_code(recommendation: str) -> int:
    """Process exit code for a recommendation: BLOCK is 2, REVIEW is 1, PASS is 0."""
    if recommendation == "BLOCK":
        return 2
    if recommendation == "REVIEW":
        return 1
    return 0


def write_report(
    report_path: Path,
    scope: str,
    files_scanned: int,
    findings: list[Finding],
    coverage: dict[str, dict[str, Any]],
    suppressions: list[Suppression],
    dep_results: list[DependencyAuditResult],
    recommendation: str,
    strict: bool,
    audit_failures: int,
    risk_points: int,
    tools: list[dict[str, Any]] | None = None,
) -> None:
    sorted_findings = sort_findings(findings)
    counts = count_severities(findings)

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
    lines.append("| Category | Status | Engines |")
    lines.append("|---|---|---|")
    for category in sorted(coverage.keys()):
        entry = coverage[category]
        engines = ", ".join(entry.get("engines", [])) or "none"
        lines.append(f"| `{category}` | `{entry['status']}` | `{engines}` |")
    lines.append("")

    lines.append("## Amplifier Tools")
    if tools:
        lines.append("| Tool | Applicable | Installed | Status | Detail |")
        lines.append("|---|---|---|---|---|")
        for tool in tools:
            lines.append(
                "| "
                + " | ".join(
                    [
                        sanitize_md(str(tool.get("name", ""))),
                        str(tool.get("applicable", False)).lower(),
                        str(tool.get("installed", False)).lower(),
                        sanitize_md(str(tool.get("status", ""))),
                        sanitize_md(str(tool.get("detail", ""))),
                    ]
                )
                + " |"
            )
        lines.append("")
        lines.append(
            "_Amplifier tools are optional external scanners. An applicable but absent "
            "tool is informational only, never coverage debt._"
        )
    else:
        lines.append("- No amplifier tools applicable to this scope.")
    lines.append("")

    lines.append("## Suppressions")
    if suppressions:
        lines.append("| Status | Rule | File | Line | Reason code | Reason |")
        lines.append("|---|---|---|---|---|---|")
        for s in suppressions:
            lines.append(
                "| "
                + " | ".join(
                    [
                        sanitize_md(s.status),
                        sanitize_md(s.rule_id),
                        sanitize_md(s.file),
                        str(s.line),
                        sanitize_md(s.reason_code or ""),
                        sanitize_md(s.reason or ""),
                    ]
                )
                + " |"
            )
    else:
        lines.append("- No suppression markers found.")
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
            lines.append(f"- Fingerprint: `{fingerprint(finding.rule_id, finding.file, finding.evidence)}`")
            lines.append(f"- CWE: {finding.cwe}")
            lines.append(f"- File: `{finding.file}:{finding.line}`")
            lines.append(f"- Category: `{finding.category}`")
            lines.append(f"- In tests: `{str(finding.in_tests).lower()}`")
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

    if args.list_tools:
        # Read-only mode: report applicability/installed per registry tool and
        # exit. No scan, no findings, no report file written.
        print(json.dumps(list_tools_result(files, repo_root), indent=2))
        return 0

    if not files and not args.force:
        notice = "No scannable files resolved for security review. Use --force to emit an empty audit report."
        print(notice, file=sys.stderr if args.json else sys.stdout)
        return 0

    compiled_rules = [(rule, re.compile(rule.regex)) for rule in RULES]

    findings: list[Finding] = []
    suppressions: list[Suppression] = []
    coverage_hits = {category: 0 for category in CATEGORIES}
    coverage_eval = {category: False for category in CATEGORIES}

    for path in files:
        file_findings, file_suppressions = scan_file(path, compiled_rules, repo_root)
        findings.extend(file_findings)
        suppressions.extend(file_suppressions)

        # A category is evaluated only for files whose class it applies to, so a
        # category with no applicable file in scope stays not_covered.
        cls = file_class(path)
        for category in CATEGORIES:
            if cls in CATEGORY_APPLICABILITY.get(category, _ALL_CODE):
                coverage_eval[category] = True

    # Amplifiers: run every applicable+installed external engine. Their findings
    # are ordinary Findings; absence is informational (recorded in tools_ledger),
    # never coverage debt and never a recommendation downgrade.
    amp_findings, tools_ledger, engine_contributions = run_amplifiers(files, repo_root)
    findings.extend(amp_findings)

    for finding in findings:
        if finding.category in coverage_hits:
            coverage_hits[finding.category] += 1

    # Coverage-honesty fix (Audit-F1): a hit proves the category was evaluated,
    # even when no file of its applicable class was in scope. Scanning stays
    # ungated; only the ledger label changes.
    for category in CATEGORIES:
        if coverage_hits.get(category, 0) > 0:
            coverage_eval[category] = True

    dep_results, dep_findings, audit_failures = run_dependency_audits(repo_root, args.skip_deps)
    findings.extend(dep_findings)

    if args.changes or args.staged:
        added = added_lines_by_file(repo_root, args.staged)
        for finding in findings:
            if finding.category == "dependency_audit":
                finding.introduced = False
            else:
                finding.introduced = finding.line in added.get(finding.file, set())

    counts = count_severities(findings)

    coverage_status: dict[str, dict[str, Any]] = {}
    for category in CATEGORIES:
        if not coverage_eval.get(category, False):
            coverage_status[category] = {"status": "not_covered", "engines": []}
            continue
        contributed = sorted(engine_contributions.get(category, set()))
        status = "covered_with_hits" if coverage_hits.get(category, 0) > 0 else "covered_no_hits"
        coverage_status[category] = {"status": status, "engines": list(COVERAGE_ENGINES) + contributed}

    uncovered = sum(1 for v in coverage_status.values() if v["status"] == "not_covered")

    risk_weights = {"critical": 25, "high": 10, "medium": 4, "low": 1}
    risk_points = sum(counts[level] * weight for level, weight in risk_weights.items())
    risk_points += audit_failures * 8

    if args.introduced_only:
        introduced_counts = count_severities([f for f in findings if f.introduced])
        recommendation = make_recommendation(introduced_counts, 0, args.strict)
    else:
        recommendation = make_recommendation(counts, audit_failures, args.strict)

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
        suppressions=suppressions,
        dep_results=dep_results,
        recommendation=recommendation,
        strict=args.strict,
        audit_failures=audit_failures,
        risk_points=risk_points,
        tools=tools_ledger,
    )

    total = sum(counts.values())

    if args.json:
        include_introduced = args.changes or args.staged
        sorted_findings = sort_findings(findings)
        findings_json: list[dict[str, Any]] = []
        for finding in sorted_findings:
            entry: dict[str, Any] = {
                "fingerprint": fingerprint(finding.rule_id, finding.file, finding.evidence),
                "rule_id": finding.rule_id,
                "category": finding.category,
                "severity": finding.severity,
                "cwe": finding.cwe,
                "title": finding.title,
                "file": finding.file,
                "line": finding.line,
                "evidence": finding.evidence,
                "confidence": finding.confidence,
                "in_tests": finding.in_tests,
            }
            if include_introduced:
                entry["introduced"] = finding.introduced
            findings_json.append(entry)

        suppressions_json: list[dict[str, Any]] = []
        for s in suppressions:
            sup_entry: dict[str, Any] = {
                "status": s.status,
                "rule_id": s.rule_id,
                "file": s.file,
                "line": s.line,
                "reason": s.reason,
            }
            if s.fingerprint is not None:
                sup_entry["fingerprint"] = s.fingerprint
            if s.reason_code is not None:
                sup_entry["reason_code"] = s.reason_code
            suppressions_json.append(sup_entry)

        counts_obj: dict[str, Any] = {"total": total, "by_severity": dict(counts)}
        if include_introduced:
            introduced_total = sum(1 for f in findings if f.introduced)
            counts_obj["introduced"] = introduced_total
            counts_obj["pre_existing"] = total - introduced_total

        result = {
            "schema_version": 1,
            "scope": resolved_scope,
            "introduced_only": args.introduced_only,
            "files_scanned": len(files),
            "findings": findings_json,
            "suppressions": suppressions_json,
            "coverage": coverage_status,
            "tools": tools_ledger,
            "counts": counts_obj,
            "recommendation": recommendation,
            "risk_points": risk_points,
            "strict": args.strict,
            "report_path": str(report_path),
        }
        print(json.dumps(result, indent=2))
        return exit_code(recommendation)

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

    return exit_code(recommendation)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
