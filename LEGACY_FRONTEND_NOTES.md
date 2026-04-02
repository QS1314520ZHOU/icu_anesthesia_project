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
- `static/js/auth_hub.js`
- `static/js/admin_hub.js`
- `static/js/report_hub.js`
- `static/js/project_detail_hub.js`

These are loaded after `static/js/main.js` and intentionally override older global functions.

## Main residual file

- `static/js/main.js`

It still contains many historical UI functions for:
- modals
- KB
- assets
- analytics
- departure / acceptance / change flows
- a few analytics-oriented helpers

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
- auth/session/login helpers -> use `auth_hub.js`
- admin user/config helpers -> use `admin_hub.js`
- report/archive helpers -> use `report_hub.js`
- project detail entry/render/modal/save/delete/update/load helpers -> use `project_detail_hub.js`

Frontend feedback behavior now:
- business pages prefer `showToast(...)`
- `static/js/api.js` now also uses toast-style fallback rendering, so `static/js/` no longer contains executing `alert(...)` calls

## Recommended next cleanup order

1. Continue moving delete/update/detail-tab logic into `project_detail_hub.js`
2. Keep `main.js` only for:
   - bootstrapping
   - auth/session
   - shared modal helpers
   - cross-module glue

## Template load order

In `templates/index.html`:

1. `main.js`
2. `dashboard_hub.js`
3. `alert_hub.js`
4. `approval_hub.js`
5. `reminder_center_hub.js`
6. `ai_ops_hub.js`
7. `auth_hub.js`
8. `admin_hub.js`
9. `report_hub.js`
10. `project_detail_hub.js`
11. `resource_hub.js`
12. `financial_hub.js`
13. `map_hub.js`

Do not move hub files before `main.js` unless shared globals are refactored first.

## Related Docs

- `README.md`
- `CURRENT_STATUS.md`
- `FEATURE_MAP.md`
- `TEST_CHECKLIST.md`
- `HUB_MODULES.md`
