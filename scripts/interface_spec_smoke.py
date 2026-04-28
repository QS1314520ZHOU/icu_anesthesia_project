import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


ROUTE_REQUIREMENTS = [
    "/extract-text",
    "/projects/<int:project_id>/interface-specs/parse",
    "/interface-specs/parse-standard",
    "/interface-specs/load-builtin-standard",
    "/projects/<int:project_id>/interface-specs",
    "/interface-specs/standard",
    "/interface-specs/<int:spec_id>",
    "/projects/<int:project_id>/interface-comparison/run",
    "/projects/<int:project_id>/interface-comparisons",
    "/interface-comparisons/<int:comp_id>/detail",
    "/projects/<int:project_id>/interface-comparison/report",
    "/field-mappings/<int:mapping_id>/confirm",
    "/chat",
]

MODULE_REQUIREMENTS = [
    "const InterfaceSpec = {",
    "async renderTab(",
    "async loadAll(",
    "renderSetupDashboard(",
    "renderMainUI(",
    "async loadOurSpecs(",
    "async loadVendorSpecs(",
    "async loadComparisons(",
    "async runComparison(",
    "use_ai_match: false",
    "cache_hit",
    "async showFieldDetail(",
    "openChatModal: function",
    "exportFieldMappings()",
]

TEMPLATE_REQUIREMENTS = [
    'id="interfaceChatModal"',
    'id="specUploadModal"',
    'id="specUploadTitle"',
    'id="uploadSpecSource"',
    'id="uploadVendorName"',
    'id="specFileInput"',
    'id="specDocText"',
    'id="btnSubmitParse"',
    'id="fieldDetailModal"',
]

PROJECT_DETAIL_REQUIREMENTS = [
    "tabInterfaceSpec",
    "InterfaceSpec.renderTab(currentProjectId)",
]


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[INTERFACE_SPEC] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    routes_text = read(ROOT / "routes/interface_spec_routes.py")
    module_text = read(ROOT / "static/js/modules/interface-spec.js")
    template_text = read(ROOT / "templates/index.html")
    render_text = read(ROOT / "static/js/project_detail_render_hub.js")

    failed |= not assert_all_present("routes", routes_text, ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("module", module_text, MODULE_REQUIREMENTS)
    failed |= not assert_all_present("template", template_text, TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("project_detail_render", render_text, PROJECT_DETAIL_REQUIREMENTS)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
