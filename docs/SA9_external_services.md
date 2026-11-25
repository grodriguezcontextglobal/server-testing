# SA-9 · External services inventory

> **Finding:** [APP-2026-001](POAM.md#app-2026-001--cumplimiento-de-los-servicios-externos-sin-documentar) · **Due:** 2026-12-16 · **Milestone:** 2026-11-30 (status of every service collected)
> **Built:** 2026-11-25, from `origin/main` at `bd50443`
> **Method:** dependency manifest, `process.env` references and outbound calls read from the
> source. No `.env` value was read and no credential appears here.

This covers step 1 of the finding's plan (what each service is and what leaves towards
it) and the data-flow half of step 2. The **compliance status column is deliberately
unfilled**: it has to come from each provider's own published page, with a link and a
consultation date, and inventing it would defeat the point of the finding.

---

## 1. The POA&M lists seven services. There are at least nine.

| # | Service | In POA&M? | Evidence in the repo |
|---|---|---|---|
| 1 | MongoDB Atlas | yes | `mongoose@8.24.8`, `mongodb@^6.13.0`, `DB_CNN` |
| 2 | PlanetScale (MySQL) | yes | `mysql2@3.24.6`, `PLANETSCALE_DATABASE_HOST`, `SQL_DATABASE_URL` |
| 3 | Redis Cloud | yes | `redis@^4.6.15`, `rate-limit-redis`, `REDIS_HOST` |
| 4 | SendGrid | yes | `@sendgrid/mail@^8.1.3` |
| 5 | Cloudinary | yes | `cloudinary@^2.11.0` |
| 6 | Amazon S3 | yes | `@aws-sdk/client-s3`, two buckets: `AWS_S3_BUCKET_NAME`, `AWS_S3_EXPORTS_BUCKET` |
| 7 | Stripe | yes | `stripe@^17.3.1`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **8** | **Cloudflare** (Workers + D1) | **NO** | `cloudflare/status-worker/` — `wrangler.toml`, D1 binding, cron every minute |
| **9** | **Microsoft Teams** (incoming webhook) | **NO** | The status worker posts state changes to a Teams webhook |

Two more outbound paths that need resolving before this finding can close:

| Item | What it is | Why it matters |
|---|---|---|
| `INVENTORY_IMPORT_WEBHOOK_URL` | `controller/document.js:1792` POSTs to this URL to trigger a remote import after an upload | **The destination is unknown from the code.** It is an environment value. If it points outside our boundary it is a tenth service and an undocumented data flow |
| `https://login.microsoftonline.com/` | Listed in `config/cors.js:15` as an accepted **origin** | Inbound, not outbound, so not an SA-9 service. But it should not be in a production CORS allowlist without a reason on record |

---

## 2. Twilio: credentials for a service that is not reachable

`controller/twilio.js` and `routes/twilio.js` exist and the controller reads
`TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`. But `scripts/extract-api-payloads.js:90`
lists `routes/twilio.js` under `UNMOUNTED` — **the route is never mounted, so the code
is unreachable**.

That is worse than an undocumented service: it is a **live credential pair in the
production environment for a path nobody can call and nobody is watching**. If those
keys leak, no alert fires because no legitimate traffic exists to compare against.

Recommended: delete the controller, the route and both environment variables, and
revoke the credentials at Twilio. If WhatsApp/SMS is a planned feature, it comes back
with the rest of its control story. Suggest a new finding, **APP-2026-016**, Low, 90
days — it is not an exposure today, it is an unmanaged key.

---

## 3. What data leaves, and where

Derived from the models and controllers; the sensitivity column is what drives the
inheritance question.

| Service | Data sent | Sensitivity |
|---|---|---|
| MongoDB Atlas | Staff and consumer accounts, events, transactions, documents, signatures, the staff audit trail | **PII.** The system of record |
| PlanetScale | Inventory, locations, staff, **students (`members_info`), guardians and consents** | **PII including minors.** FERPA/COPPA scope |
| Redis Cloud | Session state, idempotency reservations, distributed locks, rate-limit counters | **Session identifiers.** No business records, but holds what authenticates one |
| SendGrid | Recipient name and email, plus event, lease and receipt details inside message bodies | **PII**, including guardians of minors for consent email |
| Cloudinary | Company logos and uploaded images | Low, unless user-uploaded images carry PII |
| Amazon S3 | Inventory exports (XLSX) and uploaded spreadsheets | **Business data in bulk.** An export is the whole inventory in one object |
| Stripe | Payer identity, payment intents, connected-account data | **PII + financial.** Amounts live only here — they are not stored in either database |
| Cloudflare D1 | Probe history: timestamp, status code, latency against `db.devitrak.net` | **No customer data** |
| Teams webhook | Service state changes | **No customer data** |

The two at the bottom are the cheap ones to clear. The two at the top are the ones that
can change the schedule, because they hold the system of record and the minors' data.

---

## 4. What to ask each provider

The finding needs, per service: published authorization status, a link, the date it was
consulted, and which controls we inherit. Concretely:

1. **FedRAMP / GovRAMP authorization** — is the service listed in the FedRAMP
   Marketplace, at what impact level, and does *our* plan and region fall inside that
   authorization boundary? A vendor being "FedRAMP authorized" for one offering does
   not cover every tier.
2. **SOC 2 Type II** — current report, its period, and whether it is obtainable under
   NDA.
3. **Region and residency** — where the data physically sits.
4. **Encryption** — in transit and at rest, and who holds the keys.
5. **Subprocessors** — who they hand our data to.
6. **Inherited controls** — the specific list, for the SSP's responsibility matrix.

Where the answer is "no authorization", the finding's plan already requires a POA&M
entry of its own with an evaluated alternative. **Expect at least one.**

---

## 5. Status table — to fill by 2026-11-30

| Service | FedRAMP/GovRAMP | SOC 2 Type II | Region | Source link | Checked on | Inherited controls |
|---|---|---|---|---|---|---|
| MongoDB Atlas | | | | | | |
| PlanetScale | | | | | | |
| Redis Cloud | | | | | | |
| SendGrid | | | | | | |
| Cloudinary | | | | | | |
| Amazon S3 | | | | | | |
| Stripe | | | | | | |
| Cloudflare | | | | | | |
| Microsoft Teams | | | | | | |

---

## 6. Immediate actions

| # | Action | Owner | By |
|---|---|---|---|
| 1 | Identify where `INVENTORY_IMPORT_WEBHOOK_URL` points. If external, it joins this table | Devitrak | 2026-11-27 |
| 2 | Decide on Twilio: remove the code and revoke the keys, or bring it into scope | Devitrak | 2026-11-30 |
| 3 | Add Cloudflare and the Teams webhook to APP-2026-001's weakness statement — the finding currently names seven services and there are nine | Devitrak | 2026-11-26 |
| 4 | Fill §5 from each provider's published page, with links and dates | Devitrak | 2026-11-30 |
| 5 | Record why `login.microsoftonline.com` is an accepted CORS origin, or remove it | Devitrak | 2026-11-30 |
| 6 | Draw the data-flow diagram from §3 for the SSP | Devitrak | 2026-12-16 |

Items 1, 2, 3 and 5 are ours alone and cost hours, not days. Item 4 is the one that can
produce a surprise, and it is the reason this finding is rated High.
