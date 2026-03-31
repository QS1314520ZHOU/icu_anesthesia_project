# Test Checklist

## Dashboard

- Open `/`
- Verify dashboard renders without JS errors
- Verify cockpit shortcuts open:
  - approvals
  - task center
  - resource overview
  - financial overview
  - delivery map

## Today Focus

- Verify `GET /api/dashboard/today-focus` works in `global` scope
- Login and verify `scope=mine` works
- Click a focus item and verify it routes to:
  - project detail
  - approval center
  - task center
  - reminder center

## Task Center

- Open `/tasks-center`
- Create each async task and verify record is stored:
  - project AI analysis
  - project weekly report
  - all weekly report
  - report archive
  - knowledge extract
  - global briefing
  - AI cruise
- Verify:
  - list filter
  - detail popup
  - retry
  - cleanup completed
  - copy
  - download md/txt

## Approval Center

- Open approval center
- Verify pending approvals render
- Verify approval tracking renders
- Verify:
  - status filter
  - search
  - approval sp_no copy
  - click row jumps to project

## Resource Overview

- Open resource overview
- Verify:
  - city summary
  - suggestions
  - member table
  - search/filter
  - city click filter
  - member detail
  - recent logs

## Financial Overview

- Open financial overview
- Verify:
  - summary cards
  - trend charts
  - project table
  - table search
  - margin filter

## PostgreSQL

- Start with PostgreSQL config
- Verify:
  - app startup
  - background task creation
  - approval tracking query
  - resource overview query
  - financial overview query
  - task persistence table writes

