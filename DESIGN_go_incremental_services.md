# Alternativa: Node al frente + microservicios Go incrementales

> **Fecha:** 2026-08-25 · **Estado:** propuesta, nada implementado.
> Responde a la contrapropuesta al plan de `DESIGN_go_migration.md`: en vez de
> migrar toda la API, **dejar Node como hilo principal que gestiona las peticiones**
> e ir extrayendo controllers a servicios Go, encolando hacia Go lo que no necesita
> respuesta inmediata.

---

## 1. Veredicto: la idea son dos ideas, y no tienen la misma nota

**La mitad asíncrona — "lo que no necesita respuesta inmediata se encola hacia un
microservicio Go" — es la mejor jugada disponible, y el mecanismo ya está
construido.** No hay que diseñar nada: la cola vive en Mongo con reclamo atómico y
el worker **ya soporta filtrado por tipo**:

```js
// queue/worker.js:22
// QUEUE_TYPES=a,b          → este worker SOLO toma esos tipos
// QUEUE_EXCLUDE_TYPES=a,b  → toma todo MENOS esos
```

Eso significa que un consumidor Go se suma a la cola **sin tocar una línea de
Node**: se le da `QUEUE_TYPES=<tipo>` al servicio Go y `QUEUE_EXCLUDE_TYPES=<tipo>`
al worker de Node. La migración avanza **por tipo de job**, y el rollback es
quitar la variable de entorno y reiniciar. No hay ventana de riesgo, no hay
contrato HTTP nuevo, no hay auth duplicada.

**La mitad síncrona — "un microservicio Go por controller detrás de Node" — tiene
reservas serias**, y conviene decirlas antes de invertir en ella:

1. **Cada extracción síncrona agrega un salto de red a lo que era una llamada de
   función.** Para un handler que hace un `SELECT`, `Node → HTTP → Go → MySQL` es
   **más lento** que `Node → MySQL`, y agrega un modo de fallo. El repo ya pagó ese
   precio: un desalineamiento de puerto entre Node y el Go worker costó semanas de
   producción (`DEPLOY.md`). Multiplicar eso por N servicios es multiplicar puertos,
   variables de entorno y servicios nssm.
2. **"Controller" no es una costura.** `mysql/controllers/item.js` tiene **53
   handlers distintos** y lo importan cuatro namespaces (`db_item`, `db_company`,
   `db_event`, `db_inventory`); 54 handlers están montados en más de una ruta. No es
   un módulo, es un hub.
3. **Las transacciones no cruzan procesos.** Hay 22 bloques
   `beginTransaction/commit` en `mysql/`. Si media operación queda en Node y media
   en Go, esa transacción desaparece. La unidad que se puede mover es la
   **operación transaccional completa**, no el archivo.
4. **Node no desaparece.** La torre nssm → pm2-runtime → cluster de 4 procesos se
   queda para siempre, y el número de procesos a supervisar **crece**. Es una
   elección legítima si el objetivo es rendimiento por capacidad, pero entonces hay
   que dejar de contar la simplificación operativa entre los beneficios.

**Recomendación:** hacer la mitad asíncrona ya, con un solo servicio Go de cola.
Para lo síncrono pesado, **no crear servicios nuevos: agregarle comandos al
`go-worker` que ya existe** (ya tiene 13 comandos SQL, 17 Mongo y Stripe). Tres
procesos, no N.

---

## 2. Topología propuesta

```
cliente ──► Node (routing, auth, validación, respuestas inmediatas)
              ├── síncrono ligero  → MySQL / Mongo            (se queda en Node)
              ├── síncrono PESADO  → go-worker (HTTP, ya existe)  ← agregar comandos
              └── asíncrono        → Job en Mongo ──► consumidor Go (QUEUE_TYPES)
                                                  └► worker Node (el resto)
```

Node sigue siendo el único que ve al cliente: mantiene CORS, `x-token`, RBAC,
límites de body y el shape de las respuestas. **Toda la auth queda en un solo
lugar** — que era la parte más delicada y cara del plan de migración completa
(su Fase 2). Esta es la ventaja real de la contrapropuesta y no es menor.

---

## 3. Qué se encola y qué no: criterios y triaje

### Criterios

| Va a la cola | Se queda inmediato |
| --- | --- |
| El cliente no usa el resultado para pintar la pantalla | El resultado alimenta la vista actual |
| Efecto secundario (email, log, webhook, export) | Autenticación y sesión |
| Volumen sin techo natural (bulk, imports, borrados por criterio) | Pagos y cobros (el usuario espera confirmación) |
| Tarda > 2 s en p95 | Asignación/devolución de un dispositivo puntual |
| Puede reintentarse sin efectos raros (idempotente) | Lecturas de listas y búsquedas |

Y el caso intermedio, que ya está resuelto en el repo:
`createSyncOrQueuedController` (`helpers/queuedController.js:150`) encola pero
**espera hasta 4 s**; si el job termina, responde como antes; si no, devuelve
`202 + jobId`. Es el patrón correcto para operaciones que "a veces son chicas".

### Estado actual, medido

**Ya es asíncrono** (no hay nada que hacer): los 38 endpoints de
`/api/nodemailer`, los logs (`log:event`, `log:notification`, `log:error`,
actividad de staff), `document:upload-pdf`, `webhook:trigger` y **siete tipos de
bulk SQL**:

| Tipo de job | Origen |
| --- | --- |
| `inventory:bulk-insert-alphanumeric` | hasta ~15.000 seriales por job |
| `inventory:bulk-insert-range` | rango min/max expandido en el servidor |
| `inventory:bulk-update-alphanumeric` | UPDATE masivo por lista o criterio |
| `inventory:bulk-delete-by-criteria` | sin serial, borra categoría/ubicación completa |
| `event:bulk-update-item-shipping` | UPDATE masivo de `event_item_shipping` |
| `member:bulk-return-leases` | fin de trimestre: todos los leases de la company |
| `member:bulk-insert` | import de estudiantes a nivel distrito |

**Ya está delegado a Go de forma síncrona** (correcto, devuelve conteos que el
cliente usa): `item-final-status`, `returning-item-to-stock`, `delete-bulk-items`,
`insert-bulk-item*`, `get-inventory-hierarchy` y las 17 operaciones Mongo del pool
de receivers.

**Candidato número uno a encolar, y es urgente por sí solo:**
`POST /api/db_record/inserting-record-refactored`
(`mysql/controllers/recordEvent.js:59`). Hace un **loop secuencial de un
`INSERT...SELECT` por registro dentro de una sola transacción**, de forma síncrona,
con **límite de body de 100MB** concedido en `index.js:110` y un **timeout de
request de 30 s** (`index.js:97`). Para un evento grande no hay forma de que
termine: o corta a los 30 s dejando la transacción abierta hasta el rollback, o
mantiene una conexión del pool tomada un tiempo largo. Es exactamente el perfil
"volumen sin techo + trabajo mecánico + el cliente solo necesita un conteo".

Otros candidatos, en orden:

1. **Exports y reportes** (`/api/school/student/export`, cash reports): devuelven
   datos, pero un export de distrito completo debería ser job + descarga.
2. **`log:*` que aún se escriben en línea** — barrer los controladores que llaman
   a `Model.create` de logs sin encolar.
3. **Actualizaciones de caché e invalidaciones** (`/api/cache_update`).

**No encolar nunca** (respuesta inmediata obligatoria): `/api/auth/*`,
`/api/admin/*` de sesión y MFA, los 46 endpoints de `/api/stripe` (el usuario
espera el resultado del cobro), asignación puntual de dispositivo, y todas las
lecturas que pintan pantallas.

---

## 4. El consumidor Go de la cola, concretamente

Contrato que debe respetar — todo ya existe y está probado:

- **Reclamo atómico**: `Job.findOneAndUpdate` con el filtro de `queue/core.js`
  (`buildClaimFilter`) + `lockedBy`/`lockedAt`. N consumidores no duplican trabajo.
- **Reintentos**: `maxAttempts` 5, backoff exponencial con techo de 5 min,
  `lockTimeoutMs` 2 min para recuperar jobs colgados (`recoverStale`).
- **`Job.result`**: es lo que el cliente lee por `GET /api/jobs/owned/:jobId`. La
  forma del `result` es contrato de API, no detalle interno.
- **`idempotencyKey`**: misma semántica que hoy, o se pierden las garantías de los
  reintentos.

Tres cosas a resolver antes de escribir código:

1. **Frecuencia de poll.** Hoy el worker Node poll cada **4.000 ms**
   (`QUEUE_POLL_MS`) mientras `waitForJobOutcome` espera **4.000 ms** con poll de
   150 ms. O sea: el camino "híbrido" hoy funciona solo si el tick del worker cae
   con suerte. Un consumidor Go debería poll cada **250–500 ms** (o usar change
   streams de Mongo): además de ser barato, **arregla** el híbrido y hace que
   `insertBulkItem` responda como antes más seguido.
2. **El payload del job pasa a ser un contrato entre lenguajes.** Hoy lo escribe y
   lo lee el mismo Node, así que nadie lo versionó. Al meter Go hay que fijarlo
   (nombres, tipos, y el problema de siempre: `company_id` llega como string, int y
   float — `go-worker/controllers.go:1169` ya hace ese `switch`).
3. **Los tipos de email se quedan en Node.** El HTML se compone antes de encolar y
   son 8.798 líneas de plantillas; ver `DESIGN_go_migration.md` §5 para el cambio de
   payload que haría falta si algún día se mueven.

---

## 5. Primeros tres pasos, cada uno reversible con una variable de entorno

**Paso 1 — `inventory:bulk-delete-by-criteria` en Go (1–2 semanas).**
Es el tipo más aislado: un `DELETE` por criterio, sin plantillas, sin Mongo, sin
auth (ya se autorizó al encolar), y con la lógica hermana **ya escrita en Go**
(`DeleteBulkItems` en `go-worker/controllers.go:1164`). Se levanta el servicio con
`QUEUE_TYPES=inventory:bulk-delete-by-criteria` y se le añade ese tipo a
`QUEUE_EXCLUDE_TYPES` del worker Node. Criterio de salida: una semana con los
mismos `result` y cero jobs `dead`.

**Paso 2 — los otros seis tipos de bulk SQL (3–4 semanas).**
Mismo patrón, uno por semana. Al terminar, todo el trabajo masivo de SQL corre en
Go y el worker Node se queda con emails, logs, documentos y webhooks.

**Paso 3 — mover `inserting-record-refactored` a la cola (1 semana).**
Aquí sí hay cambio de contrato: pasa de `201 { inserted_record }` a
`202 { jobId }` (o híbrido con `createSyncOrQueuedController`, que es lo que
recomiendo para no romper el frontend). Coordinar con el cliente.

Después de esos tres pasos conviene **parar y medir** con lo que salga de T1 del
`BACKLOG_infra.md`: latencia por endpoint y jobs por tipo. Con esos datos se decide
si vale la pena seguir por lo síncrono — y, si se sigue, es agregando comandos al
`go-worker`, no creando un servicio por controller.

---

## 6. Comparación de los tres caminos

| | Migración completa (`DESIGN_go_migration.md`) | Microservicio por controller | **Híbrido recomendado** |
| --- | --- | --- | --- |
| Riesgo por paso | medio (gateway al frente) | bajo por paso, alto acumulado | **muy bajo** (env var) |
| Auth | hay que portarla (su Fase 2) | se queda en Node | **se queda en Node** |
| Latencia | igual | **peor** en lo síncrono ligero | igual o mejor |
| Procesos a supervisar | menos al final (1) | **más** (N servicios) | 3 |
| Node desaparece | sí | no | no (por diseño) |
| Esfuerzo | 32–45 semanas-persona | difícil de acotar | **5–7 semanas** para los pasos 1–3 |
| Beneficio inmediato | ninguno hasta la fase 3 | por controller | **el trabajo masivo sale de Node ya** |

Los tres caminos son compatibles: los consumidores Go y los comandos del
`go-worker` que se escriban ahora son **el mismo código** que usaría el gateway del
plan completo si algún día se decide ir por ahí. Nada de esto se tira.
