# Frontend Action Plan — Location/Category Scoped Roles

> **For:** frontend agent/team.
> **Context:** the backend added **category-scoped roles** that mirror the existing
> **location-scoped roles**. A staff member can now be constrained to the specific
> inventory **categories** (or **locations**) assigned to them — they only see and act
> on inventory within that scope. This requires: (a) two new roles in the role picker,
> (b) a **scope-assignment UI** (location/category multi-select), and (c) consuming two
> extended read contracts.
>
> **Base URL convention:** Mongo routes hang off `/api/...`, MySQL routes off `/api/db_...`.
>
> **Availability legend** — every contract below is tagged:
> **✅ LIVE** (deployed, build against it now) · **⏳ PENDING** (backend phase not shipped yet;
> agree on the shape, build behind a flag, wire when backend confirms).

---

## 0. Executive summary (the bare minimum)

1. **Two new roles**: `category_manager` (level 8) and `category_assistant` (level 9).
   They are the category equivalent of the existing `inventory_location_manager` (6) /
   `inventory_location_assistant` (7).
2. **New concept — scope**: roles 6/7 are limited to assigned **locations**; roles 8/9 to
   assigned **categories**. Full-access roles (root_admin, admin, inventory_manager) ignore
   scope entirely.
3. **FAIL-CLOSED (critical UX rule)**: a scoped role with **zero** assignments will see
   **NO inventory** at all (server-side, once enforcement ships). Therefore the assignment
   UI **must force at least one** location/category selection before allowing save. Never
   let an admin create a scoped user with an empty scope.
4. **Read contracts extended**: `getStaffPermissions` and `getStaffCompanies` gain a
   `categories` array alongside the existing `locations` array (**⏳ pending Phase 3**).
5. **New write endpoint needed** to assign scope — proposed shape in §5.4 (**⏳ pending Phase 3**).
6. **Today the new roles are rejected**: `addCompanyStaff` / `updateCompanyStaffRole` validate
   `role_type` against a fixed list that does **not** yet include the two new roles, so sending
   them returns `400 Invalid role_type` until backend Phase 3 lands.

---

## 1. The full role model (source of truth)

| Level | role_type | Label | Scope dimension | Inventory permissions | Needs scope UI |
|------:|-----------|-------|-----------------|-----------------------|:--------------:|
| 0 | `root_admin` | Root Administrator | none (full) | CRUD (+ everything) | no |
| 1 | `admin` | Administrator | none (full) | CRUD (+ everything) | no |
| 2 | `sale_manager` | Sale Manager | none | (unchanged) | no |
| 3 | `event_manager` | Event Manager | none | inventory R/U (+ event/consumer/txn) | no |
| 4 | `inventory_manager` | Inventory Manager | none (full inventory) | inventory CRUD | no |
| 5 | `assistant` | Assistant | none | (unchanged) | no |
| 6 | `inventory_location_manager` | Inventory Location Manager | **location** | inventory CRUD + location CRUD | **yes → locations** |
| 7 | `inventory_location_assistant` | Inventory Location Assistant | **location** | inventory R/U + location R/U | **yes → locations** |
| **8** | **`category_manager`** | **Category Manager** | **category** | **inventory CRUD** | **yes → categories** |
| **9** | **`category_assistant`** | **Category Assistant** | **category** | **inventory R/U** | **yes → categories** |

> Rows 8-9 are new. Note category roles have **inventory permissions only** — no location,
> event, consumer, staff, etc. Gate the UI accordingly (§6).

---

## 2. Work checklist (frontend)

- [ ] **Roles config** (`src/config/roles.js`): add `category_manager` / `category_assistant`,
      each tagged with its scope dimension. (§3)
- [ ] **Scope-assignment UI**: a component that, based on the selected role's scope dimension,
      renders a Locations multi-select, a Categories multi-select, or nothing. (§4)
- [ ] **Fail-closed guard**: block save when a scoped role has an empty selection. (§4)
- [ ] **Category source**: fetch company categories for the multi-select. (§5.5, ✅ live)
- [ ] **Consume `categories`** from `getStaffPermissions` / `getStaffCompanies` once shipped. (§5.1–5.2)
- [ ] **Wire the scope-save call** to the assignment endpoint. (§5.4, ⏳ Phase 3)
- [ ] **Permission-gated UI**: hide non-inventory sections for category roles. (§6)
- [ ] Put all of the above behind a **feature flag** until backend Phases 3-4 are confirmed. (§7)

---

## 3. Role picker — add the two roles

Add the two entries to the frontend roles config and **group roles by scope dimension** so the
form can decide which scope selector to show:

```js
// src/config/roles.js  (illustrative shape — adapt to the existing structure)
export const ROLE_SCOPE = {
  root_admin: null, admin: null, sale_manager: null,
  event_manager: null, inventory_manager: null, assistant: null,
  inventory_location_manager: 'location',
  inventory_location_assistant: 'location',
  category_manager: 'category',      // NEW
  category_assistant: 'category',    // NEW
};
```

The role dropdown should list all 10 role_types with their labels from §1.

---

## 4. Scope-assignment UI (the core new feature)

**Behavior driven by the selected role's scope dimension** (`ROLE_SCOPE[role_type]`):

- `'location'` → render the **Locations** multi-select.
- `'category'` → render the **Categories** multi-select.
- `null` → render **no** scope selector.

**Fail-closed guard (mandatory):** when the dimension is not `null`, require **≥1** selection.
Disable/bloquear the save button with copy like *"Assign at least one {location|category} —
a scoped user with no assignments cannot see any inventory."* This mirrors the server rule: a
scoped role with zero rows sees nothing.

**On save:** send the complete current selection to the scope endpoint (full-replace semantics,
§5.4) — not incremental add/remove. Sending an empty array would clear the scope, which the
guard above must prevent for scoped roles.

**Data sources:**
- Locations → reuse the existing company-locations fetch already used elsewhere in the app.
- Categories → `POST /api/db_company/categories` (§5.5).

---

## 5. Contracts (exact shapes)

### 5.1 `getStaffPermissions` — **✅ LIVE** (⏳ `categories` field pending Phase 3)
`POST /api/db_staff/company-staff/permissions` · headers: `x-token` (JWT) · body `{ company_id, staff_id }`

```jsonc
// Response 200 — TODAY:
{
  "ok": true,
  "roleType": "inventory_location_manager",
  "role_level": 6,
  "permissions": ["inventory:create", "inventory:read", "..."],
  "locations": [
    { "location_id": 3, "location": "Main Warehouse", "can_create": true, "can_update": true, "can_delete": false }
  ]
}
```
```jsonc
// Response 200 — AFTER Phase 3 (adds `categories`, same shape as locations):
{
  "ok": true, "roleType": "category_manager", "role_level": 8,
  "permissions": ["inventory:create", "inventory:read", "inventory:update", "inventory:delete"],
  "locations": [],
  "categories": [
    { "category_id": 11, "category_name": "Audio", "can_create": true, "can_update": true, "can_delete": false }
  ]
}
```
> **Frontend:** read `categories` defensively (`?? []`) so it works before and after Phase 3.

### 5.2 `getStaffCompanies` — **✅ LIVE** (⏳ `categories` per company pending Phase 3)
`GET /api/db_staff/companies` · headers: `x-token`. Login bootstrap. Each company currently
carries `{ company_id, company_name, roleType, role_level, locations: [...] }`; Phase 3 adds a
parallel `categories: [...]`. Same defensive read.

### 5.3 `addCompanyStaff` / `updateCompanyStaffRole` — **⏳ new roles pending Phase 3**
`POST /api/db_staff/company-staff` and `PATCH /api/db_staff/company-staff/role` ·
body includes `role_type`. **Today** these validate against a fixed 8-role list and return
`400 { ok:false, msg:"Invalid role_type" }` for `category_manager` / `category_assistant`.
Backend Phase 3 adds the two roles to that list. **Do not ship the new roles in the picker to
production until Phase 3 is deployed** (feature flag, §7).

### 5.4 Scope-assignment endpoint — **⏳ PENDING Phase 3 (proposed shape — confirm with backend)**
Proposed: `PUT /api/db_staff/company-staff/scope` · headers `x-token` · full-replace, transactional.

```jsonc
// Request — send only the dimension relevant to the role (the other stays []):
{
  "company_id": 62,
  "staff_id": 158,
  "locations":  [3, 7],      // location_ids   — for roles 6/7
  "categories": [11, 12]     // category_ids   — for roles 8/9
}
// Response 200:
{ "ok": true, "locations_set": 2, "categories_set": 0 }
```
> Semantics: replaces the full set of assignments for that `(company_id, staff_id)`. Empty array
> clears that dimension. `can_create/can_update/can_delete` flags are **optional** and **not yet
> enforced** server-side (see open question §8) — omit them for now, or default to the read/update
> the role already grants.

### 5.5 Company categories list — **✅ LIVE**
`POST /api/db_company/categories` · headers `x-token` · body `{ company_id }`

```jsonc
// Response 200:
{ "ok": true, "result": [
  { "category_id": 11, "category_name": "Audio", "sub_category_name": null, "active": 1, "created_at": "..." }
]}
```
> Scope is by **`category_name`**. If the same `category_name` appears with multiple
> `sub_category_name` rows, present it once (dedupe by `category_name`) in the multi-select.

---

## 6. Permission-gated UI

Nothing structurally new — keep driving feature visibility from the `permissions[]` array of
`getStaffPermissions`. Just note the category roles' permission sets:

- `category_manager` → `inventory:{create,read,update,delete}` only.
- `category_assistant` → `inventory:{read,update}` only.

So for a category-scoped user: **show inventory** features (respecting create/delete availability),
and **hide** location management, events, consumers, staff, billing, etc. — they have no
permissions there.

---

## 7. Backend dependency & sequencing

**Buildable NOW (behind a feature flag):**
- Role config entries + scope-dimension mapping (§3).
- Scope-assignment UI scaffold + fail-closed guard (§4).
- Category fetch for the multi-select (§5.5 is live).
- Permission-gating logic (§6).

**Blocked until backend Phase 3** (schema + helper already done; API is next):
- Creating/updating staff with the new roles (§5.3 — currently 400).
- The scope-assignment endpoint (§5.4).
- `categories` in the read responses (§5.1–5.2).

**Blocked until backend Phase 4** (enforcement):
- **Actual restriction.** Until the controllers filter inventory by category/location, assigning
  a category role will **not** limit what the user sees server-side. Do not advertise the feature
  as enforced until backend confirms Phase 4 + the Go worker rebuild are deployed.

**Recommendation:** implement behind a flag; flip it on only after backend confirms Phases 3 **and**
4 are live, to avoid a window where users appear scoped but aren't actually restricted.

---

## 8. Open questions for the backend (please confirm)

1. **Granular flags:** should `can_create/can_update/can_delete` per assignment be enforced
   (create/update/delete gated *within* the scope), or is scope purely visibility for now? Today
   the access helper reads only the assigned ids, not the flags.
2. **Scope endpoint shape:** confirm §5.4 — id-list full-replace vs. objects-with-flags, and the
   final path/verb.
3. **Category granularity:** scope is by `category_name`. Confirm the multi-select should offer
   `category_name` only (not `sub_category_name`).
4. **Mixed scope:** a role is either location- or category-scoped by design (not both). Confirm the
   UI never needs to show both selectors at once.

---

## 9. Phase C shipped — write enforcement + newly-gated endpoint (ACTION REQUIRED)

The granular `can_create/can_update/can_delete` flags (open question §8.1) are now **enforced**.
Each inventory write is gated by the flag on the acting staff's assignment for the item's own
location/category. Full-access roles (root_admin/admin/inventory_manager) are unaffected.

**Breaking — new auth on a previously-open endpoint:**
- `POST /api/db_item/item-out-warehouse` (item move-out during event assignment) **now requires the
  JWT** (`x-token` header) **and** `inventory:update`. It was previously unauthenticated.
  The event-assignment roles (`sale_manager`, `event_manager`) already hold `inventory:update`, so
  they keep working **as long as the frontend sends `x-token` on this call**. Verify the event flow
  attaches the token here — otherwise the call returns **401** (missing identity) or **403**.

**New behavior on bulk/move endpoints — partial success:**
- `POST /delete-bulk-items`, `POST /item-out-warehouse`: for a scoped role, items outside the
  staff's permitted scope are **silently skipped** (not an error). The response now includes
  `skipped_count` when any rows were skipped. A request where *nothing* is permitted returns
  `deleted_count: 0` (bulk delete) / `403` (item-out-warehouse).
- `POST /delete-bulk-items-criteria`: the criteria are intersected with the staff's scope. A
  category outside scope returns `200 { deleted_count: 0 }` (no-op), not an error.
- `POST /bulk-item`, `POST /bulk-item-alphanumeric`, `POST /new_item`, `POST /edit-item`: a scoped
  role without the relevant `can_*` flag on the target location/category gets **403**.
