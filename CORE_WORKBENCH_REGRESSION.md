# Core Workbench Regression

## Scope

This smoke covers the most frequently used desktop surfaces:

- dashboard
- task center
- approval entry
- resource entry
- business overview entry
- financial overview entry

The goal is not full browser correctness, but protecting the top-level shell and main workbench entry points from silent breakage.

## Smoke Script

Run:

```bash
python scripts/core_workbench_smoke.py
```

Current checks:

- main workbench routes still exist in `app.py`
- core desktop view containers still exist in `templates/index.html`
- primary workbench entry buttons still exist in `templates/index.html`
- task center template still contains its main filters and stats nodes
- task center script section still contains core load / retry / cancel / cleanup functions
- dashboard hub still exposes main dashboard functions
- approval / resource / business / financial hubs still expose their main entry functions

## Manual Focus

Browser validation should still cover:

1. Open `/`
2. Open dashboard shortcuts for:
   - approval
   - resource
   - business
   - financial
   - task center
3. Open `/tasks-center`
4. Confirm search, status filter and refresh still work
