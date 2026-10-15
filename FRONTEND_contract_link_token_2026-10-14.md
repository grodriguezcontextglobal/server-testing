# Dashboard: token del enlace en `/display-contracts` (2026-10-14)

Para el agente del dashboard. Viene de `FRONTEND_unauthenticated_routes_2026-10-14.md`
(grupo A, "Firma de contratos") y es la Fase 4.1 de
`PLAN_rutas_sin_autenticacion_2026-10-14.md` en el backend.

## Qué cambia

Hasta hoy, bastaba con conocer los ids de la URL de `/display-contracts`
(`company_id`, `consumer_member_id`, `verification_id`, `contract_url`) para
leer los datos del consumidor y firmar en su nombre.

Ahora el correo del contrato (`POST /api/nodemailer/liability-contract-consumer-email-notification`)
lleva **un parámetro más en la URL: `token`**. Lo firma el servidor, uno por
contrato, y:

- caduca a los **5 días** como mucho;
- se **gasta al firmar** (`PATCH /document/verification/consumer_member/signing_document`):
  un segundo intento responde **410**;
- solo vale para **ese** consumidor, compañía, verificación y contrato.

El backend solo pone el token si la petición del correo va con sesión de staff
(ya lo hace: `devitrakApi` manda `x-token`) y el `consumer.email` del body es el
que el consumidor tiene en BD. Si no cuadra, el correo sale igual, sin token.

## Qué tiene que hacer el dashboard

En `pages/authentication/signatureVerificationDocuments/Consumer.jsx`:

1. Leer el token de la URL, como los demás parámetros:
   ```js
   const linkToken = new URLSearchParams(window.location.search).get("token");
   ```
2. Mandarlo en la cabecera **`x-link-token`** en **las 6 llamadas** de la página:

   | Llamada | Línea aprox. |
   |---|---|
   | `POST /document/download/documentUrl` | 44 |
   | `POST /document/verification/consumer_member/check_signed_document` | 63 |
   | `POST /company/consumer-signatures` | 72 |
   | `GET /auth/${consumer_info}` (dos sitios) | 81, 131 |
   | `POST /company/signatures-for-consumer-member` | 160 |
   | `PATCH /document/verification/consumer_member/signing_document` | 148 |

   Por ejemplo: `devitrakApi.post(url, body, { headers: { "x-link-token": linkToken } })`.
   Si `linkToken` es null, no mandar la cabecera.

   La cabecera ya está permitida en CORS (`config/cors.js`).

3. Mensajes nuevos que puede devolver el servidor:

   | Código | `msg` | Qué mostrar |
   |---|---|---|
   | 401 | `A valid link from the email is required.` / `This link is not valid for this document.` | "Este enlace no es válido o caducó. Pide que te reenvíen el contrato." |
   | 410 | `This link has already been used.` | "Este contrato ya se firmó con este enlace." |
   | 409 | `This contract is already signed.` | Lo mismo que 410 |

   El orden actual de la firma (primero `signatures-for-consumer-member`,
   después `signing_document`) se mantiene: el token se gasta en el segundo.

## Calendario

- **Despliegue del backend:** `CONTRACT_LINK_MODE=warn`. Nada se rechaza: los
  correos ya enviados (sin token) siguen funcionando, y el servidor registra
  cada llamada que en `enforce` se habría rechazado.
- **Dashboard con el cambio de arriba desplegado.**
- **5 días después del despliegue del backend** (ya no queda vivo ningún enlace
  sin token): pasar a `CONTRACT_LINK_MODE=enforce`. Desde entonces, sin token
  válido → 401.

## Lo que NO cambia

- Con sesión de staff, las 6 rutas responden igual que hoy, con o sin token.
- `GET /auth/:id` y `POST /document/download/documentUrl` también las llama la
  app del consumidor (app.devitrak.net) sin token: a ella no se le pide nada.
  El token solo se exige cuando la petición viene de admin.devitrak.net sin sesión.
- La firma del **staff** (`StaffMember.jsx`) no cambia en esta fase: ya va con
  sesión + `verify-password`.

## Pregunta abierta

El correo de **member** (`liability-contract-member-email-notification`) arma
el enlace con `staff_member_id = member.member_id`, así que abre la página de
**staff** (`StaffMember.jsx`), que busca ese id en `/staff/admin-users`. ¿Ese
flujo funciona hoy? Si no, lo arreglamos junto con su token (Fase 4.2).
