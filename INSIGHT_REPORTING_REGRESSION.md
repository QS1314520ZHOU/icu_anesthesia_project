# Insight And Reporting Regression

## Scope

This regression note covers dashboard-adjacent workbench capabilities that are important but easy to miss during refactors:

- warning center
- reminder center
- AI analysis
- report/archive flows
- gantt overview
- delivery map entry

## Smoke Script

Run:

```bash
python scripts/insight_reporting_smoke.py
```

Current checks:

- warning / reminder / report archive routes still exist in `app.py`
- warning / reminder / gantt / map modal or container nodes still exist in `templates/index.html`
- alert hub still exposes warning-center entry functions
- reminder hub still exposes reminder-center entry functions
- AI analysis hub still exposes AI analysis history / radar functions
- report hub still exposes weekly report and archive functions
- gantt hub still exposes project and global gantt functions
- map hub still exposes delivery-map entry

## Manual Focus

Browser validation should still cover:

1. Open warning center
2. Open reminder center and switch tabs
3. Open one AI analysis modal
4. Open one report archive list/detail
5. Open global gantt modal
6. Open delivery map
