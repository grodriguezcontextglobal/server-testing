# Prod: crear `DevitrakHeavyWorker` (2026-10-16)

> **Dónde:** la VM de producción, en `C:\Users\CGAdmin\Documents\Github\server-testing`.
> **Requisitos:** PowerShell **como Administrador** (nssm lo exige), y el repo en
> `f808e9d` o posterior (el script existe desde `0bc9733`).
> **Duración:** unos 5 minutos. **Bulk y Delete se reinician unos segundos.**
> **Riesgo:** bajo. No toca `DevitrakServer` ni el worker de Go, y ningún job se
> pierde: lo que no tenga consumidor se queda `pending` hasta que alguno arranque.

---

## Por qué

Hoy en prod hay 5 servicios: `DevitrakServer`, `DevitrakEmailWorker`,
`DevitrakBulkWorker`, `DevitrakDeleteWorker` y `DevitrakGoWorker`. Los jobs del grupo
**`heavy`** (exports de inventario, imports de hoja de cálculo, rangos alfanuméricos
y actualizaciones masivas de envíos) los procesa **`DevitrakBulkWorker`**, configurado
con `QUEUE_GROUP=bulk,heavy`.

El problema: ese worker procesa **de uno en uno**. Mientras corre un export de
varios minutos, las llamadas de `bulk` que esperan su resultado (hasta 4 s, en
`helpers/queuedController.js`) no reciben respuesta a tiempo y caen a un 202, y el
dashboard tiene que consultar el job. Con un worker Heavy propio, `bulk` vuelve a
responder al momento.

## Qué hace el script

`scripts/install-queue-workers.ps1` es idempotente: se puede correr otra vez sin
romper nada. En este orden:

| Servicio | Antes | Después |
|---|---|---|
| `DevitrakHeavyWorker` | No existe | **Se crea**: `QUEUE_GROUP=heavy`, poll por defecto, arranque automático, logs en `logs\heavy-worker-*.log` |
| `DevitrakBulkWorker` | `bulk,heavy` (probablemente) | `QUEUE_GROUP=bulk QUEUE_POLL_MS=300` |
| `DevitrakDeleteWorker` | `delete` | `QUEUE_GROUP=delete QUEUE_POLL_MS=300` (se vuelve a aplicar igual) |
| `DevitrakServer` | — | **No lo toca**; solo comprueba que excluya los grupos dedicados y avisa si no |

Heavy se crea **primero** a propósito: así nunca hay un momento en que los jobs
`heavy` se queden sin consumidor. Mientras Bulk y Heavy sirven los dos el grupo,
compiten, pero sin procesar nada dos veces (la reserva del job es atómica).

---

## Pasos

### 0. Momento

Hazlo cuando **no haya un export ni un import en curso**. Si hay uno, el reinicio de
Bulk lo corta; el job no se pierde (vuelve a `pending` y se reintenta), pero el
usuario espera más. Para comprobarlo, mira en el log si hay algo corriendo:

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
Select-String -Path logs\combined.log -Pattern "inventory:export|bulk-insert-from-spreadsheet" | Select-Object -Last 5
```

### 1. Guardar la configuración actual (para poder volver atrás)

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
& {
  foreach ($s in 'DevitrakServer','DevitrakBulkWorker','DevitrakDeleteWorker','DevitrakEmailWorker') {
    "== $s"; (nssm get $s AppEnvironmentExtra) -replace "`0", ''
  }
} | Out-File "logs\nssm-env-before-heavy-$stamp.txt" -Encoding utf8
Get-Content "logs\nssm-env-before-heavy-$stamp.txt"
```

Fíjate en la línea `QUEUE_GROUP=` de **DevitrakBulkWorker**: es la que vas a necesitar
si hay que volver atrás.

### 2. Correr el script

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-queue-workers.ps1
```

Lo que tienes que ver al final:

```
==> Waiting for the workers to run
    DevitrakHeavyWorker=SERVICE_RUNNING
    DevitrakBulkWorker=SERVICE_RUNNING
    DevitrakDeleteWorker=SERVICE_RUNNING
==> Scopes logged by the workers (last lines of logs\combined.log)
    ... Task queue worker starting ... (una línea por worker, con su grupo)
==> Checking DevitrakServer leaves these groups alone
    OK: QUEUE_EXCLUDE_GROUPS=dedicated        <- o un WARNING (ver paso 3)
==> Done.
```

Si algún worker no llega a `SERVICE_RUNNING`, el script dice qué log leer
(`logs\<grupo>-worker-err.log`).

### 3. Solo si salió el WARNING de `DevitrakServer`

El aviso significa que `DevitrakServer` no excluye los grupos dedicados. No es un
error (nada se procesa dos veces), pero entonces el proceso de la API también
compite por los jobs `heavy`, y se pierde el aislamiento que buscamos.

**Cuidado:** `nssm set ... AppEnvironmentExtra` **sustituye la lista entera**. Así se
perdió `GO_WORKER_PORT` el 2026-09-22. Parte siempre de la lista actual:

```powershell
# 3a. La lista actual, una variable por línea
$current = @((nssm get DevitrakServer AppEnvironmentExtra) -replace "`0", '' | Where-Object { $_ -ne '' })
$current

# 3b. La misma lista, quitando QUEUE_EXCLUDE_TYPES / QUEUE_EXCLUDE_GROUPS y añadiendo el valor correcto.
#     QUEUE_EXCLUDE_TYPES tiene PRECEDENCIA sobre los grupos: hay que QUITARLO, no basta con añadir.
$new = @($current | Where-Object { $_ -notmatch '^QUEUE_EXCLUDE_(TYPES|GROUPS)=' }) + 'QUEUE_EXCLUDE_GROUPS=dedicated'
$new                                   # revísala: tienen que seguir GO_WORKER_PORT y el resto

# 3c. Aplicar y reiniciar
nssm set DevitrakServer AppEnvironmentExtra @new
nssm restart DevitrakServer
Start-Sleep -Seconds 10
Invoke-RestMethod http://localhost:34001/health
```

### 4. Comprobar

```powershell
Get-Service Devitrak* | Format-Table Name, Status        # ahora son 6, todos Running
nssm get DevitrakHeavyWorker AppEnvironmentExtra         # QUEUE_GROUP=heavy  NODE_ENV=production
nssm get DevitrakBulkWorker AppEnvironmentExtra          # QUEUE_GROUP=bulk  QUEUE_POLL_MS=300  NODE_ENV=production
Get-Content logs\heavy-worker-err.log -Tail 20 -ErrorAction SilentlyContinue   # vacío o sin errores
```

**Prueba funcional:** pide un export de inventario desde el dashboard. Tiene que
llegar el `.xlsx` como siempre. En `logs\combined.log` tiene que aparecer el job
`inventory:export` procesado.

### 5. Monitor de latidos (opcional)

El worker nuevo solo late si `.env` tiene `HEARTBEAT_URL_QUEUE_HEAVY`. Sin esa variable
no hace nada (ni error ni log). Si usáis el monitor externo, crea allí el servicio
`queue_heavy`, añade su URL al `.env` del repo como `HEARTBEAT_URL_QUEUE_HEAVY=...` y
reinicia solo ese worker:

```powershell
nssm restart DevitrakHeavyWorker
```

---

## Volver atrás

```powershell
nssm stop DevitrakHeavyWorker
nssm remove DevitrakHeavyWorker confirm
# Devolver a Bulk el grupo heavy (el valor del paso 1; normalmente este):
nssm set DevitrakBulkWorker AppEnvironmentExtra QUEUE_GROUP=bulk,heavy QUEUE_POLL_MS=300 NODE_ENV=production
nssm restart DevitrakBulkWorker
```

Los jobs `heavy` que se encolen mientras tanto no se pierden: esperan en `pending`
hasta que Bulk vuelva a servir el grupo.

## Después

- `scripts/deploy-node.ps1` ya incluye `DevitrakHeavyWorker`: a partir de ahora lo
  para y lo arranca con el resto en cada despliegue, y desaparecen los
  *"Can't open service"*.
- Avísanos con la salida del paso 2 (y del 3 si hizo falta) para dejarlo apuntado.
