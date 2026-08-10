# Frontend Map — `/inventory-based-on-submitted-parameters` migration (2026-08-10)

> **Audience:** the frontend agent.
> **One thing already shipped and may affect you today** (§1). Everything else is
> work you can do now, on your own schedule, against the endpoint exactly as it
> behaves today — no backend coordination required.

## Why this exists

The endpoint takes a raw SQL string from the request body and executes it:

```js
devitrakApi.post("/db_event/inventory-based-on-submitted-parameters", { query, values })
```

That contract is being retired. It's being done in phases so nothing breaks,
and **the phases you can act on now don't depend on the backend at all**.

| Phase | What | Status |
|---|---|---|
| 1 | Two of the three routes required no authentication — fixed | ✅ **Deployed** — see §1 |
| 2 | Server logs every distinct query shape to inventory them | ✅ Deployed (invisible to you) |
| 3 | Replace client SQL with server-side named queries | ⏳ Not designed yet — **do not build against it** |

---

## §1 — Already shipped: those routes now require auth

`POST /api/db_event/...` and `POST /api/db_item/...` previously had **no
authentication middleware at all**. They now require `x-token` +
`checkTokenVersion`, matching `/api/db_company/...` which always had it.

**Expected impact: none.** You already call the `db_company` variant
successfully, which means your axios client attaches `x-token` globally.

**Please confirm anyway** — it's a one-minute check and the failure mode is a
sudden 401 on inventory screens:

- Verify the `devitrakApi` interceptor attaches `x-token` to **every** request,
  not just to a subset.
- Confirm none of these calls happen from a context without a session (a
  public page, a pre-login bootstrap, a background poll after logout).

If you find a call site with no session, tell backend rather than working
around it — an unauthenticated path into this endpoint is what we just closed.

---

## §2 — Do now: stop interpolating values into SQL

Three call sites build SQL by injecting values directly. This is a real
injection bug, not a theoretical one: a `serial_number` containing a quote
breaks the query, and a crafted one changes its meaning.

**These fixes work against the endpoint exactly as it behaves today. Ship them
whenever you like.**

### 2.1 The rule

Never put a value inside the SQL string. Generate one `?` per value and pass
the values in `values`, in the **exact left-to-right order the `?` appear in the
final statement**.

```js
// ❌ WRONG - value goes into the SQL text
`... AND serial_number IN (${items.map((i) => `'${i.serial_number}'`).join(",")})`

// ✅ RIGHT - only placeholders go into the SQL text
`... AND serial_number IN (${items.map(() => "?").join(",")})`
// ...and the values are appended to `values` in that position
```

### 2.2 The three call sites

**(a) `SELECT * FROM item_inv ... AND serial_number in (...)`**

```js
// BEFORE
query: `SELECT * FROM item_inv
  WHERE item_group = ? AND category_name = ? AND company_id = ? And location = ? AND warehouse = ?
  And serial_number in (${selectedData.map((item) => `'${item.serial_number}'`).join(",")})`,
values: [item_group, category_name, user.sqlInfo.company_id, location, 1],

// AFTER
query: `SELECT * FROM item_inv
  WHERE item_group = ? AND category_name = ? AND company_id = ? And location = ? AND warehouse = ?
  And serial_number IN (${selectedData.map(() => "?").join(",")})`,
values: [
  item_group, category_name, user.sqlInfo.company_id, location, 1,
  ...selectedData.map((item) => item.serial_number),   // the IN values come LAST, matching their position
],
```

**(b) `SELECT item_id FROM item_inv ... serial_number IN (...)` — also missing company scoping**

```js
// BEFORE
query: `SELECT item_id FROM item_inv WHERE item_group = ? AND category_name = ?
  AND serial_number IN (${devicesFetchedPool.map((item) => `${item.device}`).join(",")})`,
values: [devicesFetchedPool[0].type, props.category],

// AFTER
query: `SELECT item_id FROM item_inv WHERE item_group = ? AND category_name = ? AND company_id = ?
  AND serial_number IN (${devicesFetchedPool.map(() => "?").join(",")})`,
values: [
  devicesFetchedPool[0].type, props.category, user.sqlInfo.company_id,
  ...devicesFetchedPool.map((item) => item.device),
],
```

**(c) `DELETE FROM item_inv_assigned_event ... item_id IN (...)`**

```js
// BEFORE
query: `DELETE FROM item_inv_assigned_event WHERE event_id = ?
  AND item_id IN (${responseItem.data.result.map((item) => `${item.item_id}`).join(",")})`,
values: [event.sql.event_id],

// AFTER
query: `DELETE FROM item_inv_assigned_event WHERE event_id = ?
  AND item_id IN (${responseItem.data.result.map(() => "?").join(",")})`,
values: [event.sql.event_id, ...responseItem.data.result.map((item) => item.item_id)],
```

> Note this one stays unscoped by company — see §4. It's a `DELETE`, so it's the
> highest-priority item for the Phase 3 catalog. Don't try to bolt a
> `company_id` onto it yourself; that table doesn't have the column.

---

## §3 — ⚠️ Landmine: how the server expands `IN (?)`

The controller has special handling: if the SQL contains a literal `IN (?)` and
the matching value is an **array**, it expands the array into `IN (?, ?, ?)`.
That's how this working call site passes lists safely today:

```js
query: "UPDATE item_inv set warehouse = 1, update_at = NOW() WHERE item_group IN (?) AND category_name IN (?) AND serial_number IN (?) AND company_id = ?",
values: [[type], [category], [...devices], company_id],
```

**It only works because every `IN (?)` appears before every other `?` in that
statement.** The server consumes the `IN (?)` values first, in the order the IN
clauses appear, and then appends the remaining values. So for a statement like:

```sql
WHERE a = ? AND b IN (?)
```

the final placeholder order is `a`, then `b`'s list — but the server would build
the values as `b`'s list, then `a`. **Silently misaligned**, and it fails as
wrong results or a type error, not as an obvious crash.

**Guidance: don't use the `IN (?)` + array form.** Generate explicit `?` per
value as shown in §2. That's always correct regardless of where the IN clause
sits. The existing `UPDATE` above works and can stay, but don't copy the pattern
into new code.

---

## §4 — Queries with no company scoping

Four of the known shapes have no company filter at all, meaning they can read or
write across tenants. Two you can fix yourself, two you can't:

| Shape | Fixable now? |
|---|---|
| `SELECT item_id FROM item_inv WHERE item_group=? AND category_name=? AND serial_number IN (...)` | ✅ add `AND company_id = ?` — see §2.2(b) |
| `SELECT item_id, item_group, brand, serial_number, location, warehouse, cost, category_name FROM item_inv WHERE item_id IN (...)` | ✅ add `AND company_id = ?` |
| `DELETE FROM item_inv_assigned_event WHERE event_id=? AND item_id IN (...)` | ❌ table has no `company_id`; scoping needs a join to `item_inv` — leave to Phase 3 |
| `SELECT staff_id, first_name, last_name, email FROM staff_member WHERE staff_id IN (...)` | ❌ same — company lives in a bridge table. **This reads staff PII unscoped.** Leave to Phase 3 |

For the two you can fix, `company_id` still comes from `user.sqlInfo.company_id`
for now. Be aware the server will stop trusting that value in Phase 3 and derive
it from the session instead — which is the point, since browser state can be
edited.

---

## §5 — Phase 3 preview (do NOT build against this yet)

The end state replaces client SQL with named queries:

```js
// Illustrative only. Names and params are NOT final.
devitrakApi.post("/db_item/inventory-query", {
  queryName: "inventory.rentedItemsByIds",
  params: { itemIds: [...], supplierId },
});
```

`company_id` will be injected server-side from your JWT and will no longer be
accepted from the request body.

**Why it isn't specified yet, honestly:** ~6 of your call sites pass SQL built
in variables (`query1`, `countQuery`, `getAllQuery`, `deviceInfoQuery`, plus two
bare `query, values`), so reading the frontend source doesn't enumerate them.
Publishing a catalog that misses one would break you. Phase 2 instrumentation is
now collecting the real inventory from production traffic; the catalog gets
written from that, and this document gets the final contract.

**What you can do to speed that up:** send backend the SQL templates behind those
six variables. With them the catalog can be written immediately instead of
waiting on log collection.

---

## Summary — what to action

1. **Confirm** `x-token` is attached on every call to this endpoint (§1).
2. **Fix** the three interpolated-value call sites (§2). No backend dependency.
3. **Add** `company_id` to the two fixable unscoped queries (§4).
4. **Don't** adopt the `IN (?)` + array pattern in new code (§3).
5. **Don't** build against Phase 3 yet (§5) — but sending the six missing SQL
   templates unblocks it.
