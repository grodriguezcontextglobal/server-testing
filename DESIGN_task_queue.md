# Design — Durable task queue over MongoDB (store-and-forward)

> Goal: **no important task should ever be lost** even if the server or an external dependency
> (SendGrid, Stripe, S3, Go worker, DB) is down. Tasks are persisted in a MongoDB Atlas
> collection, the client gets an immediate response, and a worker processes them once the
> dependency is healthy again, with retries and backoff.

This document defines the architecture, data model, server and frontend changes, and the
**phased action plan** following the team's methodology: **test → code → refactor**.

---

## 1. Scope

**Goes into the queue** (side effects, fire-and-forget, idempotent or dedupable):

| Tier | Operations | Service | Frontend change |
|---|---|---|---|
| **1 — Pilot** | Emails `/api/nodemailer/*` (33 routes) | SendGrid / nodemailer | **None or minimal** (already background) |
| **1** | Logs: `notificationLog`, `eventLog`, `errorLog`, `staffActivityLog` | Mongo | None |
| **1** | Go worker writes (mutating `runGoWorker`) | Go worker | None |
| **2** | Uploads to S3 / Cloudinary (documents) | S3 / Cloudinary | Partial (client wants the URL) |
| **3** | Stripe mutations | Stripe | Stay **synchronous** with retry + circuit breaker (NOT blindly queued) |

**Does NOT go in** (stays synchronous): all `GET`s, login, validations that return data
immediately, Go worker reads, and any Stripe mutation (money doesn't get buffered).

> Golden rule for queueing: (1) the client doesn't need the result right away, (2) it touches an
> external service that can fail, (3) it's idempotent or dedupable by key.

---

## 2. Architecture

```
                                 ┌──────────────────────────────────────────────┐
Client ─POST─► IIS ─► Node :34001                                                │
 (frontend)              │                                                       │
                         │ 1. enqueue(job)  ── inserts doc into Mongo (status=pending)
                         │ 2. responds 202 { ok, jobId }  ◄── client moves on     │
                         │                                                       │
                         ▼                                                       │
                 ┌─────────────────┐        ┌──────────────────────────────┐   │
                 │ MongoDB Atlas    │◄───────│  Worker / Dispatcher          │   │
                 │  jobs collection │ atomic │  (single instance:            │   │
                 │  (durable)       │ claim  │   pm2 NODE_APP_INSTANCE==0)    │   │
                 └─────────────────┘        │  - findOneAndUpdate            │   │
                         ▲                   │  - runs handler per type       │   │
                         │  retry             │  - backoff / dead-letter       │   │
                         └───────────────────│  - node-schedule polling +     │   │
                                             │    (optional) Change Streams   │   │
                                             └──────────────┬─────────────────┘   │
                                                            ▼                     │
                                          SendGrid / Go worker / S3 / Mongo ...   │
                                          (if down → job goes back to pending,   │
                                           NOT lost, survives restarts)          │
                                                                                  ┘
```

Key decisions:
- **The queue lives in MongoDB Atlas.** It leverages `findOneAndUpdate` (atomic document-level
  claim), a TTL index (auto-cleanup) and, optionally, Change Streams (avoids polling). Doesn't
  bill per read like PlanetScale.
- **A single worker.** Started by reusing the `isPM2FirstInstance` pattern from
  [`index.js:270`](index.js) — so the `pm2 -i max` cluster doesn't duplicate it. This eliminates
  at the root the problem of two processes claiming the same job.
- **Enqueue runs on any instance** (it's just an insert).

---

## 3. Data model — `models/Job.js`

Follows the repo's Mongoose pattern (`Schema` + `model` + `toJSON`, see
[`models/NotificationLog.js`](models/NotificationLog.js)).

```js
const { Schema, model } = require("mongoose");

const JobSchema = Schema(
  {
    type:            { type: String, required: true, index: true }, // 'send-email:invoice', 'go-worker:insert-item-event', ...
    payload:         { type: Schema.Types.Mixed, required: true },  // task args
    status:          { type: String, enum: ["pending","processing","done","failed","dead"], default: "pending", index: true },
    attempts:        { type: Number, default: 0 },
    maxAttempts:     { type: Number, default: 5 },
    nextAttemptAt:   { type: Date, default: Date.now, index: true }, // for backoff
    lockedBy:        { type: String, default: null },                // id of the worker that claimed it
    lockedAt:        { type: Date, default: null },
    idempotencyKey:  { type: String, default: null, unique: true, sparse: true }, // dedup
    lastError:       { type: String, default: null },
    result:          { type: Schema.Types.Mixed, default: null },    // optional: output for querying
    doneAt:          { type: Date, default: null },                  // TTL removes old 'done' jobs
    context: {                                                       // see §4 — audit snapshot
      uid:        { type: String, default: null },
      companyId:  { type: String, default: null },
      sqlStaffId: { type: Number, default: null },
    },
  },
  { timestamps: true } // createdAt / updatedAt
);

// Compound index for an efficient claim
JobSchema.index({ status: 1, nextAttemptAt: 1 });
// TTL: removes 'done' jobs 7 days after doneAt (0s after the date)
JobSchema.index({ doneAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
// Audit/support: list jobs by company (e.g. "what got queued for C1")
JobSchema.index({ "context.companyId": 1, createdAt: -1 });

JobSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();
  object.id = _id;
  return object;
});

module.exports = model("Job", JobSchema);
```

> `idempotencyKey` with `unique + sparse`: if you try to enqueue the same action twice (e.g. the
> same email), the second insert fails → you treat it as "already queued", with no duplication.

---

## 4. Audit context on jobs (identity, not credentials)

### 4.1 The problem

Every backend request carries session/context headers — in this repo today:
`x-token`, `s-token-lq`, `x-company-id`, `s-company-id` — which middlewares (`validateJWT`,
`optionalJWT`, `authorizeMongoPermission`) read and verify, leaving the result attached to `req`
(`req.uid`, `req.sqlStaffId`, `req.adminRoleType`, ...).

When a task is enqueued, **the `req` that originated it stops existing** by the time the worker
runs it — that could be seconds or even days later (a dead-letter retried by hand). If nothing is
captured, the job ends up "orphaned": there's no way to know who requested it, under which
company, or to audit the action later.

### 4.2 The underlying rule (applies to any future header, not just the current 4)

> **Already-verified identity gets persisted. Credentials never do.**

- `x-token` and `s-token-lq` are credentials (JWT / staff id derived from a session). **They are
  never stored raw** in a `jobs` document — that document lives in Mongo, readable by anyone with
  read access to the collection, and a leaked JWT is a compromised account.
- What IS stored is the **already-validated result** from the middleware that ran before the
  controller: `req.uid` (set by `validateJWT`/`optionalJWT` after verifying the JWT signature),
  `req.sqlStaffId`, the already-resolved `companyId`. That verification **already happened** in the
  original request; the job doesn't re-authenticate, it only **audits who triggered the action**.
- `s-company-id` is reserved in CORS ([`config/cors.js`](config/cors.js)) but **no middleware reads
  it today** — it's not included in the context yet because there's no semantics to capture. The
  day it gets used, it gets added following the same pattern (§4.4).

### 4.3 Design: `buildContext` as a strict allowlist

`queue/core.js` exposes a **pure** function that normalizes any input object down to exactly 3
known fields, discarding everything else:

```js
// queue/core.js
function buildContext(source = {}) {
  const { uid = null, companyId = null, sqlStaffId = null } = source || {};
  return { uid, companyId, sqlStaffId };
}
```

The important property: **it's an allowlist, not an exclusion filter**. If someone mistakenly
passes `{ uid, xToken: '<raw-jwt>' }`, `xToken` gets silently dropped — there's no way for a
secret to leak into the document even if the code calling `enqueue` has a bug. This is verified
in `test/queue.test.js` (`buildContext: is an allowlist — drops any unrecognized field`).

`helpers/queue.js` exposes the only piece that actually touches `req` — a thin extractor that
replicates the same `companyId` precedence order already used by
[`authorizeMongoPermission.js`](middlewares/authorizeMongoPermission.js) (header → body →
params → query), so as not to invent a second convention:

```js
// helpers/queue.js
const extractJobContext = (req) => {
  const headerCompanyId =
    (typeof req.header === "function" ? req.header("x-company-id") : undefined) ||
    req.headers?.["x-company-id"];

  return {
    uid: req.uid ?? null,
    companyId: headerCompanyId || req.body?.company_id || req.params?.company_id || req.query?.company_id || null,
    sqlStaffId: req.sqlStaffId ?? null,
  };
};
```

Usage in a controller (Phase 1+):

```js
const { enqueue, extractJobContext } = require("../helpers/queue");

await enqueue("send-email:invoice", payload, {
  idempotencyKey: `invoice:${transactionId}`,
  context: extractJobContext(req), // audit snapshot, captured while req still exists
});
```

### 4.4 How to scale this as new needs come up

This design was meant to grow without being rewritten. Foreseeable cases and how to solve them:

| Future need | Where to touch | What NOT to do |
|---|---|---|
| `s-company-id` gets real use (e.g. replaces `x-company-id`) | Add the read in `extractJobContext` with the same precedence as its current counterpart | Don't read it "just in case" before it has defined semantics |
| A new context header (e.g. `x-event-id`, `x-locale`) | 1) Add the field to `buildContext` (allowlist) 2) Add it to the `context` subschema in `models/Job.js` 3) Read it in `extractJobContext` | Never spread the full `req.headers` into the context — breaks the allowlist and can leak credentials without anyone noticing |
| A handler needs to **re-authorize** instead of just auditing (e.g. verify the company is still active before executing) | The handler receives `job.context.companyId` and re-queries `Company`/`hasPermission` itself, the same way `authorizeMongoPermission` does today | Don't assume the permission is still valid just because it was checked at enqueue time — days may pass before a retry |
| Need to **list/debug** jobs by company or by user | The `{ "context.companyId": 1, createdAt: -1 }` index already exists; for `uid` add an analogous index when there's an actual query that needs it | Don't index speculatively without a concrete query justifying it |
| A job type needs an audit field that **doesn't apply to the others** | Don't force it into the generic `context` — it belongs in `payload`, which is free-form per type | Don't bloat the shared `context` with fields for a single use case |

The core idea that makes this scalable: **`context` is cross-cutting infrastructure (who, for
which company), `payload` is the task-type-specific data.** As long as that separation is
respected, adding a new cross-cutting field is a 3-line change across 3 files (core → schema →
extractor), not a redesign.

---

## 5. Server components

### 5.1 `helpers/queue.js` — enqueue API (used by controllers)
```js
// enqueue(type, payload, { idempotencyKey, maxAttempts, context }) -> returns the jobId
// A simple Job.create(...). If the idempotencyKey collides (E11000), returns the existing job.
// extractJobContext(req) -> builds the context (see §4) to pass to enqueue.
```

### 5.2 `queue/worker.js` — dispatcher (runs on a single instance)
Responsibilities:
1. **Atomic claim** of N ready jobs:
   ```js
   const job = await Job.findOneAndUpdate(
     { status: "pending", nextAttemptAt: { $lte: new Date() } },
     { $set: { status: "processing", lockedBy: WORKER_ID, lockedAt: new Date() } },
     { sort: { nextAttemptAt: 1 }, new: true }
   );
   ```
2. **Runs the handler** based on `job.type` (see 5.3). The handler receives `(payload, job)`, so
   it can read `job.context` if needed (e.g. for logging or re-scoping by company).
3. **Success** → `status="done"`, `doneAt=now` (TTL cleans it up later).
4. **Failure** → `attempts++`; if `attempts < maxAttempts`: `status="pending"`,
   `nextAttemptAt = now + backoff(attempts)` (e.g. `min(2^attempts * 1s, 5min)`);
   once exhausted: `status="dead"` (dead-letter, requires manual intervention).
5. **Recovery of hung "processing" jobs**: on startup (or in a sweep), jobs with
   `status="processing"` and a stale `lockedAt` (older than the timeout) go back to `pending`.
   Covers the case where the server died mid-job.

Cycle trigger:
- **Polling** with `setInterval` (`QUEUE_POLL_MS`, default 4s). Enough for emails/logs.
- **Optional (later phase)**: Change Streams on `jobs` to react instantly and reduce latency.

### 5.3 `queue/handlers/` — registry of handlers by type
A `type -> async (payload, job) => result` map. Each handler encapsulates logic that today lives
inline in the controller. Example: `send-email:invoice` reuses the HTML/send logic from
[`nodeMailer/notifications.js`](nodeMailer/notifications.js).

### 5.4 Starting the worker
In [`index.js`](index.js), inside the `isNativeMaster || isPM2FirstInstance` block (alongside the
Go worker startup):
```js
require("./queue/worker").start();
```
This way it runs **only once**, not once per cluster worker.

---

## 6. Idempotency by type

| Type | Idempotency key | Note |
|---|---|---|
| Emails | `email + template + entity` (e.g. `invoice:{transactionId}`) | Avoids double-send on retry |
| Go worker (mutation) | `operation + entity` (e.g. `insert-item-event:{itemId}:{eventId}`) | Reconcilable |
| Logs | *(none)* | Duplicates are acceptable; not critical |
| S3/Cloudinary documents | `documentId` | Avoids uploading twice |

---

## 7. FRONTEND changes

The key point: **Tier 1 requires almost no changes**, because those operations are already
background.

### Phase 1 — Emails and logs (minimal impact)
- Today the frontend does `POST /api/nodemailer/...` and typically only needs to know it was
  "accepted", not that it was "delivered".
- The endpoint now responds **`202 { ok: true, jobId }`** immediately (previously it responded
  after sending).
- **Frontend change:**
  - If the UI only shows "email sent" → change the copy to **"email queued / will be sent
    shortly"** (more honest semantics). Nothing else.
  - If any flow **blocked** waiting for send confirmation → remove that block; it no longer
    applies.
- **No** change to endpoints or input payload. Only the response shape changes (from `{ok:true}`
  to `{ok:true, jobId}`) and the timing (immediate).
- Headers (`x-token`, `x-company-id`, ...) are still sent exactly the same as today — the
  frontend doesn't change anything there; it's the backend that captures them as `context` before
  enqueueing (see §4).

### (Optional) Tracking a job's status
If any flow wants to confirm it completed:
- New endpoint **`GET /api/jobs/:jobId`** → `{ status, attempts, lastError, result }`.
- The frontend **polls** (every few seconds) until `done`/`dead`, or shows the status in a panel.
- Future alternative: push notification / websocket on completion (reusing `notificationLog`).

### Phase 2 — Documents (S3/Cloudinary)
- Here the client usually does want the final URL. Async contract:
  1. `POST` → `202 { jobId }`.
  2. Frontend polls `GET /api/jobs/:jobId` until `done`, and reads `result.url`.
- Requires a real adjustment on the upload screen (show "processing…" then the URL).

### Phase 3 — Stripe
- **The frontend doesn't change.** Stays synchronous; only the backend is hardened with retry +
  circuit breaker.

---

## 8. Operations and observability

### 8.1 Endpoints — `GET /api/jobs/*` ✅ implemented

Both protected with `requireSuperUser` (see §8.2 — not `authorizeMongoPermission`, because a job
doesn't belong to a single company).

- **`GET /api/jobs/stats`** → `{ ok, stats: { pending, processing, done, failed, dead, total } }`.
  All statuses listed even if they're 0 (none are omitted). Must be mounted **before** `/:jobId`
  in the route, otherwise Express would capture it as a `jobId`.
- **`GET /api/jobs/:jobId`** → full detail for debugging: `type`, `status`, `payload`,
  `context`, `attempts`, `lastError`, `result`, timestamps. `400` if `jobId` isn't shaped like a
  Mongo ObjectId (24 hex chars), `404` if it doesn't exist.

Implementation: `controller/jobs.js` (`createGetJobStatus`/`createGetJobStats`, with
`findById`/`aggregateByStatus` injection to test without Mongo — same DI pattern as the rest of
the queue) + `routes/jobs.js`, mounted in `index.js` as `jobs: require("./routes/jobs")` inside
`mongoRoutes` (→ `/api/jobs`).

### 8.2 Access control: why `requireSuperUser` and not `authorizeMongoPermission`

`authorizeMongoPermission` requires a context `company_id` (or `super_user` as a bypass) because
the resources it protects always belong to a company. A queue job **is not one of those**: an
email, a staff log, etc. can belong to any company, and `/api/jobs/stats` is inherently a
platform-wide view. `middlewares/requireSuperUser.js` was created — a minimal gate (active +
`super_user`) — instead of forcing these endpoints into the per-company permission scheme.

### 8.3 Operational usage

- **Point inspection**: `GET /api/jobs/:jobId` to see why a specific job failed (`lastError`,
  `attempts`) without needing direct Mongo access.
- **Direct DB inspection**: `db.jobs.find({ status: "dead" })` → tasks that exhausted retries.
- **Inspection by company**: `db.jobs.find({ "context.companyId": "C1" }).sort({ createdAt: -1 })`.
- **Manual retry**: put a `dead`/`failed` job back to `pending` with `nextAttemptAt=now`.
- **Metrics**: `GET /api/jobs/stats` for a simple dashboard or alerts.
- **Alerts**: if `dead` count > threshold, notify (alert emails must NOT depend on the queue).
- **Cleanup**: TTL removes old `done` jobs automatically; `dead` ones are kept for auditing.

---

## 9. Phased action plan (test → code → refactor)

### Phase 0 — Queue foundations ✅ COMPLETED
1. **Tests** (`test/queue.test.js`, 27 cases):
   - `enqueue`/`buildNewJob` creates a `pending` job.
   - `context`: strict allowlist, never raw credentials (see §4.3).
   - `extractJobContext`: reads already-verified identity from `req`, never `x-token`/`s-token-lq`.
   - atomic claim: `findOneAndUpdate` filter/update documented and tested.
   - backoff: on failure, `attempts++` and a future `nextAttemptAt` (exponential with a cap).
   - dead-letter: once `maxAttempts` is exhausted, moves to `dead`.
   - recovery: a hung `processing` job (`isStale`) goes back to `pending`.
2. **Code**: `queue/core.js` (pure core), `models/Job.js`, `helpers/queue.js`,
   `queue/worker.js`, `queue/handlers/index.js`.
3. **Refactor**: decision logic isolated into pure, DB-free testable functions, same as
   `scripts/migrate*` and `idempotencyMutationCache`.
4. Worker started in `index.js` under `isNativeMaster || isPM2FirstInstance`.

### Phase 1 — Pilot: emails + logs ✅ COMPLETED (errorLog handled separately, see note)

**Emails — done, 30 of 35 routes migrated** (initial pilot of 4 + replication across 26 more in
two batches, classified by risk profile):

1. **Pilot (4)**: `singleEmailNotification`, `newUserInvitationNotification`,
   `internalNotification`, `eventBeginsReminderNotification`.
2. **Batch A — 22 simple routes** (same risk profile as the pilot: a single message, no
   validation, no DB dependency): `assingDeviceNotification`, `returningDeviceNotification`,
   `returningDeviceLeaseMemberNotification`, `deviceReportPerTransaction`,
   `cancelDepositNotification`, `captureDepositNotification`, `earlierReturningNotification`,
   `eventStaffNotification`, `editingDeviceAdminNotification`,
   `confirmationLinkNewConsumerNotification`, `loginLinkExistingConsumerNotification`,
   `linkToResetPassword`, `customizedEmailNotification`, `staffInternalNotification`,
   `itemInfoStaffNotification`, `eventLinkEvent`, `chargeInvoice`, `refundInvoice`,
   `completedTask`, `failedTask`, `forcingRevokingActiveSession`, `memberEmailNotification`.
3. **Batch B — 8 routes with input validation** (400 if fields are missing):
   `lostDeviceFeeCollectedNotification`, `liabilityContractMemberNotification`,
   `liabilityContractConsumerNotification`, `liabilityContractStaffNotification`,
   `termsAndConditionsAcceptanceNotification`, `documentSigningCompletionNotification`,
   `consumerDocumentSigningCompletionNotification`, `consumerLeaseEndedDeviceReturnedNotification`.

**Necessary factory extension (before Batch B)**: `createQueuedJobController` gained two
capabilities, each with its own tests:
- **`opts.validate(body)`** — runs before enqueueing; if it returns `{status, body}`, that's what
  gets returned and nothing gets enqueued. Without this, migrating a route with validation
  (`if (!x) return res.status(400)...`) would have turned those `400`s into `500`s by moving the
  logic into the generic `catch` — a real contract change, not a cosmetic one. Tested with TDD
  before touching any Batch B endpoint.
- **`buildPayload` as async** — allows building messages that depend on more elaborate composition
  (see next point); `await`-ed internally, compatible with existing sync builders.

**Multiple messages without a new handler**: `documentSigningCompletionNotification` and
`consumerDocumentSigningCompletionNotification` sent 2 emails with
`Promise.all([sgMail.send(msg1), sgMail.send(msg2)])`. `sgMail.send()` natively accepts an
**array** of distinct messages in a single call — an exact equivalent of the original
`Promise.all`. That's why the `buildPayload` for these two returns `[msg1, msg2]` and the same
generic `send-email` handler (which just forwards the payload to `sgMail.send(payload)`) processes
them with no changes. Zero new handlers for this case.

**2 pre-existing bugs fixed along the way** (extracting a correct builder made it impossible to
replicate the broken bugs without deliberately rewriting broken logic):
- `earlierReturningNotification`: `ReferenceError` — used a `msg` variable that was never defined
  (the real variable was `info`), and passed `returnReminderMessageHtml` as a function reference
  without invoking it. The endpoint was **100% broken** (always returned 500). The invocation is
  fixed; the template itself (`returnReminderMessageHtml`) remains a stub returning `""` — no new
  content was invented, that's a product decision out of scope.
- `linkToResetPassword`: if `sgMail.send` failed, the `catch` only logged and **never
  responded** — the client hung until the 30s timeout. The generic factory always responds.

**Refactor**: no pending duplication. The pattern (pure `build*Message` + `createQueuedEmailController`,
with `validate` where applicable) is now uniform across the 30 migrated routes.

**Frontend**: the 30 migrated routes respond `202 {ok:true, notification, jobId}` instead of
`201 {ok:true, notification:"Email sent"}` (or whatever variable balance each one had). Validation
`400`s **did not change** (same status, same body). Adjust copy/UX per §7 Phase 1 before
considering these routes "in production".

**5 routes are deliberately left unmigrated** (profiles that don't fit the mechanical pattern;
forcing the migration would have meant real risk, not just extra work):

| Route | Why it's left for later |
|---|---|
| `returnedItemsToRenterNotification` | Base64 attachments (route has a 100MB limit in `index.js`) — could get close to or exceed Mongo's **16MB per-document limit**, and a job isn't a safe place for large blobs |
| `massiveEventCustomerNotification` | Depends on `User.find()` (DB query) to build the recipient list, with an early-return branch if there are no results, and uses `sgMail.sendMultiple` (fan-out by *personalization*, not 1:1 interchangeable with `.send()` without changing what each recipient sees) |
| `devitrakFeedbackEmailNotification` | Same profile as the previous one |
| `errorFeedbackEmailNotification` | Internal function (not HTTP); its only caller is `createErrorFeed`, which is already blocked by the `errorId` issue (see logs note) |
| `loginActivityNotification` | Internal function triggered with `setImmediate` from `controller/admin.js` (fire-and-forget relative to the login response); same pattern as `logStaffActivity` but left pending due to this session's scope, not risk |

**Logs — done, with a relevant finding:** before migrating, the repo was audited for any internal
dependency on the synchronous document these endpoints returned (grepping field names, routes,
`API_DOCS.md`/`API_CLIENT_GUIDELINES.md`). Result:

- **`logStaffActivity`** (`controller/staffActivityLog.js`) — not an HTTP endpoint, it's an
  internal function invoked as `await logStaffActivity({...})` from `admin.js`, `event.js` and
  `inventory.js` (12 call sites). It never returned anything and **swallowed the error in a
  try/catch without rethrowing** — meaning if `save()` failed, the audit log was silently lost
  forever. Migrated to `enqueue("log:staff-activity", data)`: the contract for callers doesn't
  change (still doesn't throw, still doesn't return anything), but the failure now survives via
  retry + dead-letter instead of being lost. No audit `context`: `data` itself
  (`staff_member_id`/`company_id`) already IS the log's subject.
- **`feedEventLog` / `feedNotificationLog`** — no internal consumer of `feedEvent`/
  `feedNotification` in this repo, no mention in `API_DOCS.md`/`API_CLIENT_GUIDELINES.md`. The
  user confirmed the frontend doesn't depend on the returned document → migrated with the same
  generic factory (`createQueuedJobController`, extracted from `nodeMailer/queueEmail.js` once
  this second real consumer appeared). Respond `202 {ok:true, jobId}`.
- **`createErrorFeed`** (`/api/error_log`) — migrated. See §9.1 "Phase 1 — closing pending items".

**Pre-existing bug found (unrelated to this phase, not fixed here):**
[`nodeMailer/returningDeviceMessage.js:2038`](nodeMailer/returningDeviceMessage.js) uses
`props.eventSelected ?? props.eventSelected.length > 0` — with `??` instead of `&&`, if
`eventSelected` is `undefined` it still evaluates `.length` on `undefined` and throws. Affects
`singleEmailMessageHtml` (and possibly other templates with the same pattern). Documented to fix
separately.

### Phase 1 — closing pending items ✅ COMPLETED (`createErrorFeed` + 5 deferred routes)

The 6 tasks left pending after finishing the emails+logs pilot. All resolved with TDD, in this
order: factory extension → `loginActivityNotification` → `createErrorFeed` →
`massiveEventCustomerNotification`/`devitrakFeedbackEmailNotification` → `returnedItemsToRenterNotification`.

**Shared infrastructure extension** — `createQueuedJobController` (`helpers/queuedController.js`)
gains support for **"null payload = nothing to enqueue"**: if `buildPayload` resolves to
`null`/`undefined`, `enqueue` isn't called and the response uses `opts.buildSkippedBody` (default
`{ok:true}`). Needed for the two endpoints that query the DB to build recipients and can
legitimately have no one to send to.

**`loginActivityNotification`** — internal function (inside a `setImmediate` in
`controller/admin.js`, fire-and-forget relative to login) migrated with exactly the same criteria
as `logStaffActivity`: `buildLoginActivityMessage` is extracted (sanitizes + composes the
message) and enqueued as `send-email`. The contract for the caller doesn't change (never throws,
always returns `{success, message}`).

**`createErrorFeed` + `errorFeedbackEmailNotification`** — resolved together (the second was an
internal function whose only caller was the first).
- **Pre-generating the `_id`**: Mongoose assigns the `_id` when constructing `new ErrorLogs(...)`,
  before `.save()`. That id is used to respond to the client immediately (preserving the promise
  *"Please save the id for future reference"*) and the persistence is enqueued passing that same
  explicit `_id` (`ErrorLogs.create({_id: errorId, ...})` respects the given id).
- **Two independent jobs**, not a combined one: `log:error` (persists the document, reuses
  `createModelInsertHandler`) and `send-email` (the notification, with `buildErrorFeedbackMessage`
  replacing the old `errorFeedbackEmailNotification`). Each with an `idempotencyKey` based on the
  same `errorId`. Previously, both ran in the same synchronous `try/catch` — if the email failed,
  the response was `500` **even though the log had already been saved**; with independent jobs
  that coupling disappears.
- **Validation added deliberately** (deliberate behavior change, not cosmetic): `validateErrorFeed`
  was added to reject with `400` if `componentStack`/`error` is missing. Without this, Mongoose's
  rejection (`required: true`) would happen inside the worker, invisible to a client that already
  got a `200` with an `errorId` that will never be persisted.

**`massiveEventCustomerNotification` / `devitrakFeedbackEmailNotification`** — both query
`User.find()` to build recipients and use `sgMail.sendMultiple` (fan-out by *personalization*:
each recipient doesn't see the others — different semantics from `.send()` with an array, which
is used elsewhere for *distinct* messages). Resolved with:
- A new `type: "send-email-multiple"`, registered with the same generic `createEmailHandler`
  pointing to `sgMail.sendMultiple` instead of `sgMail.send` — zero new handler code.
- Async `buildPayload` (`createBuildMassiveEventCustomerMessage`/`createBuildDevitrakFeedbackMessage`,
  parametrized by the lookup function so it can be tested without Mongo) runs the query **only
  once** and returns `null` if there are no recipients — uses the factory extension above, instead
  of querying twice (once to "validate there's someone" and again to build the message).

**`returnedItemsToRenterNotification`** — the trickiest one, due to MongoDB's 16MB per-document
limit. Resolved with **Option A** (upload to S3 before enqueueing):
- Validation (`subject`, `staffEmails`, email format, each attachment's shape, file existence if
  provided via `path`) stays **identical** to the original — same messages, same `400`s. It's
  purely synchronous, doesn't touch S3.
- `createBuildReturnedItemsToRenterMessage(uploadAttachment)`: for each attachment, if it comes
  with `path` it reads the real file from disk (same as before); uploads the content to S3
  (`helpers/s3Upload.js` → `uploadNotificationAttachment`, new) and the job payload only stores
  `attachmentRefs: [{key, filename, type}]` — **never the base64**. `helpers/s3Upload.js` doesn't
  follow the DI pattern of the rest of the queue (it's a pre-existing module with its own style);
  test injection happens in the builder, not the helper.
- New `type: "send-email-multiple-with-attachments"`
  (`queue/handlers/emailWithAttachments.js`): the worker resolves each `attachmentRef` to base64
  (`fetchAttachmentAsBase64`, new) right before sending, builds `msg.attachments` in the format
  SendGrid expects, and **if the send succeeded**, deletes the S3 objects (reuses the already
  existing `deleteDocumentFromS3`) — best-effort, a cleanup failure doesn't break the job. If the
  send fails, the attachments are **not deleted**, so the retry can resolve them again.

### Phase 2 — Go worker + documents ✅ COMPLETED

**Finding made before implementing, just as important as the deferred-emails one:** of the 6
candidate Go worker mutations, **5 of 6 use the result synchronously** (counts, affected rows, or
branch on `status==="error"`) — the client needs them in the same response, they're not
fire-and-forget. Only `insert-device-event-container` truly qualified.

| Function | Go worker operation | Uses the result in the response? | Treatment |
|---|---|---|---|
| `insertingItemInEvent` | `insert-item-event` | Yes (`inserted_items`, `total_items`) | Synchronous, no changes |
| `insertingDeviceInEventDirectly` | `insert-device-event-directly` | Yes (`inserted_items`) | Synchronous, no changes |
| `insertingDeviceInEventDirectlyFromContainer` | `insert-device-event-container` | **No** | **Queued** |
| `itemFinalStatusWhenEventIsFinishedRefactored` | `item-final-status` | Yes (`affectedRows`) | Synchronous, no changes |
| `updateLargeData` | `update-item-warehouse` | Yes (`data`, branches on error) | Synchronous, no changes |
| `deleteBulkItems` | `delete-bulk-items` | Yes (`data`, branches on error; also a bulk delete) | Synchronous, no changes |

**1. Go worker hardening (circuit breaker) — centralized, zero changes in controllers.**
`helpers/goWorker.js` already had retry (3 attempts, exponential backoff) — protecting ONE call.
Missing was a circuit breaker to protect BETWEEN calls: if the Go worker is down, subsequent
requests should fail fast instead of waiting through the full 3 retries every time.
- `helpers/circuitBreaker.js` (new): generic, not Go-worker-specific. States
  closed → open (fails fast without invoking `fn`) → half-open (tries one attempt after cooldown).
- `helpers/goWorker.js` refactored into `createRunGoWorker(fetchImpl, breakerOpts)`, wrapping the
  ENTIRE operation (with its internal retries) as a single breaker unit. The default export
  (`module.exports = runGoWorker`) remains the directly-invokable function — **zero changes at the
  8+ existing call sites** (`items_events.js`, `item.js`, `auth.js`, `transaction.js`).
  `createRunGoWorker` is attached as a property of the exported function, only for tests.

**2. `insertingDeviceInEventDirectlyFromContainer` — the only truly fire-and-forget mutation.**
Queued as `type: "go-worker:insert-device-event-container"`, using a new generic handler
`queue/handlers/goWorker.js` (`createGoWorkerHandler(runGoWorkerFn, command)`, reusable for future
fire-and-forget Go worker mutations).

**3. `uploadExcelToS3` webhook — queued.** This endpoint uploads to S3 and then fires an external
HTTP webhook (`INVENTORY_IMPORT_WEBHOOK_URL`) to kick off the remote inventory import. The final
response **never depended on the webhook's response content**, only on whether it was up
(previously: `502` if the webhook failed, even though the file was already in S3). A generic
handler was created, `queue/handlers/webhook.js` (`createWebhookHandler`, reusable for any future
external webhook). **Deliberate behavior change**: the `502` branch no longer exists — if the
webhook is momentarily down, the queue's retry resolves it instead of failing the client's
response (the file was already uploaded to S3 regardless).

**4. `uploadDocument` (PDF) — full async contract, not the cosmetic Phase 1 change.** Unlike
emails/logs, the client does need the document's final URL. Confirmed with the user: migrated
with `202 {jobId}` + polling until `done`, reading `result.document`.
- **Owner-accessible polling (not super_user)** — see §9 "Owner-scoped polling" below. The
  observability endpoint `GET /api/jobs/:jobId` is super_user-only (for the dashboard); the user
  uploading the document polls `GET /api/jobs/owned/:jobId` (only their own job).
- Important prior check: Multer uses `diskStorage` under `tmp/uploads/`
  ([`routes/document.js`](routes/document.js)) — the file **does not auto-delete** when the
  response is sent, so it's still on disk when the worker processes it later. This assumes the
  worker runs on the **same machine** that received the upload — true in the current deployment
  (a single Windows machine, PM2 cluster, see `DEPLOY.md`); if the deployment moved to
  multi-machine, this assumption would no longer hold and a synchronous S3 upload would be needed,
  as was done for `returnedItemsToRenterNotification`.
- **A single job** (`type: "document:upload-pdf"`, `queue/handlers/documentUpload.js`), not two
  independent ones: creating the `Document` depends on the URL the S3 upload returns, so they
  can't be split the way `createErrorFeed` was (independent log + email).
- Synchronous validation stays: `req.file` present (`400`), `Company` exists (`404`) — both
  needed before it makes sense to enqueue anything.

### Phase 3 — Harden Stripe (no queueing) ✅ COMPLETED

Stripe mutations **are not queued** (money isn't buffered — a charge can't be left "pending
retry" blindly). They're hardened at the client layer, without changing the frontend contract.

**1. `isFailure` in the circuit breaker (extension of the Phase 2 generic).** A business error
(declined card, `card_error`) is a SUCCESSFUL response from Stripe — it proves it's healthy — and
shouldn't open the circuit or block other charges. `createCircuitBreaker` gained an optional
`isFailure(error)` predicate: errors that aren't infrastructure-related are re-thrown to the
caller but **don't** count toward opening the circuit, and in fact reset the counter like a
success. Default with no `isFailure`: everything counts (previous Go worker behavior intact).

**2. `helpers/stripeClient.js` — shared hardened client.**
- **Idempotent retry**: SDK's `maxNetworkRetries` (configurable via env, default 2). Stripe only
  retries network failures / 409 / 5xx and adds/reuses idempotency keys automatically across
  retries → safe, doesn't duplicate charges.
- **`isStripeInfraFailure`**: only `api_connection_error`, `api_error`, `rate_limit_error` count
  toward opening the circuit. `card_error`/`invalid_request_error`/`idempotency_error` do NOT
  (they're business/client errors). A raw error with no `type` (an unwrapped network timeout) is
  assumed to be infra.
- **A single SHARED breaker** across all mutations (if Stripe is down, all fail fast instead of
  hanging the request layer with retries).
- **`runStripeMutation(thunk)`**: wraps a mutation with that breaker.

**3. Wiring the 4 money mutations** in `controller/stripe.js` (`captureStripePaymentIntent`,
`cancelStripePaymentIntent`, `refundStripePaymentIntent`, `partialRefundStripePaymentIntent`):
- Import the hardened client (`stripe`, same name → the rest of the calls stay unchanged) and
  wrap the mutation with `runStripeMutation(() => ...)`.
- Pass `request.idempotencyKey` to Stripe when it's set (forward-compatible; a no-op on routes
  that don't set it today, used where they do — same pattern as create-payment-intent).

**Idempotency already in place (untouched):** the capture/cancel/refund routes already use
`idempotencyMutationCache` (replays the cached response on a duplicate request, at the HTTP
level). `attachServerIdempotencyKey` was **not** added to them: its fallback key derivation
(customerEmail/device/IP/time-bucket) is for the payment-intent *creation* flow, incorrect for
capture/refund payloads (which carry `id`/`paymentIntent`).

**Observation (not fixed, out of scope):** `controller/transaction.js` instantiates a Stripe
client (lines 6-7) that it **never uses** — its only Stripe work goes through the Go worker
(`check-stripe-payment-intents`, already hardened by the Go worker's breaker). Dead code, no
functional impact; a candidate for separate cleanup.

### Owner-scoped polling — `GET /api/jobs/owned/:jobId` ✅ (enables the async `uploadDocument` flow from §Phase 2)

The observability endpoint `GET /api/jobs/:jobId` is **super_user-only** (designed for the support
dashboard, spans all companies). But the user uploading a document — possibly not a super_user —
needs to poll the result of **their own** upload. Instead of touching that security layer (which
would change how the dashboard calls/displays the data), an **additive** endpoint was added:

- **`GET /api/jobs/owned/:jobId`** (`routes/jobs.js`) — only `validateJWT` (already integrated
  app-wide), no `requireSuperUser`. Controller `createGetOwnedJobStatus` (`controller/jobs.js`):
  returns the job only if `job.context.uid === req.uid`; if it doesn't exist, has no owner, or
  belongs to another user → `404` (not `403`, so as not to leak the existence of others' jobs).
  **SLIM** response (`buildOwnedJobResponse`): `{ok, id, type, status, attempts, lastError,
  result}` — does NOT expose `payload`/`context`/`lockedBy` (an upload's payload has internal file
  paths).
- **The owner is set at enqueue time**: since the `POST /api/document/upload` route doesn't run
  `validateJWT` (`req.uid` is null), the controller takes the owner's uid from
  `req.body.created_by` (the Mongo uid the frontend already sends) and puts it in `context.uid`.
  The frontend then polls with its token; the token's `req.uid` must match that `created_by`.
- `requireSuperUser` and the existing `/api/jobs/:jobId` and `/stats` endpoints were not modified —
  the dashboard's security layer stays intact.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Double processing (cluster) | Single worker (`isPM2FirstInstance`) + atomic `findOneAndUpdate` claim |
| Job hangs if the server dies mid-way | Sweep of `processing` jobs with a stale `lockedAt` → back to `pending` |
| Double send on retry | Unique `idempotencyKey` per action |
| Mongo down while enqueueing | The endpoint already returns 500 today in that case; evaluate a local on-disk buffer if 100% durability is required |
| Polling latency | 3–5s is invisible for emails/logs; Change Streams if less is needed |
| Collection growth | TTL removes `done`; indexes on `status`/`nextAttemptAt` |
| Credential leak via persisted jobs | `context` is a strict allowlist (§4.3); raw `x-token`/`s-token-lq` are never stored |
| Queueing logs breaks the synchronous response contract (`{ok, feedEvent}` → `{ok, jobId}`) | Audited: no internal consumer; user confirmed the frontend doesn't depend on the doc either → migrated (§9 Phase 1) |
| `createErrorFeed` promises an `errorId` "for future reference" — a `jobId` would break that promise | NOT migrated; requires pre-generating Mongoose's `_id` before enqueueing (§9 Phase 1) |
| Queueing a Go worker mutation whose result the client uses in the response | Audited: 5 of 6 use it (counts/affected rows); only the single truly fire-and-forget one was queued (§9 Phase 2) |
| `uploadExcelToS3`/`uploadDocument` depend on a temp file on local disk | Verified: Multer uses `diskStorage` (no auto-delete); assumes the worker runs on the same machine — true today, revisit if the deployment moves to multi-machine (§9 Phase 2) |
| Go worker down → every request still waits through all 3 retries | Circuit breaker in `helpers/goWorker.js` (fails fast after `failureThreshold` consecutive failures) (§9 Phase 2) |
| A declined card (or any business error) would open the Stripe circuit and block healthy charges | `isFailure`/`isStripeInfraFailure`: only infra failures count; business ones are re-thrown without opening the circuit (§9 Phase 3) |
| Stripe down → the request layer hangs waiting on doomed retries | Shared `runStripeMutation` circuit breaker + SDK's `maxNetworkRetries` (§9 Phase 3) |

---

## 11. Delivery checklist

- [x] `models/Job.js` with indexes (claim + TTL + companyId) and a unique/sparse `idempotencyKey`
- [x] `helpers/queue.js` (`enqueue`, `extractJobContext`) with idempotency-collision handling
- [x] `queue/worker.js` (atomic claim, backoff, dead-letter, hung-job recovery)
- [x] `queue/handlers/` with the `type -> handler` registry (empty, ready for Phase 1)
- [x] Worker startup in `index.js` under `isPM2FirstInstance`
- [x] Audit `context` (identity, not credentials) — §4
- [x] Phase 0 test suite green (27/27 in `test/queue.test.js`)
- [x] Generic `send-email` handler (`queue/handlers/email.js`) + controller factory
      (`nodeMailer/queueEmail.js`), both with DI tests (no real SendGrid/Mongo touched)
- [x] **30 of 35** `/api/nodemailer/*` routes migrated and tested (4 pilot + 22 Batch A + 8 Batch B)
- [x] Generic `createQueuedJobController` factory (`helpers/queuedController.js`), extracted from
      `nodeMailer/queueEmail.js` once a second real consumer appeared (logs); emails and logs
      share it. Extended with `opts.validate` (preserves 400s) and async `buildPayload`
      (supports multiple messages as an array)
- [x] Generic Mongo-write handler (`queue/handlers/dbWrite.js`, `createModelInsertHandler`),
      registered for `log:event`, `log:notification` and `log:staff-activity` in
      `queue/handlers/index.js`
- [x] `feedEventLog` and `feedNotificationLog` migrated (audited with no internal dependency;
      confirmed with the user that the frontend doesn't depend on the synchronous document
      either)
- [x] `logStaffActivity` migrated (internal function, 12 call sites in `admin.js`/`event.js`/
      `inventory.js`) — also fixes a pre-existing bug of silently losing logs if Mongo's `save()`
      failed
- [x] 2 pre-existing bugs fixed along the way during migration: `earlierReturningNotification`
      (`ReferenceError`, endpoint 100% broken) and `linkToResetPassword` (never responded on
      error)
- [x] `GET /api/jobs/:jobId` and `GET /api/jobs/stats`, protected with `requireSuperUser`
      (new middleware — a job doesn't belong to a single company, doesn't fit
      `authorizeMongoPermission`)
- [x] **All 6 closing tasks completed** (§9 Phase 1 — closing pending items):
      `createQueuedJobController` with null-payload support (skip);
      `loginActivityNotification` (same pattern as `logStaffActivity`);
      `createErrorFeed` + `errorFeedbackEmailNotification` with a pre-generated `_id` and 2
      independent jobs; `massiveEventCustomerNotification` / `devitrakFeedbackEmailNotification`
      with the new `send-email-multiple` type; `returnedItemsToRenterNotification` with
      attachments uploaded to S3 before enqueueing (`send-email-multiple-with-attachments`,
      `queue/handlers/emailWithAttachments.js`, new functions in `helpers/s3Upload.js`)
- [x] **35 of 35** `/api/nodemailer/*` routes migrated — email Phase 1 100% complete
- [x] **Phase 2 complete** (§9 Phase 2): `helpers/circuitBreaker.js` (generic) +
      `helpers/goWorker.js` hardened (zero changes at the 8+ existing call sites);
      `insertingDeviceInEventDirectlyFromContainer` queued (the only truly fire-and-forget
      mutation out of 6 candidates — the other 5 return data the client uses in the response,
      audited and kept synchronous); `uploadExcelToS3` webhook queued
      (`queue/handlers/webhook.js`, generic); `uploadDocument` migrated to a full async contract
      (`202 {jobId}` + polling on `GET /api/jobs/:jobId`, `queue/handlers/documentUpload.js`)
- [x] **Phase 3 complete** (§9 Phase 3): `createCircuitBreaker` extended with `isFailure`;
      `helpers/stripeClient.js` (hardened client with `maxNetworkRetries` + shared breaker +
      `isStripeInfraFailure` + `runStripeMutation`); 4 money mutations
      (capture/cancel/refund/partialRefund) wired in `controller/stripe.js`. Stripe is NOT
      queued (money isn't buffered). Frontend untouched.
- [x] `GET /api/jobs/owned/:jobId` — owner-scoped polling (only `validateJWT`, no super_user);
      unblocks `uploadDocument`'s async flow without touching the dashboard's security layer
      (§9 "Owner-scoped polling"). Frontend report in `FRONTEND_task_queue_changes.md`.
- [x] Full suite green: 449/450 (the only failure is pre-existing and unrelated to the queue,
      see `routeSecurityHardening.test.js`)
- [ ] Frontend: apply `FRONTEND_task_queue_changes.md` (accept 202; email copy; poll
      `GET /api/jobs/owned/:jobId` for `uploadDocument`; remove the 502 handling in upload/xlsx)
- [x] Fixed a pre-existing bug in `returningDeviceMessage.js:2038` (`??` instead of `&&`) —
      the only occurrence of this pattern in `nodeMailer/`, confirmed by grep; regression test in
      `test/nodeMailerQueue.test.js`
