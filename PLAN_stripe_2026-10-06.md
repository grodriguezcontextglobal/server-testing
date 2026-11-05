# Plan de acción — Stripe

> **2026-10-06.** Corrige las cinco áreas abiertas de Stripe. Parte de
> `BACKLOG_stripe_connect.md` (2026-09-25) y lo **re-verifica contra el código
> de producción** (`release/observabilidad`, `fe71ca1`), porque Stripe cambió
> desde entonces.
>
> Cada fase dice **qué toca** (código, configuración o datos), **qué hay que
> decidir antes**, **cómo se verifica** y **cómo se vuelve atrás**.

---

## Contexto que decide las prioridades

**Hay una sola cuenta de Stripe: la de ContextGlobal. Es deliberado** (confirmado
2026-10-06): no hay cuentas conectadas porque Devitrak aún no se ha registrado
como empresa. Consecuencias para este plan:

- **Connect (Fase 3) no es trabajo pendiente: espera** a que Devitrak se registre.
  El helper ya resuelve "sin cuenta conectada → cuenta madre", así que nada se
  rompe mientras tanto.
- **Todas las compañías cobran en la MISMA cuenta.** Por eso el aislamiento entre
  compañías no lo da Stripe: lo tiene que dar el servidor. Con la llave de la
  cuenta se puede reembolsar el pago de cualquier compañía, y las claves de
  idempotencia de Stripe (que son por cuenta) las comparten todas. Esto sube de
  prioridad las fases 0 y 1.

## Estado verificado hoy

| Área | Estado real | Evidencia |
|---|---|---|
| Refunds | **Arreglado, mergeado en release, sin desplegar.** Ningún refund funcionaba desde marzo | `fe71ca1`; ver `task_stripe_refund_broken` |
| Rutas sin sesión | `optionalJWT` está en el **router entero**: **38 de 46** rutas aceptan llamadas anónimas. Solo 8 exigen sesión (las 4 `/internal/*`, `customers` ×3, `stripe-transaction-admin`) | cadena real de `routes/stripe.js` |
| Clave de idempotencia | Sigue siendo `hdr:<Idempotency-Key>`, **sin compañía, ruta ni usuario** | `middlewares/idempotencyMutationCache.js:25-27` |
| Connect | El helper que decide la cuenta existe (`helpers/stripeConnectedAccount.js`, `2aa259b`) pero solo se usa en **1 sitio** de `controller/stripe.js`. Ningún cobro pasa `stripeAccount`, **y es correcto hoy**: no hay cuentas conectadas | grep de `stripeOptionsFor` |
| Propiedad de cada pago | `create-payment-intent` estampa `metadata.company_id` desde el 09-28; `-customized` y `-subscription` **no**. Nuestros registros sí guardan la compañía en casi todos los casos | `controller/stripe.js:328` y la medición de la Fase 0.1 |
| Webhooks | **No existe ninguno** (`constructEvent` no aparece en el repo) | grep |

**Quién llama a qué** (necesario para no romper nada al cerrar):

- **Dashboard:** manda siempre `x-token` y `x-company-id` a `/api/stripe/*`, pero usa
  las rutas **públicas** de refund, capture y cancel, no las `/internal/`.
- **App de asistentes (`devitrak`):** solo `DELETE /stripe/remove-duplicate/:id` y
  `DELETE /stripe/removing/:id`, **sin sesión**, desde la pantalla del QR.
- **Integraciones externas:** `docs/payments-endpoints-matrix.md` declara públicas
  varias rutas "por compatibilidad", sin decir quién. **No está verificado que
  exista alguna.**

---

## Fase 0 · URGENTE — antes del próximo `git pull` en producción

### 0.1 Cerrar los refunds anónimos — **CÓDIGO**

**El problema:** `POST /api/stripe/refund` y `/partial-refund` no exigen sesión.
Desde marzo el bug del 422 impedía TODO refund, y eso hacía de cerrojo sin querer.
Con `fe71ca1` desplegado, **cualquiera que conozca un `pi_…` puede reembolsarlo**,
y ese id viaja en los correos que reciben los consumidores (se ve en el payload de
`confirm-returned-device-notification`). `publicPaymentRateLimit` limita el ritmo,
no impide el abuso.

**El cambio:** `refund`, `partial-refund`, `payment-intents/:id/capture` y
`payment-intents/:id/cancel` exigen `validateJWT` + `checkTokenVersion` +
`authorizeMongoPermission("transaction", "update")`.

- **El dashboard no cambia:** ya manda `x-token` y `x-company-id` a estas rutas.
- **Por qué `transaction:update` y no `billing:update`** (que es lo que piden las
  `/internal/`): el `event_manager` cobra depósitos y multas en los eventos y
  tiene `transaction:*`, pero **no** `billing:*`. Con `billing` se quedaría sin
  poder reembolsar.

**Y además, comprobar que el pago es de la compañía de quien reembolsa.** La
sesión y el permiso no bastan: con una sola cuenta de Stripe, un staff de la
compañía A con `transaction:update` podría reembolsar un `pi_` de la compañía B.
Antes de llamar a Stripe:

1. Buscar el `pi_` en nuestros registros, que **sí** guardan la compañía como id
   de Mongo (medido en producción el 2026-10-06):

   | Colección | Registros con pago | `company` = id de Mongo | Vacía |
   |---|---|---|---|
   | `transactions` | 548 | **548 (100%)** | 0 |
   | `cashreports` (`paymentIntent_charge_transaction`) | 16 | **16 (100%)** | 0 |
   | `stripetransactions` | 528 | 504 | 24 |
   | `receivers` | 1.918 | 1.905 | 13 |

2. Como segunda fuente, `metadata.company_id` del propio PaymentIntent, que
   `create-payment-intent` estampa desde `2aa259b` (2026-09-28).
3. Regla: **si algún registro lo ata a la compañía de `x-company-id`, sigue.** Si
   lo ata a otra, **404** (no 403: no confirmar que ese pago existe). Si no hay
   registro en ningún sitio (pagos viejos sin compañía), **solo el super_user de
   plataforma** puede reembolsarlo, y queda en el audit trail.

- **Decidir antes:** ¿hay alguna integración externa que llame a estas rutas sin
  sesión? Si nadie lo sabe, se cierra igual: un refund anónimo es peor que una
  integración rota que se puede reabrir con nombre y apellido.
- **Esfuerzo:** 1 día con la comprobación de propiedad y los tests.
- **Verificación:**
  - test de router (como `docsStaffAuthzRoutes.test.js`);
  - test de propiedad: pago de la propia compañía → 201; de otra → 404; sin dueño → 403 salvo super_user;
  - un refund real desde el dashboard con un usuario `event_manager`.
- **Vuelta atrás:** revertir el commit. **No desplegar `fe71ca1` sin esto.**

### 0.1b Estampar la compañía en TODOS los PaymentIntent — **CÓDIGO, 1 hora**

`create-payment-intent` estampa `metadata.company_id`, pero
`create-payment-intent-customized` y `create-payment-intent-subscription` **no**.
Los pagos que crean quedan sin dueño en Stripe y dependen solo de nuestros
registros. Añadir el mismo `metadata` en las dos.

### 0.2 Desplegar refund + cierre juntos — **CONFIGURACIÓN**

`git pull` y reiniciar `DevitrakServer` **y todos los servicios que consumen la
cola**. Verificar con un refund parcial y uno total desde el dashboard.

---

## Fase 1 · Aislamiento entre compañías — 1 día

### 1.1 Segmentar la clave de idempotencia — **CÓDIGO**

**El problema:** dos compañías que manden el mismo `Idempotency-Key` (`1`, `abc`,
un timestamp) colisionan, y la segunda recibe **la respuesta cacheada de la
primera, con el id de un pago ajeno**. Es fuga de datos entre inquilinos en rutas
de pago, hoy.

**El cambio** en `buildKey`:

```js
`hdr:${tenant}:${req.method}:${routePath}:${headerKey}`
```

- **`tenant`:** la compañía del contexto (`resolveCompanyContext`). Si no hay
  compañía, el `uid` del JWT. Si tampoco, `anon:<ip>`.
- **`routePath`:** que la misma clave en `/refund` y en `/create-payment-intent`
  sean dos operaciones distintas. En Stripe las claves también son por cuenta, así
  que va en la misma dirección que la API.

### 1.2 La clave que llega a STRIPE también, no solo la de nuestra caché — **CÓDIGO**

`middlewares/attachServerIdempotencyKey.js:7` pasa la cabecera del cliente **tal
cual** a Stripe (`req.idempotencyKey = header`). Stripe guarda las claves 24 h
**por cuenta**, y aquí hay una sola cuenta para todas las compañías. Así que si
dos compañías mandan la misma clave en 24 h, **Stripe le devuelve a la segunda el
PaymentIntent de la primera, `client_secret` incluido**. No pasa por nuestra caché
de Redis, así que 1.1 no lo arregla.

**El cambio:** a Stripe se le manda
`sha256(compañía | ruta | clave del cliente)`. Un hash sigue siendo una clave
válida para Stripe y no deja que la del cliente decida sola el espacio.

- **Decidir antes:** nada.
- **Riesgo:** las claves cacheadas en Redis en el momento del despliegue dejan de
  coincidir. Si un cliente reintenta justo en ese instante, la operación se
  repite. Desplegar en un momento de poco tráfico.
- **Verificación:** test con dos compañías y la misma clave → dos operaciones; la
  misma compañía y la misma clave → una.
- **Vuelta atrás:** revertir; las claves nuevas caducan solas.

---

## Fase 2 · Cerrar el resto de rutas anónimas — 1-2 semanas, sobre todo medir

### 2.1 Medir antes de cerrar — **NADA QUE TOCAR**

El audit trail registra desde el 2026-10-05 quién llama a cada escritura y si vino
sin sesión (`actor_type: anonymous`). **Hasta hoy hay un único registro de
Stripe**: no alcanza para decidir. Dejar correr 1-2 semanas con tráfico real.

```js
db.staffactivitylogs.aggregate([
  { $match: { "details.route": /\/api\/stripe\//, actor_type: "anonymous" } },
  { $group: { _id: "$details.route", n: { $sum: 1 }, last: { $max: "$timestamp" } } } ])
```

Las lecturas (`GET`) no las registra el audit trail; para esas sirve
`GET /api/metrics` (requiere `platform_observer`).

### 2.2 Clasificar y cerrar en tres grupos — **CÓDIGO**

| Grupo | Rutas | Qué hacer |
|---|---|---|
| **A. Solo dashboard** (cero tráfico anónimo medido) | `accounts`, `account_link`, `account_sessions`, `company-account-stripe*`, `invoices`, `setup-search`, `stripe-transactions-saved-list`, `updating-subscription/:id`, `cancel/subscriptions/:id`, **`DELETE subscriptions/:id`**, `payment_intents/:id`, `transaction`… | `validateJWT` + permiso. Las tres de Connect (`accounts`, `account_link`, `account_sessions`) primero: hoy cualquiera crea cuentas conectadas reales bajo la plataforma |
| **B. App de asistentes** | `DELETE remove-duplicate/:id`, `DELETE removing/:id` | No se pueden cerrar con JWT de staff. Exigir que el registro pertenezca al consumidor que llama, o mover el borrado al servidor. Hoy cualquiera borra registros de transacción por id |
| **C. Pago público de verdad** | `create-payment-intent` (ya tiene `validatePublicPaymentPayload`) y lo que la medición demuestre | Se quedan públicas, con validación de payload, límite e idempotencia |

**Cuidado con el registro de compañía:** algunas rutas de Stripe se llaman en el
alta, **antes** de que exista sesión (`RegisterCompany`,
`createStripeAccount.jsx`). Con la MFA obligatoria, el alta ya no tiene sesión
sino token de enrolamiento. Revisar ese flujo antes de cerrar el grupo A.

- **Esfuerzo:** 2-3 días de código, después de la medición.
- **Verificación:** `routeSecurityHardening.test.js` ampliado ruta por ruta, y un
  recorrido del alta de compañía y del cobro en evento.
- **Vuelta atrás:** por ruta: cada grupo en un commit.

---

## Fase 3 · Stripe Connect — EN ESPERA hasta registrar Devitrak como empresa

> **No es trabajo pendiente hoy.** Solo existe la cuenta de ContextGlobal, a
> propósito. Esta fase se activa el día que Devitrak se registre como empresa y
> haya una primera cuenta conectada que usar. Mientras tanto, el helper ya hace lo
> correcto: sin cuenta conectada, cobra la cuenta madre.
>
> **Lo único que sí conviene hacer ya** es cerrar las tres rutas de alta de
> Connect (`accounts`, `account_link`, `account_sessions`) en la Fase 2: hoy
> cualquiera puede llamarlas sin sesión e intentar crear cuentas bajo la
> plataforma.

### 3.1 Decisiones — **UNA REUNIÓN, cuando se active la fase**

1. **Tipo de cargo:** directo (`stripeAccount`), con destino
   (`transfer_data.destination`) o cargos y transferencias separados. Lo ya
   configurado en `accounts.create` (la plataforma paga comisiones y asume
   pérdidas) encaja con **directo + comisión de aplicación**.
2. **Clientes existentes:** los `StripeCustomer` viven en la cuenta madre y **no
   viajan** a la cuenta conectada. ¿Migrar, recrear o convivir?
3. **Compañía sin cuenta conectada:** el helper ya decide que cobre la cuenta
   madre (es el caso de ContextGlobal). Confirmarlo como política, no como
   accidente.
4. **Comisión de la plataforma:** porcentaje o fijo, y si varía por plan.

### 3.2 Una sola puerta a Stripe — **CÓDIGO, 3-5 días**

- Envoltorio único `stripeFor(company)` que aplique `stripeOptionsFor` a
  **toda** llamada. El helper ya existe; falta que lo use todo el mundo.
- **Un test que falle si alguien llama a `stripe.*` sin pasar por él**, con un
  grep sobre `controller/`, `queue/` y `helpers/`. El riesgo de esta fase no es
  la dificultad, es el olvido: 46 rutas y una convención.
- La cuenta conectada se resuelve **siempre en el servidor** a partir de la
  compañía autenticada. Nunca del body: la fase 2 cierra justo esa puerta.

### 3.3 Migración — **DATOS, según 3.1.2**

Script con dry-run por defecto y `--apply`, como los anteriores.

---

## Fase 4 · Webhooks — 2-3 días; la parte de Connect espera con la Fase 3

Las disputas, los reembolsos hechos desde el panel de Stripe y los cobros
asíncronos **solo llegan por webhook**. Hoy el resultado de un pago se conoce
preguntando, y un reembolso hecho a mano en el panel de Stripe no se entera
nadie en la plataforma.

- **Ahora** (cuenta única): un endpoint para la cuenta de ContextGlobal, con los
  eventos de pago.
- **Con la Fase 3:** el endpoint de **Connect** (`account.updated` y eventos de
  cuentas conectadas) y su secreto propio.

- **Endpoint `POST /api/stripe/webhook`.** Va montado **ANTES** de
  `express.json()` en `index.js`, con `express.raw()`: la verificación de firma
  necesita el cuerpo sin parsear, y hoy el JSON se parsea globalmente antes de
  los routers.
- **Verificación** con `stripe.webhooks.constructEvent` y `STRIPE_WEBHOOK_SECRET`.
  Uno por modo (test/live), y uno de **Connect** aparte.
- **Responder 200 enseguida y procesar en la cola** (`queue/handlers`), con
  idempotencia por `event.id`: Stripe reintenta y no garantiza el orden.
- **Eventos mínimos:**
  - `account.updated` (alta completada, requisitos) — solo con la Fase 3;
  - `payment_intent.succeeded` y `payment_intent.payment_failed`;
  - `charge.refunded`;
  - `charge.dispute.created`.
- **Configuración:** registrar los endpoints en el panel de Stripe (test y live)
  y guardar los secretos en el entorno de `DevitrakServer`.
- **Verificación:** `stripe trigger` con la CLI de Stripe contra un entorno de
  prueba.

---

## Resumen del orden

| # | Qué | Tipo | Esfuerzo | Bloqueado por |
|---|---|---|---|---|
| **0.1** | Refunds/capture/cancel: sesión + `transaction:update` + **el pago es de tu compañía** | Código | 1 día | Nada. **Antes del próximo pull** |
| **0.1b** | `metadata.company_id` en los tres PaymentIntent | Código | 1 h | Nada |
| **0.2** | Desplegar refund + cierre | Config | 1 h | 0.1 |
| **1.1** | Clave de idempotencia de nuestra caché, por compañía y ruta | Código | ½ día | Nada |
| **1.2** | Clave que llega a Stripe, con hash de compañía y ruta | Código | ½ día | Nada |
| **2.1** | Medir tráfico anónimo por ruta | Nada | 1-2 semanas | Despliegue del audit trail (hecho) |
| **2.2** | Cerrar grupos A y B (incluye las 3 rutas de alta de Connect) | Código | 2-3 días | 2.1 |
| **4** | Webhooks de pago de la cuenta de ContextGlobal | Código + config | 2 días | Nada |
| 3.x | Connect: decisiones, puerta única, migración, webhooks de Connect | — | — | **En espera:** registrar Devitrak como empresa |

**Lo que este plan NO afirma:**

- **No sé si existe alguna integración externa** que use las rutas públicas.
  `payments-endpoints-matrix.md` lo da a entender sin nombrarla.
- **La app de asistentes revisada es `origin/main` del 2026-07-10.** Si hay una
  versión más nueva, puede llamar a otras rutas.
- **El conteo de rutas anónimas** sale del router en `fe71ca1`. Cualquier rama sin
  mergear que toque `routes/stripe.js` lo cambia.
