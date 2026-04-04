import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


REQUIRED_TEMPLATE_IDS = [
    "align-project",
    "align-spec-version",
    "align-vendor",
    "vendor-upload-zone",
    "vendor-file",
    "vendor-raw-text",
    "btn-run-align",
    "alignment-result-area",
    "align-summary",
    "align-stats",
    "align-table",
    "chat-box",
    "chat-input",
    "panel-specs",
    "spec-version-select",
    "sessions-table",
]

REQUIRED_ROUTE_FRAGMENTS = [
    "/specs/versions",
    "/specs",
    "/specs/import",
    "/parse-vendor",
    "/run",
    "/sessions",
    "/results/<int:result_id>/confirm",
    "/field-maps/<int:map_id>",
    "/ai-assistant",
]

REQUIRED_TEMPLATE_CALLS = [
    "/api/alignment/specs/versions",
    "/api/alignment/specs/import",
    "/api/alignment/run",
    "/api/alignment/sessions",
    "/api/alignment/ai-assistant",
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main():
    app_text = read(ROOT / "app.py")
    route_text = read(ROOT / "routes/alignment_routes.py")
    template_text = read(ROOT / "templates/alignment.html")

    failed = False

    print("[ALIGNMENT] page_route")
    if "@app.route('/alignment')" not in app_text or "render_template('alignment.html')" not in app_text:
        failed = True
        print("  result: FAIL")
    else:
        print("  result: OK")

    print("[ALIGNMENT] api_routes")
    missing_routes = [fragment for fragment in REQUIRED_ROUTE_FRAGMENTS if fragment not in route_text]
    if missing_routes:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_routes}")
    else:
        print("  result: OK")

    print("[ALIGNMENT] template_ids")
    missing_ids = [item for item in REQUIRED_TEMPLATE_IDS if f'id="{item}"' not in template_text]
    if missing_ids:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_ids}")
    else:
        print("  result: OK")

    print("[ALIGNMENT] template_calls")
    missing_calls = [item for item in REQUIRED_TEMPLATE_CALLS if item not in template_text]
    if missing_calls:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_calls}")
    else:
        print("  result: OK")

    tab_count = len(re.findall(r'class="tab-btn', template_text))
    print("[ALIGNMENT] tab_count")
    print(f"  count: {tab_count}")
    if tab_count < 3:
        failed = True
        print("  result: FAIL")
    else:
        print("  result: OK")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
