# Auth Async WeCom Regression

## Scope

This regression note covers the platform backbone around:

- auth and session routes
- task center async routes
- async task trigger endpoints
- WeCom callback / OAuth / JS-SDK route surface
- auth frontend helpers

## Smoke Script

Run:

```bash
python scripts/auth_async_wecom_smoke.py
```

Current checks:

- auth / user / task / async trigger routes still exist in `app.py`
- auth frontend still exposes login / logout / overlay / WeCom bind helpers
- task center script still exposes task loading / retry / cancel / cleanup functions
- WeCom route file still exposes callback / config / oauth route fragments

## Manual Focus

Browser validation should still cover:

1. Overlay login still renders
2. Normal login / register modal still renders
3. Task center list / detail / retry / cancel still work
4. WeCom login redirect path still exists
