# Payments Ops Runbook (VM Deploy)

## Scope
Operational rollout/rollback guide for payment security hardening on Devitrak backend (`server-testing`).

## Deployment Model (confirmed)
- Frontend apps: build and deploy latest client artifacts.
- Backend on VM: `git pull` + `pm2` restart runs latest repository version.

---

## 1) Pre-Deploy Checklist

1. Confirm target branch and commit:
   - branch: `development` (or approved release branch)
   - `git rev-parse --short HEAD`
2. Ensure env values are present in VM `.env`:
   - `PAYMENTS_DUAL_LANE_ENABLED`
   - `PAYMENTS_MONITOR_MODE`
   - `PUBLIC_PAYMENTS_WINDOW_MS`
   - `PUBLIC_PAYMENTS_CREATE_LIMIT`
   - `AUTH_PAYMENTS_CREATE_LIMIT`
   - `PUBLIC_PAYMENTS_MUTATION_LIMIT`
   - `PAYMENTS_MUTATION_IDEMPOTENCY_TTL_MS`
3. Recommended initial values for first rollout:
   - `PAYMENTS_DUAL_LANE_ENABLED=true`
   - `PAYMENTS_MONITOR_MODE=true`

---

## 2) Backend Deploy (VM)

```bash
cd /path/to/server-testing
git fetch origin
git checkout development
git pull --ff-only origin development
pm2 restart <server-app-name> --update-env
pm2 logs <server-app-name> --lines 200
```

> Use `--ff-only` to avoid accidental merge commits on VM.

---

## 3) Post-Deploy Smoke Checks

### Health / baseline
- Verify process is online in PM2.
- Verify no startup exceptions in logs.

### Payment route smoke checks
1. Public create intent (no token) still works.
2. Authenticated create intent (with token) still works.
3. Invalid payload returns `422`.
4. Burst traffic triggers `429` when threshold exceeded.
5. Duplicate mutation retry reuses response (idempotency cache).

---

## 4) Monitoring Guidance (first 24h)

With `PAYMENTS_MONITOR_MODE=true`, track:
- rate limit hits
- invalid payload rejections
- lane distribution (`public` vs `authenticated`)
- mutation retry replays

If false positives are high, tune limits before enforcement changes.

---

## 5) Rollback Procedure

If regression is detected:

```bash
cd /path/to/server-testing
git log --oneline -n 20
git checkout <last-known-good-commit>
pm2 restart <server-app-name> --update-env
pm2 logs <server-app-name> --lines 200
```

Optional safer rollback branch flow:

```bash
git checkout development
git reset --hard <last-known-good-commit>
pm2 restart <server-app-name> --update-env
```

---

## 6) Recommended Steady-State After Validation

After stable observation window:
- Keep `PAYMENTS_DUAL_LANE_ENABLED=true`
- Set `PAYMENTS_MONITOR_MODE=false`
- Keep tuned per-env limits in config management
- Revisit thresholds quarterly or after traffic shifts
