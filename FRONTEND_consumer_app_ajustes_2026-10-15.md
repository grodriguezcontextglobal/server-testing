# App del consumidor (app.devitrak.net): trabajo pendiente frente al servidor actual

> **Para:** el agente que trabaja en el repo `devitrak` (app del consumidor).
> **De:** backend · **Fecha:** 2026-10-15
> **Servidor de referencia:** `server-testing`, rama `release/observabilidad`, commit `296fc25`.
> **Base:** el inventario de 32 llamadas que hizo el agente de la app el 2026-10-15,
> verificado contra el código del servidor.

---

## 0. Reglas que no cambian

- **La app sigue sin sesión.** No hay que añadir token ni login. El servidor trata
  toda petición de `app.devitrak.net` como el "carril sin sesión", y la acota en el
  propio servidor.
- **No cambiar el `Origin` ni las cabeceras.** Las peticiones con el `Origin` del
  dashboard y sin sesión reciben 401. La app no debe parecerse al dashboard.
- **Este documento no cambia nada en el servidor.** Todo lo de aquí se hace en la app.
  Lo marcado con "Esperar" depende de una fase del servidor que todavía no existe.

## 1. Lo que ya cambió en el servidor y la app tiene que saber

Nada de esto rompe la app hoy, pero cambia lo que responde el servidor.

| Endpoint | Antes | Ahora (`release/observabilidad`, sin desplegar aún) |
|---|---|---|
| `POST /transaction/transaction` | El body iba tal cual a `Transaction.find()`; `{}` devolvía todo | Sin sesión solo acepta `consumerInfo.email`, `event_id`, `company`, `paymentIntent`, `active` y `created_at` con `$gte/$gt/$lte/$lt`. Con email devuelve las transacciones sin `clientSecret`. Sin email (solo `event_id`) devuelve solo `id`, `paymentIntent` y `event_id`. Cualquier otro campo u operador → **400** |
| `POST /transaction/save-transaction` | Guardaba el body tal cual y podía duplicar | Lista blanca. `paymentIntent`, `clientSecret`, `provider`, `eventSelected`, `event_id`, `company`, `consumerInfo.email` y `device[]` (no vacío) son obligatorios → si falta uno, **400**. Si ya existe una con el mismo `paymentIntent` + `event_id` + email, responde **200** con la existente y **no crea otra** |
| `DELETE /transaction/remove-duplicate-transaction/:id` y `DELETE /stripe/removing/:id` | Borraban cualquier transacción sabiendo su id | Solo borran si existe otra **más antigua** con el mismo `paymentIntent` en el mismo evento; si no, **409**. Con un id inexistente, **404** (antes la petición colgaba) |
| `POST /auth/new` | **500** con teléfono con formato (`"555-1017"`) o sin teléfono, **desde julio** | Arreglado (`89429ea`): el teléfono es opcional y se guarda tal cual. La app no tiene que cambiar nada; empieza a funcionar con el despliegue |

Las 4 consultas actuales de la app a `/transaction/transaction` encajan con el
contrato nuevo. Ver los cuerpos en §5.

## 2. Tareas, por prioridad

### P0: seguridad y código que hace daño hoy

**P0.1 Quitar y rotar `VITE_APP_AWS_AUTH_TOKEN`.**
- `src/devitrakApi.jsx`: `devitrackAWSApi` incrusta el token en el bundle público.
  Cualquiera que abra la app lo puede leer.
- Borrar `devitrackAWSApi` y las demás instancias sin uso: `devitrackApiAdmin`,
  `devitrackApiStripe`, `devitrackApiArticle` y `devitrackApiVersionated`.
- Borrar `src/pages/Consumer/ExistingConsumerCheck.jsx`: no se importa en ningún sitio,
  y es lo único que llama a AWS (`…execute-api…/dev/check-consumer`).
- Quitar la variable del `.env` y de la configuración de Netlify o del build.
- **Rotar el token en AWS:** aunque el código esté muerto, el token ya está publicado
  en cada build anterior.
- **Aceptación:** `grep -r "VITE_APP_AWS_AUTH_TOKEN\|execute-api" src` sin resultados,
  y el bundle de producción no contiene el token.

**P0.2 Quitar los tres dedupes del cliente.**
El servidor ya no duplica transacciones (§1), así que estos borrados sobran.
- `src/pages/device-options/OptionsMainPage.jsx:44-58`: `removeDuplicateEntries()`
  se llama **en el cuerpo del componente**, así que se ejecuta en cada render y
  lanza `DELETE`s sin `await` ni manejo de error. Borrar la función y su llamada.
- `src/pages/display-qr-code/DisplayQRCode.jsx`, `checkAndRemove` (`:153-195`):
  - `GET /consumer/users`: la app lee `data.stripeTransactions`, que **no existe
    desde julio**, porque esa ruta devuelve usuarios. Con eso, el bucle de
    `DELETE /stripe/remove-duplicate/:id` nunca borra nada.
  - `POST /transaction/transaction {event_id}` + `DELETE /stripe/removing/:id`:
    pide las transacciones de todo el evento para deduplicar.
  - Borrar `checkAndRemove` entero y su invocación.
- **Aceptación:** la app no llama a `/consumer/users`, `/stripe/remove-duplicate/`,
  `/stripe/removing/` ni `/transaction/remove-duplicate-transaction/`. Un pedido
  completo (QR → opciones → historial) muestra cada transacción una sola vez.

**P0.3 `POST /post/posts` sin operadores Mongo.**
- `src/pages/instructions/MainPage.jsx:132` manda `displayed_in: { $in: [event.id] }`.
- Cambiarlo a `displayed_in: event.id`. Si `displayed_in` es un array en Mongo, la
  igualdad con un valor ya hace "contiene", así que el resultado es el mismo.
- Motivo: la Fase 3.4 rechazará operadores en el carril sin sesión, y entonces esta
  pantalla se quedaría vacía.
- **Aceptación:** las instrucciones del evento se siguen mostrando con el cuerpo nuevo.

### P1: adelantar lo que romperán las fases pendientes del servidor

**P1.1 `PATCH /auth/:id` no debe cambiar el email.**
- `src/pages/profile/ConsumerInfo.jsx:57` manda `name`, `lastName`, `email` y
  `phoneNumber`.
- La Fase 3.1 dejará de aceptar `email` sin sesión: el email es la llave con la que
  se buscan el consumidor y sus transacciones, y cambiarlo sin verificar el nuevo
  buzón permite apropiarse de una cuenta ajena.
- Hacer el email **de solo lectura** en el perfil y no mandarlo en el PATCH. Si se
  necesita cambiarlo, hay que pedírselo al backend como flujo propio, con verificación.
- Los demás PATCH (`AuthenticationLogin.jsx:306`, `CheckEventGroupName.jsx:42`,
  `ConsumerInfo.jsx:153`) siguen valiendo. En la Fase 3.1 los arrays (`provider`,
  `company_providers`, `event_providers` y `groupName`) solo **añadirán** elementos:
  mandar el array completo sigue funcionando, pero **quitar** un elemento dejará de
  tener efecto. Confirmar que la app nunca necesita quitar.

**P1.2 `POST /auth/new`: campos que ya no se guardan.**
- `ConsumerInitialForm.jsx:185` manda `group`. El modelo `User` no tiene `group`
  (se llama `groupName`), así que **hoy ya se descarta**. Si la intención es guardar
  el grupo, mandarlo como `groupName: [..]`. Si no, quitarlo.
- `category`: la Fase 3.1 lo fijará en el servidor (`"Regular"`). No depender de
  poder mandar otro valor.

**P1.3 `POST /cache_update/remove-cache` desde el login.**
- `AuthenticationLogin.jsx:170` manda la clave `company=…&type=event`. En la Fase 3.4
  el carril sin sesión solo aceptará el patrón del consumidor
  (`event_id=…&company=…&consumerInfo.id=…`, el de `DisplayQRCode.jsx:144`), así que
  esta llamada fallará **sin avisar**.
- Revisar para qué hace falta. Si es para ver eventos recién creados, se puede quitar:
  el servidor invalida esa caché al escribir.

**P1.4 Decirle al backend qué campos de `GET /stripe/payment_intents/:id` usa la app.**
- Hoy el servidor devuelve el PaymentIntent completo, **incluido `client_secret`**, a
  quien conozca el id. La Fase 3.3 lo recortará.
- La app lee `charges.data[0].payment_method_details.card` (marca y últimos 4),
  `charges.data[0].receipt_url` y `amount_capturable` (`OrderHistory.jsx:49,94`,
  `PaymentInformation.jsx:49`). Confirmar si lee algo más (`status`, `amount`,
  `created`…) y responder con la lista cerrada.
- **No quitar** el filtro `paymentIntent.length > 15 && !startsWith("pi_cash")` de
  `OrderHistory.jsx:90`. Con ids de 15 caracteres o menos (los `"pi_" + nanoid(12)`
  de los pedidos sin depósito miden exactamente 15), el servidor no responde y la
  petición cuelga hasta el 408.

**P1.5 Un solo camino para crear el cliente de Stripe.**
- Hoy hay dos: `POST /consumer/stripe/create-customer` (`useStripeAccount.js:55`) y
  `POST /stripe/customer` (`ConsumerInitialForm.jsx:228`). Van al mismo controlador,
  pero el segundo pasa por el límite de peticiones y la idempotencia del router de
  Stripe.
- Quedarse con `POST /stripe/customer` y borrar el otro uso. Así un mismo email no
  puede acabar con dos clientes por una carrera entre los dos caminos.

### P2: robustez

**P2.1 Push notifications.**
- `src/hooks/usePushSubscription.js:101,106,129` llama a `POST/PATCH /consumer/push/subscribe`
  y `POST /consumer/push/unsubscribe`, que **no existen** en el servidor: dan 404.
- Hasta que el backend las implemente (`docs/push-notifications-api.md`), desactivar
  la suscripción con un flag o tratar el 404 en silencio, sin mostrar errores al
  usuario ni reintentar.

**P2.2 Manejar los códigos nuevos sin romper la pantalla.**
- `400` en `/transaction/transaction` si se cuela un filtro no permitido: mostrar
  historial vacío y registrar el error, no dejar la pantalla en blanco.
- `200` (en vez de `201`) en `save-transaction` cuando ya existía: tratarlo como éxito.
  La app hoy no mira el código, así que no hay cambio; solo no empezar a exigir 201.

## 3. Esperar al backend (no hacer todavía)

| Endpoint | Fase | Qué cambiará | Qué tendrá que hacer la app |
|---|---|---|---|
| `POST /stripe/create-payment-intent` | 3.3 | El importe lo calculará el servidor a partir del evento | Mandar la selección (evento y dispositivo) en vez del importe. **Esperar al contrato** |
| `POST /consumer/stripe/find-customer` | 3.3 | Límite por email y respuesta mínima | Confirmar qué campos usa `useStripeAccount.js:29` |
| `POST /nodemailer/login-existing-consumer` | 4.4 | El servidor firmará el enlace | Dejar de mandar `link`; la página de destino leerá un token |
| `POST /receiver/receiver-assigned-list` | 3.2 | Exigirá consumidor y evento | Nada: la app ya manda `{ user, eventSelected }` |
| `POST /cloudinary/upload-image` | 3.4 | Límites de tipo, tamaño y peticiones por IP | Validar tipo y tamaño en el cliente antes de subir |

## 4. Orden sugerido

1. P0.1 (token de AWS): hoy mismo, y la rotación en paralelo.
2. P0.2 y P0.3: un solo PR, porque los dos quitan código y se prueban con el mismo
   flujo de pedido.
3. P1.1 y P1.2: perfil y registro.
4. P1.3, P1.4 y P1.5.
5. P2.

Cuando haya PR de P0.2, avisar al backend: con los dedupes fuera, el servidor puede
cerrar `DELETE /stripe/remove-duplicate/:id`, `/stripe/removing/:id` y
`/transaction/remove-duplicate-transaction/:id` sin afectar a nadie.

## 5. Anexo: cuerpos actuales de `POST /transaction/transaction` (todos válidos)

| Dónde | Cuerpo | Qué devuelve ahora |
|---|---|---|
| `OptionsMainPage.jsx:25` | `{ "consumerInfo.email", event_id }` | Transacciones del consumidor en el evento, sin `clientSecret` |
| `OrderHistory.jsx:25` | `{ "consumerInfo.email", created_at: { $gte: <ms> } }` | Las del último año, sin `clientSecret` |
| `PaymentInformation.jsx:19` | `{ company, event_id, "consumerInfo.email" }` | Las del consumidor en el evento, sin `clientSecret` |
| `DisplayQRCode.jsx:156` | `{ event_id }` | Solo `id`, `paymentIntent` y `event_id` de todo el evento. **Se elimina con P0.2** |

Nota sobre `created_at`: el modelo `Transaction` lo rellena con la hora de arranque
del servidor, no con la de creación (bug conocido del backend, sin arreglar). El
filtro del último año de `OrderHistory` puede incluir o excluir transacciones de
forma imprecisa hasta que se corrija.
