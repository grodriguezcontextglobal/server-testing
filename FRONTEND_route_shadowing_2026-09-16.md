# Respuesta: las catorce rutas des-sombreadas, y un 409 nuevo en pagos

> Responde a `FRONTEND_breaking_changes_2026-09-15_ANSWER.md`.
> Medido sobre `mysql/routes/item.js` en `94d7076`, que es el estado **anterior**
> al commit que arregla el sombreado (`2ff47d1`). Las líneas son de ese commit.

**Respuesta corta a vuestra pregunta: ninguna de las siete.** Ninguna de
`bulk-item-alphanumeric`, `edit-item`, `delete-bulk-items-criteria`, `new_item`,
`bulk-item`, `tracking_item` ni `event-items` estaba registrada después del
`router.post("/:id")`. Ninguna de esas siete llamadas vuestras borró nada.

Pero hay tres cosas en vuestro análisis que conviene corregir, y una de ellas
invalida el razonamiento con el que dais por buenas las cuatro de arriba.

---

## 1. Las catorce, nombre por nombre

`router.post("/:id")` estaba en la **línea 117**. Estas son las catorce rutas
POST de un segmento registradas por debajo, que es la lista completa de las que
no se alcanzaban:

```
delete-item                                  inventory-pagination
delete-bulk-items                            inventory-based-on-location-and-sublocation
consulting-row-item-assigned-event           inventory-based-on-submitted-parameters
search-inventory                             inventory-query
check-item                                   return-event-devices
returning-item-refactored                    get-inventory-company
retrieve-item-location-quantity              retrieve-item-data
```

Y estas son vuestras siete, con la línea en la que estaban:

| Ruta | Línea | Veredicto |
|---|---|---|
| `delete-bulk-items-criteria` | 62 | por encima ✅ |
| `tracking_item` | 94 | es `/tracking_item/:id`, **dos segmentos** — nunca pudo colisionar ✅ |
| `new_item` | 97 | por encima ✅ |
| `bulk-item` | 100 | por encima ✅ |
| `bulk-item-alphanumeric` | 103 | por encima ✅ |
| `edit-item` | 106 | por encima ✅ |
| `event-items` | 56-59 | por encima, **pero ver §3** |

---

## 2. La corrección que importa: `delete-item` SÍ estaba debajo

Vuestra fila de arriba dice *"funcionan a diario → registradas antes del `/:id`,
demostrado por uso"*. Para tres de las cuatro es cierto: `consulting-item` (68),
`warehouse-items` (71) e `item-out-warehouse` (113) están por encima.

**`delete-item` no.** Está en la línea 120, tres por debajo del `/:id`, y es una
de las catorce. Lleva sombreada todo este tiempo y vuestras 20 llamadas diarias
funcionaban igual — porque `router.post("/:id")` apuntaba **al mismo handler**,
`deleteItem`, que lee `item_id` del body y nunca miró el parámetro de la URL.

O sea: la llamada caía en el sitio equivocado y hacía exactamente lo correcto,
por casualidad. Es la única de las catorce con esa propiedad.

**Lo que hay que sacar de aquí:** "funciona a diario" no demuestra "está
registrada antes". Demuestra que *algo* la atendió. En este caso fue una ruta
distinta que resultó ser el mismo handler; en otro caso habría sido un borrado.
No uséis el uso como prueba de orden — el orden está en el fichero.

Tras el deploy, `delete-item` deja de estar sombreada y la atiende su propio
registro. Mismo handler, mismo resultado: para vosotros no cambia nada.

---

## 3. `event-items`: no existe el POST, y nunca existió

Aquí sí hay algo que mirar, aunque no sea un borrado.

En `/api/db_item/event-items` hay registrados un `PUT` (línea 56), un `DELETE`
(58) y un `POST` sobre `/event-items/search` (57, dos segmentos). **No hay
ningún `router.post("/event-items")`.**

Así que si de verdad hacéis un `POST` a `/api/db_item/event-items`, esa petición
sí caía por debajo hasta el `/:id` y llegaba a `deleteItem`. La cadena completa
era `validateJWT` → `checkTokenVersion` → `authorizePermission("inventory","delete")`
→ `deleteItem`.

**No borró nada, y se puede afirmar por la forma del payload.** `deleteItem`
empieza así:

```js
const { item_id, company_id } = request.body;
if (!item_id || !company_id) {
  return response.status(400).json({ ok: false, msg: "item_id and company_id are required" });
}
```

Exige un `item_id` **escalar**. Toda la familia `event-items` manda `items`, un
**array** (`updateEventItemShipping` y `removeEventItemShipping` validan
`Array.isArray(items)`). Con ese cuerpo, `deleteItem` sale por el 400 antes de
tocar la base de datos. Y aunque hubiera pasado, el `DELETE` lleva
`WHERE item_id = ? AND company_id = ?`, así que no había forma de tocar otra
compañía.

Dos avisos, entonces:

- **Después del deploy esa llamada pasa de 400 a 404.** No "empieza a hacer lo
  que dice su nombre": no hay handler que la haga. Si esa llamada existe en
  vuestro código, es una llamada muerta desde siempre y hay que mirar qué
  pretendía hacer — probablemente quería ser el `PUT`.
- Si lo que contabilizasteis como *"`event-items` · 1"* era en realidad
  `POST /event-items/search`, entonces no hay nada que mirar: son dos segmentos,
  nunca entró en el reparto del `/:id`.

---

## 4. `check-item` estaba sombreada y no aparece en vuestra lista

`check-item` (línea 138) es una de las catorce y no está en vuestra tabla de
llamadas. Lo más probable es que la alcancéis por uno de sus gemelos, que están
intactos:

- `POST /api/db_inventory/check-item`
- `POST /api/db_company/check-item`

Solo confirmadlo. Si alguna pantalla llama a la de `db_item` y "no hacía nada",
tras el deploy empieza a responder de verdad, y eso es un cambio de
comportamiento aunque sea el bueno. Lo mismo aplica a `inventory-query`
(gemelos en `db_company` y `db_event`) y a `get-inventory-company` (gemelo en
`db_company`).

---

## 5. Novedad que no estaba en el informe anterior: 409 en las rutas de Stripe

Independiente de todo lo de arriba, y ya commiteado (`54dffdb`).

La caché de idempotencia de mutaciones guardaba las respuestas en memoria del
proceso, y producción son cuatro procesos: dos peticiones iguales en workers
distintos pasaban las dos. Además solo guardaba **al terminar** el handler, así
que ni siquiera dentro de un proceso protegía contra dos peticiones
simultáneas — solo contra un reintento posterior.

Ahora la clave se reserva en Redis **antes** de ejecutar. Consecuencia para
vosotros, en estas ocho rutas:

```
/payment-intents/:id/capture          /refund
/payment-intents/:id/cancel           /partial-refund
/internal/payment-intents/:id/capture /internal/refund
/internal/payment-intents/:id/cancel  /internal/partial-refund
```

- **Duplicado que llega mientras la primera aún corre → `409`** con
  `{ ok: false, msg: "A request with this idempotency key is already in progress" }`.
- Duplicado que llega cuando la primera ya terminó → sigue devolviendo la
  respuesta original, como hasta ahora.

**Qué hacer**: tratad el 409 como *"tu petición anterior sigue en marcha"*, no
como un error. Ni reintento automático en bucle ni mensaje de fallo al usuario:
lo correcto es esperar y consultar el estado. Si mandáis cabecera
`Idempotency-Key`, es la que manda; si no, la clave sale del método, la ruta y
el cuerpo.

---

## 6. Estado del deploy

- `395bba6` (métricas) **ya está en `origin/main`**, desplegado por separado como
  acordamos. En 24-48 h tenemos el tráfico real por ruta.
- `94d7076`, `2ff47d1`, `6ff962c`, `ca3611e` siguen en local, listos. Con
  vuestro visto bueno los subimos cuando digáis.
- `54dffdb` (el 409 de arriba) es nuevo y va en la misma tanda.

Lo único que os pedimos antes de esa tanda es lo de §3 —confirmar si ese POST a
`event-items` existe— y lo de §4, y el manejo del 409.
