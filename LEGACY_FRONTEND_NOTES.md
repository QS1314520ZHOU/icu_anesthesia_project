# Legacy Frontend Notes

## Current modularized hubs

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
- `static/js/project_detail_render_hub.js`
- `static/js/project_detail_tools_hub.js`
- `static/js/project_detail_actions_hub.js`

These are loaded after `static/js/main.js` and intentionally override older global functions.

## Main residual file

- `static/js/main.js`

It now mainly contains:
- startup wiring
- shared global state
- a small amount of cross-module glue

## Residual duplicate-entry risk

The most important module-entry duplicates have already been reduced, but `main.js` still acts as the base file and legacy host.

Safe assumption now:
- dashboard entry -> use `dashboard_hub.js`
- warning center -> use `alert_hub.js`
- approval entry -> use `approval_hub.js`
- reminder center -> use `reminder_center_hub.js`
- resource entry -> use `resource_hub.js`
- financial entry -> use `financial_hub.js`
- delivery map entry -> use `map_hub.js`
- AI helper modals -> use `ai_ops_hub.js`
- shared UI helpers -> use `shared_ui_hub.js`
- shared state/constants -> use `state_hub.js`
- startup wiring -> use `bootstrap_hub.js`
- auth/session/login helpers -> use `auth_hub.js`
- admin user/config helpers -> use `admin_hub.js`
- analytics/forecast helpers -> use `analytics_hub.js`
- PMO/operational helpers -> use `operations_hub.js`
- communication/collaboration helpers -> use `collaboration_hub.js`
- notification/reminder helpers -> use `notifications_hub.js`
- gantt/timeline helpers -> use `gantt_hub.js`
- AI analysis / radar helpers -> use `ai_analysis_hub.js`
- report/archive helpers -> use `report_hub.js`
- project detail entry/render/modal/save/delete/update/load helpers -> use `project_detail_hub.js`
- project detail renderers -> use `project_detail_render_hub.js`
- project detail tools -> use `project_detail_tools_hub.js`
- project detail actions -> use `project_detail_actions_hub.js`

Frontend feedback behavior now:
- business pages prefer `showToast(...)`
- `static/js/api.js` now also uses toast-style fallback rendering, so `static/js/` no longer contains executing `alert(...)` calls

## Recommended next cleanup order

1. Continue moving delete/update/detail-tab logic into `project_detail_hub.js`
2. Keep `main.js` only for:
   - bootstrapping
   - cross-module glue

## Template load order

In `templates/index.html`:

1. `main.js`
2. `dashboard_hub.js`
3. `alert_hub.js`
4. `approval_hub.js`
5. `reminder_center_hub.js`
6. `ai_ops_hub.js`
7. `shared_ui_hub.js`
8. `state_hub.js`
9. `bootstrap_hub.js`
10. `auth_hub.js`
11. `admin_hub.js`
12. `analytics_hub.js`
13. `operations_hub.js`
14. `collaboration_hub.js`
15. `notifications_hub.js`
16. `gantt_hub.js`
17. `ai_analysis_hub.js`
18. `report_hub.js`
19. `project_detail_hub.js`
20. `project_detail_render_hub.js`
21. `project_detail_tools_hub.js`
22. `project_detail_actions_hub.js`
23. `resource_hub.js`
24. `financial_hub.js`
25. `map_hub.js`

Do not move hub files before `main.js` unless shared globals are refactored first.

## Related Docs

- `README.md`
- `CURRENT_STATUS.md`
- `FEATURE_MAP.md`
- `TEST_CHECKLIST.md`
- `HUB_MODULES.md`
