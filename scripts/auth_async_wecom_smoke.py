import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


APP_REQUIREMENTS = [
    "@app.route('/api/auth/login', methods=['POST'])",
    "@app.route('/api/auth/register', methods=['POST'])",
    "@app.route('/api/auth/me', methods=['GET'])",
    "@app.route('/api/auth/logout', methods=['POST'])",
    "@app.route('/api/users', methods=['GET'])",
    "@app.route('/api/tasks', methods=['GET'])",
    "@app.route('/api/tasks/<task_id>', methods=['GET'])",
    "@app.route('/api/tasks/<task_id>/download', methods=['GET'])",
    "@app.route('/api/tasks/<task_id>/retry', methods=['POST'])",
    "@app.route('/api/tasks/<task_id>/cancel', methods=['POST'])",
    "@app.route('/api/tasks/cleanup-completed', methods=['POST'])",
    "@app.route('/api/projects/<int:project_id>/weekly-report', methods=['POST'])",
    "@app.route('/api/weekly-report/all', methods=['POST'])",
    "@app.route('/api/ai/knowledge/extract/async', methods=['POST'])",
    "@app.route('/api/standup/briefing/async', methods=['POST'])",
    "@app.route('/api/ai/cruise/async', methods=['POST'])",
]

AUTH_FRONTEND_REQUIREMENTS = [
    "function hasPermission(",
    "function applyPermissionGuards(",
    "async function checkAuth(",
    "function showFullPageLogin(",
    "async function doOverlayLogin(",
    "async function doLogin(",
    "async function doRegister(",
    "async function doLogout(",
    "function showWecomLogin(",
    "function startWecomBind(",
]

TASK_CENTER_REQUIREMENTS = [
    "async function loadTasks(",
    "async function retryTask(",
    "async function cancelTask(",
    "async function cleanupCompletedTasks(",
    "function showTaskDetail(",
    "function syncUrlFilters(",
]

WECOM_ROUTE_REQUIREMENTS = [
    "/callback",
    "/config",
    "/jssdk/config",
    "/oauth/login",
    "/oauth/callback",
]


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[AUTH_ASYNC] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    app_text = read(ROOT / "app.py")
    auth_text = read(ROOT / "static/js/auth_hub.js")
    task_center_text = read(ROOT / "templates/task_center.html")
    wecom_routes_text = read(ROOT / "routes/wecom_routes.py")

    failed |= not assert_all_present("app_routes", app_text, APP_REQUIREMENTS)
    failed |= not assert_all_present("auth_frontend", auth_text, AUTH_FRONTEND_REQUIREMENTS)
    failed |= not assert_all_present("task_center", task_center_text, TASK_CENTER_REQUIREMENTS)
    failed |= not assert_all_present("wecom_routes", wecom_routes_text, WECOM_ROUTE_REQUIREMENTS)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
