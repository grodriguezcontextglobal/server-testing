# Respuesta: lo que el dashboard espera del servidor (2026-10-16)

> **Para:** el agente del dashboard · **De:** backend
> **Responde a:** `FRONTEND_backend_pending_2026-10-15.md` (revisado el 2026-10-16).
> **Servidor:** `release/observabilidad`. Ningún commit de este documento está
> desplegado todavía (ver W1).
>
> **⚠ BORRADOR:** lo marcado con 🔶 espera la decisión de backend (Gustavo).

Vuestro §2 (lo hecho) está bien verificado; no lo repetimos. Abajo, la lista de
trabajo por número, y lo que salió en release después de vuestra revisión.

---

## W1. Despliegue 🔶

- **Qué commit corre prod y fecha del próximo despliegue:** pendiente; lo confirma
  Gustavo desde la VM. Lo actualizamos aquí en cuanto lo tengamos.
- Todo lo de esta lista y de vuestro §2 posterior al 2026-10-13 está **solo en
  release**. Además, desde vuestra revisión (`3f5192e`) entró esto, que os afecta:

| Commit | Qué | Qué cambia para el dashboard |
|---|---|---|
| `90b9ac7` | `GET /stripe/payment_intents/:id`: expande `latest_charge` y rellena `charges.data[0]` | **Arreglo:** `FooterExpandedRow.jsx:135` (y cualquier lectura de `charges.data[0]`) mostraba *"ending in: undefined"*, porque la API de Stripe fijada por el SDK (`2025-02-24.acacia`) ya no trae `charges`. Vuelve a funcionar sin cambios. Con sesión de staff sigue llegando el objeto entero, más campos planos nuevos (`card`, `receiptUrl`, `amountCapturable`). **Sin sesión desde el dashboard: 401.** Todas vuestras llamadas son de páginas con sesión, así que no os afecta |
| `89429ea` | `phoneNumber` del consumidor pasa a texto | **Arreglo:** crear un consumidor desde el dashboard con teléfono con formato (`"555-1017"`) o sin teléfono daba **500** desde julio |
| `d4fbe2d`, `5a0c25c` | Transacciones: sesión obligatoria en 6 rutas y dos carriles en 3 | Ya lo tenéis en §2. Desde el dashboard sin sesión: 401 |

## W2. `/send` que se pueda repetir 🔶

**Todavía no está hecho.** Propuesta, para que digáis si os sirve antes de
implementarla:

- El servidor recuerda cada invitación **viva** (evento + miembro) mientras su enlace
  no caduque.
- Un `/send` repetido para un miembro con invitación viva **no reenvía**. Su fila en
  `results` sale `{ member_id, ok: true, skipped: "already_invited" }`. Así, un
  reintento tras un timeout parcial es seguro y la cuenta `sent` solo incluye los
  correos que salieron de verdad.
- Para reenviar a propósito (el tutor perdió el correo), `resend: true` en el body:
  envía un enlace nuevo y el anterior deja de valer.
- Elegimos esto en vez de `Idempotency-Key` porque el riesgo es por miembro, no por
  petición: con una clave por petición, un lote reintentado con otra selección
  volvería a escribir a quien ya tenía invitación.

## W3. Contrato regenerado ✅

Regenerado hoy con `scripts/extract-api-payloads.js --json`:
`docs/api-payloads.json`, `docs/api-payloads.md` y `docs/api-payloads.d.ts`.
Commit: el mismo que este documento. Tomad el `.json` de ahí para vuestro
`src/docs/`.

- **507 endpoints montados**, 457 con payload detectado.
- Ya incluye `verify-password`, `/school/event-invitations/send|confirm|response`,
  `/school/reminders/stop|resume` y `PUT /document/:id`.
- El script se rompía con un nombre de handler que no era un identificador; está
  arreglado en el mismo commit.
- **Dos límites conocidos de la columna de autenticación:** muestra el nombre de un
  array de middlewares sin expandirlo (`canManage`, `staffOnly`; los dos llevan
  `validateJWT`), y no refleja lo montado a nivel de router (`router.use(optionalJWT)`
  en `/api/stripe`). No uséis esa columna para decidir si una ruta es anónima.

## W4. Forma de `GET /api/admin/activity-logs` ✅

```json
{
  "ok": true,
  "total": 132,
  "page": 1,
  "totalPages": 3,
  "logs": [
    {
      "id": "6710…",
      "staff_member_id": { "_id": "…", "name": "Gustavo", "lastName": "Rodriguez", "email": "g@…", "role": "…" },
      "actor_type": "staff",
      "actor": { "name": "Gustavo Rodriguez", "email": "g@…" },
      "summary": "Returned device SN-100006 from ana@x.com at event TEST _ 2",
      "target_label": "SN-100006",
      "display": {
        "who":   { "name": "Gustavo Rodriguez", "email": "g@…", "kind": "staff" },
        "what":  { "action": "RETURN", "verb": "Returned", "object": "device SN-100006", "model": "Receiver" },
        "how":   { "method": "PATCH", "endpoint": "/api/receiver/receiver-update/:id", "operation": "…",
                   "fields": [{ "label": "Status", "value": "returned" }] },
        "whom":  { "kind": "consumer", "label": "ana@x.com" },
        "where": { "event": "TEST _ 2", "company": "Test Company" },
        "when":  "2026-10-15T19:05:12.000Z"
      },
      "action": "RETURN",
      "target_model": "Receiver",
      "target_id": "…",
      "context": { "event_id": "…", "event_name": "TEST _ 2", "consumer": "ana@x.com", "serial_numbers": ["SN-100006"] },
      "details": { "…": "…" },
      "source": "server",
      "company_id": "…",
      "ip_address": "…",
      "device_info": "…",
      "timestamp": "2026-10-15T19:05:12.000Z"
    }
  ]
}
```

- `display.whom` y `display.where` pueden ser `null`. `display.how.fields` sale del
  payload de la petición, ya con nombres legibles.
- Para una acción sin sesión: `actor_type: "anonymous"`, `staff_member_id: null`, y
  el email al que se mandó el enlace en `actor.email` (por ejemplo, las respuestas a
  invitaciones de evento).
- **Mantened vuestro resumen como respaldo:** los registros anteriores al 2026-10-05
  no tienen `summary` ni `display` (el backfill no se ha corrido), y los que manda el
  cliente (`source: "client"`) tampoco.
- `source`: `"server"` = audit trail automático, `"client"` = vuestro
  `POST /activity-logs`, sin valor = registro explícito de un controlador.

## W5. Backfill del alcance por locación Mongo → SQL 🔶

**No está hecho, y no hay script.** Plan: un script que por defecto solo cuenta y
lista (dry-run) a quien tiene `preference.managerLocation` en Mongo y le faltan filas
en SQL, y que con `--apply` las crea. Se corre en prod con el visto bueno de
Gustavo, y os pasamos el recuento.

## W6. Dos preguntas sobre invitaciones firmadas 🔶

1. **¿El control por `STAFF_ORIGINS` es un límite aceptado?** **Sí.** El `Origin` lo
   falsea cualquier script, así que no es un control de seguridad. Lo que respalda
   las 4 rutas genéricas es que el carril sin sesión está acotado por sí mismo
   (búsqueda solo por email exacto y sin notas, sin borrados), y que la respuesta del
   tutor ya va por `/confirm` con token de un solo uso. El control por origen solo
   sirve para que el dashboard sin sesión reciba 401 en vez de un carril recortado.
2. **Caducidad atada al evento:** **aceptada**, como el **menor entre 5 días y el fin
   del evento**. **`/preview`:** **rechazada** por ahora. **`member:notify`:**
   **rechazada**: ese permiso no existe en `role_permissions` y habría que crearlo y
   asignarlo rol por rol. Se retoma con los roles personalizados.

## W7. Rechazar un documento caducado al asignarlo

**No está hecho**, prioridad baja. Responderá **422** (`"This document expired on
<fecha>"`) en la ruta de asignación cuando `expiration_date` sea anterior a hoy.

---

## Resumen

| # | Estado | Commit |
|---|---|---|
| W1 | 🔶 Esperando el commit de prod y la fecha | — |
| W2 | 🔶 Propuesta; sin código | — |
| W3 | ✅ Hecho | este documento |
| W4 | ✅ Respondido | — |
| W5 | 🔶 Plan; sin script | — |
| W6 | 🔶 Respondido, pendiente de confirmar | — |
| W7 | Pendiente, prioridad baja | — |
