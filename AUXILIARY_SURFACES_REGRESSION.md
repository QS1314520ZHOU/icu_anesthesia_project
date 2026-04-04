# Auxiliary Surfaces Regression

## Scope

This document covers secondary but still user-facing product surfaces that are easy to forget during refactors:

- Knowledge Base
- Asset Management
- Mobile pages

These features are real product surfaces, not internal demos, so they should stay inside the release regression loop.

## Smoke Script

Run:

```bash
python scripts/auxiliary_surfaces_smoke.py
```

Current checks:

- Knowledge Base template nodes exist in `templates/index.html`
- Knowledge Base frontend functions still exist in `static/js/kb_management.js`
- Knowledge Base backend routes still exist in `app.py`
- Asset Management template nodes exist in `templates/index.html`
- Asset Management frontend functions still exist in `static/js/asset_management.js`
- Asset Management backend routes still exist in `routes/hardware_routes.py`
- Mobile routes still exist in `routes/mobile_routes.py`
- Required mobile template files still exist in `templates/mobile/`

## Manual Focus

Even after the static smoke passes, browser validation should still cover:

1. Knowledge Base list, search, create, edit, delete and AI Q&A
2. Asset list, create, edit and status flow
3. Mobile home, mobile chat and one form-style mobile page
