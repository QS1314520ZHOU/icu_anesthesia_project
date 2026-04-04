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
    - health dashboard
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
    - warning badge/count
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
- Shared UI hub
  - File: `static/js/shared_ui_hub.js`
  - Covers:
    - toast helpers
    - markdown rendering helpers
    - generic modal helper
    - copy-current-view helper
    - tab dragging helper
- State hub
  - File: `static/js/state_hub.js`
  - Covers:
    - shared global state
    - stage/status constants
- Bootstrap hub
  - File: `static/js/bootstrap_hub.js`
  - Covers:
    - desktop startup wiring
    - initial page boot sequence
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
    - role matrix display
    - user role switching
    - password reset helpers
    - AI config management
- Analytics hub
  - File: `static/js/analytics_hub.js`
  - Covers:
    - risk trend modal
    - delivery prediction
    - project financial overview
    - SLA countdown
    - revenue entry helpers
- Operations hub
  - File: `static/js/operations_hub.js`
  - Covers:
    - PMO dashboard
    - stage baseline loading
    - demand impact analysis
    - risk simulation
- Collaboration hub
  - File: `static/js/collaboration_hub.js`
  - Covers:
    - communications CRUD
    - meeting assistant extraction / save-to-communication flow
    - communication AI analysis
    - uploaded-file analysis
    - AI retrospective / task suggestions
- Notifications hub
  - File: `static/js/notifications_hub.js`
  - Covers:
    - notification center
    - unread count
    - reminder check trigger
- Gantt hub
  - File: `static/js/gantt_hub.js`
  - Covers:
    - project gantt rendering
    - global gantt modal
    - gantt legend helpers
- AI analysis hub
  - File: `static/js/ai_analysis_hub.js`
  - Covers:
    - project AI analysis modal
    - strategic AI insight loading
    - risk radar rendering
- Report hub
  - File: `static/js/report_hub.js`
  - Covers:
    - weekly report generation
    - global weekly report generation
    - AI weekly summary insertion
    - report archive list/detail/manual generation
    - project report export
    - shared report rendering
- Project detail hub
  - File: `static/js/project_detail_hub.js`
  - Covers:
    - project detail entry
    - project template save helper
    - stage add/expand helpers
- Project detail render hub
  - File: `static/js/project_detail_render_hub.js`
  - Covers:
    - project detail main rendering
    - project detail section renderers
- Project detail actions hub
  - File: `static/js/project_detail_actions_hub.js`
  - Covers:
    - detail modal entry helpers
    - high-frequency save handlers
    - delete/update/status handlers
    - tab data loaders for worklogs/documents/expenses/changes/acceptances/satisfaction
    - dependency add/delete/load helpers
    - risk actions and status changes
- Project detail tools hub
  - File: `static/js/project_detail_tools_hub.js`
  - Covers:
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
    - financial anomaly hints
    - financial trend
    - project financial table
- Business module
  - Frontend:
    - `static/js/business_hub.js`
  - Backend:
    - `services/business_service.py`
    - `routes/business_routes.py`
  - Covers:
    - business overview
    - business month filter
    - business metric maintenance
    - business detail modal
    - monthly output value
    - collected amount
    - direct cost
    - labor cost
    - tax amount
    - management cost
    - net profit / net margin overview
- Map hub
  - File: `static/js/map_hub.js`
  - Covers:
    - delivery map entry
    - map view bootstrapping

## Knowledge Base

- KB workbench
  - Frontend:
    - `static/js/kb_management.js`
    - `templates/index.html`
  - Backend:
    - `GET /api/kb`
    - `GET /api/kb/<id>`
    - `POST /api/kb`
    - `PUT /api/kb/<id>`
    - `DELETE /api/kb/<id>`
    - `GET /api/kb/<id>/download`
    - `POST /api/ai/ask-kb`
  - Covers:
    - KB CRUD
    - tag / title / author management
    - markdown content
    - external links
    - AI KB Q&A

## Asset Management

- Asset workbench
  - Frontend:
    - `static/js/asset_management.js`
    - `templates/index.html`
  - Backend:
    - `routes/hardware_routes.py`
  - Covers:
    - asset registry
    - asset status update
    - project linkage
    - asset edit / delete

## Form Generator

- Form Generator workbench
  - Frontend:
    - `static/js/form_generator.js`
    - `templates/index.html`
  - Backend:
    - `routes/form_generator_routes.py`
    - `services/file_parser.py`
  - Covers:
    - file text extraction for `pdf/doc/docx/txt/md`
    - SmartCare JSON generation
    - local reference-form reuse
    - score-table compilation
    - text-table compilation
    - semantic block compilation
    - AI fallback generation
    - preview / field editor / table editor
    - local smoke regression script: `scripts/form_generator_smoke.py`

## Share / Access Control

- Project sharing and ACL
  - Backend:
    - `POST /api/projects/<project_id>/share/toggle`
    - `GET /share/<token>`
    - `GET /api/projects/<project_id>/access`
    - `POST /api/projects/<project_id>/access`
    - `DELETE /api/projects/<project_id>/access/<user_id>`
  - Covers:
    - share-token toggling
    - shared project page
    - project-level access control

## Standup / Snapshot / Deviation

- Standup and governance helpers
  - Backend:
    - standup APIs in `app.py`
    - snapshot APIs in `app.py`
    - deviation APIs in `app.py`
  - Covers:
    - standup generation
    - standup history
    - standup push to WeCom
    - project snapshots
    - capture-all snapshots
    - deviation report
    - AI deviation report

## Mobile

- Mobile workbench
  - Frontend:
    - `templates/mobile/index.html`
    - `templates/mobile/knowledge.html`
    - `templates/mobile/ai_chat.html`
    - `templates/mobile/briefing.html`
    - `templates/mobile/quick_log.html`
    - `templates/mobile/meeting_note.html`
    - `templates/mobile/daily_report.html`
    - `templates/mobile/acceptance.html`
  - Backend:
    - `routes/mobile_routes.py`
  - Covers:
    - mobile home
    - mobile knowledge search
    - mobile AI chat
    - project briefing
    - quick log
    - quick meeting note
    - daily report
    - acceptance page

## Admin Config Surfaces

- Config center
  - Frontend:
    - `static/js/admin_settings.js`
  - Backend:
    - AI config APIs
    - role matrix API
    - WeCom config APIs
    - storage config APIs
    - map config APIs
  - Covers:
    - AI endpoint management
    - user / permission tab
    - role matrix rendering / editing
    - WeCom integration config
    - storage auth/config/test
    - map provider config

## Frontend Workbench Files

- `static/js/dashboard_hub.js`
- `static/js/alert_hub.js`
- `static/js/approval_hub.js`
- `static/js/reminder_center_hub.js`
- `static/js/ai_ops_hub.js`
- `static/js/state_hub.js`
- `static/js/shared_ui_hub.js`
- `static/js/auth_hub.js`
- `static/js/admin_hub.js`
- `static/js/analytics_hub.js`
- `static/js/operations_hub.js`
- `static/js/collaboration_hub.js`
- `static/js/notifications_hub.js`
- `static/js/gantt_hub.js`
- `static/js/ai_analysis_hub.js`
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

### Business

- `GET /api/business/overview`
- `GET /api/business/projects/<project_id>/metrics`
- `POST /api/business/projects/<project_id>/metrics`
- `DELETE /api/business/metrics/<metric_id>`

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
