import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


KB_TEMPLATE_REQUIREMENTS = [
    'id="kbView"',
    'id="kbListContainer"',
    'id="kbSearchInput"',
    'id="kbModal"',
    'id="kbDetailModal"',
]

KB_FRONTEND_REQUIREMENTS = [
    'function initKB(',
    'async function loadKBList(',
    'function openKBModal(',
    'async function saveKBItem(',
    'async function viewKBItem(',
]

KB_BACKEND_REQUIREMENTS = [
    "/api/kb",
    "/api/kb/<int:kid>",
    "/api/kb/<int:kid>/download",
    "/api/ai/ask-kb",
]

ASSET_TEMPLATE_REQUIREMENTS = [
    'id="assetView"',
    'id="assetStatsGrid"',
    'id="assetTableBody"',
    'id="assetModal"',
]

ASSET_FRONTEND_REQUIREMENTS = [
    'function initAssets(',
    'async function loadAssets(',
    'async function openAssetModal(',
    'async function saveAsset(',
    'async function editAsset(',
    'async function changeAssetStatus(',
]

ASSET_BACKEND_REQUIREMENTS = [
    "/assets",
    "/assets/<int:asset_id>",
    "/assets/<int:asset_id>/status",
]

MOBILE_TEMPLATE_FILES = [
    "index.html",
    "knowledge.html",
    "ai_chat.html",
    "briefing.html",
    "quick_log.html",
    "meeting_note.html",
    "daily_report.html",
    "acceptance.html",
]

MOBILE_ROUTE_REQUIREMENTS = [
    "@mobile_bp.route('/')",
    "@mobile_bp.route('/knowledge')",
    "@mobile_bp.route('/chat')",
    "/api/kb/search",
    "/api/ai/chat",
    "/api/project/briefing/<int:project_id>",
    "/api/log/quick",
    "/api/meeting/quick",
    "/api/report/daily/<int:project_id>",
]


def assert_all_present(label, corpus, required_items):
    missing = [item for item in required_items if item not in corpus]
    print(f"[AUX] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    index_template = read(ROOT / "templates/index.html")
    kb_js = read(ROOT / "static/js/kb_management.js")
    asset_js = read(ROOT / "static/js/asset_management.js")
    app_text = read(ROOT / "app.py")
    hardware_routes = read(ROOT / "routes/hardware_routes.py")
    mobile_routes = read(ROOT / "routes/mobile_routes.py")

    failed |= not assert_all_present("kb_template", index_template, KB_TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("kb_frontend", kb_js, KB_FRONTEND_REQUIREMENTS)
    failed |= not assert_all_present("kb_backend", app_text, KB_BACKEND_REQUIREMENTS)

    failed |= not assert_all_present("asset_template", index_template, ASSET_TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("asset_frontend", asset_js, ASSET_FRONTEND_REQUIREMENTS)
    failed |= not assert_all_present("asset_backend", hardware_routes, ASSET_BACKEND_REQUIREMENTS)

    failed |= not assert_all_present("mobile_routes", mobile_routes, MOBILE_ROUTE_REQUIREMENTS)

    print("[AUX] mobile_templates")
    missing_templates = [name for name in MOBILE_TEMPLATE_FILES if not (ROOT / "templates/mobile" / name).exists()]
    if missing_templates:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_templates}")
    else:
        print("  result: OK")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
