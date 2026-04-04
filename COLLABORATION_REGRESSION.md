# Collaboration Regression

## Scope

This regression note covers the collaboration surface around:

- communication records
- meeting assistant
- communication timeline filtering / copy
- communication AI analysis
- uploaded file analysis
- AI retrospective
- AI task suggestions

## Smoke Script

Run:

```bash
python scripts/collaboration_center_smoke.py
```

Current checks:

- communication-analysis and retrospective routes still exist in `app.py`
- communication CRUD routes still exist in `routes/communication_routes.py`
- collaboration helper routes still exist in `routes/collaboration_routes.py`
- communication modal / meeting assistant save-panel nodes still exist in `templates/index.html`
- project-detail communication render entry points still exist in `static/js/project_detail_render_hub.js`
- collaboration hub still exposes CRUD, filtering, meeting-assistant, and AI-analysis functions in `static/js/collaboration_hub.js`

## Manual Focus

Browser validation should still cover:

1. Open communication tab in project detail
2. Add / edit / delete one communication record
3. Verify communication search / method / tag filters work
4. Verify copy-current-view exports only visible communication cards
5. Run meeting assistant on a sample transcript
6. Save meeting result back into communications, including optional issue linkage
7. Run communication AI analysis
8. Save AI analysis back into communications and verify the record refreshes
9. Upload one file and run file analysis
10. Open AI retrospective and AI task suggestions
