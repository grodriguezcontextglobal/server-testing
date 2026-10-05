# Registro de actividad en el servidor — respuesta al dashboard, 2026-10-05

> Responde a `FRONTEND_activity_log_backend_ask_2026-10-05.md`.
> Rama `feat/server-audit-trail`, sobre `release/observabilidad`. **Sin desplegar
> todavía**: os avisamos cuando lo esté (ver §5).

## 1. Qué hemos hecho

Un middleware de auditoría, como proponíais, pero con la lista al revés: **se
registra toda acción que cambia algo**, y la lista es la de lo que **no** se
registra.

- **Un único punto:** `middlewares/auditTrail.js`, montado una vez en `index.js`,
  antes de los routers. Decide al terminar cada respuesta, cuando Express ya sabe
  qué ruta casó y con qué status.
- **Se registra toda escritura** (POST/PUT/PATCH/DELETE) que termine bien, salvo:
  - las consultas que van por POST (`consulting-*`, `retrieve-*`, `*-query`,
    listados, búsquedas);
  - lo que su controlador ya registraba (no se duplica);
  - lo que es en sí un registro (logs de error, de notificaciones…).
- **Verbos:** `constants/auditedRoutes.js` pone nombre a ~260 acciones
  (`ASSIGN Device`, `CHECK_OUT Inventory`, `IMPORT Inventory`, `SEND Email`,
  `REFUND Transaction`…). Una ruta nueva que nadie haya clasificado **se registra
  igual**, con un verbo deducido de su nombre y `details.inferred: true`.
- **Cobertura comprobada:** un test exige que las **413** rutas de escritura que
  hay hoy estén clasificadas. Ninguna ruta nueva llega a producción sin que
  alguien decida cómo se registra.
- **Correos:** cada envío desde `/api/nodemailer/*` es `SEND Email`, con los
  destinatarios en `context.recipients`.
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
| Cambiar la información de items | `edit-item`, `update-items-based-on-serial-number`, `update-group-items`, `update-all-items-in-inventory`, `update-large-data`… | `UPDATE Inventory` |
| Importar items desde Excel | `POST /api/db_item/bulk-item-from-spreadsheet` | `IMPORT Inventory` |
| Exportar el inventario | `POST /api/db_item/inventory-export` | `EXPORT Inventory` |
| Borrar un item (`/db_item/${id}`) | `POST /api/db_item/:id(\d+)` | `DELETE Inventory` |
| Enviar un correo | cualquier `POST /api/nodemailer/*` | `SEND Email` |
| Asignar un dispositivo a un consumidor | `POST /api/receiver/receiver-assignation` | `ASSIGN Device` |
| Devoluciones | `returning-item*`, `return-event-devices`, `confirm-item-return`, `transaction-all-items-returned-at-once`… | `RETURN` |

## 2. Lo que trae cada registro (campos nuevos)

### Para pintar: `actor` + `summary` (añadido 2026-10-05, tarde)

Cada registro trae ya la frase hecha. **Pintad `actor.name` (`actor.email`)
seguido de `summary`, y `target_label` como etiqueta**. No hace falta componer
nada a partir de `action` + `target_model`:

> **Gustavo Santeliz** (gars…@gmail.com) — Returned device SN-100006 from
> ana@x.com at event TEST _ 2 · `SN-100006` · 5 Oct, 15:05

```json
{
  "actor": { "name": "Gustavo Santeliz", "email": "gars…@gmail.com" },
  "summary": "Returned device SN-100006 from ana@x.com at event TEST _ 2",
  "target_label": "SN-100006",
  "action": "RETURN",
  "target_model": "Device"
}
```

- **`actor`** es quién era el autor en ese momento. Usadlo antes que el
  `staff_member_id` populado, que se queda vacío si la cuenta se borra.
- **`summary`** sale en inglés, como el resto del dashboard. No incluye al
  autor.
- **`action`** puede no coincidir con el nombre de la ruta.
  `PATCH /receiver/receiver-update/:id` con `device.status: false` se registra
  como **`RETURN`**, y con `true` como **`ASSIGN`**: es lo que pasó, no lo que
  dice la URL. El filtro por acción lo respeta.
- **Acciones automáticas**: la limpieza de caché que hace el dashboard después
  de cada acción se registra con `summary` "Refreshed cached data (automatic,
  after an action)". Si molesta en la lista, ocultad `target_model: "Cache"`.
- **`ACTIVITY_LOG_ACTIONS`** del dashboard (el desplegable de acciones) se ha
  quedado corto. La lista completa la da `GET /api/admin/activity-logs/vocabulary`.

### Todos los campos

```json
{
  "staff_member_id": { "name": "…", "email": "…" },
  "actor": { "name": "…", "email": "…" },
  "summary": "…",
  "target_label": "…",
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
    "recipients": ["ana@x.com"],
    "count": 2
  },
  "details": {
    "route": "POST /api/receiver/receiver-assignation",
    "status": 201,
    "request": { "…": "el body de la petición, sin secretos" },
    "company_inferred": true,
    "inferred": true
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
- **`details.inferred: true`**: la ruta no tenía verbo asignado y se dedujo de su
  nombre. Pintadla con `details.route` si el verbo no os sirve.
- **`context.recipients`**: solo en correos (`SEND Email`).

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
3. **Correos (`/api/nodemailer`)**: sí, todos. Cada envío es `SEND Email`, con
   los destinatarios en `context.recipients` y el tipo de correo en
   `details.route`. La única excepción es `branding-preview`, que solo
   previsualiza y no envía. Los consentimientos (`consent/request`, `resend`)
   son `SEND Consent`.
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
