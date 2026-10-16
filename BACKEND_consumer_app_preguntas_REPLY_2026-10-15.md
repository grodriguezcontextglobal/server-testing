# Respuesta a las preguntas de la app del consumidor (2026-10-15)

> **Para:** app del consumidor (`devitrak`) · **De:** backend
> **Responde a:** `FRONTEND_consumer_app_preguntas_2026-10-15.md`
> **Servidor de referencia:** `release/observabilidad` @ `3839079`.
> Lo verificado en el código va con `archivo:línea`. Las **propuestas** son el
> contrato que pensamos implementar: si alguna no os sirve, decidlo antes de que
> empecemos esa fase.
>
> **⚠ BORRADOR:** las respuestas marcadas con 🔶 esperan la decisión de backend
> (Gustavo) antes de enviarse.

---

## 1. Despliegue

**Q1. 🔶 Orden y fecha.**
De acuerdo: **primero el servidor, después la app.** La fecha del despliegue de
`release/observabilidad` está pendiente; os avisamos en cuanto esté en prod. Con el
servidor nuevo, `save-transaction` ya no crea duplicados: si existe una transacción con
el mismo `paymentIntent` + `event_id` + email, devuelve la existente con **200**.

Además, el despliegue arregla el registro: `POST /auth/new` respondía **500** a todo
alta con teléfono con formato o sin teléfono desde julio (`89429ea`). La app no tiene
que cambiar nada para eso.

**Q2. 🔶 Cierre de las rutas de dedupe.**
Propuesta: pasarlas a **solo staff** (401 sin sesión), no retirarlas todavía. Así un
staff con sesión puede seguir limpiando, y las PWA viejas reciben un error que ya
tratan en silencio.

| Ruta | Después |
|---|---|
| `DELETE /stripe/remove-duplicate/:id` | Solo staff. Es la primera: hoy no tiene ningún control (`controller/stripe.js:943`) y, con un id inexistente, no responde |
| `DELETE /stripe/removing/:id` | Solo staff |
| `DELETE /transaction/remove-duplicate-transaction/:id` | Solo staff |
| `GET /consumer/users` | Sin cambios: sin sesión y sin filtro ya devuelve `[]` |

Las retiraremos del todo cuando una semana de logs confirme que nadie las llama
(Fase 5). Fecha: con el mismo despliegue o el siguiente.

**Q3. 🔶 Limpieza de duplicados existentes.**
Sin fecha todavía. Primero hay que contarlos en prod. El plan: un script en modo
dry-run por defecto que, por cada `paymentIntent` + `event_id`, se queda con la más
antigua. Después, el índice único. Os avisamos cuando se haya corrido. Hasta entonces,
ocultarlos al mostrar es lo correcto.

## 2. Stripe

**Q4a. 🔶 Respuesta recortada de `GET /stripe/payment_intents/:id`.**
Propuesta: **forma plana**, sin el objeto de Stripe:

```json
{
  "ok": true,
  "paymentIntent": {
    "id": "pi_…",
    "status": "requires_capture",
    "amount": 5000,
    "amountCapturable": 5000,
    "currency": "usd",
    "card": { "last4": "4242", "network": "visa" },
    "receiptUrl": "https://pay.stripe.com/receipts/…"
  }
}
```

Sale con la Fase 3.3. Hasta entonces, la respuesta actual no cambia.

**Q4b. ✅ Confirmado: hoy la app no muestra la tarjeta ni el recibo.**
El servidor no fija `apiVersion` (`helpers/stripeClient.js:16`), así que usa la que
fija la versión instalada del SDK de Stripe: **`2025-02-24.acacia`**. Desde
`2022-11-15`, el PaymentIntent **no trae `charges`**. Por eso
`charges.data[0].payment_method_details.card` y `receipt_url` vienen vacíos: la app
muestra "XXXX" y no enseña el recibo. `retrievePaymentIntent` no expande `latest_charge`.
**Arreglo en el servidor:** expandir `latest_charge` y devolver `card` y `receiptUrl`
con la forma de Q4a. Así que **Q4a también arregla esto**, y conviene adelantarlo a la
Fase 3.3. La app solo tendrá que leer la forma nueva.

**Q4c. ✅ Sí.** Con un id de 15 caracteres o menos responderá **400**
(`"Invalid payment intent id"`), en vez de no responder. Va con el próximo cambio de
Stripe.

**Q5. 🔶 Contrato nuevo de `POST /stripe/create-payment-intent` (Fase 3.3).**
Aceptamos vuestra propuesta:

```json
// petición
{ "event_id": "…", "customerEmail": "…", "selection": [{ "deviceType": "…", "deviceNeeded": 2 }] }
// respuesta
{ "ok": true, "paymentIntentId": "pi_…", "clientSecret": "…", "amount": 5000, "currency": "usd" }
```

- El servidor calcula `deviceValue × deviceNeeded` desde la configuración del evento y
  rechaza (**422**) los tipos que el evento no tiene o las cantidades fuera de rango.
- `amount` viene en **centavos**, como en Stripe: la app lo muestra dividido entre 100.
- **Transición:** durante un tiempo se aceptan los dos formatos. Con `selection` se
  ignora `device`. El formato viejo deja de aceptarse en una fecha que os avisaremos.

**Q6. ✅ `{ ok, exists: boolean }`.**
Lo añadimos **junto** a `stripeCustomerSaved` durante la transición, y después
quitamos `stripeCustomerSaved`. La app puede pasar a leer `exists` en cuanto salga.

**Q7. ✅ Límite actual y 🔶 cambio.**
Hoy: **30 peticiones cada 5 minutos por IP + ruta**
(`config/paymentsPolicy.js:15-16`, `middlewares/publicPaymentRateLimit.js:31-36`). El
contador vive en la memoria de cada proceso y prod corre 4, así que en la práctica son
hasta unas 120. Tenéis razón con los recintos detrás de un NAT: es poco. Propuesta: en
`POST /stripe/customer` contar por **email** (5 cada 15 minutos, como
`CONSUMER_PUBLIC_ROUTES`), con un techo amplio por IP para frenar barridos. Va con la
Fase 3.3.

## 3. Usuarios

**Q8. ✅ Lista blanca de `PATCH /auth/:id` sin sesión (Fase 3.1).**

| Campo | Cómo |
|---|---|
| `name`, `lastName`, `phoneNumber`, `profile_picture` | Se reemplazan |
| `eventSelected`, `event_providers`, `company_providers`, `provider`, `groupName` | **Solo añadir** (`$addToSet`): mandar el array completo sigue funcionando |

- **Sí, `event_providers` va en la lista** (el plan solo nombraba `eventSelected`).
- Un campo fuera de la lista **se ignora sin error** y vuelve en `ignored_fields` en la
  respuesta (el mismo patrón que `PATCH /document/:id`). La app puede ignorarlo.

**Q9. 🔶 Email.** Propuesta: **inmutable para el consumidor** por ahora. Si hace falta
cambiarlo, lo hace el staff desde el dashboard. Un flujo con verificación del buzón
nuevo no está planificado.

**Q10. ✅**
- `uid` se mantiene en la respuesta de `POST /auth/new` (`controller/auth.js:196`), igual
  que el resto de campos de hoy.
- `category`: la Fase 3.1 la fija en `"Regular"` y **ignora** lo que llegue, sin error.
  Podéis dejar de enviarla cuando queráis. `privacyPolicy` sí se sigue enviando: es
  obligatorio en el modelo.

## 4. Transacciones

**Q11. ✅ Sí, se puede reducir.**
En el servidor solo se leen `consumerInfo.id` (claves de caché,
`controller/transaction.js:59`), `consumerInfo.email` (búsqueda y deduplicación) y
`consumerInfo.name` y `consumerInfo.lastName` (búsqueda, `controller/search.js:184-186`).
El worker de Go no lee `consumerInfo`. Mandad `id`, `uid`, `email`, `name`, `lastName`,
`phoneNumber` y `groupName`. `consumer_id` no lo genera la app: lo leen pantallas del
dashboard sobre transacciones creadas por el propio dashboard. No lo mandéis.

**Q12. 🔶 `created_at`.**
Propuesta: `default: Date.now` en el modelo y corregir los registros existentes con el
**timestamp del `_id`** (un ObjectId lleva la hora exacta de creación). `date` no sirve
porque es un string con formatos distintos. Fecha: pendiente, en un despliegue próximo.

**Q13. ✅ Es redundante, quitadla.**
`saveTransaction` borra esa misma clave al guardar (`controller/transaction.js:59`). La
clave de la app usa `consumer.id ?? consumer.uid`, y la del servidor `consumerInfo.id`,
que vuestra clase `Transaction` rellena con el mismo valor. Con eso,
`/cache_update/remove-cache` sale de la app.

## 5. Correo y enlaces

**Q14. 🔶 `login-existing-consumer` (Fase 4.4).**
Contrato propuesto, para revisar antes de implementarlo:

- **La app envía** `{ email, event_id, company_id }`. Deja de mandar `link` y
  `contactInfo`: el servidor saca el consumidor por email.
- **El enlace del correo:** `https://app.devitrak.net/authentication?token=<…>` (una
  sola ruta nueva, sin `:event/:company/:uid`). El token es de un solo uso y dura 5 días
  (el mismo sistema que contratos e invitaciones).
- **La página lo canjea una vez:** `POST /api/auth/consumer-session` con
  `x-link-token`. Responde `{ consumer, event_id, company_id, token }`, donde `token` es
  el JWT de consumidor de Q15. Después de eso no se vuelve a enviar `x-link-token`.
- **Transición:** los enlaces viejos `/authentication/:event/:company/:uid` siguen
  valiendo durante el modo `warn`, y dejan de valer 5 días después del cambio.
- `confirmation-account`: **sí**, entra en la misma fase y con el mismo contrato.

**Q15. 🔶 JWT de consumidor (Fase 6).**
- **Duración:** hoy **12 horas** (`helpers/jwt.js:12`). Para el consumidor proponemos
  **30 días** (no hay contraseña con la que volver a entrar).
- **Renovación:** un token nuevo en cada respuesta de `POST /auth/new`,
  `PATCH /auth/:id` y del canje de Q14. Si la app guarda el último que recibe, se
  renueva sola.
- **Si caduca o no es válido:** la petición **cae al carril anónimo**, no da 401. La
  app no se rompe: solo pierde lo que el carril identificado le permitía.
- **Consumidor existente:** lo obtiene con el enlace firmado de Q14.
- De acuerdo en **no enviarlo** hasta que os avisemos de que el carril identificado
  está activo.

## 6. Push

**Q16. 🔶 De acuerdo con la semántica.** `POST /consumer/push/subscribe` hará **upsert
por `endpoint`**; `PATCH` solo cambiará el `scope` y dará 404 si no existe;
`POST /consumer/push/unsubscribe` borrará la suscripción por `endpoint`. **No está
planificado todavía:** necesita las claves VAPID y un emisor. Mientras tanto, seguid
tratando el 404 en silencio.

## 7. Otros

**Q17. ✅ Mismos valores:** solo `image/jpeg` e `image/png`, menos de **2 MB**. Además,
un límite de subidas por IP. Si el servidor rechaza un archivo, responderá **400** con
`msg`. Va con la Fase 3.4.

---

## Resumen

| Ya podéis hacerlo | Esperad al aviso de backend |
|---|---|
| Q8 (lista blanca), Q10 (dejar de enviar `category`), Q11 (reducir `consumerInfo`), Q13 (quitar `remove-cache`), Q17 | Q1 (despliegue), Q4a/b (forma nueva de `payment_intents`), Q5, Q6, Q14, Q15, Q16 |
