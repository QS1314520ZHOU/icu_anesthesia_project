import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


APP_ROUTE_REQUIREMENTS = [
    "@app.route('/api/projects/<int:project_id>/communications/analyze', methods=['POST'])",
    "@app.route('/api/projects/<int:project_id>/communications/analyze-file', methods=['POST'])",
    "@app.route('/api/projects/<int:project_id>/ai-retrospective', methods=['POST'])",
    "@app.route('/api/projects/<int:project_id>/ai-task-suggestions', methods=['POST'])",
]

COMMUNICATION_ROUTE_REQUIREMENTS = [
    "/projects/<int:project_id>/communications",
    "/communications/<int:record_id>",
]

COLLAB_ROUTE_REQUIREMENTS = [
    "/snapshot/<int:project_id>",
    "/parse-multi-logs",
    "/meeting-actions",
]

STATIC_TEMPLATE_REQUIREMENTS = [
    'id="communicationModal"',
    'id="communicationModalTitle"',
    'id="meetingAssistantModal"',
    'id="meetingTranscript"',
    'id="meetingResult"',
    'id="meetingResultEmpty"',
    'id="meetingResultActions"',
    'id="meetingSaveDraftPanel"',
    'id="meetingSaveContactPerson"',
    'id="meetingSaveDate"',
    'id="meetingSaveMethod"',
    'id="meetingSaveTitle"',
    'id="meetingSaveIssueSelect"',
    'id="meetingSaveSummary"',
    'id="meetingSaveDraftBtn"',
]

RENDER_TEMPLATE_REQUIREMENTS = [
    'id="communicationsList"',
    'id="communicationAiAnalysis"',
    'id="commFileInput"',
    'onclick="showMeetingAssistant()"',
    'onclick="analyzeCommunications()"',
]

FRONTEND_REQUIREMENTS = [
    "async function populateCommunicationIssueOptions(",
    "async function populateMeetingIssueOptions(",
    "async function showAiRetrospective(",
    "async function showAiTaskSuggestions(",
    "async function loadCommunications(",
    "async function showAddCommunicationModal(",
    "async function saveCommunication(",
    "function filterCommunicationTimeline(",
    "async function copyVisibleCommunications(",
    "async function reAnalyzeCurrentCommunicationSource(",
    "async function saveCommunicationAiAnalysisToRecord(",
    "async function analyzeCommunications(",
    "async function analyzeUploadedFile(",
    "async function copyCommunicationAiAnalysis(",
    "function showMeetingAssistant(",
    "async function extractMeetingActions(",
    "function prefillMeetingSaveDraft(",
    "function buildMeetingCommunicationSummary(",
    "async function saveMeetingToCommunication(",
    "async function copyMeetingAssistantResult(",
]


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[COLLAB] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    app_text = read(ROOT / "app.py")
    communication_routes_text = read(ROOT / "routes/communication_routes.py")
    collab_routes_text = read(ROOT / "routes/collaboration_routes.py")
    template_text = read(ROOT / "templates/index.html")
    render_text = read(ROOT / "static/js/project_detail_render_hub.js")
    frontend_text = read(ROOT / "static/js/collaboration_hub.js")

    failed |= not assert_all_present("app_routes", app_text, APP_ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("communication_routes", communication_routes_text, COMMUNICATION_ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("collab_routes", collab_routes_text, COLLAB_ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("static_template", template_text, STATIC_TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("render_template", render_text, RENDER_TEMPLATE_REQUIREMENTS)
    failed |= not assert_all_present("frontend", frontend_text, FRONTEND_REQUIREMENTS)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
