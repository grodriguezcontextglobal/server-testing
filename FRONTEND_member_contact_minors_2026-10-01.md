# Members: email y teléfono opcionales solo para menores — 2026-10-01

Rama `feat/member-contact-minors`. **Cambio de contrato** en los tres caminos de
escritura de members.

## La regla

| Member | Exige |
|---|---|
| Adulto (`minor` distinto de 1, o sin mandar) | `email` **y** `phone_number` |
| Menor con email y teléfono propios | nada más |
| Menor al que le falta alguno de los dos | `parent_guardian_email` |

Antes el backend no exigía nada: la regla de "email y teléfono obligatorios" solo
la ponía el formulario. Para dejar crear menores sin contacto basta con relajar el
formulario **cuando `minor` está marcado**, y pedir entonces el email del tutor.

## Qué cambia en cada endpoint

**Alta individual** (`insertNewMember`) — nuevo `400`:

```json
{ "ok": false, "message": "Adult members require phone_number.", "missing": ["phone_number"] }
```

**Import masivo** (`insertBulkMembers`) — la fila que no cumple **se salta** y el
resto entra, igual que ya pasaba con las filas sin nombre. `skipped` las cuenta, y
el campo nuevo `contact_skipped` dice cuáles y por qué (`row` es el índice en el
array que mandasteis):

```json
{
  "ok": true, "requested": 5, "inserted": 2, "skipped": 3,
  "contact_skipped": [
    { "row": 1, "missing": ["phone_number"], "msg": "Adult members require phone_number." },
    { "row": 3, "missing": ["parent_guardian_email"], "msg": "Minors without their own email and phone_number require parent_guardian_email." }
  ]
}
```

Si **ninguna** fila cumple: `400` con `contact_skipped`. En la respuesta
`202 + jobId` (import grande) también vienen `skipped` y `contact_skipped`: el
salto se decide antes de encolar, así que no hace falta esperar al job para saberlo.

**Edición** (`updateMemberInfo`) — se valida cómo **queda** la fila, no solo lo que
se manda. Dan `400` (mismo formato que el alta):

- vaciar el email o el teléfono de un adulto;
- desmarcar `minor` en un menor que no tiene contacto propio;
- vaciar `parent_guardian_email` a un menor sin contacto propio.

Un cambio que no toca `email`, `phone_number`, `minor` ni `parent_guardian_email`
sigue igual.

## Detalle

En el import, un `email` o `phone_number` vacío (`""`) se guarda ahora como `NULL`,
no como cadena vacía.
