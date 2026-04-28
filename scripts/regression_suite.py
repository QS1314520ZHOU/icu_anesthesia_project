import argparse
import json
import locale
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MANIFEST_PATH = ROOT / "scripts" / "regression_suite_manifest.json"


def load_manifest():
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    python_targets = payload.get("python_compile_targets", [])
    frontend_targets = payload.get("frontend_syntax_targets", [])
    smoke_suites = payload.get("smoke_suites", [])
    smoke_suite_map = {item["name"]: item for item in smoke_suites}
    return payload, python_targets, frontend_targets, smoke_suites, smoke_suite_map


def run_command(name, command, cwd):
    started = time.time()
    preferred_encoding = locale.getpreferredencoding(False) or "utf-8"
    completed = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding=preferred_encoding,
        errors="replace",
    )
    duration = round(time.time() - started, 3)
    return {
        "name": name,
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "duration_sec": duration,
        "ok": completed.returncode == 0,
    }


def summarize(results):
    return {
        "total": len(results),
        "passed": sum(1 for item in results if item["ok"]),
        "failed": sum(1 for item in results if not item["ok"]),
    }


def build_markdown_report(payload):
    summary = payload["summary"]
    lines = [
        "# Regression Report",
        "",
        f"- Total: **{summary['total']}**",
        f"- Passed: **{summary['passed']}**",
        f"- Failed: **{summary['failed']}**",
        "",
        "| Check | Status | Duration (s) |",
        "| --- | --- | ---: |",
    ]

    for result in payload["results"]:
        status = "OK" if result["ok"] else "FAIL"
        lines.append(f"| `{result['name']}` | {status} | {result['duration_sec']} |")

    completion = next((item for item in payload["results"] if item["name"] == "module_completion" and item["ok"]), None)
    if completion and completion["stdout"].strip():
        try:
            completion_payload = json.loads(completion["stdout"])
            modules = completion_payload.get("modules", [])
        except Exception:
            modules = []
        if modules:
            lines.extend([
                "",
                "## Module Completion",
                "",
                "| Module | Score | Status |",
                "| --- | ---: | --- |",
            ])
            for module in modules:
                lines.append(f"| {module.get('label') or module.get('name')} | {module.get('score')} | {module.get('status')} |")

    readiness = next((item for item in payload["results"] if item["name"] == "release_readiness" and item["ok"]), None)
    if readiness and readiness["stdout"].strip():
        try:
            readiness_payload = json.loads(readiness["stdout"])
            checks = readiness_payload.get("checks", [])
        except Exception:
            checks = []
        if checks:
            lines.extend([
                "",
                "## Release Readiness",
                "",
                "| Check | Status | Message |",
                "| --- | --- | --- |",
            ])
            for check in checks:
                status = "OK" if check.get("ok") else "FAIL"
                message = str(check.get("message") or "").replace("|", "\\|")
                lines.append(f"| `{check.get('name')}` | {status} | {message} |")

    failing = [item for item in payload["results"] if not item["ok"]]
    if failing:
        lines.append("")
        lines.append("## Failures")
        lines.append("")
        for item in failing:
            lines.append(f"### `{item['name']}`")
            lines.append("")
            lines.append(f"- Return code: `{item['returncode']}`")
            lines.append(f"- Command: `{ ' '.join(item['command']) }`")
            if item["stdout"].strip():
                lines.append("")
                lines.append("```text")
                lines.append(item["stdout"].rstrip())
                lines.append("```")
            if item["stderr"].strip():
                lines.append("")
                lines.append("```text")
                lines.append(item["stderr"].rstrip())
                lines.append("```")

    return "\n".join(lines) + "\n"


def print_result_block(result):
    def safe_print(text):
        value = str(text)
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.buffer.write((value + "\n").encode(encoding, errors="replace"))

    prefix = "OK" if result["ok"] else "FAIL"
    safe_print(f"[{prefix}] {result['name']} ({result['duration_sec']}s)")
    if result["stdout"].strip():
        safe_print(result["stdout"].rstrip())
    if result["stderr"].strip():
        safe_print(result["stderr"].rstrip())


def main():
    parser = argparse.ArgumentParser(description="Unified regression suite runner")
    parser.add_argument("--json-out", help="Optional path to write structured JSON results")
    parser.add_argument("--markdown-out", help="Optional path to write markdown summary results")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip node --check frontend syntax checks")
    parser.add_argument("--update-contracts", action="store_true", help="Refresh Form Generator contracts after all checks pass")
    parser.add_argument("--list-suites", action="store_true", help="List available smoke suite names and exit")
    parser.add_argument(
        "--suite",
        action="append",
        dest="suites",
        help="Run only specific smoke suite(s). May be passed multiple times."
    )
    args = parser.parse_args()
    manifest, python_compile_targets, frontend_syntax_targets, smoke_suites, smoke_suite_map = load_manifest()

    if args.list_suites:
        for item in smoke_suites:
            print(item["name"])
        return

    selected_suites = smoke_suites
    if args.suites:
        unknown = [name for name in args.suites if name not in smoke_suite_map]
        if unknown:
            print(json.dumps({
                "error": "unknown_suites",
                "unknown": unknown,
                "available": list(smoke_suite_map.keys())
            }, ensure_ascii=False), file=sys.stderr)
            raise SystemExit(2)
        selected_suites = [smoke_suite_map[name] for name in args.suites]

    os.chdir(ROOT)
    results = []

    compile_result = run_command(
        "python_compile",
        ["python", "-m", "py_compile", *python_compile_targets],
        ROOT,
    )
    results.append(compile_result)
    print_result_block(compile_result)
    if not compile_result["ok"]:
        payload = {"summary": summarize(results), "results": results}
        if args.json_out:
            Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.markdown_out:
            Path(args.markdown_out).write_text(build_markdown_report(payload), encoding="utf-8")
        raise SystemExit(1)

    if not args.skip_frontend:
        node_exists = subprocess.run(["node", "--version"], cwd=ROOT, capture_output=True, text=True).returncode == 0
        if node_exists:
            for target in frontend_syntax_targets:
                result = run_command(f"node_check:{target}", ["node", "--check", target], ROOT)
                results.append(result)
                print_result_block(result)
                if not result["ok"]:
                    payload = {"summary": summarize(results), "results": results}
                    if args.json_out:
                        Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    if args.markdown_out:
                        Path(args.markdown_out).write_text(build_markdown_report(payload), encoding="utf-8")
                    raise SystemExit(1)
        else:
            results.append({
                "name": "frontend_syntax_skipped",
                "command": ["node", "--check", "..."],
                "returncode": 0,
                "stdout": "node not found, frontend syntax checks skipped",
                "stderr": "",
                "duration_sec": 0,
                "ok": True,
            })
            print("[OK] frontend_syntax_skipped (node not found)")

    for suite in selected_suites:
        result = run_command(suite["name"], suite["command"], ROOT)
        results.append(result)
        print_result_block(result)
        if not result["ok"]:
            payload = {"summary": summarize(results), "results": results}
            if args.json_out:
                Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if args.markdown_out:
                Path(args.markdown_out).write_text(build_markdown_report(payload), encoding="utf-8")
            raise SystemExit(1)

    if args.update_contracts:
        update_result = run_command(
            "update_form_generator_contracts",
            ["python", "scripts/form_generator_smoke.py", "--write-contracts"],
            ROOT,
        )
        results.append(update_result)
        print_result_block(update_result)
        if not update_result["ok"]:
            payload = {"summary": summarize(results), "results": results}
            if args.json_out:
                Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if args.markdown_out:
                Path(args.markdown_out).write_text(build_markdown_report(payload), encoding="utf-8")
            raise SystemExit(1)

    payload = {"summary": summarize(results), "results": results}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.markdown_out:
        Path(args.markdown_out).write_text(build_markdown_report(payload), encoding="utf-8")

    print(json.dumps(payload["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
