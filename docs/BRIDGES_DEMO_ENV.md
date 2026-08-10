# Bridges demo environment

A self-contained tenant for the Bridges Public Charter School pitch, running on
its **own MySQL database and its own Mongo database** so ~370 fabricated
students, their guardians and their consent records never sit next to real
customers.

Everything below is driven by `seed/provision-bridges-demo.js`, which is
idempotent — re-run it any time to restore the demo to a known state.

---

## What gets created

| | |
|---|---|
| Tenant | Bridges Public Charter School, industry `Education` |
| Students | 369, PK3–grade 5, **all under 13** |
| Inventory | ~743 items · 12 categories · 33 groups · 15 locations |
| Staff | 21 accounts across every role level |
| Events | 12, with device pools and attendees |
| Assignments | 279 out, 7 overdue, plus prior-year closed leases |
| Consent | 306 agreed · 27 stale · 18 awaiting · 6 expired · 10 refused · 2 never requested (83% coverage) |

Demo login: `head@bridgespcs.org` / `DemoPass123!` (role 0 — needed, because
only root_admin/admin see the Staff nav, and members endpoints 403 below role 3).

All people, serial numbers and addresses are fabricated. Only the institutional
profile — grade span, roughly 365 students, inclusion model, Ward 4 campus — is
drawn from the real school.

---

## Prerequisites

1. **A dedicated MySQL database.** A PlanetScale database (or branch) of its
   own. The provisioner refuses to run against a database that already holds
   other tenants — see *Safety* below.
2. **A dedicated Mongo database.** A separate DB name is enough; it does not
   need its own cluster, though a separate cluster isolates it further.
3. **The application schema loaded** into that MySQL database. Quickest route is
   a structure-only dump of an existing environment:

   ```bash
   mysqldump --no-data -h <src-host> -u <user> -p <src-db> > schema.sql
   mysql -h <demo-host> -u <user> -p <demo-db> < schema.sql
   ```

4. **Reference data**: `roles`, `permissions`, `role_permissions`,
   `industry_list`. Without `roles`, `company_staff` cannot resolve a role and
   every permission-gated screen renders blank.

   ```bash
   mysqldump -h <src-host> -u <user> -p <src-db> \
     roles permissions role_permissions industry_list \
     | mysql -h <demo-host> -u <user> -p <demo-db>
   ```

The provisioner checks 2–4 and stops with a specific message if anything is
missing, rather than seeding a half-working tenant.

---

## Provisioning

```bash
PLANETSCALE_DATABASE_HOST=<host> \
PLANETSCALE_DATABASE_USERNAME=<user> \
PLANETSCALE_DATABASE_PASSWORD=<pass> \
PLANETSCALE_DATABASE_NAME=<demo-db> \
DB_CNN=<mongo-connection-string> \
MONGO_DB=<demo-mongo-db> \
DEMO_CONFIRM_DATABASE=<demo-db> \
node seed/provision-bridges-demo.js
```

It will, in order: run the safety checks, confirm the core tables exist, apply
the school migrations that are missing, confirm reference data, run the seed,
then verify the result — including recomputing every student's consent state
through the real controller logic and failing if any of the six states is
unreachable or coverage falls outside the amber band.

Local example (against the bundled MySQL):

```bash
PLANETSCALE_DATABASE_HOST=127.0.0.1 PLANETSCALE_DATABASE_USERNAME=root \
PLANETSCALE_DATABASE_PASSWORD= PLANETSCALE_DATABASE_SSL=false \
PLANETSCALE_DATABASE_NAME=devitrak_bridges \
MONGO_URI=mongodb://127.0.0.1:27017 MONGO_DB=devitrak_bridges \
DEMO_CONFIRM_DATABASE=devitrak_bridges \
node seed/provision-bridges-demo.js
```

---

## Safety

The provisioner will not run unless **both** hold:

1. `DEMO_CONFIRM_DATABASE` is set and matches the database the connection
   actually resolved to. A stale `.env` is the likeliest way this goes wrong, so
   naming the target is mandatory rather than inferred.
2. The database contains no tenants other than Bridges. Production holds many,
   so pointing this at production fails immediately and names what it found.

`DEMO_ALLOW_SHARED=1` overrides check 2. Only use it if seeding fabricated
minors alongside real customer data is a decision that has actually been made.

Note that `provision-bridges-demo.js` calls `dotenv`, so running it from a
checkout with a production `.env` will pick those credentials up. That is
precisely what check 1 and check 2 exist to catch.

---

## Running the API against the demo

The app reads the same variables, so a demo instance is an env file, not a code
branch:

```
PLANETSCALE_DATABASE_HOST=<host>
PLANETSCALE_DATABASE_USERNAME=<user>
PLANETSCALE_DATABASE_PASSWORD=<pass>
PLANETSCALE_DATABASE_NAME=<demo-db>
DB_CNN=<mongo-connection-string-including-/demo-db>
```

**The demo requires the backend from `feat/school-consent-hardening`**, not
stock `main`. The readiness screen's chip states (stale / awaiting / expired /
refused) come from the per-student consent state added on that branch; against
`main` the same data collapses into a binary consented-or-not view and most of
the compliance story disappears.

---

## Resetting before a pitch

```bash
# same env as above
node seed/provision-bridges-demo.js
```

Re-running restores anything that has been changed during a rehearsal. To start
completely clean, drop and recreate the database, reload schema and reference
data, then provision again.

---

## Caveat worth knowing before demoing

`Advance grades` on the Students page understands PK3/PK4 only on frontend
`feat/unified-profile-shell` or later. On an older frontend, 120 of the 369
students land in the "needs manual review" bucket.
