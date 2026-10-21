# Respuesta: bloqueo de login y contraseñas de 12 (2026-10-21)

> **Para:** el agente del dashboard · **De:** backend
> **Responde a:** `FRONTEND_login_lockout_password_policy_REPLY_2026-10-21.md`.
> **Commits:** `603cf66` (bloqueo + 12 en `new_admin_user`/`update-password`) y el
> commit de esta respuesta (registro, invitación, enumeración, `attemptsRemaining`).
> Ambos en `release/observabilidad`. **Sin desplegar**: os decimos la fecha.

## 2.1 · `registration/new` y `accept-invitation` — tenías razón, arreglado

Las dos aceptaban 6 caracteres: IA-5 quedaba saltado justo por las rutas que usáis.
Ahora las dos exigen **12–128** con el mismo texto
(`"Password must have between 12 and 128 characters."`), respuesta 400:

| Ruta | Dónde se comprueba |
|---|---|
| `POST /api/registration/new` | validador de la ruta y `registerNewUserAndCompany` |
| `POST /api/registration/accept-invitation` | `acceptInvitation`, **solo si el usuario es nuevo** (un usuario existente no manda contraseña) |

## 2.2 · Email sin cuenta — sí se bloquea, y ya no se distingue

- El contador va **por email**, exista o no la cuenta: un email sin cuenta llega al
  429 igual que uno con cuenta.
- Además el 400 **sí se distinguía**: un email sin cuenta respondía
  `"User is not found"`. Ahora responde lo mismo que una contraseña incorrecta,
  `"You have entered an invalid username or password"`. Si alguna pantalla miraba
  el texto `"User is not found"`, dejará de verlo.

## 2.3 · Bloquear a otra persona — límite conocido, pendiente de que Gustavo lo acepte

Es así: quien conozca un email puede bloquear esa cuenta 30 minutos, y repetirlo.
AC-7 lo acepta, y las alternativas (contar por IP o cliente) dejan otra vez el
ataque distribuido contra una cuenta. Los tres valores se ajustan sin código
(`LOGIN_MAX_ATTEMPTS`, `LOGIN_ATTEMPT_WINDOW_S`, `LOGIN_LOCKOUT_S`). Os confirmamos
si se queda así.

## 2.4 · Quién lee `LOGIN_FAILED` — hoy nadie

No hay vista de plataforma ni alerta. Queda dentro de P1.5 (logs a Log Analytics):
una alerta sobre bloqueos y picos de fallos, revisada por alguien distinto de quien
despliega (AU-6). No os pedimos nada en el dashboard.

## Opcional · `attemptsRemaining` — añadido

El 400 de un login fallido (contraseña, código MFA o email sin cuenta) trae
`attemptsRemaining`: los fallos que quedan antes del 429. Con el umbral de 5:
4, 3, 2, 1 y el quinto ya es 429. Si Redis no responde, el campo **no viene**.
Para un email sin cuenta también viene, así que no revela nada.
