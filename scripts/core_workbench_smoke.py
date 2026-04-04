import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


APP_ROUTE_REQUIREMENTS = [
    "@app.route('/')",
    "@app.route('/tasks-center')",
    "@app.route('/api/dashboard/stats', methods=['GET'])",
    "@app.route('/api/dashboard/today-focus', methods=['GET'])",
    "@app.route('/api/approvals/pending', methods=['GET'])",
    "@app.route('/api/resources/overview', methods=['GET'])",
    "@app.route('/api/financial/overview', methods=['GET'])",
]

INDEX_VIEW_REQUIREMENTS = [
    'id="dashboardView"',
    'id="projectDetailView"',
    'id="resourceView"',
    'id="businessView"',
    'id="financialView"',
    'id="approvalView"',
    'id="kbView"',
    'id="assetView"',
    'id="formGeneratorView"',
]

INDEX_ENTRY_REQUIREMENTS = [
    'onclick="showApprovalCenter()"',
    'onclick="showResourceOverview()"',
    'onclick="showBusinessOverview()"',
    'onclick="showFinancialOverview()"',
    'onclick="window.location.href=\'/tasks-center\'"',
]

TASK_CENTER_TEMPLATE_REQUIREMENTS = [
    'id="taskSearch"',
    'id="projectId"',
    'id="status"',
    'id="taskType"',
    'id="taskResultCount"',
    'id="stat-processing"',
    'id="stat-completed"',
    'id="stat-failed"',
    'id="stat-total"',
]

TASK_CENTER_FUNCTION_REQUIREMENTS = [
    "async function loadTasks(",
    "async function retryTask(",
    "async function cancelTask(",
    "async function cleanupCompletedTasks(",
]

DASHBOARD_FUNCTION_REQUIREMENTS = [
    "window.renderAdvancedDashboard = async function",
    "window.showDashboard = async function",
    "window.openBusinessFocus = function",
    "window.openResourceFocus = function",
]

WORKBENCH_FUNCTION_REQUIREMENTS = [
    "window.showApprovalCenter = async function",
    "window.showResourceOverview = async function",
    "window.showBusinessOverview = async function",
    "window.showFinancialOverview = async function",
]


def assert_all_present(label, corpus, required_items):
    missing = [item for item in required_items if item not in corpus]
    print(f"[CORE] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    app_text = read(ROOT / "app.py")
    index_text = read(ROOT / "templates/index.html")
    task_center_text = read(ROOT / "templates/task_center.html")
    dashboard_text = read(ROOT / "static/js/dashboard_hub.js")
    approval_text = read(ROOT / "static/js/approval_hub.js")
    resource_text = read(ROOT / "static/js/resource_hub.js")
    business_text = read(ROOT / "static/js/business_hub.js")
    financial_text = read(ROOT / "static/js/financial_hub.js")

    failed |= not assert_all_present("app_routes", app_text, APP_ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("index_views", index_text, INDEX_VIEW_REQUIREMENTS)
    failed |= not assert_all_present("index_entries", index_text, INDEX_ENTRY_REQUIREMENTS)
    failed |= not assert_all_present("task_center_template", task_center_text, TASK_CENTER_TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("task_center_functions", task_center_text, TASK_CENTER_FUNCTION_REQUIREMENTS)
    failed |= not assert_all_present("dashboard_functions", dashboard_text, DASHBOARD_FUNCTION_REQUIREMENTS)
    failed |= not assert_all_present(
        "workbench_functions",
        "\n".join([approval_text, resource_text, business_text, financial_text]),
        WORKBENCH_FUNCTION_REQUIREMENTS
    )

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
