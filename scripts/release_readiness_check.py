import json
import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


ALLOWED_SQLITE_REFERENCES = {
    "database.py",
    "db_init.py",
    "migrate_sqlite_to_pg.py",
    "audit_postgres.py",
    "backfill_geo.py",
    "fix_map_data.py",
    "robust_db_audit.py",
    "verify_geo_direct.py",
    "verify_postgres_fix.py",
}


def load_env_file():
    env_path = ROOT / ".env"
    values = {}
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def scan_unexpected_sqlite_refs():
    findings = []
    patterns = [
        re.compile(r"\bsqlite3\b", re.IGNORECASE),
        re.compile(r"\bsqlite_master\b", re.IGNORECASE),
        re.compile(r"\bINSERT\s+OR\s+(REPLACE|IGNORE)\b", re.IGNORECASE),
        re.compile(r"\bPRAGMA\s+", re.IGNORECASE),
    ]
    for folder in ["app.py", "routes", "services", "scripts"]:
        path = ROOT / folder
        files = [path] if path.is_file() else list(path.rglob("*.py"))
        for file_path in files:
            rel = file_path.relative_to(ROOT).as_posix()
            if file_path.name in ALLOWED_SQLITE_REFERENCES:
                continue
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            for lineno, line in enumerate(text.splitlines(), start=1):
                if any(pattern.search(line) for pattern in patterns):
                    findings.append({"file": rel, "line": lineno, "text": line.strip()[:160]})
    return findings


def main():
    env_values = load_env_file()
    db_type = os.environ.get("DB_TYPE") or env_values.get("DB_TYPE") or ""
    database_url = os.environ.get("DATABASE_URL") or env_values.get("DATABASE_URL") or ""
    postgres_configured = db_type.lower() == "postgres" or database_url.startswith(("postgres://", "postgresql://"))

    sqlite_refs = scan_unexpected_sqlite_refs()
    checks = [
        {
            "name": "postgres_config",
            "ok": postgres_configured,
            "message": "DB_TYPE=postgres 或 DATABASE_URL=postgresql:// 已配置" if postgres_configured else "未检测到 PostgreSQL 配置",
        },
        {
            "name": "no_unexpected_sqlite_runtime_refs",
            "ok": not sqlite_refs,
            "message": "业务运行路径未发现未授权 SQLite 专用语法" if not sqlite_refs else "发现疑似 SQLite 专用语法残留",
            "findings": sqlite_refs[:20],
        },
        {
            "name": "completion_report_exists",
            "ok": (ROOT / "scripts" / "latest_completion_report.md").exists(),
            "message": "完成度报告已生成" if (ROOT / "scripts" / "latest_completion_report.md").exists() else "缺少完成度报告",
        },
    ]

    payload = {
        "summary": {
            "total": len(checks),
            "passed": sum(1 for item in checks if item["ok"]),
            "failed": sum(1 for item in checks if not item["ok"]),
        },
        "checks": checks,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if payload["summary"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
