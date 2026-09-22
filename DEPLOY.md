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

> Still true on **pm2 7.0.4**: the line is byte-for-byte the same, it just moved from 67 to 68.
> Verified by running `pm2-runtime -i 2` against a throwaway `PM2_HOME`: two instances came up
> `online` in cluster mode and the daemon used the given folder. Do **not** drop `PM2_HOME` from
> the service on the assumption that a newer pm2 fixed it.

### ⚠️ When upgrading pm2 across a major

The pm2 **daemon** is a separate process from the `pm2-runtime` that nssm supervises, so
`nssm restart` does **not** replace it: a pm2 5 daemon can stay alive talking to a pm2 7 CLI.
After an `npm ci` that changes the pm2 major, clear the daemon before starting the service:

```powershell
nssm stop DevitrakServer
$env:PM2_HOME = "C:\Users\CGAdmin\Documents\Github\server-testing\.pm2"
node .\node_modules\pm2\bin\pm2 kill      # drops the old daemon; ignore "not running"
nssm start DevitrakServer
nssm status DevitrakServer                # SERVICE_RUNNING
```

---

## Deploy (update production code)

Replaces the old `pm2-pull-run` script from `package.json`. From PowerShell **as Administrator**:

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git pull
nssm restart DevitrakServer
```

**If the pull changed `package-lock.json`**, use the script — it is the supported path and it
handles the five traps this box has, in the right order:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\CGAdmin\Documents\Github\server-testing\scripts\deploy-node.ps1"
```

It stops the four Node services, kills the pm2 daemon (which `nssm stop` does not), deletes
`node_modules` outright, installs, checks that no direct dependency is ESM-only, starts everything
back in reverse order and polls the health endpoint for ~30s. On a failed install it leaves the
services **stopped on purpose** rather than bringing the cluster up on a half-installed tree. Pass
`-SkipInstall` for a code-only deploy. It logs to `logs\deploy-node.log`, and it never runs `git`,
so pull first.

The rest of this section is what the script does and why, kept because the deploy of 2026-09-09
hit four of these in a row. `npm ci` deletes `node_modules`, and every Node service holds files
open in there, so the install dies with `EBUSY`/`EPERM` halfway and leaves a half-populated tree.
Stop every **Node** service first (the Go worker does not use `node_modules`, leave it alone):

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git pull

nssm stop DevitrakServer
nssm stop DevitrakEmailWorker
nssm stop DevitrakBulkWorker
nssm stop DevitrakDeleteWorker

# Stopping the services is NOT enough: the pm2 daemon is a separate process that
# survives `nssm stop` and keeps handles inside node_modules. Leave it alive and
# `npm ci` dies with ENOTEMPTY/EPERM trying to rmdir some package folder.
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, StartTime, Path
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
# The Go worker is not a node process — it stays up, untouched.

npm ci --omit=dev

nssm start DevitrakServer
nssm start DevitrakEmailWorker
nssm start DevitrakBulkWorker
nssm start DevitrakDeleteWorker
nssm status DevitrakServer                # SERVICE_RUNNING
(Invoke-WebRequest -Uri "http://localhost:34001/health" -UseBasicParsing).Content
```

> If a previous `npm ci` already failed halfway, the tree is in a state npm cannot repair on its
> own — delete it by hand before retrying: `Remove-Item -Recurse -Force node_modules` (or
> `cmd /c "rmdir /s /q node_modules"` when PowerShell trips over long paths). A single file that
> keeps refusing to go is usually Defender mid-scan: wait a few seconds and retry.

> **Node >= 20.11.0 is required** (`package.json` -> `engines`), and `.npmrc` sets
> `engine-strict=true`, so npm **fails** — it does not warn — on an older Node. Production runs
> 20.11.0. Install with `--omit=dev`: nothing in `devDependencies` (`jsdoc`, `nodemon`,
> `response-time`) is used at runtime, and skipping them keeps 41 packages out of production.

### Notificaciones: pasar a `NODEMAILER_AUTH_MODE=enforce`

El primer deploy que traiga `middlewares/notificationAuth.js` **no requiere nada**:
sin la variable en el `.env`, el default del código es `warn`, que registra los
envíos sin sesión pero no bloquea ninguno. Un ambiente que nadie configuró no se
pone a rechazar tráfico solo.

`enforce` es a dónde queremos llegar, y hay que ponerlo a mano. Antes de hacerlo,
mirá un día de tráfico real:

```powershell
Select-String -Path "C:\Users\CGAdmin\Documents\Github\server-testing\logs\*.log" `
  -Pattern "unauthenticated notification allowed"
```

Cada línea trae la ruta, el origin y la IP. Lo que estamos buscando es si
`app.devitrak.net` (la app de consumidores, cuyo código no está en este repo)
llama a alguna ruta que no sea una de las cuatro públicas — reset de contraseña,
force-logout, confirmación de cuenta de consumidor, link de login de consumidor.
Esas cuatro están exentas en todos los modos.

- **Si no aparece nada legítimo**, agregá `NODEMAILER_AUTH_MODE=enforce` al `.env`
  y reiniciá. A partir de ahí, todo `POST /api/nodemailer/*` sin sesión válida
  responde 401.
- **Si aparece algo**, esa es la lista de lo que hay que autenticar primero. No
  pongas enforce todavía: un 401 sobre una notificación fire-and-forget no se
  nota del lado del que la mandó, el correo simplemente deja de llegar.

`off` desactiva el chequeo por completo, como rollback sin tocar código.

> El spoofing de marca está cerrado en los tres modos: el branding sale siempre
> de la sesión verificada, nunca del header `x-company-id`. El modo solo decide
> si además se rechazan los envíos sin sesión.

### `/api/company`: pasar a `COMPANY_AUTH_MODE=enforce`

Mismo mecanismo que el de arriba, para el namespace Mongo de compañías
(`routes/company.js` → `/api/company`; **no** `/api/db_company`, que es el de
MySQL). De sus 18 rutas solo una comprobaba algo, y las otras no son de solo
lectura: `POST /provider-upload-document/:id` sube el fichero a S3 y escribe en
Mongo, `POST /new` crea una compañía.

El primer deploy que traiga `middlewares/companyAuth.js` **no requiere nada**:
el default del código es `warn`, que registra y no bloquea.

Antes de pasar a `enforce`, lee unos días de tráfico real:

```powershell
Select-String -Path "C:\Users\CGAdmin\Documents\Github\server-testing\logs\*.log" `
  -Pattern "company: unauthenticated request allowed"
```

Cada línea trae la ruta, el método, el origin y la IP. Lo que aparezca y sea
legítimo va a `PUBLIC_ROUTES` en `middlewares/companyAuth.js` **antes** de
enforce, no después.

> La diferencia con el caso de nodemailer es que allí las cuatro rutas exentas
> se conocían. Aquí la lista está **sembrada a partir de los nombres de las
> rutas**, no de evidencia: solo el registro de compañía es seguro, y las dos de
> firmas de consumidor son una suposición marcada como tal en el código. Por eso
> `.env.example` deja esta variable en `warn` en vez de en `enforce`.
>
> Poner enforce a ciegas es exactamente lo que dejó
> `POST /api/db_company/delete-bulk-items` respondiendo 403 a un flujo real
> durante tres semanas en julio.

Verify it's back up:

```powershell
nssm status DevitrakServer      # SERVICE_RUNNING
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

## Liveness, readiness y métricas

Tres endpoints con tres usos distintos, y confundirlos es lo que hace que un
servidor roto siga recibiendo tráfico:

| Endpoint | Para qué | Auth |
|---|---|---|
| `GET /health` | **Liveness.** Plano, sin dependencias: responde mientras el proceso atienda un socket. Es lo que debe mirar nssm o el HEALTHCHECK del contenedor para decidir *reiniciar o no* | no |
| `GET /ready` | **Readiness.** Comprueba MySQL, Mongo, Redis y el worker de Go. `200` si puede servir, `503` si falla una crítica. Es lo que debe mirar un balanceador para decidir *mandarle tráfico o no* | no |
| `GET /api/metrics` | Latencia p50/p95/p99, tráfico y tasa de error **por endpoint**, más un top de clientes por volumen. Vista del cluster entero, no del proceso que responde | superuser |

```powershell
# ¿Por qué está caído? El detalle viene por dependencia
(Invoke-WebRequest "http://localhost:34001/ready" -UseBasicParsing).Content

# ¿Qué endpoint se está comiendo el tiempo? (necesita x-token de superuser)
Invoke-RestMethod "http://localhost:34001/api/metrics?hours=2" -Headers @{ "x-token" = $token }
```

Tres cosas que conviene saber antes de interpretarlos:

- **`/ready` cachea 2 s.** Pedirlo en bucle no multiplica la carga sobre la base
  de datos, que es como un endpoint de salud se convierte en un vector de DoS.
  `?force=1` salta la caché para mirar a mano.
- **Y tiene rate limit propio, en dos niveles**: 120/min por IP en total y solo
  **6/min para `?force=1`**, porque el force salta la caché y golpea las cuatro
  dependencias en cada llamada — ahí es donde 200 bytes de petición se
  convierten en cuatro consultas. Al pasarse responde `429` **sin ejecutar las
  comprobaciones**, que es todo el objetivo. Ajustables con
  `READINESS_RATE_MAX` y `READINESS_RATE_MAX_FORCED`.
  El store es en memoria a propósito: un limitador respaldado por Redis
  fallaría justo cuando Redis se cae, que es cuando hace falta consultar el
  readiness. Y como es por proceso, el presupuesto real de la máquina es
  ×4 — correcto aquí, porque lo que se protege (el event loop de cada proceso
  y su tanda de comprobaciones) también es por proceso.
- **`/health` y `/ready` no pasan por el middleware global.** Se registran en
  `index.js` antes de que `configureMiddleware` monte nada, así que quedan fuera
  del limitador de 300/15min, de helmet y de cors. Es deliberado en el caso del
  limitador: ese es por IP y lo comparte con el tráfico de la API, así que un
  pico contra la API dejaría a nssm y al balanceador sin poder sondear, y el
  supervisor concluiría que el proceso está muerto. Por eso el readiness lleva
  su propio presupuesto y las métricas se le enganchan a la ruta.
- **Redis y el worker de Go DEGRADAN, no descalifican.** Si se caen, `/ready`
  sigue devolviendo `200` con `status: "degraded"`: sin ellos se pierden cachés
  y las operaciones masivas, pero el resto de la API responde, y sacar el
  proceso de rotación dejaría al cliente sin nada en vez de con casi todo.
- **Las métricas se agrupan por plantilla de ruta** (`/api/db_item/:id`), nunca
  por la ruta con valores ni por `company_id`. Los cuatro procesos acumulan en
  memoria y vuelcan a Redis cada 10 s con `HINCRBY`, así que la vista es del
  cluster; las ventanas son por hora y expiran solas a las 3 h.

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

### ⚠️ Port must be set to the SAME value for both processes

| Side | Env var | Built-in default |
|------|---------|------------------|
| Node caller (`helpers/goWorker.js`) | `GO_WORKER_PORT` | `7453` |
| Go worker (`go-worker/main.go`)     | `GO_WORKER_PORT` | `7453` |

The defaults now match (they used to disagree — `7453` vs `8081`), and
`test/goWorkerTarget.test.js` fails if either side drifts. **Matching defaults are not enough on
their own**, because whatever value one process reads must equal the other's:

> **This caused a multi-week production outage (2026-08).** `DevitrakGoWorker` had
> `GO_WORKER_PORT=7453` injected by nssm, while `DevitrakServer` had **no** `GO_WORKER_PORT` in its
> `AppEnvironmentExtra` — so Node's `dotenv` picked up `GO_WORKER_PORT=7452` from the repo `.env`
> and dialed a port nobody was listening on. Every call died with `ECONNREFUSED` and the circuit
> breaker sat open, while `/health` on 7453 answered fine and `go-worker-err.log` stayed empty, so
> it looked like an intermittent worker fault for weeks. The worker was healthy the entire time.

Rules that follow from that:

* Set `GO_WORKER_PORT` **explicitly on both services**, never rely on one of them inheriting `.env`.
* `AppEnvironmentExtra` **replaces the whole set** — re-list the existing variables when adding one.
* On startup Node now logs `Go worker target: http://<host>:<port>`. **Check that line matches the
  worker's actual port after any deploy or service change** — it is the cheapest possible guard
  against this class of bug.
* Verify from the box itself, which bypasses Node and the breaker entirely:
  ```powershell
  node -e "fetch('http://localhost:7453/retrieve-item-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company_id:134})}).then(r=>r.text()).then(t=>console.log('OK:',t.slice(0,80))).catch(e=>console.log('FAIL:',e.message,'| CAUSE:',e.cause?.code))"
  ```

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

### Installing / upgrading the Go toolchain on the box

Production ran `go1.24.11` until 2026-09-08, which is **below the floor** the worker now needs (see
the note in the next section). Last done: **not yet — pending**. The current stable is `go1.27.1`;
grab the matching SHA-256 for any other version from <https://go.dev/dl/>.

```powershell
# 1. Download and VERIFY before running anything
Invoke-WebRequest -Uri "https://go.dev/dl/go1.27.1.windows-amd64.msi" -OutFile "$env:TEMP\go1.27.1.msi"
(Get-FileHash "$env:TEMP\go1.27.1.msi" -Algorithm SHA256).Hash -eq `
  "54DBABBC910840FCE0028779E896CD99A22BDF89463354A1CA0D9288044DC6E7"
# must print True — do not install otherwise

# 2. Install (the MSI removes the previous version and fixes the system PATH itself)
msiexec /i "$env:TEMP\go1.27.1.msi" /qb

# 3. CLOSE AND REOPEN PowerShell — the open session keeps the old PATH
go version        # go1.27.1 windows/amd64

# 4. Make sure the new go.mod is actually on disk before rebuilding
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git pull
git log --oneline -1

# 5. Rebuild the worker with the new toolchain. Absolute path on purpose: the script resolves
#    everything from $PSScriptRoot, so it does not care about the working directory — and
#    pasting a relative path from another folder is how this step usually gets fumbled.
powershell -ExecutionPolicy Bypass -File "C:\Users\CGAdmin\Documents\Github\server-testing\scripts\restart-go-worker.ps1"

# 6. Confirm it came back up
nssm status DevitrakGoWorker      # SERVICE_RUNNING
curl http://localhost:7453/health
```

> ⚠️ Step 3 is not optional bookkeeping: the MSI updates the **system** PATH, but the session you
> ran it from still resolves the old `go.exe`. Skipping the reopen shows `go1.24.11` and looks like
> a failed install when it isn't.

The `go` directive in `go-worker/go.mod` (`go 1.25.0`) is a **language minimum, not a toolchain
pin** — a 1.27.1 toolchain compiles it, which is exactly the point: no toolchain downloads during
the production build.

### Updating the worker after a deploy

> **Go >= 1.25.0 is required** to build the worker: `go-worker/go.mod` declares `go 1.25.0`,
> pulled in by `golang.org/x/crypto` v0.52.0. With an older toolchain and the default
> `GOTOOLCHAIN=auto`, `go build` does **not** fail — it silently downloads Go 1.25.0 and carries on,
> so the compiler that produces the production binary becomes whatever the network hands over
> (and it breaks outright under an account with no network or no module-cache write access).
> Keep an explicit `go version` >= 1.25.0 on the box.

Once the service exists, a worker update is: rebuild the binary, then restart the service. Prefer
[`scripts/restart-go-worker.ps1`](scripts/restart-go-worker.ps1) (next section), which does all of
this plus a health check. The manual equivalent:

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing\go-worker"
nssm stop DevitrakGoWorker        # worker.exe is locked while the service runs
go build -o .\worker.exe          # rebuild from the freshly-pulled Go source
nssm start DevitrakGoWorker       # load the new binary
nssm status DevitrakGoWorker      # SERVICE_RUNNING
```

> Building **as any account other than the repo's owner** additionally needs `-buildvcs=false` —
> see the gotcha under the automation section below.

> The invariant: **after any change to `worker.exe` or `go-worker/*.go`, restart the worker** — a
> freshly built binary does nothing until the process is restarted.
>
> **`worker.exe` is NOT committed to git** (gitignored via `go-worker/*.exe`); each host builds its
> own with `go build` (Windows here; the Docker image builds the Linux `worker`). On the first pull
> after it was untracked, if git reports a modify/delete conflict on `go-worker/worker.exe`, resolve
> with `git rm --cached go-worker/worker.exe` — the running service's local binary is untouched.

### Automating the rebuild (recommended)

Forgetting the `go build` step means prod silently keeps running **old Go code** after a pull. Use
[`scripts/restart-go-worker.ps1`](scripts/restart-go-worker.ps1) instead of a bare
`nssm restart` — it stops the service, rebuilds, starts it, and health-checks the result.
**Run in an elevated (Administrator) shell:**

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
powershell -ExecutionPolicy Bypass -File .\scripts\restart-go-worker.ps1
```

That is the whole deploy for Go changes: `git pull`, then this.

> **Do NOT wire the build as an nssm `Start/Pre` hook.** It was tried and it does not work: nssm
> cuts the hook off after a few seconds, while a real `go build` here takes **8-10s**, so the build
> was killed on every restart. Only the runs that *failed fast* (~4s) ever reached their `RESULT`
> line, which made it look like it was working when it was not. Measured on the prod box
> 2026-08-07. Building outside the service lifecycle removes the time limit and also guarantees
> `worker.exe` isn't locked by a running process when the new binary is swapped in.

**How the script behaves on failure — and why.** It **always exits 0**. A `Start/Pre` hook that
fails can block the service from starting, and restarting the worker is often an *incident-recovery*
action; a compile error in half-finished source must never be the reason production can't come back
up. So on any failure it keeps the last known-good `worker.exe`, logs loudly, and lets the service
start. It also builds to a staging file and only swaps it in on success, so a broken build can never
leave a corrupt binary behind.

**The tradeoff you must know about:** a silent build failure means the worker keeps running old
code — exactly the problem this automation is meant to prevent. So after deploying Go changes,
**check the log**:

```powershell
Get-Content "C:\Users\CGAdmin\Documents\Github\server-testing\logs\go-worker-build.log" -Tail 20
```

Every run appends a `RESULT:` line — `BUILT` (new binary in place), `SKIPPED` (Go toolchain not
found) or `FAILED` (compile error; previous binary kept, with the compiler output above it).

Gotchas worth checking the first time you enable this:

* **`go` must be resolvable by the service account** (usually `LocalSystem`), whose `PATH` differs
  from the interactive admin's. The script falls back to the standard install paths, but if you see
  `RESULT: SKIPPED`, that's what happened.
* **`-buildvcs=false` is mandatory when building as the service account** (the script already passes
  it). Go stamps git metadata into binaries since 1.18, so `go build` shells out to git; the service
  account is not the repo's owner, so git aborts with *"detected dubious ownership"* (exit 128) and
  the build dies with `error obtaining VCS status: exit status 128`. The confusing part is that the
  identical `go build` run **by hand as the repo owner succeeds**, which makes it look like an
  environment fault rather than a permissions one.
* **Cold builds are slow.** Go's build cache makes subsequent builds a few seconds, but the very
  first one can take much longer; confirm nssm doesn't cut the hook short on that first restart.
* To disable the hook later: `nssm set DevitrakGoWorker AppEvents Start/Pre ""`.

The script also works standalone, as a drop-in for the manual `go build`:
`powershell -ExecutionPolicy Bypass -File scripts\build-go-worker.ps1`.

**Manual fallback** (no service): run it detached with the port set explicitly —
`$env:GO_WORKER_PORT = "7453"; Start-Process .\worker.exe -WorkingDirectory "...\go-worker"`. This
does **not** survive a reboot; prefer the service above.

---

## Split services (native nssm) — Node · Go worker · email · bulk · delete

Production runs as **separate native nssm services** (no containers; Windows Server
2019). They share the external MySQL (PlanetScale) + Mongo and talk over localhost.

| Service | Runs | Owns |
|---------|------|------|
| `DevitrakServer` | Node (`index.js`, pm2-runtime) | HTTP API + in-process queue worker for **every job type that has no dedicated worker** (`QUEUE_EXCLUDE_GROUPS=dedicated`) |
| `DevitrakGoWorker` | `go-worker\worker.exe` | inventory Go operations (see the Go worker section) |
| `DevitrakEmailWorker` | `node queue\standalone.js` | **email** jobs only |
| `DevitrakBulkWorker` | `node queue\standalone.js` | **bulk-write** jobs (see below) — fast poll. Sirve también el grupo `heavy` mientras no exista `DevitrakHeavyWorker` |
| `DevitrakDeleteWorker` | `node queue\standalone.js` | **delete** jobs only (see below) — fast poll |

The split is driven entirely by env — the code is identical across services. The type
lists live in **`constants/queueTypeGroups.js`** (groups `email`, `bulk`, `delete`), so a
service is configured by GROUP and the lists never drift between the worker, the main
server's exclusion and this document:

- **`DevitrakServer`**: `GO_WORKER_EXTERNAL=true` (don't spawn a co-located Go worker —
  call the service) and `QUEUE_EXCLUDE_GROUPS=dedicated` — every type that has its own
  worker, resolved from the registry. **This is the line you no longer have to edit when
  a group gains a type.** Optionally `GO_WORKER_HOST` if the Go worker is on another box
  (default `localhost`).
- **`DevitrakEmailWorker`**: `QUEUE_GROUP=email`.
- **`DevitrakBulkWorker`**: `QUEUE_GROUP=bulk` and `QUEUE_POLL_MS=300` (see below — this
  one's poll interval matters).
- **`DevitrakDeleteWorker`**: `QUEUE_GROUP=delete` and `QUEUE_POLL_MS=300`.
- **Grupo `heavy`** (`inventory:bulk-insert-alphanumeric`,
  `inventory:bulk-update-alphanumeric`, `event:bulk-update-item-shipping`,
  `inventory:export`): trabajo pesado que **nadie espera** — sus controllers
  responden `202 + jobId`. Ver el aviso de abajo: **necesita consumidor**.
  `inventory:export` sube el .xlsx a S3, así que el servicio que sirva `heavy`
  necesita `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_S3_BUCKET_NAME` y **`AWS_S3_EXPORTS_BUCKET`** — los toma del `.env` del
  repositorio, que `queue\standalone.js` carga con dotenv igual que el server; no
  hay que duplicarlos en nssm. También escribe un fichero temporal en
  `os.tmpdir()` del usuario del servicio.

  > **`AWS_S3_EXPORTS_BUCKET=devitrak-inventory-exports`** (us-east-2, creado el
  > 2026-09-22 con una regla que borra los objetos al día). Va en el `.env` del
  > repositorio y **no** en `nssm`: dotenv lo carga en los cuatro servicios de
  > una vez, y así no hay que volver a montar un `AppEnvironmentExtra` entero
  > —que es como se borró un `GO_WORKER_PORT` en este mismo despliegue—.
  >
  > Si no está definida, los exports caen al bucket de documentos y **siguen
  > funcionando**: por eso el código se puede desplegar antes de tocar el `.env`.
  > Lo que no funcionaría es tenerla puesta a medias, así que es una sola línea
  > en un solo sitio.
  >
  > El bucket tiene que estar en **us-east-2**, la misma región que el cliente
  > S3: las URLs prefirmadas se firman con la región, y una firmada para Ohio
  > contra un bucket de Virginia no valida.

### Estado real de producción — verificado en la VM el 2026-09-22

Los bloques de instalación de más abajo son los pasos históricos, **no el estado
actual**. Esto es lo que devuelve `nssm get <servicio> AppEnvironmentExtra` hoy,
después del cutover a grupos:

```
DevitrakServer        PM2_HOME=…\.pm2
                      GO_WORKER_EXTERNAL=true
                      GO_WORKER_PORT=7453
                      QUEUE_EXCLUDE_GROUPS=dedicated
DevitrakBulkWorker    QUEUE_GROUP=bulk,heavy   QUEUE_POLL_MS=300
DevitrakDeleteWorker  QUEUE_GROUP=delete       QUEUE_POLL_MS=300
DevitrakEmailWorker   QUEUE_GROUP=email
```

> #### ⚠️ `GO_WORKER_PORT=7453` NO se puede omitir de esa línea
>
> `nssm set AppEnvironmentExtra` **reemplaza el bloque entero**, así que montar
> el comando sin esa variable la borra. Y no se cae al valor por defecto del
> código (que es 7453 y sería correcto): **el `.env` del repositorio tiene
> `GO_WORKER_PORT=7452`**, `dotenv` no pisa lo que ya viene del entorno, y sin la
> variable de nssm gana el `.env`. Node marcaría el 7452 mientras el worker
> escucha en el 7453 → ECONNREFUSED en **todas** las llamadas al Go worker. Es
> exactamente el incidente del 2026-08-06.
>
> Antes de tocar cualquier `AppEnvironmentExtra`, haz primero el `nssm get` y
> monta la línea nueva a partir de lo que devuelva.

**Lo que había antes del cutover**, por si hay que revertir: `DevitrakServer`
excluía **solo los tres tipos de correo** (no la lista larga que documentan los
bloques de abajo), así que competía por los bulk, los borrados y los pesados
dentro de los procesos que atienden login y pagos. Y `DevitrakBulkWorker` llevaba
un `QUEUE_TYPES=` explícito — que **tiene precedencia sobre `QUEUE_GROUP`**, así
que añadirle el grupo sin quitar la lista no habría hecho nada, mientras la API
sí habría dejado de tomar los pesados: 202 + jobId y nadie procesándolos.

> ### ⚠️ ANTES DE DESPLEGAR EL GRUPO `heavy`: hay que darle consumidor
>
> Tres de estos cuatro tipos **no estaban en ningún grupo**, así que hasta
> ahora los consumía `DevitrakServer` dentro de los mismos procesos que
> atienden el login y los pagos. Al meterlos en un grupo, `dedicated` los
> incluye y el server **deja de tomarlos en cuanto arranque con este código**.
> El cuarto, `inventory:export`, nace aquí: nunca lo ha servido nadie.
>
> **Ojo con la forma vieja, que es la que corre hoy en la VM.** El comando de
> `DevitrakServer` de más abajo trae un `QUEUE_EXCLUDE_TYPES=` con los tipos
> escritos a mano, y `QUEUE_TYPES`/`QUEUE_EXCLUDE_TYPES` **tienen precedencia**
> sobre los grupos. Mientras esa línea siga puesta, el server principal seguirá
> reclamando `inventory:export` — generando el .xlsx dentro de la API — por
> mucho que el tipo esté en `heavy`. Hay que **sustituirla** por
> `QUEUE_EXCLUDE_GROUPS=dedicated`, no añadir el grupo al lado.
>
> Si ningún worker sirve `heavy`, esos jobs se quedan **encolados para
> siempre**, sin error y sin que nada lo señale. Elige una de las dos:
>
> **(a) Rápido, sin servicio nuevo** — el worker de bulk sirve los dos grupos.
> `QUEUE_GROUP` admite lista:
>
> ```powershell
> nssm set DevitrakBulkWorker AppEnvironmentExtra QUEUE_GROUP=bulk,heavy QUEUE_POLL_MS=300
> nssm restart DevitrakBulkWorker
> ```
>
> Saca el trabajo pesado de la API, que es el 90 % de la ganancia. A cambio
> comparte worker con los jobs que sí se esperan, así que un insert de 15.000
> seriales todavía puede hacerles agotar su ventana de 4 s.
>
> **Con `inventory:export` dentro, ese «a cambio» pesa más:** un export grande
> dura minutos, no segundos, y el worker procesa de a uno. Mientras corre, los
> `bulk` que esperan 4 s caen al `202 + jobId` — que es un camino correcto y ya
> soportado (`createSyncOrQueuedController`), pero cambia lo que ve el usuario.
> Si los exports se vuelven frecuentes, pasar a (b) es un cambio de env, sin
> tocar código.
>
> **(b) Correcto** — su propio servicio, `DevitrakHeavyWorker` con
> `QUEUE_GROUP=heavy` y **poll normal** (no necesita 300 ms: nadie espera).
> Se crea igual que el de borrados, cambiando el nombre y el grupo.
>
> **Y el orden importa**: arranca el consumidor nuevo **antes** de reiniciar
> `DevitrakServer`. Al revés queda una ventana sin nadie tomando esos tipos.
> Durante el solape los dos compiten, y eso es inofensivo — el claim es atómico.

The old form still works and takes precedence: an explicit `QUEUE_TYPES` overrides
`QUEUE_GROUP`, and `QUEUE_EXCLUDE_TYPES` is added to whatever `QUEUE_EXCLUDE_GROUPS`
resolves to. A **typo in a group name makes the process exit** instead of silently
claiming the whole queue — check the service log if a worker won't start.

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

### Create the bulk worker service (fast poll)

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

### Create the delete worker service (fast poll)

Owns the `delete` group of `constants/queueTypeGroups.js`:
`inventory:bulk-delete-by-criteria` (`deleteBulkItemBasedOnCriteria`, which with
no `serial_number` wipes a whole category/location) and
`inventory:bulk-delete-by-ids` (`deleteBulkItems`, an explicit id list, chunked
into batches of 500 against the Go worker).

**Why deletes get their own process instead of riding along with `DevitrakBulkWorker`:**
the worker drains jobs **one at a time** (`queue/worker.js` § `tick` — up to
`QUEUE_BATCH` per cycle, sequentially). A bulk insert of ~15,000 serials holds the
tick for as long as it takes, and a delete claimed behind it waits. That matters on
this route specifically because the controller uses `waitForJobOutcome`
(`maxWaitMs=4000`, `helpers/queuedController.js`) to preserve the synchronous
contract: blow past those 4s and the endpoint degrades to the async `202 + jobId`
shape. Its own process means a delete never queues behind an insert.

Keep `QUEUE_POLL_MS=300` for the same reason as the bulk worker — the default
4000ms poll alone would exhaust that 4s wait.

Run **as Administrator**:

```powershell
nssm install DevitrakDeleteWorker "C:\Program Files\nodejs\node.exe"
nssm set DevitrakDeleteWorker AppParameters "queue\standalone.js"
nssm set DevitrakDeleteWorker AppDirectory "C:\Users\CGAdmin\Documents\Github\server-testing"
nssm set DevitrakDeleteWorker DisplayName "Devitrak Delete Worker"
nssm set DevitrakDeleteWorker Description "Dedicated fast-poll task-queue worker for delete jobs (queue/standalone.js)."
nssm set DevitrakDeleteWorker Start SERVICE_AUTO_START
nssm set DevitrakDeleteWorker AppEnvironmentExtra QUEUE_GROUP=delete QUEUE_POLL_MS=300
nssm set DevitrakDeleteWorker AppStdout "C:\Users\CGAdmin\Documents\Github\server-testing\logs\delete-worker-out.log"
nssm set DevitrakDeleteWorker AppStderr "C:\Users\CGAdmin\Documents\Github\server-testing\logs\delete-worker-err.log"
nssm set DevitrakDeleteWorker AppExit Default Restart
nssm set DevitrakDeleteWorker AppRestartDelay 3000
nssm start DevitrakDeleteWorker
nssm status DevitrakDeleteWorker   # SERVICE_RUNNING
```

Confirm the scope it actually resolved — the worker logs its own filter on start:

```powershell
Get-Content "C:\Users\CGAdmin\Documents\Github\server-testing\logs\delete-worker-out.log" -Tail 5
# Task queue worker starting (id=..., poll=300ms, batch=20, types=[inventory:bulk-delete-by-criteria])
```

Then — and only then — hand the type over: switch `DevitrakBulkWorker` to the group
form so it stops claiming deletes (`AppEnvironmentExtra` **replaces** the whole
block, so re-list `QUEUE_POLL_MS`):

```powershell
nssm set DevitrakBulkWorker AppEnvironmentExtra QUEUE_GROUP=bulk QUEUE_POLL_MS=300
nssm restart DevitrakBulkWorker
```

> **Order matters, but nothing is lost if you get it wrong in this direction.**
> While both services list the delete type they just compete for it and the atomic
> claim decides — no double processing, only no isolation yet. The damaging order is
> the reverse: dropping the type from `DevitrakBulkWorker` **before** the delete
> worker runs leaves delete jobs with no fast-poll consumer (the main server
> excludes the whole `dedicated` set), so every bulk delete degrades to the 202
> fallback. To remove: `nssm remove DevitrakDeleteWorker confirm`.

Optional, once the delete worker is confirmed: move the other two services to the
group form as well (the explicit `QUEUE_TYPES` lists keep working, they just have to
be edited by hand every time a group gains a type):

```powershell
nssm set DevitrakEmailWorker AppEnvironmentExtra QUEUE_GROUP=email
nssm set DevitrakServer AppEnvironmentExtra PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2 GO_WORKER_EXTERNAL=true QUEUE_EXCLUDE_GROUPS=dedicated
nssm restart DevitrakEmailWorker
nssm restart DevitrakServer
```

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
