# Hub Modules

## Current Hub Files

- `static/js/dashboard_hub.js`
  - home dashboard
  - cockpit shortcuts
  - today focus cockpit
  - financial snapshot
  - resource snapshot
- `static/js/alert_hub.js`
  - warning center
- `static/js/approval_hub.js`
  - approval center
  - pending approvals
  - approval tracking
- `static/js/reminder_center_hub.js`
  - reminder center
  - reminder digest
  - reminder tabs
- `static/js/resource_hub.js`
  - resource overview
  - member load view
  - member detail
- `static/js/financial_hub.js`
  - financial overview
  - financial trend
  - project margin table
- `static/js/map_hub.js`
  - delivery map entry
- `static/js/ai_ops_hub.js`
  - AI worklog assistant
  - AI chaser
  - AI NLQ modal
  - KB extraction helper
- `static/js/auth_hub.js`
  - auth/session bootstrap helpers
  - login/register helpers
  - full-page login overlay
- `static/js/admin_hub.js`
  - global user management
  - password reset flow
  - AI config management
- `static/js/report_hub.js`
  - weekly report modal helpers
  - global report generation
  - report archive list/detail
  - project report export
- `static/js/project_detail_hub.js`
  - project detail entry loader
  - project detail main renderer
  - project detail modal entry helpers
  - project detail save/edit handlers
  - project detail delete/update handlers
  - stage expand/add helpers
  - project detail tab loaders
  - dependency management helpers
  - interface template recommendation helpers
  - document upload helper

## Shared Base Layer

- `static/js/main.js`
  - bootstrap
  - shared modal helpers
  - shared toast helpers
  - remaining cross-module glue
  - a few legacy analytics helpers still parked here

## Practical Next Extraction Targets

1. Keep shrinking project-detail-heavy logic inside `project_detail_hub.js`
   - project detail tabs
   - delete/update handlers
   - remaining detail-only helpers still parked in `main.js`
