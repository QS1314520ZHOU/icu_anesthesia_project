import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


EXPECTED_TABS = [
    "interfaceSpec",
    "financials",
    "gantt",
    "pulse",
    "stages",
    "milestones",
    "team",
    "interfaces",
    "flow",
    "devices",
    "issues",
    "departures",
    "worklogs",
    "documents",
    "expenses",
    "changes",
    "acceptance",
    "satisfaction",
    "communications",
    "dependencies",
    "standup",
    "deviation",
]

EXPECTED_TAB_LOADERS = {
    "pulse": "renderBurndownInDetail",
    "communications": "loadCommunications",
    "flow": "renderInterfaceFlow",
    "standup": "loadStandupData",
    "deviation": "loadDeviationAnalysis",
    "financials": "loadProjectFinancials",
    "dependencies": "loadDependencies",
}

EXPECTED_FRONTEND_FUNCTIONS = [
    "loadProjectDetail",
    "renderProjectDetail",
    "syncCurrentProjectDetailState",
    "refreshProjectDetailSections",
    "renderStages",
    "renderMilestones",
    "renderMembers",
    "renderContacts",
    "renderInterfaces",
    "renderIssues",
    "renderDepartures",
    "saveProject",
    "saveDeparture",
    "saveWorklog",
    "saveExpense",
    "saveChange",
    "saveAcceptance",
    "saveSatisfaction",
]

EXPECTED_BACKEND_ROUTE_FRAGMENTS = [
    "/projects/<int:project_id>/worklogs",
    "/projects/<int:project_id>/documents",
    "/projects/<int:project_id>/expenses",
    "/projects/<int:project_id>/changes",
    "/projects/<int:project_id>/acceptances",
    "/projects/<int:project_id>/satisfaction",
    "/projects/<int:project_id>/dependencies",
    "/projects/<int:project_id>/standup",
    "/projects/<int:project_id>/snapshots",
    "/projects/<int:project_id>/deviation",
    "/projects/<int:project_id>/financials",
    "/api/projects/<int:project_id>/gantt-data",
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check_tabs(render_text: str):
    found_tabs = re.findall(r'id="tab-([A-Za-z0-9_]+)"', render_text)
    found_set = set(found_tabs)
    expected_set = set(EXPECTED_TABS)
    missing = sorted(expected_set - found_set)
    extra = sorted(found_set - expected_set)
    return found_tabs, missing, extra


def check_loader_bindings(hub_text: str):
    missing = []
    for tab, fn_name in EXPECTED_TAB_LOADERS.items():
        if f"tabName === '{tab}'" not in hub_text or fn_name not in hub_text:
            missing.append((tab, fn_name))
    return missing


def check_frontend_functions(texts):
    missing = []
    for fn_name in EXPECTED_FRONTEND_FUNCTIONS:
        exists = any(
            re.search(rf"function\s+{re.escape(fn_name)}\s*\(", text) or
            re.search(rf"window\.{re.escape(fn_name)}\s*=\s*function", text)
            for text in texts
        )
        if not exists:
            missing.append(fn_name)
    return missing


def check_backend_routes(app_text: str, route_texts):
    corpus = "\n".join([app_text] + route_texts)
    missing = [fragment for fragment in EXPECTED_BACKEND_ROUTE_FRAGMENTS if fragment not in corpus]
    return missing


def main():
    render_text = read(ROOT / "static/js/project_detail_render_hub.js")
    hub_text = read(ROOT / "static/js/project_detail_hub.js")
    actions_text = read(ROOT / "static/js/project_detail_actions_hub.js")
    tools_text = read(ROOT / "static/js/project_detail_tools_hub.js")
    app_text = read(ROOT / "app.py")
    route_texts = [read(path) for path in (ROOT / "routes").glob("*.py")]

    found_tabs, missing_tabs, extra_tabs = check_tabs(render_text)
    missing_loader_bindings = check_loader_bindings(hub_text)
    missing_frontend = check_frontend_functions([hub_text, actions_text, render_text, tools_text])
    missing_backend_routes = check_backend_routes(app_text, route_texts)

    failed = False

    print("[PROJECT_DETAIL] tabs")
    print(f"  count: {len(found_tabs)}")
    if missing_tabs or extra_tabs:
        failed = True
        print("  result: FAIL")
        if missing_tabs:
            print(f"  missing_tabs: {missing_tabs}")
        if extra_tabs:
            print(f"  extra_tabs: {extra_tabs}")
    else:
        print("  result: OK")

    print("[PROJECT_DETAIL] tab_loaders")
    if missing_loader_bindings:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_loader_bindings}")
    else:
        print("  result: OK")

    print("[PROJECT_DETAIL] frontend_functions")
    if missing_frontend:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_frontend}")
    else:
        print("  result: OK")

    print("[PROJECT_DETAIL] backend_routes")
    if missing_backend_routes:
        failed = True
        print("  result: FAIL")
        print(f"  missing: {missing_backend_routes}")
    else:
        print("  result: OK")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
