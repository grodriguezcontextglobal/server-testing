# Frontend Notice — 4 bulk endpoints now queue-backed (2026-07-31)

> **Audience:** the frontend agent. **TL;DR: for a typical request, nothing
> changes.** Same method, same URL, same status code, same response body. Read
> on only if you want to understand why, or to handle the rare large-payload
> case.

## What changed, and why you probably don't need to do anything

Four endpoints used to do their database write **inline**, holding your HTTP
request open until it finished:

| Endpoint | Method | What it does |
|---|---|---|
| `POST /api/db_item/bulk-item` | insert a range of serial numbers | |
| `POST /api/db_member/bulk-return` | end-of-term bulk lease return | |
| `POST /api/db_item/delete-bulk-items-criteria` | delete inventory by category/serial criteria | |
| `POST /api/db_member/bulk-members` | CSV student/member import | |

Each of these can, in the worst case, touch an unbounded number of rows (a
serial-number range with no natural size limit, "all outstanding leases
company-wide", "an entire inventory category", or a whole-district CSV
import). To keep one giant request from tying up a database connection
indefinitely, the actual write now runs through the durable job queue instead
of inline.

**The server still waits for the job internally before responding.** For the
overwhelming majority of calls (typical selection sizes), the job finishes in
well under the wait window and you get back **the exact same response you
always got** — same status code (`200`/`201`), same body shape. You do not
need to change how you call these 4 endpoints, parse their responses, or
handle errors.

The only cost: each call now takes a little longer end-to-end (roughly a few
hundred milliseconds to ~1-2s, once the dedicated queue worker for these jobs
is running in prod — see `project_bulk_queue_migration_plan.md`) than the old
inline version did. Not visually different for a spinner-driven bulk action.

## The one case that DOES change: an unusually large request

If a request is so large it doesn't finish inside the server's wait window,
you'll get back **`202`** instead of the normal status, with this body:

```jsonc
{ "ok": true, "jobId": "<id>", "msg": "Request queued — still processing. Poll GET /api/jobs/owned/:jobId for the result." }
```

This should be rare in practice — it only happens for the largest imports/
ranges/criteria-wide operations. If you want to handle it gracefully instead
of leaving the UI hanging, add this to the 4 call sites above:

```js
async function callBulkEndpoint(url, body) {
  const res = await fetch(url, { method: 'POST', headers: {...}, body: JSON.stringify(body) });
  const data = await res.json();

  if (res.status === 202 && data.jobId) {
    return pollJobResult(data.jobId);
  }
  return data; // normal case -- same shape as before this migration
}

async function pollJobResult(jobId, { intervalMs = 2000, timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`/api/jobs/owned/${jobId}`, { headers: {...} });
    const job = await res.json();
    if (job.status === 'done') return job.result;   // same shape the endpoint normally returns
    if (job.status === 'failed' || job.status === 'dead') {
      throw new Error(job.lastError || 'Bulk operation failed');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Bulk operation is taking longer than expected — check back later.');
}
```

`job.result` (once `status:"done"`) has the exact same shape as the normal
(non-202) response body for that endpoint — no separate contract to learn.

## Not affected

Every other endpoint — including the many other bulk-ish actions in
`FRONTEND_student_members_endpoints.md` and
`FRONTEND_server_updates_2026-07.md` — is unchanged by this migration.
