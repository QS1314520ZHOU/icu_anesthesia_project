# Implementation Workbench Strategy

## Goal

This note reframes the desktop and mobile experience from the perspective of the implementation engineer.

The target is not:

- make implementation staff report more completely
- expose more management dashboards
- add more modules to the homepage

The target is:

- make the system the shortest path for daily delivery work
- make one input reusable across logs, risks, approvals, reports, and acceptance evidence
- make implementation staff feel that not using the system creates more work, not less

Core product sentence:

`This system should help the implementation engineer finish today's work, not just explain today's work.`

## Product Principle

### 1. Serve implementation first, management second

Management views should consume implementation-side data.
Implementation should not need to enter the same fact twice into different surfaces.

### 2. Single entry, multiple reuse

Any field-side record should be reusable by:

- daily report
- weekly report
- warning / escalation
- project progress
- acceptance evidence
- coordination history

### 3. Use the system because it saves time

The system must become the fastest way to:

- know what to do today
- record what happened on site
- escalate blockers
- generate reports
- avoid forgetting evidence before leaving site

## Why Implementation Staff Will Use It

Implementation engineers usually care about five concrete questions:

1. What exactly do I need to do today?
2. What happened on site, and how do I record it once?
3. If I get blocked, how do I escalate and track it?
4. When I finish today's work, how do I get the report and evidence out quickly?
5. Before leaving, what have I not closed yet?

If the system answers these five questions faster than WeChat + notes + memory, they will use it.

If the system only asks for updates while management gets the value, they will avoid it.

## The Right Core Loop

The implementation workbench should revolve around this loop:

1. Open my workbench
2. See today's tasks / risks / approvals / reminders
3. Record one sentence, one photo, one meeting summary, or one blocker
4. Automatically connect that record to project, phase, issue, report, and reminder
5. Leave the site with evidence already accumulated

This is the core loop the current product should optimize for.

## Recommended Desktop Home For Implementation

The implementation home should not look like a mini management cockpit.

It should be a field execution workbench.

Recommended desktop home sections:

### A. My Priority Panel

Purpose:

- what must I handle first

Recommended cards:

- My active projects
- Today's completed items
- Field risks to follow up
- Available collaboration resources
- Pending approvals related to me
- Processing background tasks

Primary actions:

- open task center
- open warning center
- open resource view
- open related project

### B. Quick Record Panel

Purpose:

- record work with the fewest clicks

Required entries:

- Quick worklog
- Quick issue / blocker
- Quick demand change
- Quick meeting note
- Quick daily plan / tomorrow plan
- Upload screenshot / photo / file

Design rule:

- one action should not require the user to first navigate into project detail if the project can be inferred or selected quickly

### C. Field Coordination Panel

Purpose:

- handle blockers without leaving the workbench

Required entries:

- Escalate to PM
- Raise interface alignment problem
- Trigger approval request
- Open communication timeline
- Open current project risk / issue tab

### D. Auto Output Panel

Purpose:

- reuse today's records automatically

Required outputs:

- Daily report preview
- Weekly report preview
- Acceptance evidence package preview
- Missing-record checklist

### E. End-of-Day Closure Panel

Purpose:

- avoid leaving the site with missing records

Checklist items:

- today worklog not filled
- issue created but no owner
- issue overdue but no update
- change raised but not approved
- milestone changed but not synced
- tomorrow plan missing

## Recommended Mobile Home For Implementation

The mobile experience should be even more execution-oriented than desktop.

Recommended mobile first-level actions:

- quick log
- quick meeting note
- today tasks
- my blockers
- my project card
- upload field photo
- generate daily report

Desktop is for coordination and structured closure.
Mobile is for instant capture.

## Required Daily Workflow

The implementation workflow should be explicit and short.

### Workflow 1: Start of Day

User opens workbench and sees:

- my priority items
- today's tasks
- current project reminders
- unresolved blockers
- overdue acceptance / interface / issue items

Result:

- implementation engineer knows what to do without asking in chat first

### Workflow 2: During Field Work

User records one of:

- quick log
- quick issue
- quick demand clarification
- quick meeting summary
- quick interface blocker

The system should then automatically:

- attach it to a project
- classify the record
- update project progress context
- generate reminder candidates
- expose it to PM / management surfaces if needed

### Workflow 3: Escalation

When blocked, user should be able to:

- mark severity
- assign owner
- choose escalation target
- define promised time
- push to PM / R&D / interface owner / approver

The system should then:

- create traceable issue history
- show it in warning center
- show it in PM view
- include it in reports automatically

### Workflow 4: End of Day

User should not manually rewrite the day.

The system should generate:

- daily report draft
- pending closure checklist
- next-day plan draft

User only edits and confirms.

### Workflow 5: Weekly / Acceptance Reuse

All structured records should flow into:

- weekly report
- acceptance checklist
- issue closure evidence
- communication archive
- project retrospective

## What Must Be Kept

The following existing modules are useful and should be kept, but implementation-facing entry points should be simplified:

- `dashboard_hub.js`
  - keep as role-based shell and implementation home container
- `alert_hub.js`
  - keep for risk follow-up
- `approval_hub.js`
  - keep for change / departure / expense handling
- `reminder_center_hub.js`
  - keep for due / overdue work
- `ai_ops_hub.js`
  - keep because AI worklog assistant is directly valuable for implementation
- `collaboration_hub.js`
  - keep because meeting note and communication trace are critical
- `project_detail_hub.js`
  - keep as the deep work surface after entry from workbench
- `project_detail_actions_hub.js`
  - keep for issue / worklog / change / acceptance / document actions
- `report_hub.js`
  - keep for output reuse
- `resource_hub.js`
  - keep, but implementation should consume it as "who can help me now"
- `alignment`
  - keep, because interface blocking is high-frequency implementation pain
- mobile quick log / meeting note
  - keep and connect more tightly to desktop closure flows

## What Should Be Weakened On Implementation Home

The following are valid modules, but should not dominate implementation's default experience:

- financial overview
- business overview
- performance analytics
- global PMO surfaces
- deep admin / config tools

They can remain accessible, but should not compete with:

- quick log
- blocker handling
- today tasks
- daily report generation

## What Must Be Added Or Strengthened

### 1. Quick Record Hub

Missing product layer:

- a unified implementation capture surface

Should merge:

- quick log
- issue
- communication
- meeting summary
- demand change

into one front-door action model:

- `What happened?`
- `Which project?`
- `What type is it?`
- `Does it block progress?`
- `Who needs to know?`

### 2. Missing Closure Checklist

Implementation needs a strong end-of-day checklist.

This is one of the strongest adoption drivers.

Without it, they forget.
With it, they trust the system.

### 3. Escalation Chain

Every important blocker should support:

- owner
- severity
- due time
- escalation target
- current state

This turns "I already said it in chat" into a trackable delivery workflow.

### 4. Evidence Reuse

The system must clearly show:

- this log was used in daily report
- this issue was used in weekly report
- this meeting summary was attached to project communication
- this photo / file was attached to acceptance or project documents

That visible reuse is what creates user trust.

## Required Cross-Module Closures

The following closures must exist.

### Quick log -> Project detail -> Daily report

One implementation log should flow into:

- project worklog tab
- daily report draft
- weekly report material

### Meeting note -> Communication -> Issue / Task

Meeting extraction should support:

- save to communication record
- generate issue
- generate task
- mark responsible owner

### Issue / blocker -> Warning -> PM / report

Once an issue is high severity or overdue:

- warning center sees it
- PM sees it
- weekly report sees it

### Change / expense / departure -> Approval -> Reminder -> Report

Approval data should not stay in the approval module only.

It should affect:

- reminder center
- today focus
- project detail
- weekly summary

### Alignment -> Risk -> Daily coordination

Interface alignment problems should not remain in a separate tool island.

They should feed:

- issue list
- warning center
- PMO / PM intervention

## Desktop Implementation Homepage Proposal

### Section order

1. My priority
2. Quick record
3. Today focus
4. Resource / coordination
5. Project list
6. Auto outputs
7. Reminder / risk tail

### Recommended cards

- `Quick log`
- `Report blocker`
- `Meeting note`
- `Demand change`
- `Daily report draft`
- `Tomorrow plan`
- `Open current project`

### Recommended removals from default implementation home

- business metrics
- margin-focused metrics
- admin settings
- performance review entry

## Mapping To Existing Frontend

### Reuse directly

- `showActionInbox()`
- `showAiWorkbench()`
- `showWarningCenter()`
- `showReminderCenter()`
- `showApprovalCenter()`
- `showResourceOverview()`
- `window.location.href='/tasks-center'`
- `window.location.href='/alignment'`

### Reposition

- `showBusinessOverview()`
  - remove from implementation-first home
- `showFinancialOverview()`
  - remove from implementation-first home
- `openPmoDashboard()`
  - keep for PM only
- `showPerformanceAnalytics()`
  - remove from implementation navigation default path

### Strengthen

- AI worklog assistant in `ai_ops_hub.js`
- meeting assistant in `collaboration_hub.js`
- project detail action entry points in `project_detail_actions_hub.js`

## Mapping To Existing Mobile

Keep these as implementation-first mobile actions:

- `templates/mobile/quick_log.html`
- `templates/mobile/meeting_note.html`
- `templates/mobile/index.html`
- `templates/mobile/daily_report.html`

Recommended mobile priority order:

1. quick log
2. meeting note
3. project card
4. blocker follow-up
5. daily report

## Product Rule: One Input, Five Outputs

This rule should be explicit in implementation-facing design.

One field record should feed:

1. worklog
2. issue / warning
3. communication archive
4. daily / weekly report
5. acceptance or retrospective evidence

If this rule is visible in the UI, implementation staff will feel the system saves time.

## Product Rule: No Second Reporting

Implementation should never need to:

- write in worklog
- then rewrite in report
- then explain again in meeting summary
- then tell PM again in chat

Instead:

- record once
- confirm structure
- reuse everywhere

## Implementation Adoption KPI

If the product really shifts to implementation-first, success should be measured by:

- daily active implementation users
- percentage of active projects with same-day worklogs
- percentage of blockers with owner + due time
- percentage of daily reports generated from structured records
- percentage of weekly reports that require minimal manual rewrite
- time from blocker creation to PM visibility

Not by:

- number of dashboard cards
- number of modules accessible
- number of fields exposed

## Recommended Build Order

### P0

- implementation-first desktop home
- quick record entry consolidation
- daily closure checklist
- blocker escalation chain
- report reuse from logs / issues / meeting notes

### P1

- stronger project participation recognition
- role-personalized project grouping
- evidence package generation
- better mobile-to-desktop continuity

### P2

- auto-suggest next actions
- smarter field-to-report summarization
- acceptance / go-live package generation
- personal delivery rhythm analytics

## Concrete Next Implementation Tasks

1. Replace the current implementation homepage emphasis with:
   - my priority
   - quick record
   - end-of-day closure

2. Build a unified quick record surface that routes into:
   - worklog
   - issue
   - communication
   - change

3. Add a missing-record checklist panel on both desktop and mobile.

4. Make every important record visibly reusable in:
   - daily report
   - weekly report
   - warning center
   - project detail

5. Add explicit escalation actions from issue / communication / alignment records.

## Bottom Line

Implementation staff will not adopt the system because the company requires reporting.

They will adopt it when the system becomes the easiest way to:

- know today's work
- capture today's work
- escalate today's blockers
- finish today's report
- leave today's site without missing evidence

That is the correct product center of gravity for this codebase.
