# Plan de ejecución — 2026-09-18

> **Para revisar ANTES de ejecutar nada.** Ningún paso de este documento se ha
> ejecutado. Cada bloque dice explícitamente si toca **código**, **datos** o
> **configuración**, porque el riesgo y la vuelta atrás son distintos en cada
> caso.
>
> Complementa a `DEPLOY_PHASES_2026-09-17.md` (el orden de las fases y sus
> trampas) y a `DEPLOY.md` (los comandos y las trampas de la máquina). Esto es
> **qué hacer hoy, en qué orden, y qué hay que aprobar antes de cada cosa**.

---

## Estado del que parte este plan

Sondeado contra `https://db.devitrak.net` el **2026-09-18 a las 08:18**:

```
/health       200   {"server":"standby","status":"operational"}
/ready        200   ← daba 404 antes de la Fase 1
/api/metrics  401   ← daba 404; ahora existe y pide token
```

`/ready` con las cuatro dependencias en verde: mysql 80 ms, mongo 76 ms,
**redis 73 ms**, goWorker en 7453 a 70 ms. Uptime 48.357 s → **desplegado el
17-sep sobre las 18:52**.

Lo desplegado es `release/observabilidad`, **no `main`** (confirmado en el
mensaje de `83bb4b3`). Es decir: **los siete cambios que rompen contrato NO
están vivos**, y el riesgo de despliegue accidental que describía la Fase 0 está
desarmado.

| Fase | Estado |
|---|---|
| 0 · Prevuelo | ✅ cerrada (17-sep, en la VM) |
| 1 · Observabilidad | ✅ desplegada — **salvo el paso 1.5, que falta** |
| 2 · Medir | ⏸️ **no ha empezado de verdad** (ver A1) |
| 3 · Cerrar con frontend | ✅ cerrada, las 4 respuestas están |
| 4 · Rompe contrato | ⛔ bloqueada por la 2 |
| 5 · Cutovers a `enforce` | ⛔ bloqueada por la 2 |
| 6 · Dependabot | ⏳ sin empezar, independiente |

---

# Bloque A · Hoy, antes de la reunión

**Nada de este bloque toca código.** Son un cambio de datos y dos lecturas. No
requiere desplegar, ni reiniciar, ni mergear.

## A1 · Dar `platform_observer` al operador — **CAMBIO DE DATOS**

**Por qué es lo primero:** sin esto la Fase 2 no mide. `/api/metrics` responde
403 a todo el mundo porque nadie tiene el flag y nada en el repositorio lo
concede (detalle completo en `DEPLOY_PHASES_2026-09-17.md` § Fase 1.5).

La ventana de métricas son **3 horas**: lo que cae fuera **ya se descartó**, en
silencio. Llevamos ~13 h así. No se recupera hacia atrás, así que cada hora que
pasa antes de este paso es una hora perdida — pero solo eso: **no hay daño
acumulado, solo datos no recogidos**.

```javascript
db.adminusers.updateOne(
  { email: "<el correo del operador>" },
  { $set: { platform_observer: true } }
)
```

- **Aprobar antes:** a qué cuenta(s) se le concede.
- **No conceder `super_user`** como atajo: es bypass total de escritura en todas
  las compañías.
- **Vuelta atrás:** `{ $set: { platform_observer: false } }`. Sin efectos
  secundarios: el flag no da escritura.
- **Verificación:** `/api/metrics?hours=3` con ese token devuelve datos en vez de
  `Forbidden: platform observability requires platform_observer`.

## A2 · Primera muestra de métricas — **SOLO LECTURA**

En cuanto A1 esté:

```powershell
Invoke-RestMethod "http://localhost:34001/api/metrics?hours=3" -Headers @{ "x-token" = $token } |
  ConvertTo-Json -Depth 6 | Out-File "metrics-2026-09-18-0900.json"
```

**Guardar la salida en fichero**, no mirarla y cerrar. Por la ventana de 3 h hay
que repetir varias veces al día; una ruta poco usada da cero en una sola muestra
y parece que no la llama nadie.

Lo que se está buscando está en `DEPLOY_PHASES_2026-09-17.md` §2.2: las cuatro
rutas que hoy dan 401, las siete que cambian de contrato, y el tráfico sin
sesión a `/api/company`.

## A3 · Confirmar que la VM sigue en `release/observabilidad` — **SOLO LECTURA**

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git status
git log --oneline -1
```

Tiene que decir `release/observabilidad`. **Si dice `main`, parar y avisar**: en
ese estado cualquier `nssm restart`, reinicio de Windows o respawn de un worker
de pm2 publica los siete cambios de contrato sin que nadie lo haya decidido — y
con el cluster a medias, unos procesos sirviendo un contrato y otros otro.

---

# Bloque B · En la reunión — decidir, no ejecutar

Ninguna de estas cuatro se ejecuta durante la reunión. Son las que desbloquean
el Bloque C.

1. **`MONGO_SECONDARY_READS`** viene en `on` por defecto y **se activó sola** al
   desplegar el 17-sep. ¿Se queda en `on`? Es un interruptor de `.env`, se
   revierte sin desplegar.
2. **Cuándo la Fase 4.** El reloj de los «3 días mínimo» de la Fase 2 cuenta
   **desde A1**, no desde el despliegue de ayer. Si A1 se hace hoy, la Fase 4 no
   puede ser antes del **21-sep**.
3. **`feat/inventory-export`**: si se mergea ya, y si entra en la tanda de la
   Fase 4 o va aparte (ver C1).
4. **El aislamiento de colas que no existe**: `DevitrakServer` drena 8 de los 11
   tipos que deberían ser de workers dedicados, dentro de los mismos procesos que
   atienden login y pagos. **Es anterior a este despliegue** y **no debe colarse
   en esta tanda** (ver C5).

---

# Bloque C · Cambios de código — cada uno con su puerta

> **Nada de este bloque se ejecuta sin aprobación explícita**, y ninguno antes
> de que el Bloque A esté cerrado.

## C1 · Desplegar el export — **CÓDIGO** — ✅ listo para la VM (21-sep)

**Estado (21-sep):** **NO se mergea a `main`.** `feat/inventory-export` estaba
construida sobre `main`, así que desplegarla habría publicado de paso los siete
cambios de contrato — la Fase 4 sin la Fase 2 detrás. En su lugar, los dos
commits del export van por **cherry-pick sobre `release/observabilidad`**, que
es lo que la VM ya corre:

```
cab8f63  fix(cola): inventory:export no tenia grupo   ← el .xlsx lo generaba la API
0813526  feat(inventario): export en cola
79ddacf  ← lo que la VM tiene hoy
```

Pusheado. 1318/1319 tests en esa rama (el único fallo es el gap preexistente de
`auth.js`; son menos tests que en `main` porque allí viven los de los siete
cambios de contrato). Verificado a mano que `/inventory-export` queda por encima
del catch-all `router.post("/:id")`, que en esta rama está en otra posición.

`feat/inventory-export` (con `5b63822` encima) sigue en su sitio para cuando la
Fase 4 llegue de verdad.

- **Qué añade:** `POST /api/db_item/inventory-export` (202 + jobId), un handler
  de cola, y `exceljs` como dependencia nueva.
- **La consecuencia que hay que aprobar aparte:** arregla dos columnas del Excel
  que hoy salen mal (`Current Location` siempre vacía, `Warehouse` siempre
  `"In-Use (In-Use)"`). Es lo correcto, pero **es un cambio visible** en un
  fichero que los usuarios ya conocen. Conviene avisar al dashboard antes.
- **Ojo con el despliegue:** esta rama **sí toca `package-lock.json`**, así que
  aquí no vale el atajo de `git pull` + restart — toca `deploy-node.ps1` completo
  con sus cinco trampas, y `node >= 20.11.0` (la VM tiene 20.11.0 justo).
- **El paso de env que NO es opcional (21-sep):** `inventory:export` ya está en
  el grupo `heavy`, así que el despliegue de esta rama lleva **en el mismo
  momento** dos cambios en nssm, y en este orden:
  ```powershell
  nssm set DevitrakBulkWorker AppEnvironmentExtra QUEUE_GROUP=bulk,heavy QUEUE_POLL_MS=300
  nssm restart DevitrakBulkWorker      # primero el consumidor
  nssm set DevitrakServer AppEnvironmentExtra PM2_HOME=... GO_WORKER_EXTERNAL=true QUEUE_EXCLUDE_GROUPS=dedicated
  ```
  El `QUEUE_EXCLUDE_TYPES` escrito a mano que hoy tiene `DevitrakServer` hay que
  **quitarlo**, no dejarlo al lado: tiene precedencia sobre los grupos y el
  server seguiría generando el .xlsx dentro de la API. Si se levanta el
  consumidor al revés (server primero) queda una ventana sin nadie tomando esos
  tipos. Detalle completo en `DEPLOY.md` § aviso del grupo `heavy`.
- **Bloqueado por:** nada técnico. Es decisión de producto.
- **Vuelta atrás:** no desplegar, o revertir el merge. No hay migraciones. Si
  solo hay que revertir el reparto, `QUEUE_EXCLUDE_TYPES` vuelve a su lista
  anterior y el server retoma esos tipos — el claim es atómico, no se duplica
  nada durante el solape.

## C2 · Fase 4 — los siete cambios de contrato — **CÓDIGO**

- **Bloqueado por:** Fase 2 con datos reales (o sea, por A1 + 3 días).
- **Qué es:** `git checkout main` + restart en la VM. El disco ya tiene los
  commits; es un cambio de rama, no un `pull`.
- **Vuelta atrás:** `git checkout release/observabilidad` + restart. Vuelve a la
  Fase 1 sin perder la observabilidad — para eso existe esa rama.
- **Qué vigilar las primeras horas:** está en
  `DEPLOY_PHASES_2026-09-17.md` § Fase 4.

## C3 · Fase 5 — cutovers a `enforce` — **CONFIGURACIÓN**

- **Bloqueado por:** Fase 2 con días de tráfico real. **Uno por vez, no los dos.**
- `COMPANY_AUTH_MODE: warn → enforce` exige haber volcado antes las líneas
  `company: unauthenticated request allowed` en `PUBLIC_ROUTES`.
- Poner `enforce` a ciegas es lo que dejó una ruta real en 403 durante tres
  semanas en julio.

## C4 · Fase 6 — Dependabot — **CÓDIGO, independiente**

Puede ir en paralelo desde ya. `npm audit` en 0, ninguna urgente. `express 5`
aparte y con calma (cambia el manejo de errores asíncronos y el repositorio
depende de `express-async-errors`).

## C5 · Migrar la config de colas a grupos — **CONFIGURACIÓN, TAREA APARTE**

`QUEUE_EXCLUDE_TYPES` (lista a mano) → `QUEUE_EXCLUDE_GROUPS=dedicated`.

> ⚠️ **Hacerlo sin dar consumidor a `heavy` reintroduce la parada silenciosa**
> que describe el paso 1.1: tres rutas responderían `202 + jobId` y el trabajo no
> se haría nunca. Y en esta máquina `QUEUE_TYPES` tiene precedencia sobre
> `QUEUE_GROUP`, así que añadir el grupo sin quitar los tipos **no hace nada**.

**No debe entrar en esta tanda.** Necesita su propio momento y su propia
verificación.

---

# Checklist de revisión

Antes de aprobar la ejecución, confirmar:

- [ ] A1 — a qué cuenta(s) se concede `platform_observer`, y que es ese flag y
      no `super_user`
- [ ] A3 — la VM sigue en `release/observabilidad`
- [ ] B1 — decisión sobre `MONGO_SECONDARY_READS`, que ya está activa
- [ ] B2 — fecha de la Fase 4, contando los 3 días **desde A1**
- [ ] C1 — si `feat/inventory-export` entra, y si se avisa al dashboard del
      cambio visible en el Excel
- [ ] C5 — que la migración de colas queda **fuera** de esta tanda

---

## Lo que este plan NO afirma

- **No sé en qué commit exacto está producción**, solo que corre
  `release/observabilidad` (por `83bb4b3`) y que `/ready` y `/api/metrics`
  existen. Distinguir el commit exacto desde fuera no es posible; se confirma
  con el `git log -1` de A3.
- **No he verificado las ocho ramas de Dependabot**: `gh` no resuelve el
  repositorio desde esta máquina. El dato de «ocho ramas, `npm audit` en 0» viene
  de `DEPLOY_PHASES_2026-09-17.md`, no de una comprobación de hoy.
- **No sé si alguien ya puso `platform_observer` a mano** en producción después
  del despliegue. Lo que sí sé es que nada del repositorio lo hace. Si el paso A2
  devuelve datos a la primera, A1 ya estaba hecho y el reloj de la Fase 2 cuenta
  desde antes.
