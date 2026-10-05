# Registro de actividad en el servidor — respuesta al dashboard, 2026-10-05

> Responde a `FRONTEND_activity_log_backend_ask_2026-10-05.md`.
> Rama `feat/server-audit-trail`, sobre `release/observabilidad`. **Sin desplegar
> todavía**: os avisamos cuando lo esté (ver §5).

## 1. Qué hemos hecho

Lo que proponíais: un middleware de auditoría con una lista explícita de las
rutas que cambian datos.

- **Un único punto:** `middlewares/auditTrail.js`, montado una vez en `index.js`,
  antes de los routers. Decide al terminar cada respuesta, cuando Express ya sabe
  qué ruta casó y con qué status.
- **Lista explícita:** `constants/auditedRoutes.js`, con **~200 rutas** y su verbo
  y modelo (`ASSIGN Device`, `CHECK_OUT Inventory`, `REFUND Transaction`…). Las
  consultas por POST (`consulting-*`, `retrieve-*`, `*-query`, listados) quedan
  fuera, como pedíais. Un test comprueba que cada ruta de la lista existe de
  verdad, para que un renombrado no deje de registrar en silencio.
- **Solo lo que terminó bien** (status < 400).
- **El autor sale del JWT, nunca del cliente.** Hay rutas de escritura sin
  `validateJWT` (por ejemplo `receiver-assignation`). En esas, el middleware
  verifica vuestro `x-token` sin exigirlo: la acción queda atribuida y la ruta no
  cambia de contrato. Sin token válido, el registro se guarda igual con
  `actor_type: "anonymous"`.
- **Mismo almacén** que lee `GET /api/admin/activity-logs`.

### Las acciones del ejemplo

| Acción | Ruta | Se registra como |
|---|---|---|
| Crear evento | `POST /api/event/create-event` | `CREATE Event` (ya existía, sin cambios) |
| Asignar inventario al evento | `event_device`, `event_device_directly`, `allocate-device-event`, `inserting-items-in-event-from-container` | `ASSIGN Inventory` |
| Reservar / liberar para el evento | `reserve-items-for-event`, `lock-items-for-event` / `remove-reserved-items-for-event` | `RESERVE` / `RELEASE Inventory` |
| Salida del almacén | `POST /api/db_item/item-out-warehouse` | `CHECK_OUT Inventory` |
| Asignar un dispositivo a un consumidor | `POST /api/receiver/receiver-assignation` | `ASSIGN Device` |
| Devoluciones | `returning-item*`, `return-event-devices`, `confirm-item-return`, `transaction-all-items-returned-at-once`… | `RETURN` |

## 2. Lo que trae cada registro (campos nuevos)

```json
{
  "staff_member_id": { "name": "…", "email": "…" },
  "actor_type": "staff",
  "company_id": "665f0abc…",
  "company_sql_id": "137",
  "action": "ASSIGN",
  "target_model": "Device",
  "target_id": "88",
  "context": {
    "event_id": "701",
    "event_name": "…",
    "consumer": "ana@x.com",
    "member_id": "9",
    "serial_numbers": ["SN-1", "SN-2"],
    "item_ids": ["4567"],
    "count": 2
  },
  "details": {
    "route": "POST /api/receiver/receiver-assignation",
    "status": 201,
    "request": { "…": "el body de la petición, sin secretos" },
    "company_inferred": true
  },
  "source": "server",
  "timestamp": "…"
}
```

- **`staff_member_id`** puede venir `null` si `actor_type` es `"anonymous"`.
- **`context`** contiene lo que se pudo leer de la petición. Cada ruta nombra los
  campos a su manera (`event_id`, `eventId`, `serial_number`, `device`, listas de
  `items`/`devices`…), así que algunos registros traerán menos contexto. Para
  pintar "asignó 5 equipos al evento X": `count` + `context.event_name`, o
  `context.event_id`.
- **`details.request`** es el body con contraseñas, tokens, códigos y tarjetas
  sustituidos por `"[redacted]"`, las listas recortadas a 20 y el texto largo
  cortado.
- **`source`**: `"server"` (este middleware), `"client"` (vuestro
  `POST /activity-logs`) o vacío (los registros que ya hacían los controladores).
- **`details.company_inferred: true`**: la compañía no vino en la petición y se
  dedujo porque el autor pertenece a una sola. Ver §4.

## 3. Respuestas a vuestras preguntas

1. **¿Middleware o llamadas por controlador?** Middleware, con lista explícita.
   Las rutas que ya registraban a mano (login, force-logout, perfil, borrar staff,
   y create/edit/delete de `/api/event` y `/api/inventory`) siguen igual y **no**
   están en la lista, así que no hay duplicados.
2. **`controller/transactionAuditLog.js`** es otra colección distinta
   (`TransactionAuditLog`), que solo rellena el cliente con `POST`, guarda el body
   tal cual, sin autor, y no tiene filtros. **No** es el almacén de
   `activity-logs`. Las transacciones (crear, cobrar, capturar, cancelar,
   reembolsar) ahora las registra el servidor aquí. Os recomendamos dejar de
   escribir en `transaction-audit-log`.
3. **Correos (`/api/nodemailer`)**: no se registran. Son efecto de una acción
   que ya queda registrada. Lo que sí entra son los envíos que son una acción
   explícita de la persona: `consent/request` y `consent/resend` (`SEND Consent`).
4. **Filtros nuevos en `GET /api/admin/activity-logs`** (query string):
   - por evento: `event_id`;
   - por dispositivo: `serial_number` o `item_id`;
   - por persona afectada: `member_id`, `consumer`;
   - también `target_id`, `actor_type` y `source`.

   Siguen funcionando los anteriores (`staff_member_id`, `action`,
   `target_model`, fechas, paginación). El audit trail del dispositivo es
   `?serial_number=SN-1` (o `?item_id=`) ordenado por fecha.
5. **Llamadas a `registerStaffActivity` que debéis quitar** cuando se despliegue.
   Son las de las rutas que ahora cubre el servidor:
   - members: alta, edición, borrado, import;
   - préstamos: asignar, actualizar, devolver, borrar;
   - consentimientos: registrar, pedir, reenviar;
   - tutores: añadir.

   La lista completa está en `constants/auditedRoutes.js`. Hasta que las quitéis,
   esas acciones saldrán dos veces. Se distinguen por `source` (`server` frente a
   `client`).

## 4. Lo que necesitamos de vosotros

**Mandar `x-company-id` en todas las rutas `/api/*`, no solo en
`staff|admin|company|stripe|nodemailer`.** Hoy `/api/receiver`, `/api/event`,
`/api/document` y `/api/transaction` no llevan ninguna cabecera de compañía. Para
esas rutas el servidor deduce la compañía si el autor pertenece a una sola.
Si pertenece a varias, el registro queda **sin compañía**, y entonces solo lo ve
un super_user de plataforma en el reporte.

Es un cambio de una línea, en `COMPANY_ID_ROUTE` de `src/api/sessionHeaders.js`.
En `/api/db_*` basta con `s-company-lq`, que ya mandáis: el servidor lo traduce.

## 5. Despliegue

Pendiente de merge en `release/observabilidad`. No rompe nada del cliente: no
cambia ninguna respuesta, solo añade registros y campos. Avisaremos cuando esté
vivo, para que retiréis las llamadas del §3.5.
