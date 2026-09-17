# Respuestas a las tres preguntas del 2026-09-17

> Responde a `FRONTEND_backend_asks_2026-09-17.md`.
> Cada respuesta dice dónde se verificó, con `fichero:línea`.
> **Resumen: la 1 era un error nuestro de documentación —estáis cubiertos—, la 2
> es «ninguna de las siete» y la 3 es fail-closed, tabla vacía.**

---

## 1 · Sí, estáis cubiertos. El error estaba en nuestro documento

**Respuesta corta: la reserva en Redis protege exactamente las rutas que llamáis.
Lo que estaba mal eran los prefijos que escribimos en el §6 de la orden de
trabajo.**

Son **dos ficheros de rutas distintos**, montados en dos prefijos:

| Fichero | Se monta en | ¿Idempotencia? |
|---|---|---|
| `routes/stripe.js` | **`/api/stripe`** (`index.js:174`, `mongoRoutes`) | **Sí, en 8 rutas** |
| `mysql/routes/stripe.js` | `/api/db_stripe` (`index.js:190`, `mysqlRoutes`) | No, 0 |

Y las ocho protegidas, con su ruta real —las que aparecen en vuestra tabla—:

```
POST /api/stripe/payment-intents/:id/capture
POST /api/stripe/payment-intents/:id/cancel
POST /api/stripe/refund
POST /api/stripe/partial-refund
     …y las cuatro gemelas bajo /api/stripe/internal/
```

O sea: **el 409 os llega**, y `21896b77` es exactamente el trabajo que hacía
falta. No hay doble captura abierta por un desajuste de prefijos.

Comprobado además que `/api/db_stripe` **no tiene gemelos desprotegidos** de esas
operaciones: solo expone `consulting-stripe` y `new_stripe`
(`mysql/routes/stripe.js:12,30`) — justo los dos que decís usar en el login.

Nuestro §6 listaba las ocho como `/api/db_stripe/...`. Está corregido en
`FRONTEND_work_order_2026-09-16.md`. Gracias por preguntar en vez de asumir: si
lo hubierais dado por bueno, habríais buscado un 409 en el prefijo equivocado.

### Pero hay un hueco real, y lo destapa vuestro dato del importe editable

Tenéis razón en la implicación. La clave, cuando no mandáis cabecera, se deriva
de **método + patrón de ruta + params + cuerpo**
(`middlewares/idempotencyMutationCache.js:17-24`). El `payment_intent` va dentro
(en `params`), así que:

| Dos capturas del mismo depósito | ¿Las colapsa la idempotencia? |
|---|---|
| Mismo importe | **Sí.** La segunda recibe 409 o la respuesta guardada |
| **Importe distinto** (el operador lo editó) | **No.** Cuerpos distintos → claves distintas → las dos ejecutan |

En ese segundo caso lo único que impide la doble captura es **Stripe**, que
rechaza capturar un `payment_intent` ya capturado. Es un backstop, no un diseño:
el error os llega como fallo de Stripe, no como un 409 limpio.

**Si queréis cerrarlo del todo, está en vuestra mano y es una línea:** mandad
`Idempotency-Key` con algo estable por operación — el id del depósito o de la
transacción, **no el importe**. La cabecera tiene precedencia sobre la clave
derivada (`idempotencyMutationCache.js:14-15`), así que dos capturas del mismo
depósito colapsan aunque el importe cambie.

Decidnos si lo hacéis y lo documentamos como el contrato de esas cuatro rutas.

---

## 2 · Ninguna de las siete. Verificado contra lo que corre en producción

**No hay borrados históricos por esta vía.**

Lo miramos en el fichero, y a propósito **en la versión que corre hoy en
producción** (`c13cfd2`), no en la de desarrollo — porque vuestra pregunta es
sobre daño que ya pudo ocurrir:

`router.post("/:id")` está en la **línea 101**. Vuestras siete:

| Ruta | Línea | Veredicto |
|---|---|---|
| `delete-bulk-items-criteria` | 57 | por encima ✅ |
| `tracking_item` | 78 | es `/tracking_item/:id`, **dos segmentos** — nunca pudo colisionar ✅ |
| `new_item` | 81 | por encima ✅ |
| `bulk-item` | 84 | por encima ✅ |
| `bulk-item-alphanumeric` | 87 | por encima ✅ |
| `edit-item` | 90 | por encima ✅ |
| `event-items` | 51-52 | por encima ✅ — ver la nota |

**Nota sobre `event-items`:** no existe `router.post("/event-items")`. Hay un
`PUT /event-items` (51), un `POST /event-items/search` (52) y un
`DELETE /event-items`. Si vuestra llamada contada como «`event-items` (1)» es en
realidad el `POST /event-items/search`, son dos segmentos y nunca entró en el
reparto del `/:id`. Si fuera un `POST /event-items` a secas, sí caería en
`deleteItem` — **pero tampoco habría borrado**: `deleteItem` exige un `item_id`
**escalar** y esa familia manda `items` (un array), así que sale por su `400`
antes de tocar la base de datos. Tras nuestro deploy esa llamada pasaría a
**404**.

### Lo que sí quedaba por debajo, por si os sirve

Las catorce sombreadas eran: `delete-item`, `delete-bulk-items`,
`consulting-row-item-assigned-event`, `search-inventory`, `check-item`,
`returning-item-refactored`, `retrieve-item-location-quantity`,
`inventory-pagination`, `inventory-based-on-location-and-sublocation`,
`inventory-based-on-submitted-parameters`, `inventory-query`,
`return-event-devices`, `get-inventory-company` y `retrieve-item-data`.

De vuestra columna «muy usadas», **`delete-item` (20 llamadas) sí estaba por
debajo** — línea 104, tres por debajo del `/:id`. No pasó nada porque `/:id`
apuntaba **al mismo handler**, `deleteItem`, que ignora el parámetro de la URL y
lee el `item_id` del cuerpo. Hacía exactamente lo que debía, por la ruta
equivocada. Es el ejemplo que sostiene la corrección de método que aceptáis.

---

## 3 · Fail-closed: tabla vacía. Y el backfill tiene más historia de la que parece

**Respuesta: el segundo de vuestros dos finales.** No es el inseguro.

`buildInventoryScopeFilter` (`mysql/helpers/staffAccess.js:108`) devuelve
**`{ sql: "1=0" }`** para un rol con scope y **cero asignaciones**. Coincide
nada, así que la consulta devuelve **tabla vacía**. Nadie ve inventario que no le
toca.

El detalle que lo hace inevitable: `scoped` sale del **nivel del rol**, no de si
hay filas —`scoped: SCOPED_ROLES.has(roleLevel)` (`staffAccess.js:86`)—. Un
`inventory_location_manager` (nivel 6) sin ninguna fila es «con scope, y su scope
está vacío». Es la decisión correcta, pero vuestra objeción de UX es válida: la
pantalla no puede distinguir «no tienes nada asignado» de «no hay inventario».
Si os sirve, podemos devolver una señal explícita en la respuesta (algo como
`scopeEmpty: true`) para que pintéis un mensaje en vez de una tabla vacía.
Decidnos y lo añadimos: es aditivo y no rompe nada.

### Sobre el backfill: aceptado, pero no empieza de cero

Tenéis razón en que es nuestro. Y ya existe la mitad: **`mysql/scripts/migrate-roles.js`
lee exactamente ese campo** y escribe las filas de locación
(`migrate-roles.js:126`). No hay que escribirlo, hay que **revisarlo y volver a
correrlo**. Tres cosas que hay que mirar antes, y son la razón de que probablemente
falten filas hoy:

1. **El script mapea por NOMBRE y descarta en silencio lo que no resuelve.**
   `locationIdByName[loc.location] ?? null` y, si es `null`, `continue`
   (`migrate-roles.js:127-128`). Una persona cuyo nombre de locación no casara se
   quedó con su fila de staff y **sin ninguna fila de locación** — que es
   exactamente el síntoma que describís.
2. **Los nombres de locación no son únicos por compañía.** Está anotado en
   `staffAccess.js:102`: por eso el filtro va por `location_id` y no por nombre.
   Un mapeo por nombre puede resolver al id equivocado. Ya nos mordió algo de
   esta familia en la auditoría de roles (`aca36be`), así que esta vez va con
   informe de ambigüedades **antes** de escribir.
3. **Se escribió para correr una vez.** No es una sincronización.

Y por eso el backfill, solo, es una cinta de correr:

> **La pantalla antigua sigue escribiendo únicamente en Mongo.** Backfilleamos
> hoy y mañana vuelve a haber gente sin scope en SQL, con la misma tabla vacía y
> sin que nadie se entere.

Así que proponemos partirlo, y la primera parte es vuestra decisión:

- **(a) Retirar la pantalla antigua**, o hacer que escriba también en SQL. Sin
  esto, lo demás se deshace solo.
- **(b) Backfill con informe de ambigüedades primero**, en dry-run, para ver a
  cuánta gente afecta y cuántos nombres no resuelven.
- **(c) Aplicarlo**, y entonces encendéis el flag.

**Decidnos quién se queda (a)** — si la pantalla antigua es vuestra, el orden es
que la cerréis vosotros y nosotros corramos (b) y (c) detrás. Mientras tanto,
mantener vuestro filtro de cliente es lo correcto.

---

## Lo que esto cambia de nuestro lado

- Corregido el §6 de `FRONTEND_work_order_2026-09-16.md`: las ocho rutas de pago
  son `/api/stripe/*`, no `/api/db_stripe/*`.
- Queda abierto, esperando respuesta vuestra: si mandaréis `Idempotency-Key` en
  las capturas (§1), si queréis la señal `scopeEmpty` (§3), y quién se queda la
  pantalla antigua de locaciones (§3a).
- Nada de esto bloquea nuestro despliegue de observabilidad, que no toca ninguna
  de las tres cosas.
