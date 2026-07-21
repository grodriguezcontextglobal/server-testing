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
> hot-reload. You must also **manually restart the Go worker** (see next section), or Node will
> keep talking to the old binary and the new logic (e.g. RBAC scope enforcement) won't take effect.

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

### Updating the worker after a deploy (manual)

`worker.exe` is committed to the repo and arrives with `git pull`, but the **running** process keeps
the old binary in memory until it is restarted **by hand on this server**:

```powershell
# 1. Stop the currently-running worker (it holds the old worker.exe)
Get-Process worker -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Start the new binary from the go-worker folder.
#    GO_WORKER_PORT MUST match the value the Node service uses (see table above).
cd "C:\Users\CGAdmin\Documents\Github\server-testing\go-worker"
$env:GO_WORKER_PORT = "7453"
Start-Process .\worker.exe

# 3. Verify it answers on the expected port
Test-NetConnection -ComputerName localhost -Port 7453 | Select-Object TcpTestSucceeded
```

> Match step 2 to however the worker is actually launched on this box (the operator starts it
> manually here — there is no nssm service supervising it, unlike `DevitrakServer`). The invariant
> that matters: **after any change to `worker.exe`, stop the old process and start the new one**,
> with `GO_WORKER_PORT` equal to the Node side's.

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
