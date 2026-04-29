# Feature Suggestions Roadmap

## Goal

This note turns the current feature audit into an actionable next-step roadmap.
It is organized by domain so product, frontend, backend, and QA can move in parallel.

## Priority Bands

- `P0`
  - fix correctness, access, and workflow closure issues that block daily use
- `P1`
  - improve discoverability, polish, and cross-module efficiency
- `P2`
  - deepen intelligence, automation, and operator tooling

## Dashboard / Workbench

- `P0`
  - shift the default implementation experience from management-style reporting to an implementation-first workbench
  - add a unified action center that merges warnings, reminders, approvals, and AI suggestions
  - make today-focus cards jump directly into the exact tab or modal they refer to
- `P1`
  - allow per-role home layouts for admin / PM / delivery member
  - support pinning favorite workbench entries
- `P2`
  - add trend-based “what changed since yesterday” summaries

## Warning / Reminder / Approval

- `P0`
  - unify message wording and severity levels across warnings and reminders
  - add SLA timing and escalation hints in approval rows
- `P1`
  - allow batch processing for low-risk approvals and reminders
  - provide reminder subscription preferences by role
- `P2`
  - add AI-generated recommended actions for each warning cluster

## Resource / Financial / Business

- `P0`
  - separate “经营看板” and “财务总览” wording and metric explanations everywhere
  - add empty-state guidance when data sources are incomplete
- `P1`
  - add capacity forecast by city / role / month
  - add business-to-financial drill-through between output, cost, margin, and project detail
- `P2`
  - add profitability forecast and staffing scenario simulation

## Delivery Map / Gantt / PMO Governance

- `P0`
  - make map and gantt entry states clearer when data is missing
  - expose PMO intervention results as actionable links, not static text
- `P1`
  - support one-click jump from PMO action to project risk / dependency / issue views
  - add more explicit baseline-vs-actual visuals
- `P2`
  - add portfolio simulation for schedule slip and staffing stress

## Project Detail

- `P0`
  - strengthen tab-to-tab closure between issues, tasks, documents, approvals, and communications
  - ensure each save flow refreshes only the affected slice without losing context
- `P1`
  - add “project operating timeline” view that merges milestones, risks, departures, communications, and approvals
  - add cross-tab quick create actions from the header
- `P2`
  - add project copilot mode that can summarize current blockers and propose next-week plans

## Collaboration / Meeting / AI Communication

- `P0`
  - allow meeting assistant results to generate tasks and issues directly, not only communication records
  - keep AI analysis outputs linkable to the source communication / file / meeting
- `P1`
  - add communication templates for common scenarios like demand clarification, escalation, and go-live coordination
  - support richer filters such as date range and creator
- `P2`
  - cluster communication records by topic and auto-generate stakeholder briefings

## Report / AI Analysis / Task Center

- `P0`
  - make implementation logs, blockers, and meeting notes reusable across daily report, weekly report, warning center, and project detail without second reporting
  - improve task-center source traceability so each async task points back to its triggering screen
  - standardize AI result copy / export / archive behavior
- `P1`
  - add report diff view between two generations
  - add queue tags for AI analysis, reporting, extraction, and maintenance jobs

## Implementation-First Workbench

- detailed strategy doc:
  - `IMPLEMENTATION_WORKBENCH_STRATEGY.md`
- `P2`
  - recommend the next best async action from current project state

## Alignment / Interface Spec / Integration

- `P0`
  - finish the interface-spec workbench contract surface so routes, exports, and AI entry naming stay aligned
  - add explicit import/export actions for confirmed field mappings
- `P1`
  - separate “alignment center” and “interface spec workbench” more clearly in navigation and docs
  - add review workflow for comparison outcomes
- `P2`
  - generate draft integration plans from spec comparison results

## Knowledge / Asset / Form Generator

- `P0`
  - improve discoverability for KB and asset management from the main dashboard
  - keep form-generator debug strategy visible but better explained for operators
- `P1`
  - allow KB-to-report and KB-to-meeting references
  - add asset lifecycle views tied to project status
- `P2`
  - recommend reusable forms and KB content from project type and current stage

## Mobile / WeCom / Notifications

- `P0`
  - prioritize high-frequency mobile actions: quick log, quick issue, meeting note, approval handling
  - surface WeCom bind health more clearly for each user
- `P1`
  - support mobile communication capture with image / voice attachment metadata
  - add role-based notification routing preferences
- `P2`
  - provide mobile daily briefing tailored to the current user

## Admin / Permissions / Platform

- `P0`
  - keep “用户与权限” visible inside system settings
  - protect admin-only endpoints consistently and verify admin session permission hydration after login
- `P1`
  - move from fixed role display to configurable role-permission policy management
  - add audit visibility for role changes, status changes, and config edits
- `P2`
  - introduce environment diagnostics and release-readiness checks in admin settings

## Recommended Next Implementation Order

1. `P0` permission and admin-surface consolidation
2. `P0` interface-spec workbench contract cleanup
3. `P0` project-detail and collaboration closure improvements
4. `P1` unified action center across warning/reminder/approval/AI
5. `P1` business vs financial vocabulary cleanup
6. `P1` mobile and WeCom high-frequency workflow polish
