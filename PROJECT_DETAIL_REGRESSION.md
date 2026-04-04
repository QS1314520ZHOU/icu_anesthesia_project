# Project Detail Regression

## Goal

Project detail is the widest single workflow surface in the desktop workbench.
Compared with other modules, it has:

- more tabs
- more CRUD entry points
- more cross-module dependencies
- more risk of silent regressions after refactors

This document defines the minimum regression surface we should keep stable.

## Core Surface

The current project detail view is expected to keep these tabs:

- `interfaceSpec`
- `financials`
- `gantt`
- `pulse`
- `stages`
- `milestones`
- `team`
- `interfaces`
- `flow`
- `devices`
- `issues`
- `departures`
- `worklogs`
- `documents`
- `expenses`
- `changes`
- `acceptance`
- `satisfaction`
- `communications`
- `dependencies`
- `standup`
- `deviation`

## Loader Bindings

Tab switching currently triggers these key loaders:

- `pulse` -> `renderBurndownInDetail`
- `communications` -> `loadCommunications`
- `flow` -> `renderInterfaceFlow`
- `standup` -> `loadStandupData`
- `deviation` -> `loadDeviationAnalysis`
- `financials` -> `loadProjectFinancials`
- `dependencies` -> `loadDependencies`

## Frontend Files

- `static/js/project_detail_hub.js`
- `static/js/project_detail_render_hub.js`
- `static/js/project_detail_actions_hub.js`
- `static/js/project_detail_tools_hub.js`

## Backend Route Surface

The project detail area depends on these backend route groups:

- worklogs
- documents
- expenses
- changes
- acceptances
- satisfaction
- dependencies
- standup
- snapshots
- deviation
- financials
- gantt

## Smoke Script

Run:

```bash
python scripts/project_detail_smoke.py
```

Current smoke checks:

- expected tab set exists in project-detail render output
- key tab-to-loader bindings still exist
- core project-detail frontend functions still exist
- primary backend route fragments still exist

## Manual Regression Focus

Even if the static smoke passes, browser validation should still cover:

1. Opening a project detail from the dashboard and from the sidebar project list.
2. Switching tabs without JS errors.
3. Saving at least one item in:
   - worklogs
   - issues
   - expenses
   - changes
   - acceptances
4. Loading communications / dependencies / standup / deviation views.
5. Uploading a document and verifying list refresh.

## When To Update

Update this document and the smoke script when:

- a tab is intentionally added or removed
- a tab loader is intentionally renamed
- project detail ownership moves across hub files
