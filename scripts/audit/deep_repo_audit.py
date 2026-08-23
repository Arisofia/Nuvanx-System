#!/usr/bin/env python3
"""Deterministic whole-repository audit scanner.

Reads every tracked file byte-for-byte, then every decodable text line. When
AUDIT_REF is set, inventory and bytes are read directly from that immutable Git
object rather than the working tree. This proves exact-SHA repository coverage.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from collections import Counter
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "audit-output"
OUT.mkdir(parents=True, exist_ok=True)
AUDIT_REF = os.getenv("AUDIT_REF", "").strip()

CODE_EXTS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".php", ".sh",
    ".sql", ".yml", ".yaml", ".json", ".toml", ".css", ".scss", ".html",
    ".md", ".mmd",
}

PATTERNS: list[tuple[str, str, str, re.Pattern[str]]] = [
    ("critical", "merge_conflict_marker", "Unresolved merge-conflict marker", re.compile(r"^(<<<<<<<|=======|>>>>>>>)(?:\s|$)")),
    ("high", "dynamic_eval", "Dynamic code execution", re.compile(r"\b(?:eval\s*\(|new\s+Function\s*\()")),
    ("high", "unsafe_dom_html", "Unsafe direct HTML sink", re.compile(r"\b(?:dangerouslySetInnerHTML|document\.write\s*\(|\.innerHTML\s*=)")),
    ("high", "shell_pipe_remote", "Remote content piped to shell", re.compile(r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b")),
    ("high", "vite_secret_name", "Secret-like VITE variable would be browser-exposed", re.compile(r"\bVITE_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN)[A-Z0-9_]*\b")),
    ("medium", "cors_wildcard", "Wildcard CORS origin", re.compile(r"Access-Control-Allow-Origin[\"'\s:=>,-]*\*")),
    ("medium", "ts_ignore", "TypeScript diagnostic suppression", re.compile(r"@ts-(?:ignore|nocheck|expect-error)")),
    ("medium", "lint_suppression", "Lint/security suppression", re.compile(r"(?:eslint-disable|deno-lint-ignore|nosec|noqa|phpcs:ignore|shellcheck\s+disable)")),
    ("medium", "swallowed_catch", "Potentially swallowed exception", re.compile(r"catch\s*(?:\([^)]*\))?\s*\{\s*\}")),
    ("medium", "promise_swallow", "Promise rejection intentionally discarded", re.compile(r"\.catch\s*\(\s*\(?[^=)]*\)?\s*=>\s*(?:\{\s*\}|undefined|null|false)\s*\)")),
    ("medium", "unsafe_sql_concat", "Potential SQL string construction", re.compile(r"(?:query|execute|sql)\s*\([^\n]*(?:\+|\$\{)")),
    ("medium", "sql_rls_open", "Potential universally-open RLS predicate", re.compile(r"\b(?:using|with\s+check)\s*\(\s*true\s*\)", re.I)),
    ("medium", "sql_grant_anon", "Database grant to anon", re.compile(r"\bgrant\b[^;\n]*\bto\s+anon\b", re.I)),
    ("low", "todo", "Unresolved TODO/FIXME/HACK/XXX marker", re.compile(r"\b(?:TODO|FIXME|HACK|XXX)\b", re.I)),
    ("low", "console_debug", "Console debug statement", re.compile(r"\bconsole\.(?:log|debug|trace)\s*\(")),
    ("low", "debugger", "Debugger statement", re.compile(r"(^|\s)debugger\s*;")),
    ("low", "plain_http", "Plain HTTP URL outside localhost", re.compile(r"http://(?!localhost\b|127\.0\.0\.1\b|0\.0\.0\.0\b|\[::1\])", re.I)),
]

SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("github_token", re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b")),
    ("supabase_service_role_jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b")),
    ("generic_secret_assignment", re.compile(r"(?i)\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*[\"'][^\"']{16,}[\"']")),
]

EXAMPLE_OR_DOC = re.compile(r"(?:^|/)(?:\.env[^/]*\.example|[^/]*example[^/]*|docs?/)", re.I)


def tracked_files() -> list[str]:
    if AUDIT_REF:
        raw = subprocess.check_output(["git", "ls-tree", "-rz", "--name-only", AUDIT_REF], cwd=ROOT)
    else:
        raw = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    return [p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p]


def read_tracked(rel: str) -> bytes:
    if AUDIT_REF:
        return subprocess.check_output(["git", "show", f"{AUDIT_REF}:{rel}"], cwd=ROOT)
    return (ROOT / rel).read_bytes()


def is_probably_binary(data: bytes) -> bool:
    if not data:
        return False
    if b"\0" in data[:8192]:
        return True
    sample = data[:8192]
    ctrl = sum(1 for b in sample if b < 9 or (13 < b < 32))
    return ctrl / max(1, len(sample)) > 0.05


def severity_rank(s: str) -> int:
    return {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}.get(s, 0)


def finding(severity: str, rule: str, message: str, path: str, line: int | None, text: str = "") -> dict:
    return {
        "severity": severity,
        "rule": rule,
        "message": message,
        "path": path,
        "line": line,
        "excerpt": text.strip()[:500],
    }


def scan_workflow_line(path: str, line_no: int, line: str) -> Iterable[dict]:
    if not path.startswith(".github/") or not path.endswith((".yml", ".yaml")):
        return []
    out: list[dict] = []
    uses = re.search(r"\buses:\s*([^\s#]+)", line)
    if uses:
        ref = uses.group(1)
        if "@" in ref:
            version = ref.rsplit("@", 1)[1]
            if not re.fullmatch(r"[0-9a-fA-F]{40}", version):
                out.append(finding("medium", "action_not_sha_pinned", "GitHub Action is not pinned to a full commit SHA", path, line_no, line))
    if re.search(r"\bpull_request_target\s*:", line):
        out.append(finding("high", "pull_request_target", "pull_request_target requires strict untrusted-code controls", path, line_no, line))
    if re.search(r"\bpermissions\s*:\s*write-all\b", line):
        out.append(finding("high", "workflow_write_all", "Workflow grants write-all permissions", path, line_no, line))
    return out


def main() -> None:
    files = tracked_files()
    manifests: list[dict] = []
    findings: list[dict] = []
    ext_counts: Counter[str] = Counter()
    language_lines: Counter[str] = Counter()
    total_bytes = 0
    total_lines = 0
    text_files = 0
    binary_files = 0

    for rel in files:
        path = Path(rel)
        data = read_tracked(rel)
        total_bytes += len(data)
        sha256 = hashlib.sha256(data).hexdigest()
        ext = path.suffix.lower() or "<none>"
        ext_counts[ext] += 1
        binary = is_probably_binary(data)
        lines_count = 0
        nonempty = 0
        max_line_len = 0
        decode = "binary"

        if binary:
            binary_files += 1
        else:
            try:
                text = data.decode("utf-8")
                decode = "utf-8"
            except UnicodeDecodeError:
                text = data.decode("utf-8", "replace")
                decode = "utf-8-replacement"
                findings.append(finding("low", "invalid_utf8", "Text-like tracked file is not valid UTF-8", rel, None))
            text_files += 1
            lines = text.splitlines()
            lines_count = len(lines)
            total_lines += lines_count
            language_lines[ext] += lines_count
            if ext in CODE_EXTS and lines_count > 2000:
                findings.append(finding("medium", "very_large_code_file", f"Tracked code/config file has {lines_count} lines", rel, None))
            elif ext in CODE_EXTS and lines_count > 1000:
                findings.append(finding("low", "large_code_file", f"Tracked code/config file has {lines_count} lines", rel, None))

            for line_no, line in enumerate(lines, 1):
                if line.strip():
                    nonempty += 1
                max_line_len = max(max_line_len, len(line))
                for sev, rule, msg, rx in PATTERNS:
                    if rx.search(line):
                        findings.append(finding(sev, rule, msg, rel, line_no, line))
                for sec_rule, rx in SECRET_PATTERNS:
                    if rx.search(line) and not EXAMPLE_OR_DOC.search(rel):
                        findings.append(finding("critical", f"secret_{sec_rule}", "Potential committed credential/secret", rel, line_no, line))
                findings.extend(scan_workflow_line(rel, line_no, line))

            if ext == ".sql" and re.search(r"\bsecurity\s+definer\b", text, re.I):
                if not re.search(r"\bset\s+search_path\s*=", text, re.I):
                    findings.append(finding("high", "security_definer_no_search_path", "SQL file contains SECURITY DEFINER without an explicit search_path", rel, None))

            if rel.startswith("frontend/") and re.search(r"SERVICE_ROLE|service[_-]?role", text, re.I):
                findings.append(finding("high", "frontend_service_role_reference", "Frontend source references service-role material", rel, None))

        manifests.append({
            "path": rel,
            "sha256": sha256,
            "bytes": len(data),
            "extension": ext,
            "binary": binary,
            "decode": decode,
            "lines": lines_count,
            "nonempty_lines": nonempty,
            "max_line_length": max_line_len,
        })

    findings.sort(key=lambda f: (-severity_rank(f["severity"]), f["path"], f["line"] or 0, f["rule"]))
    sev_counts = Counter(f["severity"] for f in findings)
    rule_counts = Counter(f["rule"] for f in findings)

    with (OUT / "manifest.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(manifests[0].keys()) if manifests else ["path"])
        writer.writeheader()
        writer.writerows(manifests)

    with (OUT / "findings.jsonl").open("w", encoding="utf-8") as fh:
        for item in findings:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")

    with (OUT / "findings.csv").open("w", newline="", encoding="utf-8") as fh:
        fields = ["severity", "rule", "message", "path", "line", "excerpt"]
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(findings)

    audited_sha = subprocess.check_output(["git", "rev-parse", AUDIT_REF or "HEAD"], cwd=ROOT, text=True).strip()
    summary = {
        "audited_ref": AUDIT_REF or "HEAD",
        "audited_sha": audited_sha,
        "runner_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "tracked_files": len(files),
        "text_files": text_files,
        "binary_files": binary_files,
        "total_bytes": total_bytes,
        "total_text_lines": total_lines,
        "files_by_extension": dict(ext_counts.most_common()),
        "lines_by_extension": dict(language_lines.most_common()),
        "findings_by_severity": dict(sev_counts),
        "findings_by_rule": dict(rule_counts.most_common()),
        "coverage_contract": "Every tracked file in audited_sha was read byte-for-byte; every decodable text file was scanned line-by-line.",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"DEEP_REPO_SCAN=PASS audited_sha={audited_sha} tracked_files={len(files)} text_lines={total_lines} findings={len(findings)}")


if __name__ == "__main__":
    main()
