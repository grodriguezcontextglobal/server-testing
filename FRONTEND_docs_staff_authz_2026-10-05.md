# Documentos, force-logout y perfil: autorización por compañía — 2026-10-05

Rama `feat/docs-staff-authz`. **Cuatro cambios de contrato.**

> **Actualizado 2026-10-06:**
> - **Documentos ya NO exigen `x-company-id`.** El dashboard no lo manda a
>   `/api/document`. La compañía sale del propio documento: tienes que ser
>   miembro de la compañía DUEÑA.
> - **`PUT /api/document/:id` existe**, que es lo que llama `EditDocument.jsx`.
>
> Para force-logout y perfil, la compañía sigue tomándose de `x-company-id`
> (también se acepta `company_id` en params/body/query).

---

## 1 · `PUT` / `PATCH /api/document/:id` — NUEVO

Edita los metadatos de un documento ya subido. **PUT y PATCH hacen lo mismo**: un
cambio parcial, donde lo que no viene no se toca. El PDF no se edita: para
cambiar el binario se sigue subiendo uno nuevo (`POST /api/document/upload`) y se
borra el viejo.

- **Auth:** token, y ser miembro activo de la compañía **dueña del documento**
  (vale cualquier miembro, igual que para subir), o super_user de plataforma.
  **No hace falta `x-company-id`.** Si se manda y no es la dueña, 404.
- **Campos editables:** `title`, `description`, `language`, `requires_signature`,
  `expiration_date`, `document_type`, `trigger_action`, `at_`, `status` (solo
  `active` | `archived`), `applicable_locations`, `applicable_items`,
  `applicable_events`, `tags`, `metadata`.
- **Reactivar un vencido:** cambiar `expiration_date` a una fecha futura, o
  mandarla `null` para quitarla.
- **`public_document`:** se acepta sin error y se devuelve en `ignored_fields`.
  **No se guarda ni se aplica**: el modelo no tiene ese campo, y hoy
  `GET /api/document/:id` es público para cualquier documento.
- **No editables** (dan 400): `company_id` como campo (sí se acepta como
  selector de contexto), `document_url`, `version`, `replaced_at`, `created_*`,
  contadores de uso y `document_config`.
- El body es JSON normal, no multipart: los arrays van como arrays, no como
  string JSON como en el upload.

| Respuesta | Cuándo |
|---|---|
| `200 { ok, document, ignored_fields }` | actualizado |
| `400 { ok:false, msg, invalid_fields }` | campo no editable |
| `400` | body vacío, `status` inválido, o `document_type`/`trigger_action` fuera de lo permitido a la compañía |
| `404` | no existe, es de otra compañía o no eres miembro de la dueña (no se distingue a propósito) |

## 2 · `DELETE /api/document/:id` — ahora con scope de compañía

Antes borraba cualquier documento por id, también los de otras compañías. Ahora
aplica las mismas reglas que el PUT/PATCH: miembro de la compañía dueña, o 404.
**El dashboard no tiene que cambiar nada**: `ViewDocument.jsx` ya funciona tal cual.

## 3 · `POST /api/staff/force-logout` — exige token

Antes era anónima.

- **Para el usuario al que el login le dice "Active session already exists":**
  esta ruta ya **no** es el camino. Hay que reintentar el login con
  `forceLogin: true`, que ya existe y se envía después de verificar la contraseña.
  Si el dashboard llamaba a force-logout desde la pantalla de login (sin token),
  **ese flujo deja de funcionar** con un 401 y hay que cambiarlo a `forceLogin`.
- **Cerrar la propia sesión** (con token, `email` = el tuyo): permitido. Borra la
  cookie.
- **Cerrar la sesión de otro:** hace falta ser super_user de plataforma, o, en la
  compañía de `x-company-id`, ser super_user o tener `staff:update`, y que el otro
  sea miembro de esa compañía. Si no, `403`. **La cookie de quien llama no se
  toca.**
- Body igual que antes: `{ "email": "..." }`.

## 4 · `PATCH /api/admin/profile/:id` — ya no acepta cualquier campo

Antes el body entero iba a la base, y cualquiera podía ponerle `super_user: true`
a cualquier otro.

| Quién | Qué puede cambiar |
|---|---|
| **El propio usuario** | `name`, `lastName`, `phone`, `imageProfile`, `emailNotifications`, `online`, `agreedPlatformConditions` |
| **Super_user de la compañía** (`x-company-id`), sobre un miembro de esa compañía o sobre sí mismo | cualquier campo salvo los protegidos |
| **Super_user de plataforma** | cualquier campo salvo los protegidos |
| Cualquier otro caso con un usuario ajeno | nada: `403` |

**Protegidos, nadie los cambia por esta ruta:** `email`, `password`,
`super_user`, `platform_observer`, `tokenVersion`, `mfaEnabled`, `mfaSecret`,
`_id`.

**Comportamiento con campos no permitidos:** se **descartan** y se devuelven en
`ignored_fields`; el resto se aplica. Si no queda ninguno aplicable, `403` sin
escribir nada. La respuesta de éxito es la de antes más `ignored_fields`.

**Qué revisar:**
- Si algún flujo del **propio usuario** actualiza `companiesAssigned` (por
  ejemplo, al aceptar una invitación o cambiar de compañía), ese cambio ahora se
  **descarta**: sale en `ignored_fields`. `companiesAssigned` es legacy; el rol y
  la membresía reales salen de `Company.employees`. Dejad de depender de
  escribirlo desde el cliente.
- Si se cambiaba el `email` o la contraseña por esta ruta: ya no. La contraseña
  tiene su propio endpoint.
- Leed `ignored_fields` en la respuesta. Si no viene vacío, algo que el usuario
  creyó guardar no se guardó.
