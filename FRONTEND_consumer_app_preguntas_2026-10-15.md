# App del consumidor (app.devitrak.net): preguntas para backend

> **Para:** backend (`server-testing`, rama `release/observabilidad`).
> **De:** app del consumidor (`devitrak`) · **Fecha:** 2026-10-15
> **Responde a:** `FRONTEND_consumer_app_ajustes_2026-10-15.md` (servidor @ `296fc25`).
> **Formato de respuesta pedido:** un `BACKEND_consumer_app_preguntas_REPLY_<fecha>.md`
> que conteste cada pregunta por su número (Q1, Q2…).

---

## 0. Estado de la app

Todo está en el árbol de trabajo de `devitrak` (`main`), **sin commit ni despliegue**. El build
pasa y los tests también (77/78; el que falla es `formatEventDateTime` en portugués, que ya
fallaba antes y no tiene relación).

| Tarea del documento de backend | Estado en la app |
|---|---|
| P0.1 Token de AWS | Eliminados `devitrackAWSApi`, las instancias sin uso y `ExistingConsumerCheck.jsx`. El token ya no está en el bundle. **Rotación en AWS: pendiente**, a cargo de quien tenga acceso. |
| P0.2 Dedupes del cliente | Eliminados. La app ya no llama a `/consumer/users`, `/stripe/remove-duplicate/:id`, `/stripe/removing/:id` ni `/transaction/remove-duplicate-transaction/:id`. Los duplicados antiguos se **ocultan al mostrar** (agrupando por `paymentIntent`, sin borrar nada). |
| P0.3 `post/posts` | Envía `displayed_in: event.id`, sin `$in`. |
| P1.1 Email | No editable en el perfil y no se envía en el PATCH. Redux solo se actualiza si el PATCH responde bien. |
| P1.2 `group` | Ya no se envía en `/auth/new`. |
| P1.3 `remove-cache` del login | Eliminada. |
| P1.4 `payment_intents` | `PaymentInformation` ya no pide ids de 15 caracteres o menos. |
| P1.5 Cliente de Stripe | Un solo camino: `POST /stripe/customer`. |
| P2.1 Push | Un 404 de `/consumer/push/*` ya no se muestra al usuario. |
| P2.2 Códigos nuevos | Un 400 en `/transaction/transaction` deja la lista vacía y queda registrado en consola. |

---

## 1. Despliegue (bloquea el despliegue de la app)

**Q1. ¿Cuándo sale `release/observabilidad` a producción, y en qué orden respecto a la app?**
- La app ya no borra duplicados. Si la app se despliega **antes** que el servidor, el servidor
  actual sigue creando duplicados (todavía no deduplica en `save-transaction`). La app los
  oculta al mostrarlos, pero en la base se acumulan.
- Propuesta: **primero el servidor, después la app**. Necesitamos una fecha o un aviso cuando
  esté desplegado.

**Q2. Ya podéis cerrar las rutas de dedupe. ¿Cuándo, y cómo?**
- Con P0.2, la app no llama a ninguna de estas cuatro rutas:
  - `DELETE /stripe/remove-duplicate/:id`: hoy **sin ningún control**
    (`controller/stripe.js:943`, `StripeTransaction.findByIdAndDelete`). Es la más urgente.
  - `DELETE /stripe/removing/:id`
  - `DELETE /transaction/remove-duplicate-transaction/:id`
  - `GET /consumer/users` sin filtro (ya devuelve `[]`)
- Ojo: las versiones de la app que ya están instaladas como PWA siguen llamándolas hasta que
  se actualizan. ¿Las pasáis a "solo staff" (401 sin sesión) o las retiráis directamente? La
  app vieja trata el error en silencio, así que cualquiera de las dos vale.

**Q3. ¿Vais a limpiar los duplicados que ya hay en la base?**
- El plan menciona limpiarlos antes de crear el índice único por `paymentIntent`.
  ¿Hay fecha?
- Mientras tanto, la app los oculta al mostrar, pero el dashboard y los informes los
  siguen viendo.

---

## 2. Stripe

**Q4. `GET /stripe/payment_intents/:id` (Fase 3.3): esta es la lista cerrada de campos que lee la app.**

| Campo | Dónde |
|---|---|
| `id` | `OrderHistory.jsx` (clave del historial) |
| `amount_capturable` | `OrderHistory.jsx` (importe del depósito) |
| `charges.data[0].payment_method_details.card.last4` | `PaymentInformation.jsx` |
| `charges.data[0].payment_method_details.card.network` | `PaymentInformation.jsx` |
| `charges.data[0].receipt_url` | `FormatCurrentOrder.jsx` |

`status` y `amount` los lee `Checkout.jsx`, pero de Stripe.js en el navegador, no de este
endpoint.

- **Q4a.** ¿Mantendréis estos campos en la respuesta recortada? ¿Con la misma forma, o con una
  plana (p. ej. `{ id, amountCapturable, card: { last4, network }, receiptUrl }`)? Si cambia la
  forma, necesitamos el contrato antes de la Fase 3.3.
- **Q4b.** ¿Qué versión de la API de Stripe usa el servidor? `new Stripe(key)` no fija
  `apiVersion`, así que usa la de la cuenta. Desde `2022-11-15`, el PaymentIntent **no trae
  `charges`**: hay que usar `latest_charge` expandido. Si la cuenta ya está en esa versión, hoy
  la app muestra "XXXX" y no muestra el recibo. ¿Podéis confirmarlo?
- **Q4c.** Con ids de 15 caracteres o menos, `retrievePaymentIntent` no responde y la petición
  cuelga hasta el 408. ¿Podéis devolver **400** (o 404) en ese caso? La app ya lo evita, pero
  las versiones antiguas no.

**Q5. `POST /stripe/create-payment-intent` (Fase 3.3): ¿cuál es el contrato nuevo?**
- Hoy la app envía `{ customerEmail, device: <importe en dólares> }` (`SinglSelection.jsx:209`).
- Lo que la app tiene en el momento de pagar: `event.id`, `company.id`, el email del
  consumidor y la selección por tipo `[{ deviceType, deviceNeeded, deviceValue }]`.
- Preguntas:
  - ¿Qué campos queréis? Propuesta: `{ event_id, customerEmail, selection: [{ deviceType, deviceNeeded }] }`.
  - ¿La respuesta incluirá el importe calculado? La app lo muestra en el checkout.
  - ¿Hay un periodo en el que se acepten los dos formatos, el viejo y el nuevo?
- Respuesta a la pregunta 3 de vuestro plan: en la app el consumidor **no elige el importe**.
  Siempre sale de `deviceValue × cantidad` según la configuración del evento.

**Q6. `POST /consumer/stripe/find-customer`: la app solo necesita saber si el cliente existe.**
- La app solo mira si `stripeCustomerSaved.length > 0`. El objeto se guarda en Redux
  (`customerStripe`), pero **ningún componente lo lee**.
- Así que la respuesta mínima puede ser `{ ok, exists: boolean }`, o mantener
  `stripeCustomerSaved` con un único elemento `{ id }`. ¿Cuál preferís? Adaptamos la app a esa
  forma.

**Q7. Límite de peticiones de `POST /stripe/customer`.**
- Ahora es el único camino para crear el cliente (registro + perfil).
  `publicPaymentRateLimit` limita por `IP + ruta`, y en un evento cientos de asistentes salen
  por la misma IP (wifi del recinto, NAT del operador).
- ¿Cuál es el límite en producción para esta ruta? ¿Lo podéis llevar al **email** (como
  `CONSUMER_PUBLIC_ROUTES`) en lugar de la IP?

---

## 3. Usuarios

**Q8. Lista blanca de `PATCH /auth/:id` sin sesión (Fase 3.1): esto es lo que envía la app.**

| Origen | Campos |
|---|---|
| `ConsumerInfo.jsx` (perfil) | `name`, `lastName`, `phoneNumber` |
| `ConsumerInfo.jsx` (foto) | `profile_picture` |
| `AuthenticationLogin.jsx` | `event_providers`, `eventSelected`, `company_providers`, `provider` (siempre el array completo con el valor nuevo añadido) |
| `CheckEventGroupName.jsx` | `groupName` (array completo con el valor nuevo añadido) |

- La app **nunca quita** elementos de esos arrays, así que `$addToSet` le sirve.
  **¿Confirmáis** que `eventSelected` y `event_providers` están en la lista de "solo añadir"?
  Vuestro plan menciona `eventSelected` pero no `event_providers`.
- Si se envía un campo que no está en la lista blanca, ¿se ignora en silencio o responde 400?
  La app prefiere que se ignore.

**Q9. Cambio de email.**
- La app ya no deja editar el email. ¿Hay previsto un flujo con verificación del nuevo buzón,
  o el email es inmutable para el consumidor? Si es inmutable, el texto del perfil lo dirá.

**Q10. `POST /auth/new` tras la Fase 3.1.**
- La app lee `uid` (o `id`) de la respuesta para el resto del flujo. ¿Se mantienen?
- La app envía `category: "Regular"` y `privacyPolicy: true`. Si el servidor fija `category`,
  ¿dejamos de enviarla, o se ignora sin error?

---

## 4. Transacciones

**Q11. ¿Qué campos de `consumerInfo` necesitáis en `save-transaction`?**
- Hoy la app envía el objeto `consumer` **completo** de Redux (incluye `sqlInfo`, todos los
  arrays de proveedores y eventos, `profile_picture`…).
- En el dashboard y el servidor encontramos lecturas de `id`, `uid`, `email`, `name`,
  `lastName`, `phoneNumber`, `groupName` y `consumer_id`.
- ¿Podemos reducirlo a esos 8? ¿Lee algún informe, worker de Go o la migración a SQL algún
  campo más? ¿De dónde sale `consumer_id`? La app no lo envía.

**Q12. `created_at` de `Transaction`.**
- `models/Transaction.js:50` usa `default: new Date().getTime()`, que se evalúa una sola vez al
  arrancar. Afecta al filtro del último año de `OrderHistory` y a qué cuenta como "último
  pedido" en `PaymentInformation` (ordenado por `created_at`).
- ¿Hay fecha para el arreglo (`default: Date.now`)? ¿Corregiréis los registros existentes, por
  ejemplo usando `date` o el timestamp del `_id`?

**Q13. `remove-cache` desde `DisplayQRCode.jsx`.**
- La app borra `event_id=…&company=…&consumerInfo.id=…` **antes** de guardar la transacción, y
  `saveTransaction` ya borra esa misma clave en el servidor.
- ¿Confirmáis que es redundante? Si es así, la quitamos y `/cache_update/remove-cache`
  desaparece de la app del todo. Eso os deja libre la Fase 3.4 para esa ruta.

---

## 5. Correo y enlaces

**Q14. `POST /nodemailer/login-existing-consumer` (Fase 4.4): ¿cuál es el contrato?**
- Hoy la app arma el enlace (`/authentication/:event/:company/:uid`, sin firmar) y lo envía en
  `link`.
- Preguntas:
  - ¿Qué envía la app en su lugar? (¿`event_id`, `company_id` y `email`?)
  - ¿Qué ruta de la app abrirá el enlace firmado, y cómo se llama el parámetro (`?token=`)?
  - ¿La página canjea el token llamando a un endpoint (cuál, y qué devuelve) o lo envía en
    `x-link-token` en cada llamada, como `/display-contracts`?
  - Mientras convivan los dos tipos de enlace, ¿siguen valiendo los viejos
    `/authentication/:event/:company/:uid`?
- `confirmation-account` también recibe el `link` armado por la app, con
  `https://app.devitrak.net` fijo en el código. ¿Entra en la misma fase?

**Q15. Fase 6: JWT del consumidor.**
- `/auth/new` y `PATCH /auth/:id` devuelven un `token` que la app ignora. Respuesta a la pregunta
  4 de vuestro plan: **la app puede guardarlo y enviarlo en `x-token`** (con un interceptor en
  `devitrackApi`).
- Para hacerlo necesitamos saber:
  - ¿cuánto dura el token y cómo se renueva?
  - ¿qué pasa si caduca: el carril de consumidor responde 401, o cae al carril anónimo?
  - ¿cómo lo obtiene un consumidor que ya existía (¿por el enlace firmado de Q14?)?
- Hasta que el servidor no tenga un carril de consumidor identificado, enviarlo no cambia nada,
  así que no lo haremos sin vuestro visto bueno.

---

## 6. Push notifications

**Q16. ¿Cuándo estarán `/consumer/push/*`, y con qué semántica?**
- Hoy dan 404 y la app lo trata en silencio.
- Problema de diseño: la app envía `PATCH /push/subscribe` cuando el navegador **ya tiene** una
  suscripción. Todas las suscripciones creadas mientras el servidor daba 404 nunca llegaron al
  servidor, así que ese PATCH fallaría.
- Propuesta: que **`POST /push/subscribe` sea crear o actualizar** (upsert por `endpoint`). La
  app usaría siempre POST, y PATCH solo para cambiar el `scope`, devolviendo 404 si no existe,
  en cuyo caso la app reintenta con POST. ¿De acuerdo?

---

## 7. Otros

**Q17. Límites de `POST /cloudinary/upload-image` (Fase 3.4).**
- La app ya valida en el cliente: solo `image/jpeg` e `image/png`, menos de 2 MB
  (`validateProfileImage.js`). ¿Usaréis los mismos valores en el servidor? Si no, ¿cuáles, para
  alinearlos?

---

## Resumen de lo que bloquea a la app

| Bloquea | Preguntas |
|---|---|
| Desplegar lo ya hecho | Q1 |
| Fase 3.3 (Stripe) | Q4a, Q4b, Q5, Q6 |
| Fase 3.1 (usuarios) | Q8, Q10 |
| Fase 4.4 / 6 | Q14, Q15 |
| Push | Q16 |
| Limpieza menor (la app puede seguir sin respuesta) | Q2, Q3, Q4c, Q7, Q9, Q11, Q12, Q13, Q17 |
