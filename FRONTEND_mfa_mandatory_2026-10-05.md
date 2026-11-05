# MFA obligatoria para staff — 2026-10-05

Rama `feat/mfa-mandatory`, ya mergeada en `release/observabilidad`.
**Cambio de contrato en el login, el alta y la renovación.** Una cuenta sin MFA
ya **no recibe token de sesión**: tiene que enrolarse primero.

## ⚠️ El dashboard actual NO es compatible: hay que cambiar tres cosas

El dashboard (`main`, desde el 2026-09-21) ya obliga a enrolarse, pero lo hace
**después** de que el servidor emitiera la sesión: guarda el `token` del login y
lo usa para `/mfa/generate` y `/mfa/verify`. Ese token ya no llega. Con el
dashboard tal como está, **una cuenta sin MFA no puede entrar**:
`handleLoginFailure` no reconoce `mfaSetupRequired`, muestra el mensaje y vuelve
al email.

Lo que **no** hay que tocar: `MfaEnrollmentModal.jsx` ni `mfaRequestConfig`. El
servidor acepta el token de enrolamiento también en `x-token`, que es lo que
manda el modal. Basta con pasarle `mfaSetupToken` donde hoy recibe el `token`.

1. **`src/pages/authentication/Login.jsx` — abrir el modal desde el 403.**
   En `handleLoginFailure`, antes del resto, si
   `error.response?.status === 403 && responseData?.mfaSetupRequired`: guardar
   `responseData.mfaSetupToken` en un estado y abrir `MfaEnrollmentModal` con
   `authToken={ese token}`, en vez de `pendingLogin.current?.loginResponse?.data?.token`.
   La rama de `needsMfaEnrollment(loginResponse.data)` en el login con éxito deja
   de dispararse: una cuenta sin MFA ya no llega a un 200.
2. **`Login.jsx` — `handleMfaEnrolled`: volver a loguearse con el código.**
   Ya no hay respuesta de login guardada que continuar (`continueAfterAuthentication`
   con `markEnrolled`). Al terminar el enrolamiento la cuenta ya tiene MFA, así
   que basta con `goToStep(LOGIN_STEPS.MFA)`: el paso de código que ya existe
   reenvía el login con `mfaCode` y recibe la sesión normal. `markEnrolled` deja
   de hacer falta, porque esa respuesta ya trae `mfaEnabled: true`.
3. **`src/pages/authentication/RegisterCompany.jsx` — línea ~285.**
   `setEnrollmentToken(apiResponse.token)` → `setEnrollmentToken(apiResponse.mfaSetupToken ?? apiResponse.token)`.
   El registro ya no devuelve `token`; sin este cambio el modal no se abre.

El botón de cancelar del modal sigue funcionando igual: el servidor no abrió
ninguna sesión, así que cancelar no deja nada abierto.

## El flujo nuevo

```
POST /api/admin/login { email, password }
  ├─ cuenta CON MFA   → 403 { mfaRequired: true }   (como hasta ahora)
  │                     → repetir con { ..., mfaCode } → 200 { token, ... }
  └─ cuenta SIN MFA   → 403 { mfaSetupRequired: true, mfaSetupToken }   ← NUEVO
        │
        ├─ POST /api/admin/mfa/generate        header x-mfa-setup-token: <mfaSetupToken>
        │     → 200 { secret, qrCode }         (mostrar el QR)
        ├─ POST /api/admin/mfa/verify { token: "<código de 6 dígitos>" }
        │                                      header x-mfa-setup-token: <mfaSetupToken>
        │     → 200 { ok, reloginRequired: true }
        └─ POST /api/admin/login { email, password, mfaCode } → 200 { token, ... }
```

- **`mfaSetupToken`** dura **15 minutos** y solo vale en `/mfa/generate` y
  `/mfa/verify`, en el header **`x-mfa-setup-token`** (no en `x-token`). En
  cualquier otra ruta da 401. Si caduca, el usuario vuelve a loguearse y recibe
  otro.
- **`/mfa/verify` no devuelve sesión.** Tras activar la MFA hay que volver a
  llamar al login con el código. Podéis hacerlo de forma transparente: ya tenéis
  email y contraseña en el formulario y el código recién verificado. Ojo: un
  código TOTP vale ~30 s, así que si el segundo login falla por código, pedid
  uno nuevo.
- Los dos 403 del login se distinguen por la clave: `mfaRequired` (pedir código)
  frente a `mfaSetupRequired` (llevar a la pantalla de enrolamiento). **No trates
  cualquier 403 del login como "pedir código".**

## Otros cambios

| Endpoint | Antes | Ahora |
|---|---|---|
| `POST /api/admin/new_admin_user` (alta) | `201 { token }` + cookie | `201 { mfaSetupRequired: true, mfaSetupToken }`, sin `token` ni cookie |
| `POST /api/registration/...` (registro con compañía) | `201 { token, user, company }` | `201 { mfaSetupRequired: true, mfaSetupToken, user, company }`, sin `token` |
| Renovación de token (`renewToken`) | renovaba siempre | `403 { mfaSetupRequired: true }` si la cuenta no tiene MFA → mandar al login |
| `POST /api/admin/mfa/generate` con MFA ya activa | sobrescribía el secreto | `409`. Rotar la MFA no está soportado por ahora |
| `POST /api/admin/mfa/verify` sin haber generado | 500 | `400 "Generate an MFA secret first."` |
| `POST /api/admin/mfa/disable` | desactivaba | `403 "MFA is mandatory and cannot be disabled."` → **quitad el botón** |

`/mfa/generate` y `/mfa/verify` siguen aceptando también un JWT de sesión
normal (`x-token`).

## Qué pasa con quien ya está logueado

Las sesiones abiertas antes del despliegue siguen valiendo hasta que caduquen (12 h,
o 30 días con "recordarme"), pero **no se renuevan**: la renovación da 403
`mfaSetupRequired`. Al volver a entrar, el login los manda a enrolarse. Si
queréis empujarlos antes, mostrad el enrolamiento a quien tenga
`entire.mfaEnabled === false`. Usad un JWT de sesión con `/mfa/generate` y
`/mfa/verify`, que siguen aceptándolo.

## Checklist

- [ ] El login distingue `mfaRequired` de `mfaSetupRequired`
- [ ] Pantalla de enrolamiento: QR de `/mfa/generate`, código a `/mfa/verify`, con `x-mfa-setup-token`
- [ ] Tras `reloginRequired`, nuevo login con `mfaCode`
- [ ] El alta y el registro con compañía llevan al enrolamiento en vez de entrar
- [ ] La renovación con 403 `mfaSetupRequired` manda al login
- [ ] Fuera el botón de desactivar MFA
