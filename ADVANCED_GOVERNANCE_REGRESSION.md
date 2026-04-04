# Advanced Governance Regression

## Scope

This regression note covers the higher-order governance features that sit above normal CRUD:

- PMO dashboard
- stage baselines
- demand change analysis
- risk simulation
- analytics compare / trend / workload / geo endpoints

These features are not always in the first-click workflow, but they are part of the product capability surface and should not silently disappear.

## Smoke Script

Run:

```bash
python scripts/advanced_governance_smoke.py
```

Current checks:

- PMO / analytics compare routes still exist
- operational / risk-simulation routes still exist
- PMO and risk-simulation modal/container nodes still exist in `templates/index.html`
- `operations_hub.js` still exposes PMO / demand-analysis / risk-simulation functions
- `analytics_hub.js` still exposes trend / prediction / financial analysis helpers

## Manual Focus

Browser validation should still cover:

1. Open PMO dashboard modal
2. Load PMO overview and summary
3. Open demand-analysis modal and verify layout renders
4. Open risk simulation modal from a task row
5. Open risk trend modal
