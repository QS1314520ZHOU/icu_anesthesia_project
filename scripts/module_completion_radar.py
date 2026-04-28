import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


MODULES = [
    {
        "name": "dashboard",
        "label": "Dashboard / Today Focus",
        "files": ["static/js/dashboard_hub.js"],
        "routes": ["/api/dashboard/stats", "/api/dashboard/today-focus", "/api/dashboard/health"],
        "templates": ["dashboardView", "healthDashboard", "showDashboard()"],
        "tests": ["core_workbench"],
    },
    {
        "name": "warning_reminder",
        "label": "Warning / Reminder",
        "files": ["static/js/alert_hub.js", "static/js/reminder_center_hub.js"],
        "routes": ["/api/warnings", "/api/reminders", "/api/reminders/digest"],
        "templates": ["warningModal", "reminderModal", "reminderListContainer"],
        "tests": ["insight_reporting"],
    },
    {
        "name": "approval",
        "label": "Approval Center",
        "files": ["static/js/approval_hub.js"],
        "routes": ["/api/approvals/pending", "/api/approvals/tracking", "/api/approvals/remind"],
        "templates": ["approvalView", "approvalTrackingContainer"],
        "tests": ["core_workbench"],
    },
    {
        "name": "resource_financial_business",
        "label": "Resource / Financial / Business",
        "files": ["static/js/resource_hub.js", "static/js/financial_hub.js", "static/js/business_hub.js"],
        "routes": ["/api/resources/overview", "/api/financial/overview", "/overview"],
        "templates": ["resourceView", "financialView", "businessView"],
        "tests": ["core_workbench"],
    },
    {
        "name": "governance",
        "label": "PMO / Gantt / Map / Risk",
        "files": ["static/js/operations_hub.js", "static/js/analytics_hub.js", "static/js/gantt_hub.js", "static/js/map_hub.js"],
        "routes": ["/overview", "gantt-data", "/api/analytics/trend"],
        "templates": ["pmoModal", "globalGanttChart", "mapView"],
        "tests": ["advanced_governance", "insight_reporting"],
    },
    {
        "name": "project_detail",
        "label": "Project Detail",
        "files": [
            "static/js/project_detail_hub.js",
            "static/js/project_detail_render_hub.js",
            "static/js/project_detail_actions_hub.js",
            "static/js/project_detail_tools_hub.js",
        ],
        "routes": ["/projects/<int:project_id>", "projects/<int:project_id>/issues", "projects/<int:project_id>/documents"],
        "templates": ["projectDetailView", "tabInterfaceSpec", "tab-content"],
        "tests": ["project_detail", "delivery_data_domains"],
    },
    {
        "name": "collaboration",
        "label": "Collaboration / Meeting AI",
        "files": ["static/js/collaboration_hub.js"],
        "routes": ["/projects/<int:project_id>/communications", "/meeting-actions", "/communications/analyze-file"],
        "templates": ["meetingAssistantModal", "communication"],
        "tests": ["collaboration_center"],
    },
    {
        "name": "report_ai_task",
        "label": "Report / AI / Task Center",
        "files": ["static/js/report_hub.js", "static/js/ai_analysis_hub.js", "templates/task_center.html"],
        "routes": ["/api/tasks", "@report_bp.route('/preview'", "@report_bp.route('/export'"],
        "templates": ["taskModal", "aiModal", "reportArchive"],
        "tests": ["insight_reporting", "auth_async_wecom"],
    },
    {
        "name": "alignment_interface",
        "label": "Alignment / Interface Spec",
        "files": ["templates/alignment.html", "static/js/modules/interface-spec.js"],
        "routes": ["/document-chat", "/interface-specs/load-builtin-standard", "interface-comparison/run"],
        "templates": ["doc-chat-box", "interfaceChatModal", "specUploadModal"],
        "tests": ["alignment_center", "interface_spec"],
    },
    {
        "name": "kb_asset_form",
        "label": "Knowledge / Asset / Form Generator",
        "files": ["static/js/kb_management.js", "static/js/asset_management.js", "static/js/form_generator.js"],
        "routes": ["/api/kb", "/assets", "/api/form-generator"],
        "templates": ["kbView", "assetView", "formGeneratorView"],
        "tests": ["auxiliary_surfaces", "form_generator"],
    },
    {
        "name": "admin_mobile_wecom",
        "label": "Admin / Mobile / WeCom",
        "files": ["static/js/admin_settings.js", "static/js/admin_hub.js", "routes/mobile_routes.py", "routes/wecom_routes.py"],
        "routes": ["/api/admin", "/m/", "/wecom"],
        "templates": ["adminSettingsModal", "rolePermissionMatrix", "mobile"],
        "tests": ["platform_admin_share", "auth_async_wecom", "auxiliary_surfaces"],
    },
]


CORPUS_PATHS = [
    "app.py",
    "templates/index.html",
    "templates/alignment.html",
    "templates/task_center.html",
    "static/js",
    "routes",
    "scripts/regression_suite_manifest.json",
    "TEST_CHECKLIST.md",
]


def read_path(path: Path) -> str:
    if path.is_dir():
        suffixes = {".js", ".py", ".html", ".json", ".md"}
        return "\n".join(
            child.read_text(encoding="utf-8", errors="ignore")
            for child in sorted(path.rglob("*"))
            if child.is_file() and child.suffix.lower() in suffixes
        )
    if path.exists():
        return path.read_text(encoding="utf-8", errors="ignore")
    return ""


def build_corpus() -> str:
    return "\n".join(read_path(ROOT / rel) for rel in CORPUS_PATHS)


def check_items(items, corpus):
    return [item for item in items if item not in corpus]


def main():
    corpus = build_corpus()
    rows = []
    failed = False

    for module in MODULES:
        missing_files = [rel for rel in module["files"] if not (ROOT / rel).exists()]
        missing_routes = check_items(module["routes"], corpus)
        missing_templates = check_items(module["templates"], corpus)
        missing_tests = check_items(module["tests"], corpus)
        missing_total = len(missing_files) + len(missing_routes) + len(missing_templates) + len(missing_tests)
        score = max(0, round(100 - missing_total * 12.5))
        status = "OK" if missing_total == 0 else "GAP"
        failed = failed or missing_total > 0
        rows.append({
            "name": module["name"],
            "label": module["label"],
            "score": score,
            "status": status,
            "missing_files": missing_files,
            "missing_routes": missing_routes,
            "missing_templates": missing_templates,
            "missing_tests": missing_tests,
        })

    print(json.dumps({"modules": rows}, ensure_ascii=False, indent=2))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
