# Plan de acción: rutas sin autenticación (2026-10-14)

Responde a `FRONTEND_unauthenticated_routes_2026-10-14.md` (revisión FedRAMP
AC-3 / IA-2). Todo lo de aquí está contrastado con el código de
`release/observabilidad` y con las llamadas reales de los dos clientes
(`devitrak/src` = app.devitrak.net, `devitrak_claude/testing-admin-dashboard/src`
= admin.devitrak.net).

## Restricción de partida

**La app del consumidor (app.devitrak.net) no se autentica nunca.** No tiene
interceptor de token (`devitrak/src/devitrakApi.jsx`). Desde ahí se registra al
usuario, se le consulta, se actualiza su información y se crean transacciones y
pagos de Stripe. Por eso **usuarios, transacciones y Stripe se quedan con
autenticación opcional** (`optionalJWT`): nunca rechazan por falta de token.

Lo que cambia en esas rutas no es *si* aceptan anónimos, sino *qué* puede hacer
un anónimo. Cada una tiene dos carriles, como ya hace `/api/auth/users`
(`helpers/consumerUserFilter.js`):

| Carril | Quién | Qué puede hacer |
|---|---|---|
| **Staff** | Token válido + `tokenVersion` vigente de un AdminUser activo | Todo lo que hace hoy, más permisos/compañía donde ya existan |
| **Consumidor** (sin token) | App del consumidor, páginas públicas del dashboard | Solo la operación concreta del flujo, con campos en lista blanca, sin operadores Mongo, sin ver datos internos |

Desde admin.devitrak.net sin sesión → 401 (regla por origen, ya aplicada en
`/api/auth/users`), salvo las páginas públicas del dashboard (§Fase 4).

---

## Respuestas a §4 del documento del frontend

1. **¿Algún router monta `validateJWT` con `router.use`?** No. Hay tres guardas
   a nivel de router que el extractor no ve, pero ninguna es `validateJWT`:
   - `routes/company.js:75` → `requireCompanyAuth` (modo por `COMPANY_AUTH_MODE`, `.env.example` = `warn`: no bloquea).
   - `routes/nodeMailer.js:59-62` → `requireNotificationAuth` (modo por `NODEMAILER_AUTH_MODE`, `.env.example` = `enforce`).
   - `routes/stripe.js:97` → `optionalJWT` (nunca rechaza).
2. **`api-payloads.json` regenerado:** se entrega en la Fase 0, con el extractor
   corregido (ver abajo).
3. **Grupo B, ¿sí?** Sí, **menos 6 rutas que también llama la app del
   consumidor** y que el documento clasificó como "solo con sesión" porque solo
   miró el dashboard (ver Fase 2).
4. **Grupo C (`canRead`, `canCreate`, … `canManage`, `canReadInventory`):**
   **falso positivo.** Todos son arrays que empiezan por `validateJWT,
   checkTokenVersion` (`mysql/routes/members.js:35-38`,
   `mysql/routes/school.js:43-60`, `mysql/routes/lease.js:16`,
   `routes/document.js:107`). El extractor no expande constantes. Los datos de
   menores de `/api/school` y `/api/db_member` ya exigen token.
5. **D y F:** en la Fase 3 (D, las de la app del consumidor) y la Fase 5 (F).

---

## Inventario: lo que llama la app del consumidor (32 rutas, todas sin token)

| Dominio | Rutas |
|---|---|
| Usuarios | `POST /auth/new`, `POST /auth/user-query`, `GET /auth/:id`, `PATCH /auth/:id`, `GET /consumer/users`, `POST /db_consumer/new_consumer` |
| Transacciones | `POST /transaction/transaction`, `POST /transaction/save-transaction`, `DELETE /transaction/remove-duplicate-transaction/:id`, `POST /receiver/receiver-assigned-list` |
| Stripe | `POST /consumer/stripe/find-customer`, `POST /consumer/stripe/create-customer`, `POST /stripe/customer`, `POST /stripe/create-payment-intent`, `POST /stripe/stripe-transaction/`, `GET /stripe/payment_intents/:id`, `DELETE /stripe/removing/:id`, `DELETE /stripe/remove-duplicate/:id` |
| Evento / compañía | `POST /event/event-list`, `POST /company/search-company`, `PATCH /company/update-signatures`, `POST /company/event-consumer-signatures`, `POST /document/download/documentUrl` |
| Correo | `POST /nodemailer/confirmation-account`, `POST /nodemailer/login-existing-consumer`, `POST /nodemailer/terms-and-conditions-acceptance` |
| Otros | `POST /cache_update/remove-cache`, `POST /cloudinary/upload-image`, `POST /post/posts`, `POST/PATCH /consumer/push/subscribe`, `POST /consumer/push/unsubscribe` |

Ninguna de estas puede pasar a `validateJWT`. Esta lista es la que hay que
consultar antes de cerrar cualquier ruta.

---

## Fase 0 — Hecho y entregables inmediatos

**Ya hecho (sin commitear, 1756/1757 tests):**
- Carpetas de documentos (`/document/new_folder`, `folders`, `folder/:id`): `validateJWT` + compañía dueña.
- `/auth/users` y `/auth/user-query`: dos carriles + regla por origen; `POST /auth/user-query` sigue pública por email (la usa `/attendance-confirmation`).
- `GET /event/all-users-and-transactions-per-event`: `validateJWT` (solo dashboard).

**Por hacer:**
- [ ] Extractor (`scripts/extract-api-payloads.js`): expandir arrays de middlewares (`canRead = [...]`) y reportar los `router.use` de cada router. Regenerar `docs/api-payloads.{md,json,d.ts}` y mandarlo al dashboard.
- [ ] **Catálogo de carriles** `constants/routeAuthLanes.js`: cada ruta montada se clasifica como `staff` | `consumer` | `public-pre-session`, con un test que falle si una ruta nueva no está clasificada o si una `staff` no lleva `validateJWT` (mismo patrón que el test de cobertura de `auditedRoutes.js`). Es lo que evita que esto vuelva a pasar.

## Fase 1 — Dos trampas que ya pueden romper la app del consumidor ✅ (código, 2026-10-14, sin commitear)

No son mejoras: son 401 silenciosos esperando a un cambio de modo.

- [x] **`/nodemailer/terms-and-conditions-acceptance`** no está en `PUBLIC_ROUTES` de `middlewares/notificationAuth.js:56`. Con `NODEMAILER_AUTH_MODE=enforce` (lo que trae `.env.example`) la app recibe 401 y el correo de aceptación de términos no sale, sin error visible. **Comprobar el valor en prod** y añadirla a `PUBLIC_ROUTES` (y a `CONSUMER_PUBLIC_ROUTES`, para el límite por email).
- [x] **`/company/search-company` y `/company/update-signatures`** no están en `PUBLIC_ROUTES` de `middlewares/companyAuth.js:61`. Hoy `COMPANY_AUTH_MODE=warn` no bloquea; el día que pase a `enforce`, la app se rompe. Añadirlas antes.

## Fase 2 — Grupo B: `validateJWT` + `checkTokenVersion`

De las 154 rutas del grupo B, **6 las llama también la app del consumidor** y
pasan a la Fase 3, no aquí:
`POST /transaction/transaction`, `POST /transaction/save-transaction`,
`POST /receiver/receiver-assigned-list`, `POST /cache_update/remove-cache`,
`POST /post/posts`, y las de `/nodemailer` que estén en `PUBLIC_ROUTES`.

Las otras ~148 se cierran por dominio, un commit por dominio, en este orden
(de más a menos daño posible):

| Lote | Dominio | Rutas aprox. | Nota |
|---|---|---|---|
| 2.1 | `/api/nodemailer/*` | 25 | Basta con confirmar `NODEMAILER_AUTH_MODE=enforce` en prod tras la Fase 1. Sin cambio de código |
| 2.2 | `/api/receiver/*` (asignar, devolver, borrar del pool) | 20 | Menos `receiver-assigned-list` |
| 2.3 | `/api/db_item`, `/db_event`, `/db_company`, `/db_inventory`, `/db_lease`, `/db_location`, `/db_record`, `/db_shipment` | ~70 | Inventario SQL. Varias ya usan `authorizePermission` por dentro: revisar que no dupliquen el 401 |
| 2.4 | `/api/transaction/*` (solo staff: `update-transaction/:id`, `update-multiple-documents`), `/api/cash-report/*`, `/api/stripe/save-transaction`, `/api/subscription/*` | ~15 | |
| 2.5 | Resto: `/api/admin/check-online-status/:email`, `/api/event/*` staff, `/api/post/*` escrituras, `/api/image/*`, `/api/item/*`, `/api/error_log`, `/api/event-log`, `/api/transaction-audit-log` | ~20 | |

El dashboard ya manda `x-token` en todas: no tiene que cambiar nada. Cada lote
se despliega por separado y el dashboard lo prueba en el navegador.

## Fase 3 — Carril consumidor: endurecer sin exigir sesión

Todas siguen con `optionalJWT`. Con sesión de staff, comportamiento actual. Sin
ella:

### 3.1 Usuarios
| Ruta | Problema hoy (código) | Sin sesión, pasa a |
|---|---|---|
| `POST /auth/user-query`, `/auth/users`, `/consumer/users` | ✅ Hecho | Solo email exacto, sin `notes` |
| `GET /auth/:id` | Devuelve el usuario completo a quien sepa el id | Proyección sin `notes` |
| `PATCH /auth/:id` | `editUser` hace `findByIdAndUpdate(id, {...request.body})`: cualquiera reescribe cualquier campo de cualquier consumidor | Lista blanca: `name`, `lastName`, `phoneNumber`, `privacyPolicy`, `profile_picture`, y **solo añadir** a `eventSelected`/`provider`/`company_providers`/`event_providers`/`groupName` (`$addToSet`, nunca reemplazar el array). Sin `email` ni `notes` |
| `POST /auth/new` | `new User(request.body)` | Misma lista blanca; email obligatorio y único (ya lo comprueba) |
| `POST /db_consumer/new_consumer` | Revisar | Lista blanca de columnas |

### 3.2 Transacciones
| Ruta | Problema hoy (código) | Sin sesión, pasa a |
|---|---|---|
| `POST /transaction/transaction` | `Transaction.find(request.body)` (`controller/transaction.js:117`): el body es un filtro Mongo; `{}` lista todas | Filtro saneado como en usuarios; exigir `event_id`; devolver solo los campos que usa la app (dedupe en `DisplayQRCode.jsx`) |
| `POST /transaction/save-transaction` | `new Transaction(request.body)` | Lista blanca + comprobar en Stripe que el `paymentIntent` existe y es del evento/compañía. Índice único por `paymentIntent` |
| `DELETE /transaction/remove-duplicate-transaction/:id` | Borra cualquier transacción sabiendo su id | **Quitar la necesidad**: con el índice único de 3.2, no hay duplicados que borrar desde el cliente. Después, solo staff |
| `POST /receiver/receiver-assigned-list` | Revisar | Exigir consumidor + evento; campos mínimos |

### 3.3 Stripe
Ya tienen `optionalJWT` por router. Pendiente sin sesión:
- [ ] `create-payment-intent`: el importe lo calcula el servidor a partir del evento (depósito configurado), no lo manda el cliente.
- [ ] `GET payment_intents/:id`: devolver solo estado/importe, no el objeto completo de Stripe.
- [ ] `DELETE /stripe/removing/:id` y `/remove-duplicate/:id`: mismo arreglo que 3.2 (dedupe en servidor), y después solo staff.
- [ ] `create-customer` / `find-customer` / `customer`: límite por email (como `CONSUMER_PUBLIC_ROUTES`) y respuesta mínima.
- Lo que ya está del plan de Stripe (`PLAN_stripe_2026-10-06.md`): refund/capture/cancel ya exigen sesión (8b7cf4a, desplegado). Falta la Fase 0.1 (dueño del pago) y la 1.2 (clave de idempotencia por compañía).

### 3.4 Otros
- [ ] `cache_update/remove-cache`: sin sesión, solo claves con el patrón del consumidor (`event_id=…&company=…&consumerInfo.id=…`).
- [ ] `cloudinary/upload-image`: tipo y tamaño máximos + límite por IP.
- [ ] `post/posts`: solo lectura sin sesión (ya lo es); confirmar que no acepta filtros con operadores.

## Fase 4 — Páginas públicas del dashboard: enlace firmado de un solo uso

Mismo sistema que el reset de contraseña (`helpers/passwordResetToken.js`) y
la invitación (`helpers/invitationToken.js`): **el servidor firma el enlace y
solo viaja en el correo**. Quien lo presenta demuestra que controla ese buzón.

**Reglas del token** (`helpers/emailLinkToken.js`, genérico por propósito):
- Firmado por el servidor, con propósito propio y los ids del sujeto.
- **Caducidad máxima 5 días** (tope duro en el helper, no configurable por encima).
- **Un solo uso, consumido en la acción final**, no en la primera lectura: la
  página hace varias llamadas (leer usuario, comprobar firma, descargar) y solo
  la última (firmar / confirmar) gasta el token. Las lecturas se aceptan
  mientras no caduque y **solo para su sujeto**.
- Consumo en Redis (`SET NX`, como la idempotencia) **más** comprobación de
  estado en el controller ("¿ya está firmado?"): si Redis cae, nadie se queda
  sin firmar y la doble firma sigue siendo imposible.
- Viaja en la URL como `?token=` y la página lo manda en la cabecera
  `x-link-token`.
- Cada ruta acepta **sesión de staff o token del enlace**. Las rutas que también
  usa la app del consumidor (`GET /auth/:id`, `POST /document/download/documentUrl`)
  solo lo exigen si la petición viene del dashboard (admin.devitrak.net) sin sesión.
- Modo por env, como `NODEMAILER_AUTH_MODE`: `off` | `warn` (por defecto:
  registra y no bloquea, para no romper los correos ya enviados sin token) |
  `enforce`. Pasar a `enforce` **5 días después del despliegue**, cuando ya no
  quede ningún enlace viejo vivo.

| Flujo | Estado | Notas |
|---|---|---|
| **4.1 `/display-contracts`, consumidor** | En curso (2026-10-14) | El servidor ya arma el enlace (`returningDeviceMessage.js`). 6 rutas: `download/documentUrl`, `consumer_member/check_signed_document`, `company/consumer-signatures`, `GET /auth/:id`, `company/signatures-for-consumer-member`, `consumer_member/signing_document` (consume). El token solo se emite si quien pide el correo tiene sesión de staff y la verificación, el consumidor y su email cuadran en BD |
| 4.2 `/display-contracts`, staff y member | Pendiente | El staff firma con su sesión + `verify-password`. El correo de member manda `staff_member_id = member_id` a la página de staff: revisar si ese flujo funciona hoy |
| **4.3 `/attendance-confirmation`** | Hecho en servidor (2026-10-14, sin commitear) | `POST /api/school/event-invitations/send` (staff: el servidor saca miembro/tutor/evento de la BD, firma el enlace y manda el correo), `/confirm` (público con token: la confirmación la hace el servidor, gasta el token) y `/response` (público: `opened`/`failed`, `verified` según haya token). Las 4 rutas genéricas (`POST /auth/user-query`, `POST /auth/new`, `PATCH /auth/:id`, `POST /db_consumer/new_consumer`) rechazan al dashboard sin sesión en `enforce`. `ATTENDANCE_LINK_MODE` (warn por defecto). Dashboard: `FRONTEND_attendance_invitation_link_2026-10-14.md` |
| 4.4 App del consumidor, usuario existente | Pendiente (= Fase 6) | El enlace de `login-existing-consumer` lleva un token de un solo uso que se canjea por sesión de consumidor |
| — Registro nuevo y pago en la app | No aplica | Llegan por QR sin correo previo: siguen opcionales (Fase 3) |
| — Consentimiento del tutor | Ya lo tiene | OTC de un solo uso con hash |

Requiere en el dashboard: leer `?token=` y mandarlo como `x-link-token` en
las llamadas de la página (ver `FRONTEND_contract_link_token_2026-10-14.md`).

También del grupo A, fuera de este sistema: `update-company/register-process/:id`
(atarla a la cuenta recién creada), `devitrak/new_acceptance` y `devitrak/:id`
(atarlas a la cuenta que acepta), `db_member/my-devices` (confirmar qué prueba
de identidad pide).

## Fase 5 — Grupo F (111 rutas que el dashboard no llama)

- [ ] Cruzar con el inventario de la app del consumidor (arriba) y con la API RFID.
- [ ] Una semana en modo registro: log de cada llamada anónima a una ruta F (ruta, origen, IP), sin bloquear.
- [ ] Las que no aparezcan: retirarlas. Las que aparezcan: clasificarlas en el catálogo de Fase 0.
- Ya identificada: `POST /admin/users` (`controller/admin.js` `showAllUsers` = `StripeTransaction.find(body).populate("user")`, sin ningún middleware, nadie la llama) → cerrar ya.

## Fase 6 (futuro, opcional) — Identidad de consumidor sin login

El servidor **ya emite un JWT de consumidor** en `POST /auth/new`,
`POST /auth/` y `PATCH /auth/:id` (`generateJWT` en `controller/auth.js`), y
existe el enlace sin contraseña (`/nodemailer/login-existing-consumer`). Si la
app guardara ese token y lo mandara, el carril consumidor podría comprobar
**propiedad** ("solo puedes editar tu propio usuario y ver tus transacciones")
sin pedir login. Es el paso que convierte "anónimo con lista blanca" en
"consumidor identificado". Requiere cambio en la app del consumidor.

---

## Decisiones que necesito

1. **Fase 3.1, `PATCH /auth/:id` sin sesión:** ¿la lista blanca propuesta cubre lo que la app necesita cambiar? (sin `email`).
2. **Fase 3.2:** ¿de acuerdo con quitar los DELETE de dedupe del cliente y resolver duplicados en el servidor con índice único por `paymentIntent`? Hay que limpiar los duplicados existentes antes de crear el índice.
3. **Fase 3.3:** ¿el importe del payment intent siempre sale de la configuración del evento, o hay casos en que el consumidor elige?
4. **Fase 6:** ¿se plantea a la app del consumidor guardar el token que ya le devolvemos?
5. **Prod:** valores actuales de `NODEMAILER_AUTH_MODE` y `COMPANY_AUTH_MODE` (Fase 1).

## Orden recomendado

Fase 1 (hoy, 2 líneas, evita un 401 silencioso) → Fase 0 catálogo + extractor →
Fase 2 por lotes → Fase 3.2 (transacciones: inyección y borrado anónimo) →
Fase 3.1/3.3 → Fase 5 → Fase 4 y 6 con los frontends.
