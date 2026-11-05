# Token de consumidor: respuesta de la app

> **Para:** backend (`server-testing`, rama `release/observabilidad`).
> **De:** app del consumidor (`devitrak`) · **Fecha:** 2026-10-22 · **App @ `a24d7b2`**
> **Responde a:** `FRONTEND_consumer_token_2026-10-22.md`.
> **Formato de respuesta pedido:** un `BACKEND_consumer_token_REPLY_<fecha>.md` que conteste
> cada punto por su número (T1, T2…).

No tocamos nada de la app hasta que confirméis el despliegue de la fase A.

---

## 0. La regla de negocio: `merchant` decide cómo se entra

`event.eventInfoDetail.merchant` cambia el proceso, **tanto para consumidores nuevos como para
existentes**:

| | Consumidor nuevo | Consumidor existente |
|---|---|---|
| **`merchant = true`** (se cobra depósito) | Registro → `/device` | Ingreso → `/device` |
| **`merchant = false`** (sin depósito) | Registro → enlace por correo → login | Enlace por correo → login |

- **Con merchant**, el depósito cubre el riesgo: el consumidor entra directo, sin correo.
- **Sin merchant**, los dispositivos se entregan sin depósito, así que hay que verificar los
  datos del consumidor por si hay una pérdida. El enlace del correo es esa verificación.

La app ya funciona así desde `a24d7b2`: sin merchant, ningún formulario guarda al consumidor
antes de que entre por el enlace.

El punto 3 de vuestro documento aplica el enlace a **todos** los consumidores existentes y el
token de `/auth/new` a **todos** los nuevos. Las tres primeras preguntas son para ajustarlo a
esta regla.

---

## 1. Ajustes al flujo

**T1. Consumidor existente con merchant: token sin enlace.**
Vuestro punto 3.2 dice que, cuando `user-query` encuentra el email, la app llama a
`consumer-login-link`. Eso solo vale para `merchant = false`. Con `merchant = true` el
consumidor entra directo, así que necesita un token **sin enlace**.

Propuesta: que `POST /api/auth/consumer-session` acepte también `{ email, event_id }` sin
`x-link-token`, y emita el token **solo si ese evento tiene merchant** (si no, `403`). La regla
tiene que estar en el servidor: si la decide la app, cualquiera puede saltársela.
¿Lo hacéis así o preferís otra ruta?

**T2. `POST /auth/new` sin merchant: sin token.**
Vuestro punto 3.3 pide guardar el `token` de `/auth/new`. Sin merchant, ese token da una sesión
válida a alguien que todavía no ha verificado su correo, que es justo lo que hay que evitar.
Pedimos que `/auth/new` devuelva `token: null` cuando el evento no tiene merchant. Mientras
tanto, la app solo guardará ese token si el evento tiene merchant.

**T3. Consumidor nuevo sin merchant: enlace firmado.**
Vuestro documento solo da enlace firmado al consumidor existente. El nuevo sigue recibiendo el
correo de `POST /nodemailer/confirmation-account`, con el enlace viejo
`/authentication/:event/:company/:uid` (el `uid` en la URL). En Q14 dijisteis que
`confirmation-account` entraba en la misma fase.

Propuesta: sin merchant, después de `/auth/new` la app llama a `consumer-login-link`, y ese
correo sirve de confirmación. Así hay un solo camino de login y `confirmation-account` sale de
la app. ¿Os parece bien, o el correo de bienvenida tiene que ser distinto?

**T4. Alcance de un token emitido sin enlace.**
Con merchant (T1), quien escriba el email de otra persona recibe un token de esa persona para
ese evento. El depósito cubre el dispositivo, pero ese token también abre su perfil y sus
transacciones (`GET /auth/:id`, `POST /transaction/transaction`,
`GET /stripe/payment_intents/:id`). ¿Limitáis lo que permite un token emitido sin enlace (por
ejemplo, solo crear transacciones nuevas), o lo aceptáis como riesgo?

---

## 2. Rutas que la app usa y no están en la tabla de la fase C

Las cuatro escriben o devuelven datos del consumidor o de pagos:

| Ruta | Dónde la llama la app |
|---|---|
| `POST /stripe/stripe-transaction/` | `DisplayQRCode.jsx:64` y `:84` |
| `PATCH /company/update-signatures` | `DisplayQRCode.jsx:112` |
| `POST /nodemailer/terms-and-conditions-acceptance` | `MainDocument.jsx:157` |
| `POST /consumer/stripe/find-customer` | `useStripeAccount.js:31` |

**T5.** ¿Entran en la fase C? Si no, ¿qué las protege?

---

## 3. Datos que nos pedís

**T6. Puerto local:** `http://localhost:3791` (`vite.config.js:102`). Podéis añadirlo a
`CONSUMER_ORIGINS`.

---

## 4. Lo que falta en el documento

**T7. Transición de los enlaces viejos.** ¿Hasta qué fecha siguen valiendo
`/authentication/:event/:company/:uid`? La app mantendrá esa ruta mientras tanto.

**T8. Respuesta de `consumer-session`.** Trae `event_id` y `company_id`, pero no los documentos.
La app seguirá llamando a `POST /event/event-list` y `POST /company/search-company` después del
canje. Confirmad que `search-company` sigue siendo anónima (no está en vuestra tabla).

---

## 5. Lo que hará la app en la fase B

Cuando confirméis el despliegue:

1. **Ruta `/authentication?token=…`:** canjea con `POST /api/auth/consumer-session`
   (`x-link-token`), guarda consumidor y token, y va a `/device`. Mensajes propios para `401`
   (enlace caducado), `410` (ya usado) y `404`.
2. **Token por evento:** se guarda junto al `event_id` y un interceptor lo envía en
   `x-consumer-token`. Si el evento actual no coincide, no se envía.
3. **Consumidor existente:** con merchant, T1; sin merchant, `consumer-login-link`
   (sustituye a `POST /nodemailer/login-existing-consumer`).
4. **Consumidor nuevo:** con merchant, guarda el token de `/auth/new`; sin merchant, T3.
5. **Rutas protegidas:** `/device`, `/payment`, `/qr-code-generation` y `/profile` exigen un
   token vigente del evento actual.
6. **Ruta vieja** `/authentication/:event/:company/:uid` activa hasta la fecha de T7.
