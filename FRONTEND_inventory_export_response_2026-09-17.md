# `inventory-export` está listo, y una corrección a vuestra §4.1

> Del servidor al dashboard, 2026-09-17.
> Respuesta a `FRONTEND_inventory_export_contract_2026-09-17.md`.
> Los cuatro puntos de vuestra §5 están implementados. Elegimos **A**: el XLSX
> lo escribimos nosotros. Lo que necesitáis leer aunque no leáis el resto es la
> §3 de aquí abajo — **`event_name` nunca estuvo en `warehouse-items`**, así que
> dos columnas de la hoja que enviáis hoy no contienen lo que creéis.

---

## 1. Lo que ya está

| Vuestra §5 | Estado |
|---|---|
| 1 · `POST /api/db_item/inventory-export` → 202 `{ jobId }` | ✅ |
| 2 · Payload terminal con `url` prefirmada, `expiresAt`, `rowCount` | ✅ |
| 3 · Decidir A o B | ✅ **A** — el fichero lo escribe el servidor |
| 4 · Que el job lea la fila completa, no las trece columnas | ✅ |

La URL prefirmada no era un bloqueante: `getTemporaryDownloadUrl` ya existía en
`helpers/s3Upload.js` desde los adjuntos de correo, y
`@aws-sdk/s3-request-presigner` ya era dependencia. Lo que faltaba era el job.

### La petición

Exactamente el cuerpo que propusisteis, y **`company_id` en la cabecera
`s-company-lq`** como en todo `/api/db_*`:

```jsonc
POST /api/db_item/inventory-export
{ "filters": { "brand": "Dell", "logistic_status": "in-stock" },
  "search": "00100", "sortBy": "category_name", "sortDir": "asc" }
→ 202 { "ok": true, "msg": "Inventory export queued", "jobId": "..." }
```

**El vocabulario de filtros es literalmente el mismo objeto de código que el de
`inventory-page`** — no una copia que haya que mantener en paralelo. El export
llama a `buildBaseFilter` y a `normalizeSort`, los mismos que la página. Si un
filtro vale en la tabla vale en el export, y si no vale devuelve el mismo 400
con el mismo mensaje. Hay una prueba que falla si alguien los separa.

Un `sortBy` inválido responde **400 al encolar**, no un job en `failed` treinta
segundos después: el controller construye la consulta y la tira antes de encolar.

**Mandad el `Idempotency-Key`** si podéis, con el mismo formato que ya usáis en
pagos. Un doble clic en «Export» genera si no dos ficheros y ocupa el worker dos
veces. Sin cabecera funciona igual, solo que sin esa protección.

### El resultado

`GET /api/jobs/owned/:jobId`, el que ya hace `BackgroundJobsTracker`:

```jsonc
{ "state": "done",
  "result": { "url": "https://…", "expiresAt": "2026-09-17T18:40:00Z",
              "rowCount": 12483, "fileName": "inventory-77-2026-09-17.xlsx" } }
```

- **`expiresAt` son 15 minutos, no 5.** Entre que el job termina, vuestro
  polling de 3 s lo detecta y la persona vuelve a la pestaña, cinco minutos se
  consumen solos.
- El objeto va con `Content-Disposition: attachment`, así que la URL **descarga**
  en vez de abrir el .xlsx en una pestaña.
- En `failed`/`dead`, `lastError` lleva el motivo legible que pedisteis. Hoy el
  único motivo propio es el techo de 200.000 filas: *"The export exceeds the
  200,000 row limit. Narrow the filters and try again."* No es un límite de
  producto, es el seguro de que un filtro vacío sobre una compañía enorme no
  deje al worker una hora ocupado. Si alguien lo toca de verdad, nos lo decís y
  lo subimos.

---

## 2. Vuestra §4 es la especificación de la hoja, y se respeta

Las dieciséis columnas, en orden, con las cinco transformaciones, la hoja
`Stock - Report`, la fila 1 en negrita y congelada, y los anchos. Vive en
`helpers/inventoryExportSheet.js`, y cada transformación tiene su prueba —
incluidos los casos que no estaban en vuestra tabla y que hay que decidir igual:
un `ownership` desconocido se deja crudo en vez de vaciarse, y un
`extra_serial_number` con JSON ilegible da celda vacía en vez de tumbar un
export de 50.000 filas.

El job lee **la fila completa** (§4.1): los cinco campos que a `inventory-page`
le faltan están. No es `SELECT *` sino una allowlist de dieciséis columnas — nos
ahorramos `returnedRentedInfo` y `supplier_info`, que la hoja no usa y son de
las que peor comprimen.

---

## 3. La corrección: `event_name` nunca estuvo en `warehouse-items`

Vuestra §4.1 lista `event_name` entre los cinco campos que `inventory-page` no
trae, dando por hecho que `warehouse-items` sí. **No lo trae ninguno de los
dos.**

`warehouse-items` es `SELECT * FROM item_inv` (`mysql/controllers/item.js:741`),
y `event_name` no es columna de `item_inv`: vive en `event_info`, y solo se
alcanza pasando por `item_inv_assigned_event`. Lo mismo `condition`.

Consecuencia en el fichero que vuestros usuarios descargan **hoy**:

| Columna | Lo que hace hoy | Por qué |
|---|---|---|
| 3 · Warehouse | Todo ítem fuera de stock dice `"In-Use (In-Use)"` | `event_name ?? 'In-Use'` nunca tiene `event_name` |
| 10 · Current Location | **Siempre vacía** para lo que está fuera de stock | resuelve a `event_name` |
| 9 · Condition | Siempre `status`; el `?? condition` es código muerto | `condition` tampoco está en la fila |

No es un fallo que hayáis introducido: el campo nunca llegó al navegador, así
que el respaldo se comía el hueco en silencio.

**El export nuevo sí los resuelve.** Por cada trozo de filas hace una segunda
consulta en lote contra `item_inv_assigned_event` + `event_info`, solo para los
ítems que no están en stock, y se queda con la **asignación activa más
reciente** — la misma regla que ya aplica `retrieveCompanyInventory` al elegir
`usageMap.get(item_id)[0]`. Un ítem en dos eventos activos a la vez existe en
los datos y la hoja tiene una sola celda.

Va en lote y no en un `JOIN` por dos motivos: un `LEFT JOIN` duplicaría el ítem
en el fichero cuando tiene varias asignaciones, y `status`/`item_id` existen en
las dos tablas, lo que volvería ambiguo el WHERE que compartimos con
`inventory-page` — y compartirlo es justo lo que garantiza que el export y la
tabla no puedan divergir.

**Lo que os toca mirar:** con esto, «Current Location» pasa de vacía a tener el
nombre del evento, y «Warehouse» pasa de `"In-Use (In-Use)"` a
`"NAB 2026 (In-Use)"`. Es lo que la columna siempre quiso decir, pero **es un
cambio visible** en un fichero que vuestros usuarios ya conocen. Si alguien
tiene un proceso montado encima del texto actual, avisadnos antes de que lo
enciendan.

---

## 4. Lo que falta, que es vuestro

Enseñar a `BackgroundJobsTracker` a descargar al llegar a `done` (`result.url`
con `file-saver`, que ya tenéis) y retirar el parche de `warehouse-items`
(`13dff7b6`). El export ya respeta los filtros activos, así que al retirarlo
desaparece también el «exporta todo, no lo que estoy mirando» de vuestra §2.

---

## 5. Nota sobre el volumen

El inventario no se materializa entero en ningún sitio: el job lo lee de 1.000
en 1.000 con keyset —insertar inventario mientras corre no salta filas— y
escribe el libro en streaming a disco. Verificado con 2.500 filas: tres trozos,
160 KB, fichero válido. Ni el worker ni el navegador ven el catálogo completo en
memoria, que era el punto de vuestra §2.
