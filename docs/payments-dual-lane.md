# Public Payments Dual-Lane Behavior

## Endpoint
`POST /api/stripe/create-payment-intent`

## Purpose
Allow both external (unauthenticated) and internal (authenticated) callers to use the same endpoint without client-side changes, while enforcing different server-side protections.

## Request Lanes

### 1) Public lane (external users)
- Triggered when no valid `x-token` is provided.
- Protections:
  - Public rate limiting (`PUBLIC_PAYMENTS_CREATE_LIMIT`, default `30` per 5 minutes).
  - Payload validation (`device` must be a positive number).
  - Server-side idempotency key generation when not provided.

### 2) Authenticated lane (internal/admin users)
- Triggered when a valid `x-token` is provided.
- Protections:
  - Authenticated rate limit (`AUTH_PAYMENTS_CREATE_LIMIT`, default `120` per 5 minutes).
  - Same payload validation and idempotency protections.

## Middleware Chain
1. `optionalJWT`
2. `publicPaymentRateLimit`
3. `validatePublicPaymentPayload`
4. `attachServerIdempotencyKey`
5. `stripePaymentIntent`

## Notes
- No endpoint change required on client-side.
- Existing integrations continue to work.
- Logs include `lane` (`public` or `authenticated`) for observability.
