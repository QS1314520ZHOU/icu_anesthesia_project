# Test Checklist

## Dashboard

- Open `/`
- Verify dashboard renders without JS errors
- Verify cockpit shortcuts open:
  - approvals
  - task center
  - resource overview
  - financial overview
  - business overview
  - delivery map
- Run core workbench smoke:
  - `python scripts/core_workbench_smoke.py`
  - verify all sections return `OK`

## Insight / Reporting

- Open warning center
- Verify:
  - warning list renders
  - severity filter works
  - keyword search works
- Open reminder center
- Verify:
  - digest renders
  - tab switching works
  - search works
- Open one AI analysis flow
- Verify:
  - AI modal renders
  - history entry can be opened
  - radar rendering path remains available
- Open report archive area in project detail
- Verify:
  - archive list renders
  - archive detail opens
  - archive content can export / copy
- Open global gantt modal
- Verify:
  - chart container renders
  - empty state or chart renders without JS errors
- Open delivery map
- Verify:
  - map view container renders
  - map bootstrapping path executes
- Run insight/reporting smoke:
  - `python scripts/insight_reporting_smoke.py`
  - verify all sections return `OK`

## Advanced Governance

- Open PMO dashboard
- Verify:
  - PMO overview renders
  - PMO summary renders
- Open demand analysis modal
- Verify:
  - modal renders
  - analysis result area renders
- Open risk simulation modal
- Verify:
  - modal renders
  - impacted task list container exists
- Open risk trend modal
- Verify:
  - chart container renders
- Run advanced governance smoke:
  - `python scripts/advanced_governance_smoke.py`
  - verify all sections return `OK`

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

## Form Generator

- Open Form Generator in `/`
- Upload `表单/ICU机械通气患者误吸风险评估量表.docx`
- Verify:
  - debug panel shows `generation_strategy = score_table`
  - grouped score options render in preview
  - generated JSON contains `总分`
  - generated JSON contains `风险等级`
- Upload `表单/2.已发压疮评估及护理措施记录单（2025年第4次修订）.doc`
- Verify:
  - debug panel shows `generation_strategy = semantic`
  - patient-bound fields like `科室 / 姓名 / 住院号` remain readable in preview
  - option groups such as `措施完全到位` render as selectable controls
- Upload `表单/普通表格示例.txt`
- Verify:
  - debug panel shows `generation_strategy = text_table`
  - preview shows `自动填写位`
  - generated result contains `table_overlay` category controls
- Verify text-table overlays:
  - when a normal Word table is parsed, preview shows `自动填写位`
  - field editor can see auto-generated table-overlay fields
- Run local smoke:
  - `python scripts/form_generator_smoke.py`
  - verify all samples return `OK`
  - verify the baseline is loaded from `scripts/form_generator_contracts.json`
- If a validated behavior change is expected:
  - run `python scripts/form_generator_smoke.py --write-contracts`
  - review the diff in `scripts/form_generator_contracts.json`
- Or run one-click check in PowerShell:
  - `powershell -ExecutionPolicy Bypass -File scripts/run_form_generator_checks.ps1`
  - verify all steps return `OK`

## Knowledge Base

- Open KB workbench in `/`
- Verify:
  - list renders
  - search works
  - create / edit / delete works
  - markdown content renders
  - download works
  - AI KB Q&A returns content
- Run auxiliary surfaces smoke:
  - `python scripts/auxiliary_surfaces_smoke.py`
  - verify KB / Asset / Mobile sections return `OK`

## Asset Management

- Open asset management in `/`
- Verify:
  - asset list renders
  - create asset works
  - status update works
  - edit / delete works
  - project linkage displays correctly

## Alignment Center

- Open `/alignment`
- Verify:
  - spec version list loads
  - standard import works
  - vendor parse works
  - alignment run works
  - session list/detail renders
  - result confirmation works
  - AI assistant returns response
- Run local alignment smoke:
  - `python scripts/alignment_center_smoke.py`
  - verify all sections return `OK`

## Project Detail

- Open a project detail page in `/`
- Verify:
  - tabs switch correctly
  - stage add / expand works
  - task CRUD works
  - issue CRUD works
  - document upload / download works
  - expense CRUD works
  - change / acceptance / satisfaction tabs render
  - dependency add / delete / critical path works
  - standup / snapshot / deviation data loads
  - share / access actions work if enabled
- Run local project-detail smoke:
  - `python scripts/project_detail_smoke.py`
  - verify all sections return `OK`

## Collaboration Center

- Open communications tab inside project detail
- Verify:
  - communication list renders
  - add / edit / delete communication works
  - communication keyword / method / tag filters work
  - copy current communication view exports only the filtered cards
  - meeting assistant modal opens
  - meeting extraction returns content
  - meeting result can save into communication records
  - meeting save panel supports optional issue linkage
  - communication AI analysis renders
  - communication AI analysis can copy / save into communication records
  - uploaded file analysis renders
  - AI retrospective and AI task suggestions can open
- Run collaboration smoke:
  - `python scripts/collaboration_center_smoke.py`
  - verify all sections return `OK`

## Mobile

- Open `/m/`
- Verify:
  - mobile home renders
  - `/m/knowledge` search works
  - `/m/chat` returns AI response
  - `/m/quick_log` submit works
  - `/m/meeting_note` submit works
  - `/m/project/briefing/<project_id>` renders
  - `/m/daily_report/<project_id>` renders
  - `/m/acceptance/<project_id>` renders

## Admin Config

- Open admin settings
- Verify:
  - AI config list / create / edit / test works
  - WeCom config load / save works
  - user and permission tab renders
  - role matrix renders
  - role matrix can save non-admin display name / permission updates
  - user role switching works
  - user enable / disable and password reset work
  - storage status and config save works
  - map config load / save works

## Share / Access Control

- For one project:
  - toggle share token
  - open `/share/<token>`
  - verify project shared page renders
  - verify access list load / add / delete works
- Run platform smoke:
  - `python scripts/platform_admin_share_smoke.py`
  - verify admin/share sections return `OK`

## PostgreSQL

- Start with PostgreSQL config
- Verify:
  - app startup
  - background task creation
  - approval tracking query
  - resource overview query
  - financial overview query
  - task persistence table writes
