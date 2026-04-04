# Platform Admin And Share Regression

## Scope

This regression note covers platform-level product surfaces that are easy to miss because they are not part of the main daily cockpit flow:

- project share page
- project access control APIs
- admin settings center
- user role / permission tooling

## Smoke Script

Run:

```bash
python scripts/platform_admin_share_smoke.py
```

Current checks:

- share and access routes still exist in `app.py`
- admin config and editable role-matrix routes still exist in `app.py`
- admin settings tabs and permission-tab entry points still exist in `static/js/admin_settings.js`
- role / user-management functions still exist in `static/js/admin_hub.js`
- admin settings and user-permission entry buttons still exist in `templates/index.html`
- shared project template still contains core display structure

## Manual Focus

Browser validation should still cover:

1. Open admin settings modal
2. Switch across all config tabs
3. Open `用户与权限` tab and confirm role matrix + user list both load
4. Modify one non-admin role display name or permission list and save successfully
5. Open standalone user management
6. Open role matrix
7. Toggle one project share token and visit `/share/<token>`
8. Verify project access add / remove still works
