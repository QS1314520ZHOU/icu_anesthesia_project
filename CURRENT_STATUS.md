# Current Status

## Database Migration

- SQLite-oriented business SQL has been heavily reduced.
- PostgreSQL compatibility layer is centered in `database.py`.
- High-risk SQLite patterns already cleaned:
  - direct literal SQL execute calls
  - `cursor = conn.cursor()` style business residue
  - `INSERT OR REPLACE`
  - `INSERT OR IGNORE`

## New Functional Modules

- Today Focus Cockpit
- Task Center
- Approval Tracking Center
- Resource Scheduling View
- Financial Overview / Margin Dashboard
- Delivery Map entry integrated into cockpit

## Frontend Modularization

The following hub files now own major cockpit/workbench flows:

- `static/js/dashboard_hub.js`
- `static/js/alert_hub.js`
- `static/js/approval_hub.js`
- `static/js/reminder_center_hub.js`
- `static/js/resource_hub.js`
- `static/js/financial_hub.js`
- `static/js/map_hub.js`
- `static/js/ai_ops_hub.js`
- `static/js/shared_ui_hub.js`
- `static/js/state_hub.js`
- `static/js/bootstrap_hub.js`
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
  - analytics/forecast and revenue-entry helpers have started moving out of `main.js`
  - now owns the project detail entry flow
  - now also owns project template saving
- `static/js/project_detail_render_hub.js`
  - now owns the project detail main rendering and section renderers
- `static/js/project_detail_actions_hub.js`
  - now covers most project detail save/delete/update flows
  - and several project detail tab loading flows
- `static/js/project_detail_tools_hub.js`
  - now covers interface template recommendation and document upload

## Stability Hardening Already Applied

- Many partial-update APIs were converted to safe merge updates.
- Approval center now covers:
  - changes
  - departures
  - expenses
- Approval tracking is based on `approval_sp_no`.
- Task records persist to `background_tasks`.
- Several workbench pages now support:
  - filter-to-URL sync
  - copy current view link
  - refresh without losing context
  - empty-state explanations
- `static/js/` no longer contains executing `alert(...)` calls; feedback is now centered on the toast flow.

## Recommended Next Phase

1. Run a real end-to-end validation based on `TEST_CHECKLIST.md`
2. Continue shrinking `static/js/main.js`
3. Extract project-detail-heavy logic into a dedicated hub/module
4. Test against a live PostgreSQL instance and fix runtime mismatches

## Related Docs

- `README.md`
- `FEATURE_MAP.md`
- `TEST_CHECKLIST.md`
- `LEGACY_FRONTEND_NOTES.md`
- `HUB_MODULES.md`
