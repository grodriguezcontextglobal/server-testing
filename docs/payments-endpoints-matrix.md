# Payments Endpoints Matrix

This document clarifies which Stripe endpoints are public-compatible versus internal/admin-protected.

## Public-compatible routes (no mandatory JWT)
These routes are kept compatible for existing external integrations.

- `POST /api/stripe/create-payment-intent`
  - Lane-aware (`public` / `authenticated`) via `optionalJWT`
  - Rate-limited + payload validation + idempotency key support

- `POST /api/stripe/payment-intents/:id/capture`
- `POST /api/stripe/payment-intents/:id/cancel`
- `POST /api/stripe/refund`
- `POST /api/stripe/partial-refund`
  - Public safety controls:
    - rate-limit
    - strict route/payload validation
    - mutation idempotency cache

## Internal/admin routes (JWT + role required)
Protected through `internalStripeGuard = [validateJWT, authorizeAdminRoles()]`.

Examples:
- `POST /api/stripe/accounts`
- `POST /api/stripe/account_link`
- `POST /api/stripe/account_sessions`
- `POST /api/stripe/create-payment-intent-customized`
- `POST /api/stripe/create-payment-intent-subscription`
- `POST /api/stripe/new-company-account`
- `POST /api/stripe/create-subscriptions`
- `POST /api/stripe/create-subscriptions_no_trial`
- `POST /api/stripe/payment-method/subscriptions/:id`
- `POST /api/stripe/payment_methods/:id/attach`
- `POST /api/stripe/payment_intents/:id/update-payment-method`
- `GET /api/stripe/payment-intents/search`
- `POST /api/stripe/setup-search`
- `GET|POST /api/stripe/customers`
- `GET /api/stripe/customers/search`
- `GET /api/stripe/payment_intents/:id`
- `GET|POST /api/stripe/stripe-transactions-saved-list`
- `POST /api/stripe/company-account-stripe/`
- `GET|POST /api/stripe/invoices`
- `POST /api/stripe/cancel/subscriptions/:id`
- `POST /api/stripe/stripe-transaction-admin`
- `DELETE /api/stripe/remove-duplicate/:id`
- `POST /api/stripe/save-transaction-admin-dashboard`
- `GET /api/stripe/transaction`
- `DELETE /api/stripe/removing/:id`
- `GET /api/stripe/subscriptions/:id`
- `PATCH /api/stripe/updating-subscription/:id`
- `DELETE /api/stripe/subscriptions/:id`

## Internal aliases for sensitive mutations
These internal aliases exist for explicit protected usage:

- `POST /api/stripe/internal/payment-intents/:id/capture`
- `POST /api/stripe/internal/payment-intents/:id/cancel`
- `POST /api/stripe/internal/refund`
- `POST /api/stripe/internal/partial-refund`

## Environment controls
Configured via `.env`:

- `PAYMENTS_DUAL_LANE_ENABLED`
- `PAYMENTS_MONITOR_MODE`
- `PUBLIC_PAYMENTS_WINDOW_MS`
- `PUBLIC_PAYMENTS_CREATE_LIMIT`
- `AUTH_PAYMENTS_CREATE_LIMIT`
- `PUBLIC_PAYMENTS_MUTATION_LIMIT`
- `PAYMENTS_MUTATION_IDEMPOTENCY_TTL_MS`
