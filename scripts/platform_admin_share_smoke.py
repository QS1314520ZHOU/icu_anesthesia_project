import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


APP_REQUIREMENTS = [
    "@app.route('/api/projects/<int:project_id>/access', methods=['GET'])",
    "@app.route('/api/projects/<int:project_id>/access', methods=['POST'])",
    "@app.route('/api/projects/<int:project_id>/access/<int:user_id>', methods=['DELETE'])",
    "@app.route('/api/projects/<int:project_id>/share/toggle', methods=['POST'])",
    "@app.route('/share/<string:token>')",
    "@app.route('/api/admin/roles', methods=['GET'])",
    "@app.route('/api/admin/roles', methods=['POST'])",
    "@app.route('/api/admin/ai-configs', methods=['GET'])",
    "@app.route('/api/admin/wecom-config', methods=['GET'])",
    "@app.route('/api/admin/storage/config', methods=['GET'])",
    "@app.route('/api/admin/map-config', methods=['GET'])",
    "@app.route('/api/admin/users/wecom-bindlist', methods=['GET'])",
]

ADMIN_SETTINGS_REQUIREMENTS = [
    "window.openAdminSettings",
    "id=\"tabAiConfig\"",
    "id=\"tabWecomConfig\"",
    "id=\"tabWecomBind\"",
    "id=\"tabPermissions\"",
    "id=\"rolePermissionMatrix\"",
    "id=\"permissionUserList\"",
    "id=\"tabMapConfig\"",
    "id=\"tabStorageConfig\"",
    "fetchRoleDefinitions(",
    "saveRolePermissionMatrix()",
    "loadRolePermissionMatrix()",
    "/admin/ai-configs",
    "/admin/wecom-config",
    "/admin/storage/config",
    "/admin/storage/test-r2",
    "/admin/map-config",
    "/admin/users/wecom-bindlist",
    "/admin/users/${userId}/bind-wecom",
]

ADMIN_HUB_REQUIREMENTS = [
    "async function fetchRoleDefinitions(",
    "function renderRoleMatrixTable(",
    "function buildAdminUserRows(",
    "function showRoleMatrixModal(",
    "async function openUserManagementModal(",
    "async function loadGlobalUsers(",
]

INDEX_REQUIREMENTS = [
    "id=\"adminSettingsBtn\"",
    "id=\"userManagementBtn\"",
    "onclick=\"adminSettings.open()\"",
    "onclick=\"openUserManagementModal()\"",
]

SHARE_TEMPLATE_REQUIREMENTS = [
    "project-title",
    "progress-card",
    "milestone-list",
]


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[PLATFORM] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    app_text = read(ROOT / "app.py")
    admin_settings_text = read(ROOT / "static/js/admin_settings.js")
    admin_hub_text = read(ROOT / "static/js/admin_hub.js")
    index_text = read(ROOT / "templates/index.html")
    share_template_text = read(ROOT / "templates/share_project.html")

    failed |= not assert_all_present("app_routes", app_text, APP_REQUIREMENTS)
    failed |= not assert_all_present("admin_settings", admin_settings_text, ADMIN_SETTINGS_REQUIREMENTS)
    failed |= not assert_all_present("admin_hub", admin_hub_text, ADMIN_HUB_REQUIREMENTS)
    failed |= not assert_all_present("index_entry", index_text, INDEX_REQUIREMENTS)
    failed |= not assert_all_present("share_template", share_template_text, SHARE_TEMPLATE_REQUIREMENTS)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
