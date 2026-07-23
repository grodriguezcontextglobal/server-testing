# FERPA / COPPA Compliance — Plan (scoping)

> **Status:** planning / not built. This is the engineering roadmap to make the
> school (education) vertical FERPA- and COPPA-defensible. It builds on the
> compliance **floor already shipped** (PII access audit + consent recording &
> opt-in enforcement). **Not legal advice** — the agreement/policy workstream
> (§7) must be reviewed by counsel; engineering builds the controls & tooling.

---

## 0. Posture (who is responsible for what)

devitrak is a **vendor/processor to schools**, operating as a FERPA **"school
official"** (under the school's direct control, data used only for the authorized
purpose, no re-disclosure) and under COPPA's **school-consent exception** (the
school authorizes collection of a child's data for an educational purpose in lieu
of direct parental consent). **The school/district is the covered entity.**

→ Engineering's job: give the school the **controls + evidence + tooling** to meet
its obligations (access control, audit, consent, data-subject rights, retention).
The school + legal own the **agreements and parental notices**.

**PII in scope:** student identity (name, email, grade, homeroom), `minor` flag,
guardian contact, device assignments/leases, consent records.

---

## 1. Already in place (the floor — DONE)

- **Access control:** JWT auth + token-version, RBAC (incl. scoped roles 6–9),
  multi-tenant isolation, `industry='Education'` gating on `/api/school`.
- **Consent:** recording (`school_consent`) + **opt-in enforcement** on device
  assignment (per-company `company_school_settings.enforce_member_consent`).
- **PII access audit:** `auditPiiAccess` on all `/api/school` routes → durable
  `StaffActivityLog` (who/what/when/outcome).
- **Guardian model:** normalized `guardians` + `student_guardian`.

---

## 2. Phase A — Data-subject rights: export + deletion  *(highest priority)*

FERPA (inspect/review, amendment) and COPPA (parental review/deletion), fulfilled
**via the school** (staff-mediated), not a public parent portal.

- **A1. Student export** — `POST /api/school/student/export { company_id, member_id }`:
  returns ALL data for one student (identity, guardians, leases/lease history,
  consents, and their access/disclosure log) in a portable shape (JSON, optional CSV).
- **A2. Student erase/anonymize** — `POST /api/school/student/erase { company_id, member_id, mode }`:
  `mode: 'anonymize'` (default — strip PII from `members_info`/guardians/consents,
  keep non-PII lease/asset history + a tombstone) or `'delete'` (hard delete incl.
  `student_guardian`, `school_consent`, `member_assigned_device_lease`). Must be a
  high-permission, audited action; return a receipt.
- Design care: FK order, keep device/asset records (strip the person, keep the asset
  trail), and **audit the erase itself** (immutable record that it happened).

**Effort:** medium (export easy; erase needs careful anonymization/FK design + a decision, §8).

---

## 3. Phase B — Retention & destruction

Student data currently lives forever. FERPA/COPPA expect defined retention + destruction.

- **B1.** Add a **student lifecycle status** (`active | withdrawn | graduated`) + a
  status date to `members_info` (or a small side table, to avoid altering the core).
- **B2.** Per-company **retention config** — extend `company_school_settings`
  (e.g. `retention_months`, default null = keep).
- **B3.** **Scheduled purge/anonymize job** (reuse the `node-schedule` scheduler +
  the Phase-A anonymize routine) that anonymizes students past retention. Dry-run +
  logged + reversible-window before hard action.

**Effort:** medium. **Needs a policy decision (§8).**

---

## 4. Phase C — Disclosure audit & report  *(cheap, do early)*

FERPA §99.32 expects a **record of disclosures** of education records that parents
can request.

- **C1.** Extend auditing to log **disclosures**, not just internal access: the
  overdue-reminder emails to guardians (already sent server-side) and any Phase-A
  export → log as a disclosure event (recipient, what, when, purpose).
- **C2.** `POST /api/school/student/access-log { company_id, member_id }` → the
  per-student access + disclosure history (from `StaffActivityLog` + disclosure logs).

**Effort:** small–medium (extends the existing audit).

---

## 5. Phase D — Consent hardening (COPPA under-13)

COPPA's verifiable-consent bar applies to children **under 13** — narrower than the
generic `minor` flag.

- **D1.** Capture **age/DOB or an explicit `under_13` flag** so under-13 handling is
  distinguishable from the general minor flag.
- **D2.** Policy decision: gate **data collection** (member create) on consent for
  under-13, not only device assignment (§8).
- **D3.** Consent **re-collection on policy change** — `policy_version` already exists;
  add a "current required version" per company and flag stale consents in
  `consent/status`.

**Effort:** small–medium. **Needs decisions (§8).**

---

## 6. Phase E — Data minimization & security (ongoing)

- **E1.** Field-level review: collect only necessary PII; guardian fields only for minors.
- **E2.** Encryption: TLS in transit is in place (PlanetScale/Atlas); **document**
  at-rest encryption; consider field-level encryption for the most sensitive PII.
- **E3.** Ensure audit/logs never store raw sensitive PII beyond IDs (the current
  audit stores IDs + route/status — good; keep it that way).

---

## 7. Non-engineering workstreams (business/legal — NOT code)

Flagged so they aren't forgotten; engineering supplies the supporting evidence/exports:
- **DPA / "school official" designation** with each district; **privacy policy**;
  **parental notice** templates; **breach-notification** procedure; periodic review.

---

## 8. Open decisions needed (from you / legal) before building

1. **Erase semantics:** anonymize (keep asset history, strip person) vs hard delete? (recommend anonymize default)
2. **Retention:** period + trigger — N years after `withdrawn`/`graduated`, or on contract end?
3. **Under-13:** collect DOB, or a manual `under_13` flag? Gate data *collection* on consent, or only device assignment?
4. **Request intake:** staff-mediated (school submits export/erase requests) vs a parent-facing portal? (recommend staff-mediated first)

---

## 9. Suggested sequence

1. **Phase A** (export + erase) — most-requested rights, concrete, high value.
2. **Phase C** (disclosure audit + report) — cheap extension of the existing audit.
3. **Phase B** (retention) — after the erase/anonymize routine from A exists.
4. **Phase D** (under-13) — after the §8 decisions.
5. **Phase E** — ongoing.
6. **§7 legal/policy** — parallel, business-owned.

Each engineering phase follows the established pattern: separate migration (never
alter core tables destructively), pure testable helpers, Education-gated + audited
endpoints, e2e-verified against prod with cleanup.
