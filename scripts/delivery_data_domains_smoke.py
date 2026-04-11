import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


ROUTE_REQUIREMENTS = {
    "routes/project_routes.py": [
        "/projects",
        "/projects/<int:project_id>",
        "/projects/<int:project_id>/stages",
        "/projects/<int:project_id>/milestones",
        "/projects/<int:project_id>/interfaces",
        "/projects/<int:project_id>/issues",
        "/projects/<int:project_id>/devices",
        "/projects/<int:project_id>/dependencies",
        "/projects/<int:project_id>/milestones/pending-celebrations",
    ],
    "routes/member_routes.py": [
        "/projects/<int:project_id>/members",
        "/members/<int:member_id>",
        "/projects/<int:project_id>/contacts",
        "/contacts/<int:contact_id>",
    ],
    "routes/log_routes.py": [
        "/projects/<int:project_id>/worklogs",
        "/worklogs/<int:log_id>",
        "/projects/<int:project_id>/worklogs/stats",
        "/projects/<int:project_id>/departures",
        "/departures/<int:departure_id>/return",
    ],
    "routes/doc_routes.py": [
        "/projects/<int:project_id>/documents",
        "/documents/<int:doc_id>/download",
        "/projects/<int:project_id>/expenses",
        "/expenses/<int:expense_id>",
        "/projects/<int:project_id>/expenses/stats",
    ],
    "routes/lifecycle_routes.py": [
        "/projects/<int:project_id>/changes",
        "/changes/<int:change_id>",
        "/projects/<int:project_id>/acceptances",
        "/acceptances/<int:acceptance_id>",
        "/projects/<int:project_id>/satisfaction",
        "/satisfaction/<int:satisfaction_id>",
        "/projects/<int:project_id>/followups",
        "/followups/<int:followup_id>",
    ],
    "routes/task_routes.py": [
        "/stages/<int:stage_id>",
        "/tasks/<int:task_id>/toggle",
        "/stages/<int:stage_id>/tasks",
        "/tasks/<int:task_id>",
        "/issues/<int:issue_id>",
        "/devices/<int:device_id>",
    ],
}


def assert_all_present(label, corpus, required):
    missing = [item for item in required if item not in corpus]
    print(f"[DELIVERY_DATA] {label}")
    if missing:
        print("  result: FAIL")
        print(f"  missing: {missing}")
        return False
    print("  result: OK")
    return True


def main():
    failed = False
    for rel_path, required in ROUTE_REQUIREMENTS.items():
        failed |= not assert_all_present(rel_path, read(ROOT / rel_path), required)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
