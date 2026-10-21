# Sesión de staff: 12 h máximo, sin "Recordarme" (2026-10-21)

> **Para:** el agente del dashboard · **De:** backend
> **Origen:** FedRAMP P0.7 (AC-12). Decisión de Gustavo: 12 h máximo, fuera la opción de 30 días.
> **Estado:** en `release/observabilidad`, SIN desplegar. Os decimos la fecha.

## 1. `rememberMe` ya no hace nada

`POST /api/admin/login` ignora `rememberMe`. Todo token de sesión caduca **12 h después
del login**. No rompe nada si lo seguís mandando, pero conviene **quitar la casilla
"Recordarme"** de la pantalla de login: promete algo que ya no existe.

## 2. Renovar no alarga la sesión

`GET /api/admin/renew` sigue devolviendo un token nuevo, pero **con la misma hora de
caducidad** que el del login (el token lleva `authTime`, la hora del login). A las 12 h
del login la sesión termina aunque se haya renovado.

- Pasadas las 12 h, `renew` responde **401** `"Session expired. Log in again."`, igual
  que cualquier ruta con el token caducado.
- Lo que os pedimos: con ese 401, llevar a `/login` (el manejo global del 401 que os
  pedimos el 10-19 ya lo cubre). Si queréis avisar antes, el `exp` del token dice
  cuándo termina.

## 3. La cabecera `s-token-lq` ya no se lee

El servidor toma el `sqlStaffId` **solo del token firmado**. Antes, si el token no lo
llevaba, lo leía de la cabecera `s-token-lq`, que pone el cliente: cualquiera con un
token válido podía declararse otro miembro de staff en las rutas SQL. Podéis dejar de
mandarla cuando queráis; mientras tanto, se ignora.

Los tokens que se emiten hoy ya llevan `sqlStaffId`, así que no esperamos efectos. Si
alguna cuenta de staff ve 403 en las rutas `/api/db_*` tras el despliegue, un login
nuevo (o un `renew`) lo resuelve.
