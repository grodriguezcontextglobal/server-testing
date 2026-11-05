# Contraseñas: reset con MFA y fin del hash en el cliente (2026-10-13)

## Por qué

- `GET /api/staff/__staff-search` era anónima y devolvía **todos** los usuarios
  **con el hash de su contraseña**. Cualquiera podía descargarlos.
- `PATCH /api/admin/update-password` cambiaba la contraseña de cualquier cuenta
  sabiendo solo el email.
- El enlace del reset lo armaba el navegador y se validaba ahí (`stamp-time`),
  así que se podía fabricar. Ahora lo arma y firma el servidor (ver § 0).
- "Mi contraseña" y la verificación de firma comparaban la contraseña actual
  contra el hash **en el navegador** (`compareSync`).

**Desplegar el servidor y el dashboard a la vez:** sin los cambios de abajo,
las 5 pantallas afectadas fallan.

## Cambios de contrato

### 0. `POST /api/nodemailer/reset-admin-password`: el enlace lo arma el servidor

- El body puede seguir igual, pero `linkToResetPassword` y `link` **se ignoran**.
  El servidor busca la cuenta por `contactInfo.email`, firma un token y arma:
  `https://admin.devitrak.net/reset-password?token=<jwt>&uid=<id>&email=<email>&stamp-time=<ISO>`
  (el origen sale de `FRONTEND_URL` en el servidor).
- El `token` vale **1 hora** y **un solo uso**: deja de valer en cuanto la
  contraseña cambia.
- Email sin cuenta: misma respuesta `202`, pero no se envía nada.
- `ResetPassword.jsx` tiene que leer `token` de la URL y mandarlo como
  `resetToken` en `update-password`.

### 1. `PATCH /api/admin/update-password` (sigue sin token)

```json
{ "uid": "<id del enlace>" , "password": "nueva", "mfaCode": "123456" }
{ "email": "a@b.com",        "password": "nueva", "mfaCode": "123456" }
{ "resetToken": "<token del enlace>", "password": "nueva", "mfaCode": "123456" }
```

Desde `/reset-password` hay que mandar **`resetToken`**. Si llega, la cuenta
sale del token y `uid`/`email` se ignoran.

Hay que mandar `uid` o `email`, más `password` (mínimo 6 caracteres) y `mfaCode`
(el código de la app autenticadora).

| Respuesta | Cuándo | Qué mostrar |
|---|---|---|
| `201` | Contraseña cambiada | Ir a login. **Las sesiones abiertas de esa cuenta quedan cerradas** (se invalidan los tokens) |
| `403` + `mfaSetupRequired: true` | La cuenta no tiene MFA activa. Se responde **antes** de pedir el código (llegue o no `mfaCode`) | Informar que debe **activar MFA** y luego **volver a enviar la solicitud**. No pedir el código |
| `403` + `mfaSetupRequired: true` + **`mfaSetupToken`** | Lo mismo, pero la petición traía un `resetToken` válido | Abrir el modal de configuración con `x-mfa-setup-token` (como en el login) y reenviar con `resetToken` + `mfaCode` |
| `400` + `resetLinkInvalid: true` | `resetToken` falso, caducado o ya usado | "El enlace no es válido o caducó; pide uno nuevo" |
| `403` + `mfaRequired: true` | Falta `mfaCode` (cuenta con MFA, o email desconocido) | Pedir el código |
| `400` "Invalid email or MFA code" | Código incorrecto **o** cuenta inexistente (misma respuesta a propósito) | "Código o cuenta no válidos" |
| `400` | Falta `uid`/`email` o la contraseña tiene menos de 6 caracteres | Validación |

### 2. `GET|POST /api/staff/__staff-search` (sigue sin token)

- **Ahora exige `email`:** en el body para el POST, en `?email=` para el GET.
  Sin email responde `400`; ya **no** devuelve la lista completa.
- La respuesta mantiene la misma forma, `{ ok, adminUsers: [...] }`, pero cada
  usuario trae **solo** estos campos: `id`, `name`, `lastName`, `email`,
  `imageProfile`, `active` y `companiesAssigned`.
- La búsqueda es por email exacto. Se quitan los espacios de los extremos; las
  mayúsculas no se normalizan.

### 3. `POST /api/admin/verify-password` (NUEVA, con token)

```json
{ "password": "contraseña actual" }   →   { "ok": true, "valid": true | false }
```

Comprueba la contraseña **del usuario del token**. Sustituye a todo
`compareSync` del cliente.

### 4. `password` ya no viene en ninguna respuesta

Esto afecta a `/staff/admin-users`, `entire` del login y cualquier `AdminUser`
que devuelva el servidor. Todo código que lea `.password` de un usuario recibe
`undefined`.

## Pantallas a cambiar

| Pantalla | Hoy | Cambio |
|---|---|---|
| `authentication/ForgotPassword.jsx` | `GET /staff/__staff-search` (lista entera) y busca el email en el cliente | `POST /staff/__staff-search` con `{ email }`; usar `adminUsers[0].id` para el enlace |
| `authentication/ResetPassword.jsx` | Baja la lista para sacar el email del `uid`; valida `stamp-time` en el cliente | Mandar `{ resetToken, password, mfaCode }` a `update-password` (`resetToken` = `?token=`). Con `mfaSetupToken` en el 403, abrir el modal de MFA. `stamp-time` es solo un aviso |
| `Profile/my_password/components/Body.jsx` | `POST /staff/admin-users` + `compareSync` contra el hash | Pedir el código MFA y mandar `{ email, password, mfaCode }` a `update-password`. Si además quieren pedir la contraseña actual: `POST /admin/verify-password` |
| `signatureVerificationDocuments/StaffMember.jsx` | `compareSync(current_password, staffMemberInfo.password)` | `POST /admin/verify-password` y usar `valid` |
| `InvitationLanding.jsx`, `Registration.jsx` | `POST /staff/__staff-search` con `{ email }` | **Sin cambios**, siguen funcionando (solo usan campos públicos). La invitación a un usuario existente **no** necesita `mfaSetupToken`: después de aceptar va a `/login`, y el login con contraseña ya lo entrega a una cuenta sin MFA |

Cuando el login se pida otra vez después de un `201` en `update-password`, no
habrá conflicto de "sesión activa": el servidor borra la sesión al cambiar la
contraseña.
