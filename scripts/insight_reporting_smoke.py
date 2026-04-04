import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


APP_ROUTE_REQUIREMENTS = [
    "@app.route('/api/warnings', methods=['GET'])",
    "@app.route('/api/warnings/count', methods=['GET'])",
    "@app.route('/api/reminders', methods=['GET'])",
    "@app.route('/api/reminders/digest', methods=['GET'])",
    "@app.route('/api/reminders/overdue', methods=['GET'])",
    "@app.route('/api/reminders/upcoming', methods=['GET'])",
    "@app.route('/api/projects/<int:project_id>/report-archive', methods=['GET'])",
    "@app.route('/api/report-archive/<int:archive_id>', methods=['GET'])",
    "@app.route('/api/projects/<int:project_id>/report-archive/generate', methods=['POST'])",
]

INDEX_TEMPLATE_REQUIREMENTS = [
    'id="warningModal"',
    'id="warningList"',
    'id="reminderModal"',
    'id="reminderDigest"',
    'id="reminderListContainer"',
    'id="globalGanttModal"',
    'id="globalGanttChart"',
    'id="globalGanttLegend"',
    'id="mapView"',
]

ALERT_REQUIREMENTS = [
    "window.showWarningCenter = async function",
    "window.loadWarnings = async function",
    "window.renderWarnings = function",
    "window.loadWarningCount = async function",
]

REMINDER_REQUIREMENTS = [
    "window.showReminderCenter = async function",
    "window.loadReminderDigest = async function",
    "window.switchReminderTab = async function",
]

AI_ANALYSIS_REQUIREMENTS = [
    "function callAiAnalysis(",
    "function refreshAiAnalysis(",
    "function renderRadarChart(",
    "function showAiAnalysisHistory(",
]

REPORT_REQUIREMENTS = [
    "function generateWeeklyReport(",
    "function generateAllReport(",
    "function refreshWeeklyReport(",
    "async function loadReportArchive(",
    "async function viewArchiveDetail(",
]

GANTT_REQUIREMENTS = [
    "function renderProjectGantt(",
    "window.showGlobalGanttModal = async function",
    "function renderGanttLegend(",
]

MAP_REQUIREMENTS = [
    "window.showDeliveryMap = function",
]


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[INSIGHT] {label}")
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
    alert_text = read(ROOT / "static/js/alert_hub.js")
    reminder_text = read(ROOT / "static/js/reminder_center_hub.js")
    ai_analysis_text = read(ROOT / "static/js/ai_analysis_hub.js")
    report_text = read(ROOT / "static/js/report_hub.js")
    gantt_text = read(ROOT / "static/js/gantt_hub.js")
    map_text = read(ROOT / "static/js/map_hub.js")

    failed |= not assert_all_present("app_routes", app_text, APP_ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("index_template", index_text, INDEX_TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("alert_hub", alert_text, ALERT_REQUIREMENTS)
    failed |= not assert_all_present("reminder_hub", reminder_text, REMINDER_REQUIREMENTS)
    failed |= not assert_all_present("ai_analysis_hub", ai_analysis_text, AI_ANALYSIS_REQUIREMENTS)
    failed |= not assert_all_present("report_hub", report_text, REPORT_REQUIREMENTS)
    failed |= not assert_all_present("gantt_hub", gantt_text, GANTT_REQUIREMENTS)
    failed |= not assert_all_present("map_hub", map_text, MAP_REQUIREMENTS)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
