# Handoff — Slack thread 1773321669.039519

Date: 2026-03-12 (UTC)
Owner: Gustavo Rodriguez
Project context: Devitrak (backend `server-testing`, frontend `testing-admin-dashboard`)

## Communication Contract
- This Slack thread is the exclusive communication channel for this project.
- PR titles/descriptions must be in English.

## Repos / Branching
- Backend repo: `grodriguezcontextglobal/server-testing`
- Frontend repo: `grodriguezcontextglobal/testing-admin-dashboard`
- Active backend working branch used: `chore/security-baseline`
- Target merge branch: `development`

## Security/Payments Work Completed (backend)
All changes were pushed to `origin/chore/security-baseline`.

### 1) Public payments hardening (server-only, no client-side dependency)
- Added:
  - `middlewares/publicPaymentRateLimit.js`
  - `middlewares/validatePublicPaymentPayload.js`
  - `middlewares/attachServerIdempotencyKey.js`
- Updated:
  - `routes/stripe.js`
  - `controller/stripe.js`
- Behavior:
  - Rate limit on public payment routes
  - Payload validation for create payment intent
  - Idempotency key handling for payment intent creation

### 2) Internal Stripe protection (JWT + role authorization)
- Added:
  - `middlewares/authorizeAdminRoles.js`
- Updated:
  - `routes/stripe.js`
- Behavior:
  - Internal/admin Stripe routes guarded with `validateJWT` + role checks
  - Public consumer flow kept compatible

### 3) Public-safe + internal aliases for mutation routes
- Added:
  - `middlewares/validateStripeRoutePayload.js`
- Updated:
  - `routes/stripe.js`
- Behavior:
  - Public existing routes kept available with stricter validation
  - Added internal aliases under `/internal/...` for capture/cancel/refund

### 4) Dual-lane handling for `create-payment-intent`
- Added:
  - `middlewares/optionalJWT.js`
- Updated:
  - `middlewares/publicPaymentRateLimit.js`
  - `routes/stripe.js`
  - `controller/stripe.js`
- Behavior:
  - Same endpoint supports:
    - public lane (no token)
    - authenticated lane (token present)
  - No client endpoint changes required

### 5) Configurable policy + monitor mode
- Added:
  - `config/paymentsPolicy.js`
  - `test/paymentsPolicyConfig.test.js`
- Updated:
  - `middlewares/optionalJWT.js`
  - `middlewares/publicPaymentRateLimit.js`
- Env controls:
  - `PAYMENTS_DUAL_LANE_ENABLED`
  - `PAYMENTS_MONITOR_MODE`
  - `PUBLIC_PAYMENTS_WINDOW_MS`
  - `PUBLIC_PAYMENTS_CREATE_LIMIT`
  - `AUTH_PAYMENTS_CREATE_LIMIT`
  - `PUBLIC_PAYMENTS_MUTATION_LIMIT`

### 6) Idempotency cache for mutation retry safety
- Added:
  - `middlewares/idempotencyMutationCache.js`
  - `test/idempotencyMutationCache.test.js`
- Updated:
  - `routes/stripe.js`
- Behavior:
  - TTL-based response replay for duplicate mutation retries
  - Uses `Idempotency-Key` header when present

## Documentation Added
- `docs/endpoint-map.md`
- `docs/payments-dual-lane.md`

## Test Status during session
- Node test suite expanded and passing at last run:
  - `14/14` tests passing

## Notable Commits on `chore/security-baseline`
- `80e6a7c` feat(payments): add server-side hardening for public stripe routes
- `c86d096` test(payments): add no-regression coverage for public hardening
- `dee4684` feat(stripe): enforce JWT and role checks on internal admin endpoints
- `7ff76eb` feat(stripe): split public-safe and internal refund/capture paths
- `11de95d` feat(payments): add dual-lane handling for create-payment-intent
- `4503068` docs(payments): add dual-lane endpoint behavior reference
- `7586312` feat(payments): add configurable dual-lane policy and monitor mode
- `55e44e1` feat(payments): add idempotency cache for mutation retry safety

## Deployment Context Confirmed by Gustavo
- Apps and server are deployed on a VM.
- Frontend deploy flow: build latest client app version, then deploy.
- Backend deploy flow: `git pull` + PM2 restart to run latest repo version.

## Recommended Next Steps
1. Add `.env.example` entries for all new `PAYMENTS_*` variables.
2. Add `docs/payments-ops-runbook.md` with VM rollout/rollback and post-deploy checks.
3. Deploy with monitor mode first, observe logs, then tune limits.
