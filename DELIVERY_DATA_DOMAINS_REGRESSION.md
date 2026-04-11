# Delivery Data Domains Regression

## Scope

This regression note covers the backend CRUD route groups that support the project-delivery workflow:

- project core
- members / contacts
- worklogs / departures
- documents / expenses
- lifecycle records
- task / issue / device updates

These route groups are the data foundation behind project detail, so even if UI shells remain intact, a route regression here would break core workflows.

## Smoke Script

Run:

```bash
python scripts/delivery_data_domains_smoke.py
```

Current checks:

- project routes still expose project / stage / milestone / interface / issue / device / dependency operations
- member routes still expose member and contact CRUD
- log routes still expose worklog and departure operations
- document routes still expose document / expense operations
- lifecycle routes still expose change / acceptance / satisfaction / follow-up operations
- task routes still expose stage/task toggle and issue/device updates

## Manual Focus

Browser validation should still cover at least one successful CRUD flow in:

1. project members
2. worklogs
3. documents
4. expenses
5. changes
6. acceptances
