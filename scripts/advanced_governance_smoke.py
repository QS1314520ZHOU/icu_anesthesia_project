import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


APP_ROUTE_REQUIREMENTS = [
    "@app.route('/api/analytics/compare', methods=['POST'])",
    "@app.route('/api/analytics/trends', methods=['GET'])",
]

ROUTE_REQUIREMENTS = {
    "routes/pmo_routes.py": [
        "/overview",
        "/summary",
    ],
    "routes/operational_routes.py": [
        "/stage-baselines",
        "/analyze-change",
        "/projects/<int:project_id>/impact-chain",
    ],
    "routes/risk_simulation_routes.py": [
        "/simulate",
        "/countdown/<int:project_id>",
    ],
    "routes/analytics_routes.py": [
        "/api/analytics/overview",
        "/api/analytics/compare",
        "/api/analytics/trend",
        "/api/analytics/geo",
        "/api/analytics/workload",
    ],
}

TEMPLATE_REQUIREMENTS = [
    'id="pmoModal"',
    'id="pmoAiSummary"',
    'id="pmoPortfolioActions"',
    'id="pmoRegionalChart"',
    'id="pmoPmWorkload"',
    'id="riskSimulationModal"',
    'id="simTaskName"',
    'id="simulationResult"',
    'id="impactedTasksList"',
]

FRONTEND_REQUIREMENTS = {
    "static/js/operations_hub.js": [
        "async function openPmoDashboard(",
        "async function loadPmoOverview(",
        "async function loadPmoSummary(",
        "async function loadStageBaselines(",
        "function showDemandAnalysisModal(",
        "async function runDemandAnalysis(",
        "function showRiskSimulationModal(",
        "async function runRiskSimulation(",
    ],
    "static/js/analytics_hub.js": [
        "async function showRiskTrend(",
        "function renderRiskTrendChart(",
        "async function loadProjectPrediction(",
        "function showPredictionDetail(",
        "async function loadProjectFinancials(",
    ],
}


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[ADVANCED] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False

    app_text = read(ROOT / "app.py")
    template_text = read(ROOT / "templates/index.html")

    failed |= not assert_all_present("app_routes", app_text, APP_ROUTE_REQUIREMENTS)
    failed |= not assert_all_present("template", template_text, TEMPLATE_REQUIREMENTS)

    for rel_path, required in ROUTE_REQUIREMENTS.items():
        failed |= not assert_all_present(rel_path, read(ROOT / rel_path), required)

    for rel_path, required in FRONTEND_REQUIREMENTS.items():
        failed |= not assert_all_present(rel_path, read(ROOT / rel_path), required)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
