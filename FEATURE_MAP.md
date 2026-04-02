# Feature Map

## Main Entrances

- `/`
  - Main dashboard
- `/tasks-center`
  - Task center
- `/alignment`
  - Interface alignment center

## Dashboard Modules

- Dashboard hub
  - File: `static/js/dashboard_hub.js`
  - Covers:
    - dashboard overview
    - cockpit shortcuts
    - today focus cockpit
    - financial snapshot
- Approval hub
  - File: `static/js/approval_hub.js`
  - Covers:
    - pending approvals
    - approval tracking
    - approval search/filter/copy
- Alert hub
  - File: `static/js/alert_hub.js`
  - Covers:
    - warning center
    - warning search/filter
    - warning URL state
- Reminder center hub
  - File: `static/js/reminder_center_hub.js`
  - Covers:
    - reminder center
    - reminder tab switch
    - reminder search
    - reminder URL state
- AI ops hub
  - File: `static/js/ai_ops_hub.js`
  - Covers:
    - AI worklog assistant
    - AI chaser
    - AI NLQ modal
    - KB extraction helper
- Auth hub
  - File: `static/js/auth_hub.js`
  - Covers:
    - auth/session bootstrap
    - login/register helpers
    - full-page login overlay
- Admin hub
  - File: `static/js/admin_hub.js`
  - Covers:
    - global user management
    - password reset helpers
    - AI config management
- Report hub
  - File: `static/js/report_hub.js`
  - Covers:
    - weekly report generation
    - global weekly report generation
    - AI weekly summary insertion
    - report archive list/detail/manual generation
    - project report export
- Project detail hub
  - File: `static/js/project_detail_hub.js`
  - Covers:
    - project detail entry and main rendering
    - stage add/expand helpers
    - detail modal entry helpers
    - high-frequency save handlers
    - delete/update/status handlers
    - tab data loaders for worklogs/documents/expenses/changes/acceptances/satisfaction
    - dependency add/delete/load helpers
    - interface template recommendation / batch import
    - document upload
- Resource hub
  - File: `static/js/resource_hub.js`
  - Covers:
    - resource overview
    - city resource summary
    - member load table
    - member detail
- Financial hub
  - File: `static/js/financial_hub.js`
  - Covers:
    - financial overview
    - monthly trend
    - project financial table
- Map hub
  - File: `static/js/map_hub.js`
  - Covers:
    - delivery map entry
    - map view bootstrapping

## Frontend Workbench Files

- `static/js/dashboard_hub.js`
- `static/js/alert_hub.js`
- `static/js/approval_hub.js`
- `static/js/reminder_center_hub.js`
- `static/js/ai_ops_hub.js`
- `static/js/auth_hub.js`
- `static/js/admin_hub.js`
- `static/js/report_hub.js`
- `static/js/project_detail_hub.js`
- `static/js/resource_hub.js`
- `static/js/financial_hub.js`
- `static/js/map_hub.js`

## Key Backend APIs

### Dashboard

- `GET /api/dashboard/stats`
- `GET /api/dashboard/today-focus`
- `GET /api/dashboard/health`

### Tasks

- `GET /api/tasks`
- `GET /api/tasks/<task_id>`
- `GET /api/tasks/<task_id>/download`
- `POST /api/tasks/<task_id>/retry`
- `POST /api/tasks/cleanup-completed`

### Async task triggers

- `POST /api/projects/<project_id>/ai-analysis`
- `POST /api/projects/<project_id>/weekly-report`
- `POST /api/weekly-report/all`
- `POST /api/ai/knowledge/extract/async`
- `POST /api/standup/briefing/async`
- `POST /api/ai/cruise/async`
- `POST /api/projects/<project_id>/report-archive/generate`

### Approvals

- `GET /api/approvals/pending`
- `GET /api/approvals/tracking`

### Resources

- `GET /api/resources/overview`
- `GET /api/resources/member-detail`

### Financial

- `GET /api/financial/overview`
- `GET /api/projects/<project_id>/financials`
- `GET /api/projects/<project_id>/financial-costs`
- `POST /api/projects/<project_id>/revenue`

## Data Tables Added Or Extended

- `background_tasks`
  - task persistence
  - source endpoint
  - retry source
- approval business tables extended earlier with:
  - `approval_sp_no`

## Frontend Script Order

In `templates/index.html`, module override order is:

1. `main.js`
2. `dashboard_hub.js`
3. `alert_hub.js`
4. `approval_hub.js`
5. `reminder_center_hub.js`
6. `ai_ops_hub.js`
7. `report_hub.js`
8. `project_detail_hub.js`
9. `resource_hub.js`
10. `financial_hub.js`
11. `map_hub.js`

This order is intentional so newer modular implementations override older global functions still present in `main.js`.

## Related Docs

- `README.md`
- `CURRENT_STATUS.md`
- `TEST_CHECKLIST.md`
- `LEGACY_FRONTEND_NOTES.md`
- `HUB_MODULES.md`
