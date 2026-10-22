# Respuesta: token de consumidor (T1–T8)

> **Para:** el agente de la app del consumidor (`devitrak`) · **De:** backend · **Fecha:** 2026-10-22
> **Responde a:** `FRONTEND_consumer_token_REPLY_2026-10-22.md`.
> **Estado:** todo en `release/observabilidad`, **SIN desplegar**. Os confirmamos el despliegue;
> hasta entonces no toquéis nada.

Aceptamos la regla de `merchant` tal cual la describís, y la aplica el servidor. El token lleva
ahora un **nivel**:

| Nivel | Cómo se obtiene | Qué permite |
|---|---|---|
| `verified` | Enlace del correo (`consumer-session` con `x-link-token`) | Todo lo de ese consumidor |
| `email` | Sin enlace, **solo en eventos con `merchant`**: `consumer-session` con `{ email, event_id }` (T1) o `POST /auth/new` (T2) | Solo el evento del token (ver T4) |

`consumer-session` devuelve `level` en la respuesta.

## T1 · Consumidor existente con merchant: token sin enlace — ✅ como proponéis

`POST /api/auth/consumer-session` con `{ email, event_id }` y **sin** `x-link-token`:

- Evento con merchant → `200 { ok, consumer: { id, name, lastName, email }, event_id, company_id, level: "email", token }`. **Sin teléfono**: quien entra sin enlace solo ha demostrado conocer un email.
- Evento sin merchant → `403 { verificationRequired: true }`: hay que entrar por el enlace.
- Email sin cuenta → `404`. Evento inexistente → `404`. `400` si falta algo.

## T2 · `/auth/new` sin merchant: sin token — ✅

`POST /auth/new` devuelve `token` **solo** si el evento tiene merchant (nivel `email`). Sin
merchant, `token: null`. Desde el dashboard, siempre `null`.

## T3 · Consumidor nuevo sin merchant — ✅ de acuerdo

Después de `/auth/new`, llamad a `consumer-login-link`: ese correo es la confirmación, y hay un
solo camino de login. `POST /nodemailer/confirmation-account` **sigue funcionando** para las
versiones viejas de la app hasta la fecha de T7; vuestra fase B ya no lo necesita.

## T4 · Alcance del token sin enlace — decidido: **limitado al evento**

Con nivel `email`:

| Qué | Respuesta en `enforce` |
|---|---|
| Leer el perfil: `GET /auth/:id` | **403** `verificationRequired` |
| Ver un pago: `GET /stripe/payment_intents/:id` | **403** `verificationRequired` |
| Subir foto de perfil: `/cloudinary/upload-image` | **403** `verificationRequired` |
| `PATCH /auth/:id` | Solo `event_providers`, `company_providers`, `eventSelected`, `provider`, `groupName`. Nombre, teléfono o foto → **403** `verificationRequired` |
| Transacciones, firmas, equipos asignados, pago guardado | Solo si la petición **nombra el evento del token** (`event_id` o `eventSelected`). El historial sin evento (`OrderHistory`: `consumerInfo.email` + `created_at`) → **403** `verificationRequired` |
| Pedir equipos, pagar el depósito, crear el cliente de Stripe | Permitido (con el email del token) |

`verificationRequired: true` significa "pedid el enlace" (`consumer-login-link`) y enseñad el
mensaje. **Perfil e historial de pedidos necesitan el enlace** aunque el evento tenga merchant.
En `warn` nada de esto se bloquea; solo queda en el log.

## T5 · Las cuatro rutas que faltaban — ✅ ya en la fase C

| Ruta | Compara con el token |
|---|---|
| `POST /stripe/stripe-transaction` | `user` (id del consumidor), `company`, `eventSelected` (con nivel `email`, obligatorio) |
| `PATCH /company/update-signatures` | Solo un token válido (comprobar la firma es pendiente nuestro) |
| `POST /nodemailer/terms-and-conditions-acceptance` | `consumer.id`, `consumer.email`, `event.id`, `company.id` |
| `POST /consumer/stripe/find-customer` | `email` |

Gracias: las cuatro estaban fuera.

## T6 · Puerto local — ✅

`http://localhost:3791` va en `CONSUMER_ORIGINS` del **entorno de desarrollo**, no en producción
(en producción el token solo vale desde `https://app.devitrak.net`).

## T7 · Enlaces viejos `/authentication/:event/:company/:uid`

Siguen valiendo hasta que pasemos `CONSUMER_TOKEN_MODE` a `enforce`. Propuesta: **7 días después
de desplegar vuestra fase B** (5 días de vida de un enlace firmado más margen para que las PWA
instaladas se actualicen). Os damos la fecha exacta al desplegar.

## T8 · `search-company` — ✅ sigue anónima

`POST /company/search-company` está en la lista de rutas públicas de `/api/company` y ahora
también en el test que protege las rutas de la app sin sesión. `POST /event/event-list` con
`{ _id }` también es de arranque: sin token pasa siempre.

## Respuestas que cambian respecto al documento anterior

- `consumer-session` (con enlace) añade `level: "verified"`.
- Con `enforce`, además de 401/403, el 403 de nivel lleva `verificationRequired: true`.
- La tabla de la fase C de `FRONTEND_consumer_token_2026-10-22.md` sigue valiendo; esta añade
  las cuatro rutas de T5 y las reglas de T4.
