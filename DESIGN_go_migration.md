# Migración del servidor Node → Go: estudio y plan de acción

> **Fecha:** 2026-08-25 · **Estado:** propuesta, nada implementado.
> **Ver también `DESIGN_go_incremental_services.md`**: la alternativa de dejar Node
> al frente y extraer trabajo hacia Go por la cola. Es más barata, menos ambiciosa y
> compatible con este plan (el código que se escriba allí sirve igual aquí).
> **Alcance:** mover la API HTTP de Express a Go de forma gradual, conservando los
> workers que hoy funcionan bien.
> Las cifras de este documento están **medidas** sobre el repo (no estimadas):
> salen de `docs/api-payloads.json` (contrato generado desde el código) y de
> conteos de líneas por área.

---

## 1. Veredicto

**Es factible, y el terreno ya está preparado a medias**, pero no por las razones
que suelen motivar un "pasemos a Go".

A favor, y es bastante:

- Ya hay **2.849 líneas de Go en producción** (`go-worker/`) hablando con **MySQL,
  Mongo y Stripe**. Las tres capas de datos del sistema ya están probadas desde Go;
  no hay ninguna incógnita tecnológica que resolver.
- El acoplamiento a Mongoose es **casi nulo**: 4 `.populate()`, 1 `.aggregate()` y
  6 hooks/virtuals en 38 modelos. Los "modelos" son esquemas planos → structs +
  `mongo-driver` sin drama. Esto es lo que normalmente hunde una migración de
  Node a Go, y aquí no aplica.
- Existe un **contrato explícito y regenerable** de los 486 endpoints
  (`docs/api-payloads.md` / `.d.ts` / `.json`). Una migración sin ese inventario es
  a ciegas; con él, es una lista de tareas verificable.
- El despliegue actual (nssm → pm2-runtime → cluster de 4 procesos Node en Windows
  Server 2019) es una torre de tres capas para conseguir lo que un binario de Go da
  solo. Eso es una ganancia operativa real y medible en esa máquina.

En contra, y hay que decirlo antes de empezar:

- **Go no va a hacer esto más rápido de forma perceptible.** Prácticamente todos
  los handlers son I/O sobre MySQL/Mongo; el tiempo se va en la consulta, no en el
  runtime. Lo que se gana es memoria, arranque, despliegue y tipado — no latencia.
- **El costo no es escribir Go: es demostrar paridad de 419 handlers distintos**
  cuyo contrato tiene rarezas deliberadas (201 en éxito, bodies dinámicos que se
  vuelven columnas SQL, bodies que son filtros Mongo, `:id` ignorados, 298 rutas sin
  auth). Un reescrito "limpio" cambia esas rarezas en silencio y rompe el cliente.
- El tipado de Go va a **chocar con datos que hoy llegan flojos**. Evidencia dentro
  del propio repo: `go-worker/controllers.go:1169` ya tiene que hacer un `switch`
  sobre `string | float64 | int` para `company_id`, porque el cliente lo manda de
  las tres formas. Cada handler portado va a encontrar uno de esos.

**Recomendación:** hacerlo, gradual, con un gateway en Go al frente y paridad
verificada por diff automático. Y **no mover las plantillas de email** (§7).

---

## 2. Qué hay hoy, medido

| Área | Archivos | Líneas |
| --- | --- | --- |
| `mysql/controllers/` | 18 | 12.516 |
| `controller/` (Mongo) | 30 | 11.885 |
| `nodeMailer/` (mayormente HTML) | 4 | **8.798** |
| `models/` (esquemas Mongoose) | 38 | 2.476 |
| `routes/` + `mysql/routes/` | 50 | 3.027 |
| `queue/` (core + 14 handlers) | 18 | 1.515 |
| `helpers/` + `mysql/helpers/` | 17 | 1.533 |
| `middlewares/` | 18 | 934 |
| resto (`index.js`, config, db, scheduler, constants) | ~12 | ~1.100 |
| **Producción (sin tests)** | | **≈ 44.000** |
| `test/` | 105 | 17.487 (954 casos) |
| `go-worker/` (ya en Go) | 6 | 2.849 |

Superficie HTTP: **486 endpoints montados**, servidos por **419 handlers
distintos** (54 handlers están montados en más de una ruta: 121 endpoints son
alias — se portan una vez y se montan varias veces, gratis, siempre que se
conserven los alias).

Reparto por almacén: **198 endpoints MySQL** (`/api/db_*`, `/api/school`) y
**288 Mongo** (`/api/*`).

Lo que el worker de Go **ya hace**: 13 comandos SQL (bulk insert/delete de
inventario, jerarquía, item-event, returning-to-stock…), 17 operaciones Mongo
(pool de receivers, transacciones de dispositivos, stats) y un chequeo de
payment intents de Stripe. Todo eso son handlers que se absorben, no se escriben.

---

## 3. Estrategia: strangler con gateway Go al frente

```
            hoy                        durante                       al final
  cliente → Node (:PORT)      cliente → Go gateway (:PORT)   cliente → Go (:PORT)
                                        ├── /api/school  → in-process
                                        ├── /api/db_item → in-process
                                        └── resto        → proxy → Node (:PORT+1)
```

El gateway es un binario Go con una **tabla de rutas por prefijo**: lo migrado se
sirve en proceso, todo lo demás se reenvía a Node con `httputil.ReverseProxy`.
Node pasa a escuchar en un puerto interno y va adelgazando hasta quedar solo con
el email.

Por qué así y no un nginx/IIS delante:

- No agrega un componente nuevo a una máquina Windows que ya tiene tres capas de
  supervisión. El gateway **es** el servidor final; no es andamiaje que haya que
  desmontar después.
- El rollback de cualquier fase es **una entrada de la tabla de rutas** (config o
  env) + reinicio del servicio: el prefijo vuelve al proxy hacia Node, que sigue
  teniendo el código intacto hasta el final.
- Permite **modo sombra** por prefijo: el gateway atiende con Node y, en paralelo,
  ejecuta la versión Go y compara respuestas sin afectar al cliente (§6).

Stack propuesto (todo con precedente o ya presente):

| Pieza | Node hoy | Go |
| --- | --- | --- |
| Router | Express | `chi` (middlewares idénticos en forma a los de Express) |
| MySQL | `mysql2` | `database/sql` + `go-sql-driver/mysql` (**ya en el worker**) |
| Mongo | Mongoose | `mongo-driver` (**ya en el worker**) |
| Stripe | `stripe` | `stripe-go/v79` (**ya en el worker**) |
| JWT | `jsonwebtoken` | `golang-jwt/jwt/v5` |
| Redis | `redis` | `go-redis/v9` |
| S3 | `@aws-sdk/client-s3` | `aws-sdk-go-v2` |
| Cron | `node-schedule` | `robfig/cron/v3` |
| Logs | winston | `log/slog` (stdlib) |
| CORS / headers / gzip | cors + helmet + compression | `rs/cors` + middleware propio + `chi/middleware` |

---

## 4. Fases

Cada fase tiene criterio de entrada y de salida; ninguna empieza hasta que la
anterior esté en producción y estable.

### Fase 0 · Reducir el alcance antes de portar (1–2 semanas)

Lo más rentable de todo el plan: **no portar lo que nadie usa**.

1. Agregar al `requestLogger` (ya existe) una agregación por ruta y dejarla correr
   **30 días** en prod. Salida: tráfico real por endpoint.
2. Borrar lo que ya sabemos que está muerto: las 7 rutas comentadas de
   `mysql/routes/stripe.js`, `routes/cloudinary.js` (no montado; el mount real es el
   handler pelado — ver `FRONTEND_api_payload_findings.md` §B2), `routes/twilio.js` y
   `mysql/routes/location_manager.js` (no montados).
3. Con los 30 días de datos: los endpoints con **cero tráfico** no se portan; se
   marcan como candidatos a borrar con aviso al frontend.

> Criterio de salida: lista firme de endpoints a portar. Si el tráfico confirma lo
> que suele pasar en una API de 486 rutas con 121 alias, el alcance real cae bien
> por debajo de 419 handlers, y esta fase se paga sola.

### Fase 1 · Gateway y paridad de plataforma (3–4 semanas)

El gateway con **cero** endpoints propios: solo proxy. Hay que replicar, con la
misma forma observable:

- CORS (`config/cors.js`), cabeceras de seguridad (helmet), gzip.
- Límites de body: **50MB general y 100MB en las rutas bulk** (`index.js:122`).
- Rate limit con Redis (300 req/15 min) y el limitador específico de pagos públicos.
- `requestLogger` + `securityLogger` con el mismo formato (los logs alimentan
  auditorías existentes).
- El **error shape**: `500 { error, message, requestId }` y el `{ ok:false, msg }`
  de los controladores.
- `/health` y `/api/status`, y apagado con drenaje de conexiones.

> Criterio de salida: 100% del tráfico pasa por el gateway hacia Node, p99 sin
> regresión medible durante una semana. Rollback: devolver el puerto a Node.

### Fase 2 · Auth y RBAC en Go (3–4 semanas)

Es la pieza compartida por todo lo demás y la más delicada. Hay que portar
`validateJWT` (header **`x-token`**, claims `uid`/`name`/`tokenVersion`/`sqlStaffId`),
`checkTokenVersion`, `optionalJWT` (con su `authContext` y el *lane* público de
`config/paymentsPolicy`), `authorizePermission` (scopes de staff en MySQL),
`authorizeMongoPermission` (`Company.employees`), `requireIndustry`,
`requireSuperUser` y `auditPiiAccess`.

> Criterio de salida: los casos de `test/authorizePermission.test.js`,
> `authorizeMongoPermission.test.js`, `staffPermissions.test.js`,
> `rolePermissions.test.js`, `schoolRbac.test.js` y `inventoryLocationRoles.test.js`
> reproducidos en Go, con las mismas tablas de rol → permiso
> (`constants/rolePermissions.js`, `mysql/constants/roles.js`).

### Fase 3 · Piloto: `/api/school` (2 semanas)

18 endpoints, 18 handlers, MySQL puro, 16 detrás de `canRead/canCreate/canUpdate`,
cero bodies dinámicos, código reciente y con la mejor cobertura de tests del repo.
No toca Stripe ni Mongo. Es el piloto ideal: si algo del andamiaje está mal, se
descubre aquí y no en inventario.

> Criterio de salida: 2 semanas en canary con **diff en cero** (§6).

### Fase 4 · Todo el lado MySQL (8–10 semanas)

~177 handlers. Orden sugerido de menor a mayor riesgo:

| Namespace | Endpoints | Handlers | Nota |
| --- | --- | --- | --- |
| `db_sub_location`, `db_record`, `db_shipment`, `db_consumer`, `db_consumer_attending_event_record`, `db_stripe` | 24 | 24 | CRUD simple |
| `db_location`, `db_inventory`, `db_staff`, `db_lease` | 33 | 32 | scopes de staff ya portados en Fase 2 |
| `db_member` | 15 | 15 | school/members, bien testeado |
| `db_event` | 32 | 32 | asignación de contenedores; 5 bodies dinámicos |
| `db_item` | 36 | 35 | **el más caliente**; 10 bodies dinámicos + listas blancas de columnas |
| `db_company` | 40 | 39 | 22 rutas anónimas: portar tal cual (§8) |

Aquí se absorben los 13 comandos SQL que ya están en Go.

### Fase 5 · Mongo de bajo riesgo (3–4 semanas)

~45 handlers de CRUD y logs: `error_log`, `event-log`, `notificationlog`,
`transaction-audit-log`, `staff-activity-log`, `jobs`, `cache_update`, `image`,
`article`, `post`, `feedback`, `devitrak`, `heavy-task`, `cash-report`, `item`,
`lease`, `inventory`, `search`.

### Fase 6 · Dominios Mongo (8–12 semanas)

| Namespace | Handlers | Nota |
| --- | --- | --- |
| `receiver` | 23 | **17 ya están en el worker Go** → casi gratis |
| `document` | 23 | multipart + S3 + firmas; usa `multer` → `mime/multipart` |
| `company` | 17 | 16 rutas anónimas |
| `event` | 13 | |
| `transaction` | 10 | |
| `admin` + `auth` + `registration` | 31 | **sensible**: bcrypt, MFA (`speakeasy`→`pquerna/otp`), emisión de tokens, revocación de sesiones |
| `staff`, `consumer` | 7 | |

### Fase 7 · Stripe (4–6 semanas)

39 handlers en `/api/stripe` + 7 en `/api/subscription`. Va al final por ser
dinero: hay que portar además `validateStripeRoutePayload`,
`attachServerIdempotencyKey`, `idempotencyMutationCache`, `publicPaymentRateLimit`
y las *lanes* de `config/paymentsPolicy`. `stripe-go/v79` ya está en el `go.mod`.

### Fase 8 · Cierre (2–3 semanas)

- Schedulers a `robfig/cron` (`scheduler/`, 202 líneas): recordatorios de mora y
  expiración de consentimientos. **Un solo dueño del schedule**: si el cron de Go
  arranca antes de apagar el de Node, los emails se duplican.
- **Absorber `go-worker/` dentro del gateway**: los comandos pasan a ser paquetes
  internos y desaparece la llamada HTTP entre procesos — con ella desaparece el
  modo de fallo del puerto desalineado que costó semanas de producción
  (`DEPLOY.md` §Go worker).
- Node queda solo como **EmailWorker** (§7).

---

## 5. Qué se queda en Node, a propósito

El usuario preguntó si se pueden mantener los workers que funcionan bien. Sí, y
además conviene:

1. **`nodeMailer/` (8.798 líneas, casi todo HTML)**. Portar plantillas de email a
   `html/template` es semanas de trabajo cuyo único resultado posible es que los
   correos se vean *igual*. Cero ganancia, riesgo alto (38 plantillas, cada una un
   correo que ve un cliente o un guardián).
   **Diseño para partirlo:** hoy el endpoint compone el HTML **síncronamente** y
   luego encola. Se invierte: el endpoint en Go valida y encola
   `{ template: "returned-items-to-renter", body: {...} }`, y el **EmailWorker en
   Node renderiza y envía**. Así los 38 endpoints se pueden mover a Go sin tocar una
   sola plantilla. Requiere un cambio en el payload del job, versionado con
   compatibilidad hacia atrás.
2. **Los workers de cola** (`DevitrakBulkWorker`, `EmailWorker`). La cola vive en
   Mongo con reclamo atómico y ya está probada. Go solo necesita el **lado
   productor**: escribir el documento `Job` con la misma forma y la misma semántica
   de clave de idempotencia (`models/Job.js`, `helpers/queue.js`). Los consumidores
   siguen en Node mientras rindan.

---

## 6. Paridad: el arnés de diff (esto es el proyecto, en realidad)

Sin esto la migración es fe. Con esto es evidencia.

1. **La especificación ya existe**: `docs/api-payloads.json` (486 endpoints, con
   requeridos, params, query, auth y `archivo:línea` del handler). Se regenera con
   `node scripts/extract-api-payloads.js`.
2. **Modo sombra en el gateway**: para un prefijo en shadow, el gateway sirve la
   respuesta de Node y, en paralelo, ejecuta el handler Go con el mismo request;
   compara status + JSON normalizado y registra las diferencias. Cero impacto en el
   cliente, tráfico real como suite de pruebas.
3. **Normalización obligatoria del diff**, o el ruido lo vuelve inútil: ordenar
   claves, tolerar timestamps generados en el servidor y los ids nuevos.
4. **Promoción por prefijo**: shadow → canary (se sirve desde Go) → migrado. El
   criterio de promoción es "N días con diff en cero", no "ya está escrito".
5. Los 954 tests actuales **se quedan en Node** mientras Node sirva algo: son la red
   de la mitad no migrada. Nota: usan inyección por `require.cache`, un patrón que
   no se traduce a Go — en Go es inyección por interfaz. No se "portan" los tests;
   se reescriben por handler, y el diff cubre el comportamiento.

---

## 7. Trampas concretas de este código (lista de verificación por handler)

Cada una ya rompió algo o está a un descuido de romperlo:

1. **`201` en éxito**, no `200`, en casi toda la API. Un `chi` recién escrito
   responde 200 por defecto.
2. **Bodies dinámicos**: 34 endpoints convierten los pares del body en columnas o
   filtros SQL (`Object.keys(req.body)`), con listas blancas de columnas
   (`updateItemInTable`) e `identifierKeys`. En Go hay que replicar la lista blanca,
   no inventar un struct.
3. **Bodies que son filtros Mongo** (`Model.find(req.body)`): el contrato es el
   esquema del modelo y `{}` significa "todo".
4. **Params ignorados**: `POST /api/db_item/:id` lee el id del body, no de la ruta.
5. **Tipos flojos del cliente**: `company_id` llega como string, número entero y
   float según la pantalla. En Go: `json.Number`/`interface{}` con coerción
   explícita, como ya hace `DeleteBulkItems`.
6. **Serialización JSON**: en Node un campo `undefined` desaparece del JSON; en Go
   un struct emite el zero value (`""`, `0`, `null`) salvo punteros + `omitempty`.
   Hay clientes que hacen `if (x === undefined)`. Esto es la fuente número uno de
   diffs falsos y de bugs reales.
7. **Fechas**: `toDateString()`/`toLocaleTimeString()` en emails y `DATETIME` sin
   zona en MySQL. Fijar formato y zona explícitos.
8. **Caches en memoria**: `node-cache` hoy vive **por proceso** (4 procesos del
   cluster). En un binario Go pasa a ser una sola caché compartida: más consistente,
   pero **distinto**. Revisar los endpoints que dependan de esa inconsistencia.
9. **298 endpoints sin auth de ruta**. Se portan **tal cual**. Cerrarlos es un
   cambio de contrato para el frontend y va como tarea aparte (ya hay precedente:
   `project_raw_sql_endpoint_hardening`), nunca mezclado con el port: si algo se
   rompe, hay que poder saber cuál de los dos cambios fue.

---

## 8. Riesgos y esfuerzo

| Riesgo | Mitigación |
| --- | --- |
| Cambio silencioso de contrato al reescribir | Arnés de diff (§6) + lista de trampas (§7) |
| Migración a medias abandonada (lo peor: dos servidores para siempre) | Fases con criterio de salida y rollback por prefijo; el gateway es el destino final, no andamiaje |
| Auth divergente entre los dos servidores | Fase 2 antes de cualquier endpoint; una sola tabla de permisos, en un solo lugar |
| Doble ejecución de schedulers/cola | Un solo dueño del schedule; el cron de Go no arranca hasta apagar el de Node |
| Build en Windows Server | Ya resuelto para el worker (`scripts/build-go-worker.ps1`, `restart-go-worker.ps1`); el gateway hereda ese patrón, incluida la lección de que nssm mata los hooks de arranque |

**Esfuerzo:** sumando las fases, **32–45 semanas de una persona**; con dos personas
y el arnés andando, **4–6 meses**. El desglose está en cada fase. Y una advertencia
sobre la estimación: el cuello de botella no es escribir Go — con asistencia, portar
un handler CRUD es cuestión de minutos. El cuello de botella es **verificar**: 30
días de tráfico en sombra por bloque, y el tiempo de las personas que confirman que
las pantallas siguen funcionando.

Un camino intermedio legítimo, si el objetivo real es operativo y no lingüístico:
hacer **Fase 0 + 1 + 2 + 3** (≈ 2–3 meses), quedarse ahí y decidir con datos si
sigue valiendo la pena. Al final de la Fase 3 ya se tiene un binario en producción,
la torre pm2+cluster empieza a sobrar y el resto puede migrarse (o no) sin prisa.

---

## 9. Decisiones que hacen falta antes de empezar

1. **¿Las plantillas de email se quedan en Node para siempre?** (recomendado: sí,
   con el cambio de payload del job de §5).
2. **¿Se miden 30 días de tráfico antes de portar?** Sin eso vamos a portar
   endpoints muertos, y el alcance real no se conoce.
3. **¿Rutas anónimas: portar tal cual o cerrarlas en el camino?** (recomendado:
   tal cual, cierre como tarea aparte).
4. **¿Un solo binario (gateway + worker) o dos servicios durante la transición?**
   (recomendado: dos durante la transición, fusionar en Fase 8).
5. **¿`chi` o `net/http` pelado?** (recomendado: `chi`, por el parecido de la
   cadena de middlewares con Express, que hace el port mucho más literal).
6. **¿Se congela la API mientras se migra?** No hace falta congelarla, pero cada
   endpoint nuevo que se escriba en Node durante la migración es deuda: a partir de
   la Fase 3, lo nuevo debería nacer en Go.
