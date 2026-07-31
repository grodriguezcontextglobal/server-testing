# Deploy & Production — devitrak-backend

Deployment guide for the backend on the production server (Windows + IIS).
The goal of this document is for any dev to be able to understand, operate, and recover
the service without prior knowledge of the setup.

---

## Production architecture

```
Client   ──►  IIS (db.devitrak.net :80/:443)  ──►  reverse proxy  ──►  Node :34001
                                                                        (pm2-runtime cluster -i max)
                                                                        supervised by the Windows service "DevitrakServer" (nssm)
```

- **IIS** terminates 80/443 for the host `db.devitrak.net` and rewrites **all** traffic to
  `http://localhost:34001`. The rule lives in [`public/web.config`](public/web.config)
  (`ReverseProxyInboundRule1`). **IIS does not run Node** — it only acts as a proxy.
- **Node** (`index.js` at the root) listens on port **34001**.
- The Node process is managed by a **Windows service named `DevitrakServer`**, created with
  [**nssm**](https://nssm.cc/), which in turn runs **`pm2-runtime`** to keep the multi-core cluster
  (`-i max`).

### Why nssm and not PM2 directly?

PM2 on Windows **does not natively survive machine restarts** (its `pm2 startup` doesn't work the
same way as on Linux). When Windows Update restarted the server, PM2 wouldn't come back and the
client app stayed down until someone manually logged in to bring it up.

nssm registers the process as a **native Windows service** with automatic startup on boot (even
before anyone logs in) and automatic restart if the process dies. We use `pm2-runtime` (not plain
`node index.js`) to **preserve the multi-core cluster** we had with `pm2 start -i max`.

---

## ⚠️ Critical gotcha: `PM2_HOME` is mandatory on Windows

`pm2-runtime` has a bug on Windows: in `node_modules/pm2/lib/binaries/Runtime4Docker.js:67` it uses
`process.env.HOME` (a **Linux** variable, nonexistent on Windows) to locate its data folder.
Without `PM2_HOME` set, it starts up and **crashes instantly** with:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined
    at Object.instanciate (...\pm2\lib\binaries\Runtime4Docker.js:67:47)
```

The service ends up in `SERVICE_PAUSED` state (nssm pauses it after several failed retries).

**Fix:** the service defines `PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2`.
With that variable set, `pm2-runtime` uses it directly and never reaches the broken code path.

---

## Deploy (update production code)

Replaces the old `pm2-pull-run` script from `package.json`. From PowerShell **as Administrator**:

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git pull
nssm restart DevitrakServer
```

Verify it's back up:

```powershell
nssm status DevitrakServer      # SERVICE_RUNNING
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

> **⚠️ If the pull changed `go-worker/worker.exe`** (or any `go-worker/*.go`), the Node
> restart is **not enough** — the Go worker is a **separate persistent process** and does not
> hot-reload. You must also **restart the Go worker** (`nssm restart DevitrakGoWorker`, or rebuild
> then restart — see the Go worker section), or Node will keep talking to the old binary and the
> new logic (e.g. RBAC scope enforcement) won't take effect.

---

## Go worker (separate background process)

The Go worker (`go-worker/worker.exe`) is a **long-running HTTP server**, not a one-shot CLI.
Node calls it over `http://localhost:<GO_WORKER_PORT>/<command>` (see
[`helpers/goWorker.js`](helpers/goWorker.js)); the worker's `main.go` starts an HTTP server
(`startServer`) unless it's invoked with ≥3 CLI args (legacy/testing path).

### ⚠️ Port must be set explicitly — defaults disagree

The two sides have **different built-in defaults**, so an unset `GO_WORKER_PORT` breaks the link:

| Side | Env var | Built-in default |
|------|---------|------------------|
| Node caller (`helpers/goWorker.js`) | `GO_WORKER_PORT` | `7453` |
| Go worker (`go-worker/main.go`)     | `GO_WORKER_PORT` | `8081` |

Production **must** set `GO_WORKER_PORT` to the **same value** for both the Node service and the
worker process, or Node will POST to `7453` while the worker listens on `8081` and every call fails
with *"Go Worker Connection Failed … Ensure the Go worker is running."*

### Where the worker gets its config

`main.go` / `db.go` call `godotenv.Load("../.env")` on startup, so the worker reads the **repo-root
`.env`** (the same file Node uses) for its MySQL (`PLANETSCALE_DATABASE_*`) and Mongo (`DB_CNN`)
credentials — **as long as its working directory is the `go-worker` folder** so `../.env` resolves.
`godotenv` does **not** override variables already present in the process environment, so a
`GO_WORKER_PORT` set by the service (below) wins, while the DB creds still come from `.env`.

`GO_WORKER_PORT` is **not** in `.env`, so it must be provided by whatever launches the worker.

### Run the worker as a Windows service (recommended)

Like `DevitrakServer`, register the worker under **nssm** so it auto-starts on boot and restarts on
crash — otherwise it dies on the next Windows-Update reboot and inventory breaks until someone
relaunches it by hand. Run **as Administrator**:

```powershell
# 0. Stop any manually-launched worker so the service can bind the port
Get-Process worker -ErrorAction SilentlyContinue | Stop-Process -Force

# 1. Install, pointing at the compiled binary
nssm install DevitrakGoWorker "C:\Users\CGAdmin\Documents\Github\server-testing\go-worker\worker.exe"

# 2. Working dir MUST be the go-worker folder (so the worker's godotenv.Load("../.env")
#    resolves to the repo-root .env with the DB/Mongo creds)
nssm set DevitrakGoWorker AppDirectory "C:\Users\CGAdmin\Documents\Github\server-testing\go-worker"
nssm set DevitrakGoWorker DisplayName "Devitrak Go Worker"
nssm set DevitrakGoWorker Description "Go inventory worker (HTTP server on GO_WORKER_PORT), called by the Node backend over localhost."
nssm set DevitrakGoWorker Start SERVICE_AUTO_START

# 3. The port — not in .env, so set it here or the worker defaults to 8081 and Node (7453) can't reach it
nssm set DevitrakGoWorker AppEnvironmentExtra GO_WORKER_PORT=7453

# 4. Logs
New-Item -ItemType Directory -Force "C:\Users\CGAdmin\Documents\Github\server-testing\logs" | Out-Null
nssm set DevitrakGoWorker AppStdout "C:\Users\CGAdmin\Documents\Github\server-testing\logs\go-worker-out.log"
nssm set DevitrakGoWorker AppStderr "C:\Users\CGAdmin\Documents\Github\server-testing\logs\go-worker-err.log"

# 5. Restart on crash
nssm set DevitrakGoWorker AppExit Default Restart
nssm set DevitrakGoWorker AppRestartDelay 3000

# 6. Start + verify
nssm start DevitrakGoWorker
nssm status DevitrakGoWorker      # SERVICE_RUNNING
Test-NetConnection -ComputerName localhost -Port 7453 | Select-Object -ExpandProperty TcpTestSucceeded   # True
```

To remove it entirely: `nssm remove DevitrakGoWorker confirm`.

### Updating the worker after a deploy

Once the service exists, a worker update is: rebuild the binary, then restart the service.

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing\go-worker"
go build -o .\worker.exe          # rebuild from the freshly-pulled Go source
nssm restart DevitrakGoWorker     # load the new binary
nssm status DevitrakGoWorker      # SERVICE_RUNNING
```

> The invariant: **after any change to `worker.exe` or `go-worker/*.go`, restart the worker** — a
> freshly built binary does nothing until the process is restarted.
>
> **`worker.exe` is NOT committed to git** (gitignored via `go-worker/*.exe`); each host builds its
> own with `go build` (Windows here; the Docker image builds the Linux `worker`). On the first pull
> after it was untracked, if git reports a modify/delete conflict on `go-worker/worker.exe`, resolve
> with `git rm --cached go-worker/worker.exe` — the running service's local binary is untouched.

**Manual fallback** (no service): run it detached with the port set explicitly —
`$env:GO_WORKER_PORT = "7453"; Start-Process .\worker.exe -WorkingDirectory "...\go-worker"`. This
does **not** survive a reboot; prefer the service above.

---

## Split services (native nssm) — Node · Go worker · email worker

Production runs as **separate native nssm services** (no containers; Windows Server
2019). They share the external MySQL (PlanetScale) + Mongo and talk over localhost.

| Service | Runs | Owns |
|---------|------|------|
| `DevitrakServer` | Node (`index.js`, pm2-runtime) | HTTP API + in-process queue worker for **all job types except email and the bulk-write types** |
| `DevitrakGoWorker` | `go-worker\worker.exe` | inventory Go operations (see the Go worker section) |
| `DevitrakEmailWorker` | `node queue\standalone.js` | **email** jobs only |
| `DevitrakBulkWorker` | `node queue\standalone.js` | **bulk-write** jobs only (see below) — fast poll, not yet deployed |

The split is driven entirely by env — the code is identical across services:
- **`DevitrakServer`**: `GO_WORKER_EXTERNAL=true` (don't spawn a co-located Go worker —
  call the service) and `QUEUE_EXCLUDE_TYPES=send-email,send-email-multiple,send-email-multiple-with-attachments,inventory:bulk-insert-range,member:bulk-return-leases,inventory:bulk-delete-by-criteria,member:bulk-insert`
  (let the email worker and the bulk worker own those). Optionally `GO_WORKER_HOST` if
  the Go worker is on another box (default `localhost`).
- **`DevitrakEmailWorker`**: `QUEUE_TYPES=send-email,send-email-multiple,send-email-multiple-with-attachments`.
- **`DevitrakBulkWorker`**: `QUEUE_TYPES=inventory:bulk-insert-range,member:bulk-return-leases,inventory:bulk-delete-by-criteria,member:bulk-insert` and `QUEUE_POLL_MS=300` (see below — this one's poll interval matters).

The atomic claim + type filter (`queue/core.js` `buildClaimFilter`) guarantee no job is
processed twice across workers.

### Create the email worker service

Run **as Administrator**:

```powershell
nssm install DevitrakEmailWorker "C:\Program Files\nodejs\node.exe"
nssm set DevitrakEmailWorker AppParameters "queue\standalone.js"
nssm set DevitrakEmailWorker AppDirectory "C:\Users\CGAdmin\Documents\Github\server-testing"
nssm set DevitrakEmailWorker DisplayName "Devitrak Email Worker"
nssm set DevitrakEmailWorker Description "Dedicated task-queue worker for email jobs (queue/standalone.js)."
nssm set DevitrakEmailWorker Start SERVICE_AUTO_START
nssm set DevitrakEmailWorker AppEnvironmentExtra QUEUE_TYPES=send-email,send-email-multiple,send-email-multiple-with-attachments
nssm set DevitrakEmailWorker AppStdout "C:\Users\CGAdmin\Documents\Github\server-testing\logs\email-worker-out.log"
nssm set DevitrakEmailWorker AppStderr "C:\Users\CGAdmin\Documents\Github\server-testing\logs\email-worker-err.log"
nssm set DevitrakEmailWorker AppExit Default Restart
nssm set DevitrakEmailWorker AppRestartDelay 3000
nssm start DevitrakEmailWorker
nssm status DevitrakEmailWorker   # SERVICE_RUNNING
```

Then point the main server away from email + the co-located Go worker, and restart it
(one line — `AppEnvironmentExtra` **replaces** the whole extra-env block, so re-list
`PM2_HOME`, which is mandatory — see the gotcha above):

```powershell
nssm set DevitrakServer AppEnvironmentExtra PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2 GO_WORKER_EXTERNAL=true QUEUE_EXCLUDE_TYPES=send-email,send-email-multiple,send-email-multiple-with-attachments
nssm restart DevitrakServer
```

> **Enable incrementally.** Start `DevitrakEmailWorker` FIRST and confirm it drains email
> jobs; only then set `QUEUE_EXCLUDE_TYPES` on the main server. Otherwise email jobs would
> sit unclaimed in the gap. To remove: `nssm remove DevitrakEmailWorker confirm`.

### Create the bulk worker service (fast poll — NOT YET DEPLOYED)

Backs the 4 queue-migrated bulk-write endpoints (see
`project_bulk_queue_migration_plan.md` in the AI memory store):
`insertBulkItem`, `bulkReturnMemberLeases`, `deleteBulkItemBasedOnCriteria`,
`insertBulkMembers`. Their controllers enqueue and then wait (poll the `Job`
document) for a few seconds before responding with the exact same body a
synchronous handler would have returned — so the frontend contract doesn't
change for a typical request. That only works if this job gets picked up fast:
the **default** queue worker polls every `QUEUE_POLL_MS` (4000ms), which would
add 2-4s of latency to every one of these calls, even a 2-row insert. This
worker exists solely to poll much faster (`QUEUE_POLL_MS=300`) for just these
4 job types, without touching the default interval used by every other queue
consumer.

**Until this service is running, jobs of these 4 types are NOT dead — the
main `DevitrakServer` worker still picks them up (at its default 4s poll,
before `QUEUE_EXCLUDE_TYPES` below is applied to it), just slower than
intended.** Don't apply the `QUEUE_EXCLUDE_TYPES` change to `DevitrakServer`
until this service is confirmed running, or these 4 job types would sit
unclaimed.

Run **as Administrator**:

```powershell
nssm install DevitrakBulkWorker "C:\Program Files\nodejs\node.exe"
nssm set DevitrakBulkWorker AppParameters "queue\standalone.js"
nssm set DevitrakBulkWorker AppDirectory "C:\Users\CGAdmin\Documents\Github\server-testing"
nssm set DevitrakBulkWorker DisplayName "Devitrak Bulk Worker"
nssm set DevitrakBulkWorker Description "Dedicated fast-poll task-queue worker for bulk-write jobs (queue/standalone.js)."
nssm set DevitrakBulkWorker Start SERVICE_AUTO_START
nssm set DevitrakBulkWorker AppEnvironmentExtra QUEUE_TYPES=inventory:bulk-insert-range,member:bulk-return-leases,inventory:bulk-delete-by-criteria,member:bulk-insert QUEUE_POLL_MS=300
nssm set DevitrakBulkWorker AppStdout "C:\Users\CGAdmin\Documents\Github\server-testing\logs\bulk-worker-out.log"
nssm set DevitrakBulkWorker AppStderr "C:\Users\CGAdmin\Documents\Github\server-testing\logs\bulk-worker-err.log"
nssm set DevitrakBulkWorker AppExit Default Restart
nssm set DevitrakBulkWorker AppRestartDelay 3000
nssm start DevitrakBulkWorker
nssm status DevitrakBulkWorker    # SERVICE_RUNNING
```

Then, once confirmed running, add the 4 bulk types to the main server's exclude
list (again, `AppEnvironmentExtra` **replaces** the whole block — re-list
`PM2_HOME` and the existing email-worker exclusions too):

```powershell
nssm set DevitrakServer AppEnvironmentExtra PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2 GO_WORKER_EXTERNAL=true QUEUE_EXCLUDE_TYPES=send-email,send-email-multiple,send-email-multiple-with-attachments,inventory:bulk-insert-range,member:bulk-return-leases,inventory:bulk-delete-by-criteria,member:bulk-insert
nssm restart DevitrakServer
```

> **Enable incrementally, same as the email worker.** Start `DevitrakBulkWorker`
> FIRST, hit one of the 4 endpoints with a small payload, and confirm it responds
> with the normal (non-202) body quickly; only then set `QUEUE_EXCLUDE_TYPES` on
> the main server. To remove: `nssm remove DevitrakBulkWorker confirm`.

---

## Day-to-day operations

```powershell
nssm status DevitrakServer        # service status
nssm restart DevitrakServer       # restart (after a deploy)
nssm stop DevitrakServer          # stop
nssm start DevitrakServer         # start
nssm edit DevitrakServer          # open the configuration GUI
Get-Service DevitrakServer        # status via Windows
```

**Logs** (service stdout/stderr):

```powershell
Get-Content "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-out.log" -Tail 40
Get-Content "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-err.log" -Tail 40
```

---

## Recreating the service from scratch

If the server needs to be reinstalled or the service gets corrupted. PowerShell **as
Administrator**:

```powershell
# 0. (If there's an old PM2 daemon running, get it out of the way so it doesn't fight over the port)
pm2 delete all; pm2 kill

# 1. Logs folder
New-Item -ItemType Directory -Force "C:\Users\CGAdmin\Documents\Github\server-testing\logs"

# 2. Create the service (Application = path to node.exe)
nssm install DevitrakServer "C:\Program Files\nodejs\node.exe"

# 3. Configure it
nssm set DevitrakServer AppParameters "C:\Users\CGAdmin\Documents\Github\server-testing\node_modules\pm2\bin\pm2-runtime start index.js -i max"
nssm set DevitrakServer AppDirectory "C:\Users\CGAdmin\Documents\Github\server-testing"
nssm set DevitrakServer DisplayName "Devitrak Backend Server"
nssm set DevitrakServer Description "Node backend (cluster -i max, port 34001) via pm2-runtime, reverse proxy from IIS db.devitrak.net"
nssm set DevitrakServer Start SERVICE_AUTO_START
nssm set DevitrakServer AppStdout "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-out.log"
nssm set DevitrakServer AppStderr "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-err.log"
nssm set DevitrakServer AppExit Default Restart
nssm set DevitrakServer AppRestartDelay 3000

# 4. MANDATORY! Without this, pm2-runtime crashes on Windows (see gotcha above)
nssm set DevitrakServer AppEnvironmentExtra PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2

# 5. Start and verify
nssm start DevitrakServer
nssm status DevitrakServer      # SERVICE_RUNNING
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

To remove the service entirely: `nssm remove DevitrakServer confirm`

---

## Verifying it survives a restart (the test that matters)

Restart the machine and, **without logging in or starting anything by hand**:

```powershell
Get-Service DevitrakServer      # must be Running after boot
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

And `https://db.devitrak.net` must respond on its own.

---

## Quick setup reference

| Item             | Value                                                                    |
|------------------|--------------------------------------------------------------------------|
| Service          | `DevitrakServer` (nssm, auto-start on boot)                              |
| Runs             | `node node_modules\pm2\bin\pm2-runtime start index.js -i max`            |
| Working dir      | `C:\Users\CGAdmin\Documents\Github\server-testing`                       |
| Required var     | `PM2_HOME=...\server-testing\.pm2`                                        |
| Node port        | `34001`                                                                  |
| IIS              | reverse proxy `db.devitrak.net:80/443` → `localhost:34001` (`public/web.config`) |
| node.exe         | `C:\Program Files\nodejs\node.exe`                                        |
| Logs             | `...\server-testing\logs\service-*.log`                                   |

---

## Known limitation (downtime during restart)

nssm eliminates **permanent** downtime after a restart (the service comes back on its own). But
during the ~30–60s the machine takes to reboot for Windows Update, IIS has nowhere to forward to,
and the client will see transient errors.

To close that gap (future work, not covered by this setup):
- Retries with backoff on the frontend, to absorb short blips.
- A second instance behind a load balancer (restart one at a time), or migrate to a managed service
  (Azure App Service / Container Apps) with multiple replicas and rolling updates.
