# Diseño — Cola de tareas durable sobre MongoDB (store-and-forward)

> Objetivo: que **ninguna tarea importante se pierda** aunque el servidor o una dependencia
> externa (SendGrid, Stripe, S3, Go worker, DB) esté caída. Las tareas se persisten en una
> colección de MongoDB Atlas, se responden al cliente de inmediato y un worker las procesa
> cuando la dependencia vuelve a estar sana, con reintentos y backoff.

Este documento define la arquitectura, el modelo de datos, los cambios en servidor y frontend,
y el **plan de acción por fases** siguiendo la metodología del equipo: **test → code → refactor**.

---

## 1. Alcance

**Sí entra en la cola** (efectos secundarios, fire-and-forget, idempotentes o dedupables):

| Tier | Operaciones | Servicio | Cambio de frontend |
|---|---|---|---|
| **1 — Piloto** | Correos `/api/nodemailer/*` (33 rutas) | SendGrid / nodemailer | **Ninguno o mínimo** (ya son background) |
| **1** | Logs: `notificationLog`, `eventLog`, `errorLog`, `staffActivityLog` | Mongo | Ninguno |
| **1** | Escrituras del Go worker (`runGoWorker` de mutación) | Go worker | Ninguno |
| **2** | Subidas a S3 / Cloudinary (documentos) | S3 / Cloudinary | Parcial (cliente quiere la URL) |
| **3** | Mutaciones Stripe | Stripe | Se mantienen **síncronas** con retry + circuit breaker (NO se encolan a ciegas) |

**No entra** (siguen síncronas): todos los `GET`, login, validaciones que devuelven dato inmediato,
lecturas del Go worker, y cualquier mutación de Stripe (dinero no se buffea).

> Regla de oro para encolar: (1) el cliente no necesita el resultado al instante,
> (2) toca un servicio externo que puede fallar, (3) es idempotente o dedupable por clave.

---

## 2. Arquitectura

```
                                 ┌──────────────────────────────────────────────┐
Cliente ─POST─► IIS ─► Node :34001                                               │
 (frontend)              │                                                       │
                         │ 1. enqueue(job)  ── inserta doc en Mongo (status=pending)
                         │ 2. responde 202 { ok, jobId }  ◄── el cliente sigue    │
                         │                                                       │
                         ▼                                                       │
                 ┌─────────────────┐        ┌──────────────────────────────┐   │
                 │ MongoDB Atlas    │◄───────│  Worker / Dispatcher          │   │
                 │  colección jobs  │ claim  │  (1 sola instancia:           │   │
                 │  (durable)       │ atómico│   pm2 NODE_APP_INSTANCE==0)    │   │
                 └─────────────────┘        │  - findOneAndUpdate            │   │
                         ▲                   │  - ejecuta handler por type    │   │
                         │  reintento         │  - backoff / dead-letter       │   │
                         └───────────────────│  - polling node-schedule +     │   │
                                             │    (opcional) Change Streams   │   │
                                             └──────────────┬─────────────────┘   │
                                                            ▼                     │
                                          SendGrid / Go worker / S3 / Mongo ...   │
                                          (si está caído → job vuelve a pending,  │
                                           NO se pierde, sobrevive reinicios)     │
                                                                                  ┘
```

Decisiones clave:
- **La cola vive en MongoDB Atlas.** Aprovecha `findOneAndUpdate` (claim atómico a nivel documento),
  TTL index (auto-limpieza) y, opcionalmente, Change Streams (evita polling). No factura por lectura
  como PlanetScale.
- **Un solo worker.** Se arranca reutilizando el patrón `isPM2FirstInstance` de
  [`index.js:270`](index.js) — así el cluster `pm2 -i max` no lo duplica. Evita de raíz el problema
  de dos procesos tomando el mismo job.
- **El enqueue corre en cualquier instancia** (es solo un insert).

---

## 3. Modelo de datos — `models/Job.js`

Sigue el patrón Mongoose del repo (`Schema` + `model` + `toJSON`, ver [`models/NotificationLog.js`](models/NotificationLog.js)).

```js
const { Schema, model } = require("mongoose");

const JobSchema = Schema(
  {
    type:            { type: String, required: true, index: true }, // 'send-email:invoice', 'go-worker:insert-item-event', ...
    payload:         { type: Schema.Types.Mixed, required: true },  // args de la tarea
    status:          { type: String, enum: ["pending","processing","done","failed","dead"], default: "pending", index: true },
    attempts:        { type: Number, default: 0 },
    maxAttempts:     { type: Number, default: 5 },
    nextAttemptAt:   { type: Date, default: Date.now, index: true }, // para el backoff
    lockedBy:        { type: String, default: null },                // id del worker que lo tomó
    lockedAt:        { type: Date, default: null },
    idempotencyKey:  { type: String, default: null, unique: true, sparse: true }, // dedup
    lastError:       { type: String, default: null },
    result:          { type: Schema.Types.Mixed, default: null },    // opcional: salida para consulta
    doneAt:          { type: Date, default: null },                  // TTL borra 'done' viejos
    context: {                                                       // ver §4 — snapshot de auditoría
      uid:        { type: String, default: null },
      companyId:  { type: String, default: null },
      sqlStaffId: { type: Number, default: null },
    },
  },
  { timestamps: true } // createdAt / updatedAt
);

// Índice compuesto para el claim eficiente
JobSchema.index({ status: 1, nextAttemptAt: 1 });
// TTL: borra jobs 'done' 7 días después de doneAt (0 s tras la fecha)
JobSchema.index({ doneAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
// Auditoría/soporte: listar jobs por compañía (ej. "qué se encoló para C1")
JobSchema.index({ "context.companyId": 1, createdAt: -1 });

JobSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();
  object.id = _id;
  return object;
});

module.exports = model("Job", JobSchema);
```

> `idempotencyKey` con `unique + sparse`: si intentas encolar dos veces la misma acción
> (ej. mismo correo), el segundo insert falla → lo tratas como "ya encolado", sin duplicar.

---

## 4. Contexto de auditoría en jobs (identidad, no credenciales)

### 4.1 El problema

Toda request al backend trae headers de sesión/contexto —hoy en este repo:
`x-token`, `s-token-lq`, `x-company-id`, `s-company-id`— que los middlewares
(`validateJWT`, `optionalJWT`, `authorizeMongoPermission`) leen y verifican, dejando el
resultado colgado en `req` (`req.uid`, `req.sqlStaffId`, `req.adminRoleType`, ...).

Cuando una tarea se encola, **el `req` que la originó deja de existir** en el momento en que
el worker la ejecuta —puede ser segundos o hasta días después (dead-letter reintentado a
mano). Si no se captura nada, el job queda "huérfano": no hay forma de saber quién lo pidió,
bajo qué compañía, ni de auditar la acción después.

### 4.2 La regla de fondo (aplica a cualquier header futuro, no solo a los 4 actuales)

> **Se persiste identidad ya verificada. Nunca se persisten credenciales.**

- `x-token` y `s-token-lq` son credenciales (JWT / id de staff derivado de sesión). **Jamás
  se guardan crudos** en un documento de `jobs` — ese documento vive en Mongo, lo puede leer
  cualquiera con acceso de lectura a la colección, y un JWT filtrado es una cuenta comprometida.
- Lo que sí se guarda es el **resultado ya validado** por el middleware que corrió antes del
  controller: `req.uid` (puesto por `validateJWT`/`optionalJWT` tras verificar la firma del
  JWT), `req.sqlStaffId`, el `companyId` ya resuelto. Esa verificación **ya ocurrió** en la
  request original; el job no reautentica, solo **audita quién disparó la acción**.
- `s-company-id` está reservado en CORS ([`config/cors.js`](config/cors.js)) pero **ningún
  middleware lo lee hoy** — no se incluye en el context todavía porque no existe semántica que
  capturar. El día que se le dé uso, se agrega siguiendo el mismo patrón (§4.4).

### 4.3 Diseño: `buildContext` como allowlist estricto

`queue/core.js` expone una función **pura** que normaliza cualquier objeto de entrada a
exactamente 3 campos conocidos, descartando todo lo demás:

```js
// queue/core.js
function buildContext(source = {}) {
  const { uid = null, companyId = null, sqlStaffId = null } = source || {};
  return { uid, companyId, sqlStaffId };
}
```

La propiedad importante: **es un allowlist, no un filtro de exclusión**. Si por error alguien
pasa `{ uid, xToken: '<jwt-crudo>' }`, `xToken` se descarta silenciosamente — no hay forma de
que un secreto se cuele en el documento aunque el código que llama a `enqueue` tenga un bug.
Esto está verificado en `test/queue.test.js` (`buildContext: es un allowlist — descarta
cualquier campo no reconocido`).

`helpers/queue.js` expone la única pieza que sí toca `req` — un extractor delgado que replica
el mismo orden de precedencia de `companyId` que ya usa
[`authorizeMongoPermission.js`](middlewares/authorizeMongoPermission.js) (header → body →
params → query), para no inventar una segunda convención:

```js
// helpers/queue.js
const extractJobContext = (req) => {
  const headerCompanyId =
    (typeof req.header === "function" ? req.header("x-company-id") : undefined) ||
    req.headers?.["x-company-id"];

  return {
    uid: req.uid ?? null,
    companyId: headerCompanyId || req.body?.company_id || req.params?.company_id || req.query?.company_id || null,
    sqlStaffId: req.sqlStaffId ?? null,
  };
};
```

Uso en un controller (Fase 1+):

```js
const { enqueue, extractJobContext } = require("../helpers/queue");

await enqueue("send-email:invoice", payload, {
  idempotencyKey: `invoice:${transactionId}`,
  context: extractJobContext(req), // snapshot de auditoría, capturado mientras el req existe
});
```

### 4.4 Cómo escalar esto cuando aparezcan nuevas necesidades

Este diseño se dejó pensado para crecer sin reescribirse. Casos previsibles y cómo resolverlos:

| Necesidad futura | Dónde tocar | Qué NO hacer |
|---|---|---|
| Se le da uso real a `s-company-id` (ej. reemplaza a `x-company-id`) | Agregar la lectura en `extractJobContext` con la misma precedencia que su análogo actual | No leerlo "por si acaso" antes de que tenga semántica definida |
| Un nuevo header de contexto (ej. `x-event-id`, `x-locale`) | 1) Añadir el campo a `buildContext` (allowlist) 2) Añadirlo al subschema `context` en `models/Job.js` 3) Leerlo en `extractJobContext` | Nunca hacer spread de `req.headers` completo en el context — rompe el allowlist y puede filtrar credenciales sin que nadie lo note |
| Un handler necesita **reautorizar** en vez de solo auditar (ej. verificar que la compañía sigue activa antes de ejecutar) | El handler recibe `job.context.companyId` y vuelve a consultar `Company`/`hasPermission` él mismo, igual que hace `authorizeMongoPermission` hoy | No asumir que el permiso sigue vigente solo porque se validó al encolar — pueden pasar días hasta un reintento |
| Se necesita **listar/depurar** jobs por compañía o por usuario | Ya existe el índice `{ "context.companyId": 1, createdAt: -1 }`; para `uid` agregar un índice análogo cuando haya una consulta real que lo use | No indexar especulativamente sin un query concreto que lo justifique |
| Un tipo de job necesita un campo de auditoría que **no aplica a los demás** | No forzarlo al `context` genérico — va dentro de `payload`, que es libre por tipo | No inflar el `context` compartido con campos de un solo caso de uso |

La idea central que hace esto escalable: **`context` es infraestructura transversal (quién,
para qué compañía), `payload` es el dato específico del tipo de tarea.** Mientras esa
separación se respete, agregar un campo transversal nuevo es un cambio de 3 líneas en 3
archivos (core → schema → extractor), no un rediseño.

---

## 5. Componentes del servidor

### 5.1 `helpers/queue.js` — API de encolado (la usan los controllers)
```js
// enqueue(type, payload, { idempotencyKey, maxAttempts, context }) -> devuelve el jobId
// Un simple Job.create(...). Si choca la idempotencyKey (E11000), devuelve el job existente.
// extractJobContext(req) -> arma el context (ver §4) para pasarlo a enqueue.
```

### 5.2 `queue/worker.js` — dispatcher (corre en 1 sola instancia)
Responsabilidades:
1. **Claim atómico** de N jobs listos:
   ```js
   const job = await Job.findOneAndUpdate(
     { status: "pending", nextAttemptAt: { $lte: new Date() } },
     { $set: { status: "processing", lockedBy: WORKER_ID, lockedAt: new Date() } },
     { sort: { nextAttemptAt: 1 }, new: true }
   );
   ```
2. **Ejecuta el handler** según `job.type` (ver 5.3). El handler recibe `(payload, job)`, así
   que puede leer `job.context` si lo necesita (ej. para logging o re-scoping por compañía).
3. **Éxito** → `status="done"`, `doneAt=now` (TTL lo limpia luego).
4. **Fallo** → `attempts++`; si `attempts < maxAttempts`: `status="pending"`,
   `nextAttemptAt = now + backoff(attempts)` (ej. `min(2^attempts * 1s, 5min)`);
   si se agota: `status="dead"` (dead-letter, requiere intervención manual).
5. **Recuperación de "processing" colgados**: al arrancar (o en un barrido), jobs con
   `status="processing"` y `lockedAt` viejo (> timeout) vuelven a `pending`. Cubre el caso
   de que el server muriera a mitad de un job.

Disparo del ciclo:
- **Polling** con `setInterval` (`QUEUE_POLL_MS`, default 4s). Suficiente para correos/logs.
- **Opcional (fase posterior)**: Change Streams sobre `jobs` para reaccionar al instante y bajar latencia.

### 5.3 `queue/handlers/` — registro de handlers por tipo
Un mapa `type -> async (payload, job) => result`. Cada handler encapsula la lógica que hoy vive
inline en el controller. Ejemplo: `send-email:invoice` reutiliza el HTML/envío de
[`nodeMailer/notifications.js`](nodeMailer/notifications.js).

### 5.4 Arranque del worker
En [`index.js`](index.js), dentro del bloque `isNativeMaster || isPM2FirstInstance`
(junto al arranque del Go worker):
```js
require("./queue/worker").start();
```
Así corre **una sola vez**, no una por cada worker del cluster.

---

## 6. Idempotencia por tipo

| Tipo | Clave de idempotencia | Nota |
|---|---|---|
| Correos | `email + plantilla + entidad` (ej. `invoice:{transactionId}`) | Evita doble envío en reintento |
| Go worker (mutación) | `operación + entidad` (ej. `insert-item-event:{itemId}:{eventId}`) | Reconciliable |
| Logs | *(ninguna)* | Aceptan duplicados; no es crítico |
| Documentos S3/Cloudinary | `documentId` | Evita subir dos veces |

---

## 7. Cambios en el FRONTEND

La clave: **el Tier 1 casi no requiere cambios**, porque esas operaciones ya son background.

### Fase 1 — Correos y logs (impacto mínimo)
- Hoy el frontend hace `POST /api/nodemailer/...` y normalmente solo necesita saber que
  "se aceptó", no que "se entregó".
- El endpoint pasa a responder **`202 { ok: true, jobId }`** de inmediato (antes respondía tras enviar).
- **Cambio de frontend:**
  - Si la UI solo muestra "correo enviado" → cambiar el texto a **"correo en cola / se enviará en breve"**
    (semántica más honesta). Nada más.
  - Si algún flujo **bloqueaba** esperando la confirmación de envío → quitar ese bloqueo; ya no aplica.
- **No hay** cambio de endpoints ni de payload de entrada. Solo cambia la forma de la respuesta
  (de `{ok:true}` a `{ok:true, jobId}`) y el momento (inmediato).
- Los headers (`x-token`, `x-company-id`, ...) se siguen enviando exactamente igual que hoy —
  el frontend no cambia nada ahí; es el backend el que los captura como `context` antes de
  encolar (ver §4).

### (Opcional) Seguimiento de estado de un job
Si algún flujo quiere confirmar que se completó:
- Nuevo endpoint **`GET /api/jobs/:jobId`** → `{ status, attempts, lastError, result }`.
- El frontend hace **polling** (cada pocos s) hasta `done`/`dead`, o muestra el estado en un panel.
- Alternativa a futuro: notificación push / websocket al completar (reutilizando `notificationLog`).

### Fase 2 — Documentos (S3/Cloudinary)
- Aquí el cliente sí suele querer la URL final. Contrato asíncrono:
  1. `POST` → `202 { jobId }`.
  2. Frontend hace polling a `GET /api/jobs/:jobId` hasta `done`, y toma `result.url`.
- Requiere ajuste real en la pantalla de subida (mostrar "procesando…" y luego la URL).

### Fase 3 — Stripe
- **No cambia el frontend.** Se mantiene síncrono; solo se endurece el backend con retry + circuit breaker.

---

## 8. Operación y observabilidad

### 8.1 Endpoints — `GET /api/jobs/*` ✅ implementados

Ambos protegidos con `requireSuperUser` (ver §8.2 — no `authorizeMongoPermission`, porque un job
no pertenece a una sola compañía).

- **`GET /api/jobs/stats`** → `{ ok, stats: { pending, processing, done, failed, dead, total } }`.
  Todos los status listados aunque tengan 0 (no se omiten). Debe montarse **antes** de `/:jobId`
  en la ruta, si no Express lo captura como un `jobId`.
- **`GET /api/jobs/:jobId`** → detalle completo para depurar: `type`, `status`, `payload`,
  `context`, `attempts`, `lastError`, `result`, timestamps. `400` si `jobId` no tiene formato de
  ObjectId de Mongo (24 hex), `404` si no existe.

Implementación: `controller/jobs.js` (`createGetJobStatus`/`createGetJobStats`, con inyección de
`findById`/`aggregateByStatus` para testear sin Mongo — mismo patrón DI del resto de la cola) +
`routes/jobs.js`, montado en `index.js` como `jobs: require("./routes/jobs")` dentro de
`mongoRoutes` (→ `/api/jobs`).

### 8.2 Control de acceso: por qué `requireSuperUser` y no `authorizeMongoPermission`

`authorizeMongoPermission` exige un `company_id` de contexto (o `super_user` como bypass) porque
los recursos que protege son siempre de una compañía. Un job de la cola **no lo es**: un correo,
un log de staff, etc. puede pertenecer a cualquier compañía, y `/api/jobs/stats` es inherentemente
una vista de plataforma completa. Se creó `middlewares/requireSuperUser.js` — un gate mínimo
(activo + `super_user`) — en vez de forzar estos endpoints al esquema de permisos por-compañía.

### 8.3 Uso operativo

- **Inspección puntual**: `GET /api/jobs/:jobId` para ver por qué un job específico falló
  (`lastError`, `attempts`) sin necesidad de acceso directo a Mongo.
- **Inspección directa en DB**: `db.jobs.find({ status: "dead" })` → tareas que agotaron reintentos.
- **Inspección por compañía**: `db.jobs.find({ "context.companyId": "C1" }).sort({ createdAt: -1 })`.
- **Reintento manual**: poner un `dead`/`failed` de vuelta a `pending` con `nextAttemptAt=now`.
- **Métricas**: `GET /api/jobs/stats` para un dashboard simple o alertas.
- **Alertas**: si `dead` > umbral, avisar (los correos de alerta NO deben depender de la cola).
- **Limpieza**: el TTL borra `done` viejos automáticamente; los `dead` se conservan para auditoría.

---

## 9. Plan de acción por fases (test → code → refactor)

### Fase 0 — Fundamentos de la cola ✅ COMPLETADA
1. **Tests** (`test/queue.test.js`, 27 casos):
   - `enqueue`/`buildNewJob` crea job `pending`.
   - `context`: allowlist estricto, nunca credenciales crudas (ver §4.3).
   - `extractJobContext`: lee identidad ya verificada del `req`, nunca `x-token`/`s-token-lq`.
   - claim atómico: filtro/update de `findOneAndUpdate` documentado y testeado.
   - backoff: al fallar, `attempts++` y `nextAttemptAt` futuro (exponencial con techo).
   - dead-letter: al agotar `maxAttempts`, pasa a `dead`.
   - recuperación: `processing` colgado (`isStale`) vuelve a `pending`.
2. **Code**: `queue/core.js` (núcleo puro), `models/Job.js`, `helpers/queue.js`,
   `queue/worker.js`, `queue/handlers/index.js`.
3. **Refactor**: lógica de decisión aislada en funciones puras testeables sin DB, igual que
   `scripts/migrate*` e `idempotencyMutationCache`.
4. Worker arrancado en `index.js` bajo `isNativeMaster || isPM2FirstInstance`.

### Fase 1 — Piloto: correos + logs ✅ COMPLETADA (errorLog pendiente aparte, ver nota)

**Correos — hecho, 30 de 35 rutas migradas** (piloto inicial de 4 + réplica de 26 más en dos
batches, clasificadas por perfil de riesgo):

1. **Piloto (4)**: `singleEmailNotification`, `newUserInvitationNotification`,
   `internalNotification`, `eventBeginsReminderNotification`.
2. **Batch A — 22 rutas simples** (mismo perfil de riesgo que el piloto: un solo mensaje, sin
   validación, sin dependencia de DB): `assingDeviceNotification`, `returningDeviceNotification`,
   `returningDeviceLeaseMemberNotification`, `deviceReportPerTransaction`,
   `cancelDepositNotification`, `captureDepositNotification`, `earlierReturningNotification`,
   `eventStaffNotification`, `editingDeviceAdminNotification`,
   `confirmationLinkNewConsumerNotification`, `loginLinkExistingConsumerNotification`,
   `linkToResetPassword`, `customizedEmailNotification`, `staffInternalNotification`,
   `itemInfoStaffNotification`, `eventLinkEvent`, `chargeInvoice`, `refundInvoice`,
   `completedTask`, `failedTask`, `forcingRevokingActiveSession`, `memberEmailNotification`.
3. **Batch B — 8 rutas con validación de entrada** (400 si faltan campos): `lostDeviceFeeCollectedNotification`,
   `liabilityContractMemberNotification`, `liabilityContractConsumerNotification`,
   `liabilityContractStaffNotification`, `termsAndConditionsAcceptanceNotification`,
   `documentSigningCompletionNotification`, `consumerDocumentSigningCompletionNotification`,
   `consumerLeaseEndedDeviceReturnedNotification`.

**Extensión necesaria de la factory (antes de Batch B)**: `createQueuedJobController` ganó dos
capacidades, con sus propios tests:
- **`opts.validate(body)`** — corre antes de encolar; si devuelve `{status, body}`, responde eso
  y NO encola. Sin esto, migrar una ruta con validación (`if (!x) return res.status(400)...`)
  hubiera convertido esos `400` en `500` al mover la lógica al `catch` genérico — un cambio de
  contrato real, no cosmético. Se probó con TDD antes de tocar cualquier endpoint de Batch B.
- **`buildPayload` async** — permite armar mensajes que dependen de composición más elaborada
  (ver siguiente punto); `await`-eado internamente, compatible con builders sync existentes.

**Mensajes múltiples sin handler nuevo**: `documentSigningCompletionNotification` y
`consumerDocumentSigningCompletionNotification` enviaban 2 correos con
`Promise.all([sgMail.send(msg1), sgMail.send(msg2)])`. `sgMail.send()` acepta nativamente un
**array** de mensajes distintos en una sola llamada — equivalente exacto al `Promise.all`
original. Por eso el `buildPayload` de estos dos devuelve `[msg1, msg2]` y el mismo handler
genérico `send-email` (que solo reenvía el payload a `sgMail.send(payload)`) los procesa sin
cambios. Cero handlers nuevos para este caso.

**2 bugs preexistentes corregidos de paso** (al extraer un builder correcto, no se podían
replicar los bugs sin reescribir la lógica rota a propósito):
- `earlierReturningNotification`: `ReferenceError` — usaba una variable `msg` que nunca se
  definió (la variable real era `info`), y pasaba `returnReminderMessageHtml` como referencia de
  función sin invocarla. El endpoint estaba **100% roto** (siempre devolvía 500). Se corrige la
  invocación; el template en sí (`returnReminderMessageHtml`) sigue siendo un stub que devuelve
  `""` — no se inventó contenido nuevo, eso es una decisión de producto fuera de alcance.
- `linkToResetPassword`: si `sgMail.send` fallaba, el `catch` solo logueaba y **nunca respondía**
  — el cliente quedaba colgado hasta el timeout de 30s. La factory genérica siempre responde.

**Refactor**: sin duplicación pendiente. El patrón (`build*Message` puro + `createQueuedEmailController`,
con `validate` cuando aplica) es ahora uniforme en las 30 rutas migradas.

**Frontend**: las 30 rutas migradas responden `202 {ok:true, notification, jobId}` en vez de
`201 {ok:true, notification:"Email sent"}` (o el saldo variable que tenía cada una). Los `400` de
validación **no cambiaron** (mismo status, mismo body). Ajustar textos/UX según §7 Fase 1 antes
de considerar estas rutas "en producción".

**5 rutas quedan deliberadamente sin migrar** (perfiles que no encajan en el patrón mecánico;
migrarlas a la fuerza hubiera significado riesgos reales, no solo trabajo extra):

| Ruta | Por qué se deja para después |
|---|---|
| `returnedItemsToRenterNotification` | Adjuntos en base64 (ruta con límite de 100MB en `index.js`) — podrían acercarse o superar el **límite de 16MB por documento de Mongo**, y un job no es un lugar seguro para blobs grandes |
| `massiveEventCustomerNotification` | Depende de `User.find()` (consulta a DB) para armar la lista de destinatarios, con rama de retorno temprano si no hay resultados, y usa `sgMail.sendMultiple` (fan-out por *personalización*, no intercambiable 1:1 con `.send()` sin cambiar qué ve cada destinatario) |
| `devitrakFeedbackEmailNotification` | Mismo perfil que la anterior |
| `errorFeedbackEmailNotification` | Función interna (no HTTP); su único llamador es `createErrorFeed`, que ya está bloqueado por el tema del `errorId` (ver nota de logs) |
| `loginActivityNotification` | Función interna disparada con `setImmediate` desde `controller/admin.js` (fire-and-forget respecto a la respuesta de login); mismo patrón que `logStaffActivity` pero se deja pendiente por alcance de esta sesión, no por riesgo |

**Logs — hecho, con hallazgo relevante:** antes de migrar se auditó el repo buscando cualquier
dependencia interna sobre el documento síncrono devuelto por estos endpoints (grep de nombres de
campo, rutas, `API_DOCS.md`/`API_CLIENT_GUIDELINES.md`). Resultado:

- **`logStaffActivity`** (`controller/staffActivityLog.js`) — no es un endpoint HTTP, es una
  función interna invocada como `await logStaffActivity({...})` desde `admin.js`, `event.js` e
  `inventory.js` (12 call-sites). Nunca devolvía nada y **tragaba el error en un try/catch sin
  relanzar** — es decir, si el `save()` fallaba, el log de auditoría se perdía para siempre en
  silencio. Migrado a `enqueue("log:staff-activity", data)`: el contrato para los callers no
  cambia (sigue sin lanzar, sigue sin devolver nada), pero la falla ahora sobrevive vía reintento
  + dead-letter en vez de perderse. Sin `context` de auditoría: el propio `data`
  (`staff_member_id`/`company_id`) ya ES el sujeto del log.
- **`feedEventLog` / `feedNotificationLog`** — sin consumidor interno de `feedEvent`/
  `feedNotification` en este repo, sin mención en `API_DOCS.md`/`API_CLIENT_GUIDELINES.md`. El
  usuario confirmó que el frontend no depende del documento devuelto → migrados con la misma
  factory genérica (`createQueuedJobController`, extraída de `nodeMailer/queueEmail.js` al
  aparecer este segundo consumidor real). Responden `202 {ok:true, jobId}`.
- **`createErrorFeed`** (`/api/error_log`) — migrado. Ver §9.1 "Fase 1 — cierre de pendientes".

**Bug preexistente encontrado (ajeno a esta fase, no corregido aquí):**
[`nodeMailer/returningDeviceMessage.js:2038`](nodeMailer/returningDeviceMessage.js) usa
`props.eventSelected ?? props.eventSelected.length > 0` — con `??` en vez de `&&`, si
`eventSelected` es `undefined` igual evalúa `.length` sobre `undefined` y revienta. Afecta a
`singleEmailMessageHtml` (y posiblemente otras plantillas con el mismo patrón). Documentado
para corregir aparte.

### Fase 1 — cierre de pendientes ✅ COMPLETADA (`createErrorFeed` + 5 rutas diferidas)

Las 6 tareas que habían quedado pendientes al terminar el piloto de correos+logs. Todas resueltas
con TDD, en el orden: extensión de la factory → `loginActivityNotification` → `createErrorFeed` →
`massiveEventCustomerNotification`/`devitrakFeedbackEmailNotification` → `returnedItemsToRenterNotification`.

**Extensión de infraestructura compartida** — `createQueuedJobController` (`helpers/queuedController.js`)
gana soporte de **"payload nulo = no hay nada que encolar"**: si `buildPayload` resuelve a
`null`/`undefined`, no se llama `enqueue` y se responde con `opts.buildSkippedBody` (default
`{ok:true}`). Necesario para los dos endpoints que consultan la DB para armar destinatarios y
pueden legítimamente no tener a quién enviarle nada.

**`loginActivityNotification`** — función interna (dentro de un `setImmediate` en
`controller/admin.js`, fire-and-forget respecto al login) migrada exactamente con el mismo
criterio que `logStaffActivity`: se extrae `buildLoginActivityMessage` (sanitiza + compone el
mensaje) y se encola como `send-email`. El contrato para el caller no cambia (nunca lanza,
siempre devuelve `{success, message}`).

**`createErrorFeed` + `errorFeedbackEmailNotification`** — resueltos juntos (la segunda era una
función interna cuyo único llamador era la primera).
- **Pre-generación del `_id`**: Mongoose asigna el `_id` al construir `new ErrorLogs(...)`, antes
  de `.save()`. Se usa ese id para responder de inmediato al cliente (preserva la promesa de
  *"Please save the id for future reference"*) y se encola la persistencia pasándole ese mismo
  `_id` explícito (`ErrorLogs.create({_id: errorId, ...})` respeta el id dado).
- **Dos jobs independientes**, no uno combinado: `log:error` (persiste el documento, reutiliza
  `createModelInsertHandler`) y `send-email` (la notificación, con `buildErrorFeedbackMessage`
  reemplazando a la vieja `errorFeedbackEmailNotification`). Cada uno con `idempotencyKey` basada
  en el mismo `errorId`. Antes, ambos corrían en el mismo `try/catch` síncrono — si el correo
  fallaba, la respuesta era `500` **aunque el log ya se hubiera guardado**; con jobs
  independientes ese acoplamiento desaparece.
- **Validación agregada a propósito** (cambio de comportamiento deliberado, no cosmético): se
  agregó `validateErrorFeed` para rechazar con `400` si falta `componentStack`/`error`. Sin esto,
  el rechazo de Mongoose (`required: true`) ocurriría dentro del worker, invisible para un
  cliente que ya recibió `200` con un `errorId` que nunca se va a persistir.

**`massiveEventCustomerNotification` / `devitrakFeedbackEmailNotification`** — ambas consultan
`User.find()` para armar destinatarios y usan `sgMail.sendMultiple` (fan-out por
*personalización*: cada destinatario no ve a los demás — semántica distinta a `.send()` con un
array, que sí se usa en otras rutas para mensajes *distintos*). Se resuelven con:
- Un nuevo `type: "send-email-multiple"`, registrado con el mismo `createEmailHandler` genérico
  apuntando a `sgMail.sendMultiple` en vez de `sgMail.send` — cero código nuevo en el handler.
- `buildPayload` async (`createBuildMassiveEventCustomerMessage`/`createBuildDevitrakFeedbackMessage`,
  parametrizadas por la función de búsqueda para poder testear sin Mongo) hace la consulta **una
  sola vez** y devuelve `null` si no hay destinatarios — usa la extensión de la factory de arriba,
  en vez de consultar dos veces (una para "validar que hay alguien" y otra para armar el mensaje).

**`returnedItemsToRenterNotification`** — el más delicado, por el límite de 16MB por documento de
MongoDB. Resuelto con la **Opción A** (subir a S3 antes de encolar):
- La validación (`subject`, `staffEmails`, formato de email, forma de cada adjunto, existencia
  del archivo si viene por `path`) se mantiene **idéntica** a la original — mismos mensajes,
  mismos `400`. Es puramente síncrona, no toca S3.
- `createBuildReturnedItemsToRenterMessage(uploadAttachment)`: por cada adjunto, si viene con
  `path` lee el archivo real de disco (igual que antes); sube el contenido a S3
  (`helpers/s3Upload.js` → `uploadNotificationAttachment`, nueva) y el payload del job solo
  guarda `attachmentRefs: [{key, filename, type}]` — **nunca el base64**.
  `helpers/s3Upload.js` no sigue el patrón DI del resto de la cola (es un módulo preexistente con
  su propio estilo); la inyección para tests se hace en el builder, no en el helper.
- Nuevo `type: "send-email-multiple-with-attachments"`
  (`queue/handlers/emailWithAttachments.js`): el worker resuelve cada `attachmentRef` a base64
  (`fetchAttachmentAsBase64`, nueva) justo antes de enviar, arma `msg.attachments` en el formato
  que espera SendGrid, y **si el envío tuvo éxito**, borra los objetos de S3 (reutiliza
  `deleteDocumentFromS3` ya existente) — best-effort, un fallo de limpieza no rompe el job. Si el
  envío falla, los adjuntos **no se borran**, para que el reintento los pueda volver a resolver.

### Fase 2 — Go worker + documentos ✅ COMPLETADA

**Hallazgo previo a implementar, igual de importante que el de los correos diferidos:** de las 6
mutaciones del Go worker candidatas, **5 de 6 usan el resultado de forma síncrona** (conteos,
filas afectadas, o bifurcan en `status==="error"`) — el cliente los necesita en la misma
respuesta, no son fire-and-forget. Solo `insert-device-event-container` calificaba de verdad.

| Función | Operación Go worker | ¿Usa el resultado en la respuesta? | Tratamiento |
|---|---|---|---|
| `insertingItemInEvent` | `insert-item-event` | Sí (`inserted_items`, `total_items`) | Síncrono, sin cambios |
| `insertingDeviceInEventDirectly` | `insert-device-event-directly` | Sí (`inserted_items`) | Síncrono, sin cambios |
| `insertingDeviceInEventDirectlyFromContainer` | `insert-device-event-container` | **No** | **Encolado** |
| `itemFinalStatusWhenEventIsFinishedRefactored` | `item-final-status` | Sí (`affectedRows`) | Síncrono, sin cambios |
| `updateLargeData` | `update-item-warehouse` | Sí (`data`, bifurca en error) | Síncrono, sin cambios |
| `deleteBulkItems` | `delete-bulk-items` | Sí (`data`, bifurca en error; además es un borrado masivo) | Síncrono, sin cambios |

**1. Endurecimiento del Go worker (circuit breaker) — centralizado, cero cambios en controllers.**
`helpers/goWorker.js` ya tenía reintento (3 intentos, backoff exponencial) — protege UNA llamada.
Faltaba un circuit breaker que proteja ENTRE llamadas: si el Go worker está caído, que las
siguientes requests fallen rápido en vez de esperar los 3 reintentos completos cada vez.
- `helpers/circuitBreaker.js` (nuevo): genérico, no específico de Go worker. Estados
  closed → open (falla rápido sin invocar `fn`) → half-open (prueba un intento tras el cooldown).
- `helpers/goWorker.js` refactorizado a `createRunGoWorker(fetchImpl, breakerOpts)`, envolviendo
  la operación COMPLETA (con sus reintentos internos) como una sola unidad del breaker. El export
  por defecto (`module.exports = runGoWorker`) sigue siendo la función invocable directamente —
  **cero cambios en los 8+ call-sites existentes** (`items_events.js`, `item.js`, `auth.js`,
  `transaction.js`). `createRunGoWorker` queda como propiedad de la función exportada, solo para tests.

**2. `insertingDeviceInEventDirectlyFromContainer` — la única mutación fire-and-forget real.**
Encolada con `type: "go-worker:insert-device-event-container"`, usando un nuevo handler genérico
`queue/handlers/goWorker.js` (`createGoWorkerHandler(runGoWorkerFn, command)`, reutilizable para
futuras mutaciones fire-and-forget del Go worker).

**3. Webhook de `uploadExcelToS3` — encolado.** Este endpoint sube a S3 y luego dispara un webhook
HTTP externo (`INVENTORY_IMPORT_WEBHOOK_URL`) para iniciar la importación remota de inventario. La
respuesta final **nunca dependió del contenido de la respuesta del webhook**, solo de si estaba
arriba (antes: `502` si el webhook fallaba, aunque el archivo ya estuviera en S3). Se creó un
handler genérico `queue/handlers/webhook.js` (`createWebhookHandler`, reutilizable para cualquier
webhook externo futuro). **Cambio de comportamiento deliberado**: ya no existe la rama `502` — si
el webhook está caído momentáneamente, el reintento de la cola lo resuelve en vez de fallarle la
respuesta al cliente (el archivo ya estaba subido a S3 de todas formas).

**4. `uploadDocument` (PDF) — contrato async completo, no el cambio cosmético de Fase 1.** A
diferencia de correos/logs, el cliente sí necesita la URL final del documento. Confirmado con el
usuario: se migra con `202 {jobId}` + polling hasta `done`, leyendo `result.document`.
- **Polling accesible al dueño (no super_user)** — ver §9 "Polling owner-scoped" abajo. El endpoint
  de observabilidad `GET /api/jobs/:jobId` es super_user-only (para el dashboard); el usuario que
  sube el documento poll­ea `GET /api/jobs/owned/:jobId` (solo su propio job).
- Verificación previa importante: Multer usa `diskStorage` en `tmp/uploads/`
  ([`routes/document.js`](routes/document.js)) — el archivo **no se autoborra** al responder, así
  que sigue en disco cuando el worker lo procesa más tarde. Esto asume que el worker corre en la
  **misma máquina** que recibió el upload — cierto en el despliegue actual (1 sola máquina
  Windows, cluster PM2, ver `DEPLOY.md`); si el despliegue pasara a multi-máquina, esta suposición
  dejaría de sostenerse y habría que subir a S3 síncrono como se hizo con
  `returnedItemsToRenterNotification`.
- **Un solo job** (`type: "document:upload-pdf"`, `queue/handlers/documentUpload.js`), no dos
  independientes: crear el `Document` depende de la URL que devuelve la subida a S3, así que no
  se pueden separar como sí se hizo con `createErrorFeed` (log + email independientes).
- La validación síncrona se mantiene: `req.file` presente (`400`), `Company` existe (`404`) —
  ambas necesarias antes de que tenga sentido encolar algo.

### Fase 3 — Endurecer Stripe (sin encolar) ✅ COMPLETADA

Las mutaciones de Stripe **no se encolan** (el dinero no se buffea — un cobro no puede quedar
"pendiente de reintento" a ciegas). Se endurecen en la capa de cliente, sin cambiar el contrato
del frontend.

**1. `isFailure` en el circuit breaker (extensión del genérico de Fase 2).** Un error de negocio
(tarjeta rechazada, `card_error`) es una respuesta EXITOSA de Stripe — prueba que está sano — y no
debe abrir el circuito ni bloquear otros cobros. `createCircuitBreaker` ganó un predicado opcional
`isFailure(error)`: los errores que no son de infraestructura se re-lanzan al caller pero **no**
cuentan para abrir el circuito, y de hecho resetean el contador como un éxito. Default sin
`isFailure`: todo cuenta (comportamiento previo de Go worker intacto).

**2. `helpers/stripeClient.js` — cliente endurecido compartido.**
- **Retry idempotente**: `maxNetworkRetries` del SDK (configurable por env, default 2). Stripe
  reintenta solo fallos de red / 409 / 5xx y agrega/reutiliza idempotency keys automáticamente en
  los reintentos → seguro, no duplica cobros.
- **`isStripeInfraFailure`**: solo `api_connection_error`, `api_error`, `rate_limit_error` cuentan
  para abrir el circuito. `card_error`/`invalid_request_error`/`idempotency_error` NO (son
  negocio/cliente). Un error crudo sin `type` (timeout de red no envuelto) se asume infra.
- **Un solo breaker COMPARTIDO** por todas las mutaciones (si Stripe está caído, todas fallan
  rápido en vez de colgar el request layer con reintentos).
- **`runStripeMutation(thunk)`**: envuelve una mutación con ese breaker.

**3. Cableado de las 4 mutaciones de dinero** en `controller/stripe.js` (`captureStripePaymentIntent`,
`cancelStripePaymentIntent`, `refundStripePaymentIntent`, `partialRefundStripePaymentIntent`):
- Importan el cliente endurecido (`stripe` mismo nombre → resto de llamadas sin cambios) y
  envuelven la mutación con `runStripeMutation(() => ...)`.
- Pasan `request.idempotencyKey` a Stripe cuando está seteado (forward-compatible; no-op en las
  rutas que hoy no lo setean, se usa donde sí — mismo patrón que el create-payment-intent).

**Idempotencia ya existente (no se tocó):** las rutas capture/cancel/refund ya usan
`idempotencyMutationCache` (replay de la respuesta cacheada ante un request duplicado, a nivel
HTTP). **No** se les agregó `attachServerIdempotencyKey`: su derivación de clave de fallback
(customerEmail/device/IP/time-bucket) es para el flujo de *creación* de payment intent, incorrecta
para payloads de capture/refund (que traen `id`/`paymentIntent`).

**Observación (no corregida, fuera de alcance):** `controller/transaction.js` instancia un cliente
Stripe (líneas 6-7) que **nunca usa** — su único trabajo Stripe es vía Go worker
(`check-stripe-payment-intents`, ya endurecido por el breaker del Go worker). Código muerto, sin
impacto funcional; candidato a limpieza aparte.

### Polling owner-scoped — `GET /api/jobs/owned/:jobId` ✅ (habilita el flujo async de §Fase 2 uploadDocument)

El endpoint de observabilidad `GET /api/jobs/:jobId` es **super_user-only** (diseñado para el
dashboard de soporte, cruza todas las compañías). Pero el usuario que sube un documento —posiblemente
no super_user— necesita poll­ear el resultado de **su propia** subida. En vez de tocar esa capa de
seguridad (lo que cambiaría cómo el dashboard llama/muestra los datos), se agregó un endpoint
**aditivo**:

- **`GET /api/jobs/owned/:jobId`** (`routes/jobs.js`) — solo `validateJWT` (primitiva ya integrada
  app-wide), sin `requireSuperUser`. Controller `createGetOwnedJobStatus` (`controller/jobs.js`):
  devuelve el job solo si `job.context.uid === req.uid`; si no existe, no tiene dueño, o es de otro
  usuario → `404` (no `403`, para no filtrar la existencia de jobs ajenos). Respuesta **SLIM**
  (`buildOwnedJobResponse`): `{ok, id, type, status, attempts, lastError, result}` — NO expone
  `payload`/`context`/`lockedBy` (el payload de un upload tiene rutas internas de archivo).
- **El dueño se fija al encolar**: como la ruta `POST /api/document/upload` no corre `validateJWT`
  (`req.uid` es null), el controller toma el uid del dueño de `req.body.created_by` (el uid Mongo que
  el frontend ya envía) y lo pone en `context.uid`. El frontend luego poll­ea con su token; el
  `req.uid` del token debe coincidir con ese `created_by`.
- No se modificó `requireSuperUser` ni los endpoints existentes `/api/jobs/:jobId` y `/stats` — la
  capa de seguridad del dashboard queda intacta.

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Doble procesamiento (cluster) | 1 solo worker (`isPM2FirstInstance`) + claim atómico `findOneAndUpdate` |
| Job colgado si el server muere a mitad | Barrido de `processing` con `lockedAt` viejo → vuelve a `pending` |
| Doble envío en reintento | `idempotencyKey` única por acción |
| Mongo caído al encolar | El endpoint ya devuelve 500 hoy en ese caso; evaluar buffer local en disco si se requiere 100% |
| Latencia por polling | 3–5 s es invisible para correos/logs; Change Streams si se necesita menos |
| Crecimiento de la colección | TTL borra `done`; índices en `status`/`nextAttemptAt` |
| Fuga de credenciales vía jobs persistidos | `context` es un allowlist estricto (§4.3); nunca se guarda `x-token`/`s-token-lq` crudos |
| Encolar logs rompe el contrato de respuesta síncrona (`{ok, feedEvent}` → `{ok, jobId}`) | Auditado: sin consumidor interno; usuario confirmó que el frontend tampoco depende del doc → migrado (§9 Fase 1) |
| `createErrorFeed` promete un `errorId` "para referencia futura" — un `jobId` rompería esa promesa | NO migrado; requiere pre-generar el `_id` de Mongoose antes de encolar (§9 Fase 1) |
| Encolar una mutación del Go worker cuyo resultado el cliente usa en la respuesta | Auditado: 5 de 6 lo usan (conteos/filas afectadas); solo se encoló la única fire-and-forget real (§9 Fase 2) |
| `uploadExcelToS3`/`uploadDocument` dependen de un archivo temporal en disco local | Verificado: Multer usa `diskStorage` (no se autoborra); asume worker en la misma máquina — cierto hoy, revisar si el despliegue pasa a multi-máquina (§9 Fase 2) |
| Go worker caído → cada request espera los 3 reintentos completos igual | Circuit breaker en `helpers/goWorker.js` (falla rápido tras `failureThreshold` fallos consecutivos) (§9 Fase 2) |
| Una tarjeta rechazada (o cualquier error de negocio) abriría el circuito de Stripe y bloquearía cobros sanos | `isFailure`/`isStripeInfraFailure`: solo fallos de infra cuentan; los de negocio se re-lanzan sin abrir el circuito (§9 Fase 3) |
| Stripe caído → el request layer cuelga esperando reintentos condenados | Circuit breaker compartido `runStripeMutation` + `maxNetworkRetries` del SDK (§9 Fase 3) |

---

## 11. Checklist de entrega

- [x] `models/Job.js` con índices (claim + TTL + companyId) y `idempotencyKey` única/sparse
- [x] `helpers/queue.js` (`enqueue`, `extractJobContext`) con manejo de choque de idempotencia
- [x] `queue/worker.js` (claim atómico, backoff, dead-letter, recuperación de colgados)
- [x] `queue/handlers/` con el registro `type -> handler` (vacío, listo para Fase 1)
- [x] Arranque del worker en `index.js` bajo `isPM2FirstInstance`
- [x] `context` de auditoría (identidad, no credenciales) — §4
- [x] Suite de tests de la Fase 0 en verde (27/27 en `test/queue.test.js`)
- [x] Handler genérico `send-email` (`queue/handlers/email.js`) + factory de controller
      (`nodeMailer/queueEmail.js`), ambos con tests DI (sin tocar SendGrid/Mongo reales)
- [x] **30 de 35 rutas** `/api/nodemailer/*` migradas y probadas (piloto 4 + Batch A 22 + Batch B 8)
- [x] Factory genérica `createQueuedJobController` (`helpers/queuedController.js`), extraída de
      `nodeMailer/queueEmail.js` al aparecer un segundo consumidor real (logs); correos y logs
      la comparten. Extendida con `opts.validate` (preserva 400s) y `buildPayload` async
      (soporta mensajes múltiples como array)
- [x] Handler genérico de escritura a Mongo (`queue/handlers/dbWrite.js`,
      `createModelInsertHandler`), registrado para `log:event`, `log:notification` y
      `log:staff-activity` en `queue/handlers/index.js`
- [x] `feedEventLog` y `feedNotificationLog` migrados (auditado sin dependencia interna;
      confirmado con el usuario que el frontend tampoco depende del documento síncrono)
- [x] `logStaffActivity` migrado (función interna, 12 call-sites en `admin.js`/`event.js`/
      `inventory.js`) — corrige además un bug preexistente de pérdida silenciosa de logs si
      Mongo fallaba en el `save()`
- [x] 2 bugs preexistentes corregidos de paso al migrar: `earlierReturningNotification`
      (`ReferenceError`, endpoint 100% roto) y `linkToResetPassword` (nunca respondía en error)
- [x] `GET /api/jobs/:jobId` y `GET /api/jobs/stats`, protegidos con `requireSuperUser`
      (nuevo middleware — un job no pertenece a una sola compañía, no encaja en
      `authorizeMongoPermission`)
- [x] **Las 6 tareas de cierre completadas** (§9 Fase 1 — cierre de pendientes):
      `createQueuedJobController` con soporte de payload nulo (skip);
      `loginActivityNotification` (mismo patrón que `logStaffActivity`);
      `createErrorFeed` + `errorFeedbackEmailNotification` con `_id` pre-generado y 2 jobs
      independientes; `massiveEventCustomerNotification` / `devitrakFeedbackEmailNotification`
      con nuevo type `send-email-multiple`; `returnedItemsToRenterNotification` con adjuntos
      subidos a S3 antes de encolar (`send-email-multiple-with-attachments`,
      `queue/handlers/emailWithAttachments.js`, nuevas funciones en `helpers/s3Upload.js`)
- [x] **35 de 35 rutas** `/api/nodemailer/*` migradas — Fase 1 de correos 100% completa
- [x] **Fase 2 completa** (§9 Fase 2): `helpers/circuitBreaker.js` (genérico) +
      `helpers/goWorker.js` endurecido (cero cambios en los 8+ call-sites existentes);
      `insertingDeviceInEventDirectlyFromContainer` encolada (única mutación fire-and-forget de
      6 candidatas — las otras 5 devuelven datos que el cliente usa en la respuesta, se
      auditaron y se dejaron síncronas); webhook de `uploadExcelToS3` encolado
      (`queue/handlers/webhook.js`, genérico); `uploadDocument` migrado a contrato async completo
      (`202 {jobId}` + polling a `GET /api/jobs/:jobId`, `queue/handlers/documentUpload.js`)
- [x] **Fase 3 completa** (§9 Fase 3): `createCircuitBreaker` extendido con `isFailure`;
      `helpers/stripeClient.js` (cliente endurecido con `maxNetworkRetries` + breaker compartido +
      `isStripeInfraFailure` + `runStripeMutation`); 4 mutaciones de dinero
      (capture/cancel/refund/partialRefund) cableadas en `controller/stripe.js`. Stripe NO se
      encola (dinero no se buffea). Frontend intacto.
- [x] `GET /api/jobs/owned/:jobId` — polling owner-scoped (solo `validateJWT`, no super_user);
      desbloquea el flujo async de `uploadDocument` sin tocar la capa de seguridad del dashboard
      (§9 "Polling owner-scoped"). Reporte de frontend en `FRONTEND_task_queue_changes.md`.
- [x] Suite completa en verde: 449/450 (el único fallo es preexistente y ajeno a la cola,
      ver `routeSecurityHardening.test.js`)
- [ ] Frontend: aplicar `FRONTEND_task_queue_changes.md` (aceptar 202; textos de correo; polling de
      `GET /api/jobs/owned/:jobId` para `uploadDocument`; quitar manejo del 502 en upload/xlsx)
- [x] Corregir bug preexistente en `returningDeviceMessage.js:2038` (`??` en vez de `&&`) —
      único caso del patrón en `nodeMailer/`, confirmado por grep; test de regresión en
      `test/nodeMailerQueue.test.js`
