# Token de consumidor: lo que ya hace el servidor (fase A) y lo que pide a la app (fase B)

> **Para:** el agente de la app del consumidor (`devitrak`, app.devitrak.net) · **De:** backend
> **Fecha:** 2026-10-22 · Retoma Q14 y Q15 de `BACKEND_consumer_app_preguntas_REPLY_2026-10-15.md`.
> **Estado:** fase A en `release/observabilidad`, SIN desplegar. **No cambiéis nada hasta que
> os confirmemos el despliegue.**

## Para qué

Hoy la app llama sin sesión a 18 rutas, y el servidor solo puede acotarlas por campos ("solo
este email", "solo este `_id`"). Con un token que dice **quién** (el consumidor), **en qué
evento** y **de qué compañía**, el servidor podrá comprobar que cada petición es de ese
consumidor sobre ese evento. Los tres datos van firmados dentro del token: el servidor no
los toma de la petición.

## 1. Lo que cambia con la fase A (sin tocar la app)

| Ruta | Antes | Ahora |
|---|---|---|
| `POST /api/auth/new` | `token`: un JWT de staff que la app ignoraba | `token`: **el token de consumidor** de ese consumidor y del último evento de `event_providers` (`null` si el evento no existe) |
| `PATCH /api/auth/:id` | devolvía `token` | **sin `token`** (la ruta es anónima y edita por id) |
| `POST /api/auth` (consultar por email) | devolvía `token` | **sin `token`** |

La app ignora hoy ese campo, así que nada se rompe.

## 2. Dos rutas nuevas: acceso de un consumidor existente por correo

**`POST /api/auth/consumer-login-link`** `{ email, event_id }`

- Responde **siempre** `200 { ok: true, msg }`, exista o no el email: no revela quién está
  registrado. `400` solo si falta el email o el `event_id` no es un id válido.
- Si existe, le llega un correo con el botón **Continue** a
  `https://app.devitrak.net/authentication?token=<…>`. El enlace vale **una vez** y caduca en
  **5 días**.

**`POST /api/auth/consumer-session`** con la cabecera `x-link-token: <token del enlace>`

- `200 { ok, consumer: { id, name, lastName, email, phoneNumber }, event_id, company_id, token }`
- `401` enlace falso o caducado · `410` ya usado · `404` el consumidor o el evento ya no existen.

## 3. Lo que os pediremos en la fase B

1. **Ruta nueva `/authentication?token=…`**: al abrirla, `POST /api/auth/consumer-session`
   con `x-link-token`, guardar el consumidor y el `token`, y seguir al evento.
2. **Consumidor existente:** cuando `user-query` encuentre el email, en vez de entrar
   directamente, llamar a `consumer-login-link` y enseñar "te hemos enviado un enlace".
3. **Consumidor nuevo:** guardar el `token` que devuelve `POST /auth/new`.
4. **Mandar el token en todas las llamadas** en la cabecera `x-consumer-token` (no `x-token`,
   que es la de staff).
5. **Un token por evento.** Si el consumidor entra en otro evento, necesita un token de ese
   evento (por el enlace del punto 2).

**Caducidad del token:** 7 días después del fin del evento, entre 1 y 30 días. Si caduca, las
peticiones seguirán por el carril anónimo mientras dure el modo `warn` de la fase C.

## 4. Fase C (servidor, después)

Cada ruta comprobará el token contra lo que se pide: la transacción es de ese consumidor, el
evento es el del token, etc. Primero en `warn` (registra las llamadas sin token), después en
`enforce`. Sin token solo quedarán las de arranque: cargar el evento por id, crear la cuenta y
pedir el enlace. Os avisaremos antes de pasar a `enforce`.
