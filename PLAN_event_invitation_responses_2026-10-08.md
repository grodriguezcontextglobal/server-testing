# Plan: registrar las respuestas del tutor a una invitación de evento (2026-10-08)

Responde a `FRONTEND_event_invitation_responses_2026-10-08.md`. Estado
verificado contra `release/observabilidad` (`56a3079`).

## 0. Qué hay hoy en el código

| Pieza que pide el dashboard | ¿Existe? | Dónde / nota |
|---|---|---|
| Ruta `POST /api/school/event-invitations/response` | **No** | Ninguna referencia a "event-invitation" en el repo |
| Almacén con autor anónimo | **Sí** | `models/StaffActivityLog.js`: `actor_type: staff \| anonymous`, `staff_member_id` opcional |
| Filtros por `event_id` / `member_id` | **Sí** | `context.event_id` / `context.member_id`; el GET ya filtra (`controller/staffActivityLog.js`) |
| `target_model: EventInvitation` | **No** | No está en `constants/activityVocabulary.js` (vocabulario publicado, con test) |
| Rate limit para escritura pública | **A medias** | Existe `publicNotificationRateLimit` (10/15 min por IP), demasiado justo para esto; `/consent/public/*` no tiene ninguno |
| Enlace firmado (fase 2) | **No** | El patrón existe: OTC del consentimiento (`mysql/helpers/consentOtc.js`, `otc_hash`) |

## 1. Trampas encontradas al revisar (cambian el diseño respecto a la propuesta)

1. **Sin `company_id`, la fila no la ve nadie.** El reporte solo muestra
   las filas sin compañía a su autor, y una fila anónima no tiene autor. Hay que
   guardar `company_id` = el **id de Mongo** de la compañía. El reporte lo
   reconoce: `keysOf` compara contra `String(company._id)`.
2. **No se puede reutilizar la protección de `/api/school`.** `requireIndustry`
   busca `company_info` por el `company_id` **numérico de MySQL**, y el enlace trae
   el de Mongo: respondería 404 a todo. La comprobación válida es la que pide el
   documento, que el evento exista y sea de esa compañía
   (`Event.findOne({ _id: event_id, company_id })`; `Event.company_id` es el id de
   Mongo).
3. **Doble registro.** El middleware global del audit trail registra toda
   escritura, aunque sea anónima. Si la ruta escribe su propia fila y además
   pasa por el middleware, salen dos. Hay que ponerla en `LOGGED_ELSEWHERE`
   (`constants/auditedRoutes.js`).
4. **`event_id` mal formado → 500.** Sin validar que sea un ObjectId, Mongoose
   lanza CastError. Hay que validarlo antes y responder 400.
5. **No fiarse del body para mostrar.** `event_name` se toma del evento en la
   base, no del body. El body se guarda tal cual en `details.request`, como
   pide el documento, pero marcado como **no verificado** (ver §4).

## 2. Fase 1: la ruta pedida (≈ medio día)

**Archivos:**
- nuevo `controller/eventInvitation.js`;
- `mysql/routes/school.js` (montar la ruta);
- `middlewares/notificationAuth.js` (limitador nuevo, o uno propio);
- `constants/activityVocabulary.js`;
- `constants/auditedRoutes.js`;
- nuevo `test/eventInvitationResponse.test.js`.

1. **Vocabulario:** añadir `'EventInvitation'` a `ACTIVITY_TARGET_MODELS`.
2. **Controlador `recordEventInvitationResponse`:**
   - **Obligatorios:** `company_id`, `event_id`, `member_email`, `responder_role` ∈ {guardian, member} y `response` ∈ {opened, confirmed, already_confirmed, failed}. Si falta alguno o el valor no es válido → 400.
   - **`event_id`:** tiene que ser un ObjectId válido; si no → 400.
   - **Topes de longitud:** emails ≤ 254, `reason` ≤ 500 (solo se guarda con `failed`), `event_name` ≤ 200. `member_id` puede ser `null` (enlaces anteriores a hoy).
   - **Evento:** `Event.findOne({ _id: event_id, company_id }).select('eventInfoDetail.eventName company_id')`. Si no existe → **404 y no se escribe**.
   - **Escritura:** `logStaffActivity` (por la cola, con reintentos):
     `{ actor_type: 'anonymous', company_id, action: 'CREATE', target_model: 'EventInvitation', target_id: event_id, actor: { email: responder_email }, context: { event_id, event_name: <de la base>, member_id }, details: { route, request: <body saneado>, verified: false, server_received_at }, ip_address, device_info, timestamp: <hora del servidor> }`.
   - **Respuesta:** `201 { ok: true }`, sin ningún dato del alumno.
3. **Ruta:** `router.post('/event-invitations/response', <limitador>, recordEventInvitationResponse)`, **sin** `validateJWT` ni `requireIndustry`. `auditPiiAccess` ya no hace nada sin `req.uid`.
4. **Audit trail:** añadir `'POST /api/school/event-invitations/response'` a `LOGGED_ELSEWHERE`. Así el test de cobertura de rutas sigue en verde y no hay doble fila.
5. **Rate limit:** un limitador propio por IP, por ejemplo 30 cada 15 min. Un flujo emite 2 o 3 eventos (opened → confirmed), y una familia o un colegio detrás de la misma IP agotarían el de 10. Ojo: los limitadores son por proceso (pendiente de infra conocido), así que es un freno, no una garantía.
6. **Tests:**
   - 400 por cada campo obligatorio y por los enums;
   - 400 con un `event_id` que no es ObjectId;
   - 404 sin escritura si el evento es de otra compañía;
   - forma exacta del payload encolado (`company_id` de Mongo, `context.member_id`, hora del servidor, `verified: false`, `event_name` de la base);
   - la respuesta no devuelve nada del alumno;
   - la ruta lleva el limitador y no lleva `validateJWT`;
   - el test de cobertura del audit trail sigue en verde.
7. **Respuesta al dashboard** (`BACKEND_event_invitation_responses_REPLY_*.md`): el contrato final; las diferencias son que `event_name` sale de la base y que la fila lleva `verified: false`.

Sin migraciones ni variables de entorno nuevas. No rompe nada: es una ruta nueva y aditiva.

## 3. Fase 2: enlace firmado (≈ 2-3 días, requiere decisión)

Lo que propone el documento en §4, y con lo que estoy de acuerdo. Mientras el
enlace se construya en el navegador del staff, cualquiera puede fabricar
confirmaciones y respuestas.

1. **El servidor emite la invitación:** nueva `POST /api/school/event-invitations/send` (staff, `canCreate`). Genera un token aleatorio y lo guarda **hasheado**, igual que `otc_hash`, con caducidad y ligado a `company + event + member + email del destinatario`. Arma el enlace y manda el correo por la cola. Sustituye, para este flujo, al `customize-message-notification` que hoy arma el cliente.
2. **Migración:** tabla `event_invitations` (token_hash, ids, destinatario, estado, `expires_at`, `responded_at`).
3. **La ruta de la Fase 1 exige el token:** el servidor saca evento, miembro y compañía **del token** e ignora esos campos del body. La fila pasa a `verified: true`.
4. **La confirmación en sí:** hoy usa rutas genéricas de consumidor (`/auth/user-query`, `POST /auth/new`, `POST /db_consumer/new_consumer`, `PATCH /auth/:id`), que no se pueden atar a un token sin afectar a otros flujos. Propuesta: una `POST /api/school/event-invitations/confirm` que haga la confirmación en el servidor a partir del token.
5. **Cambios en el cliente:** pasar el token que viene en el enlace y usar `/confirm`. Los enlaces antiguos sin token seguirían entrando por la Fase 1 con `verified: false` durante un periodo de transición.

## 4. Decisiones para el usuario

- **¿Fase 2 sí o no, y cuándo?** Sin ella, el registro sirve como trazabilidad, pero no prueba quién respondió: cualquiera puede escribir esas filas. Por eso la Fase 1 las marca `verified: false`.
- **¿Limitar a compañías Education?** El documento no lo pide. Habría que traducir el id de Mongo de la compañía al de MySQL. Propuesta: no hacerlo en la Fase 1; basta con que el evento sea de la compañía.
- **Retención de PII:** cada fila guarda el email del tutor y el del alumno en el log de actividad. Encaja con FERPA, que exige registrar estas divulgaciones, pero entra en el alcance del export y el borrado de datos del alumno.
