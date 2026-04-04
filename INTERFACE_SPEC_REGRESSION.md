# Interface Spec Regression

## Scope

This regression note covers the project-level interface-spec and intelligent comparison workbench, which is separate from the standalone `/alignment` center.

It protects:

- interface document extraction
- standard / vendor spec parsing
- project-level comparison results
- field mapping detail view
- interface AI assistant modal

## Smoke Script

Run:

```bash
python scripts/interface_spec_smoke.py
```

Current checks:

- project-level interface-spec routes still exist
- `static/js/modules/interface-spec.js` still exposes the main module entry points
- upload modal / field-detail modal / AI chat modal nodes still exist in `templates/index.html`
- project detail render still keeps the interface-spec tab hook

## Manual Focus

Browser validation should still cover:

1. Open project detail -> 智能对照 tab
2. Load built-in standard
3. Upload vendor spec
4. Run comparison
5. Open field detail
6. Open interface AI assistant
