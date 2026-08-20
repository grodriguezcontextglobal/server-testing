# Estudio — tabla de pertenencia para items contenedor

**Fecha:** 2026-08-20 · **Estado:** diseño cerrado (decisiones en §8), nada implementado · **Evidencia:** consultas read-only contra `devitrak_db` (prod)

## Veredicto

**Sí, conviene — y es más urgente y más barato de lo que parece.**

Más barato porque **casi no hay datos que migrar**: de 227 contenedores marcados en `item_inv`, 226 no tienen fila en la tabla que ya existe; de las 7 filas de esa tabla, 6 apuntan a items que ya no existen; y los 37 hijos registrados cuelgan de dos contenedores inexistentes. El modelo actual no es "funciona pero está denormalizado": está roto y prácticamente sin uso.

Más urgente porque hoy no hay forma de **scopear estos endpoints por compañía** (está documentado en `mysql/routes/inventory.js:25`), y porque la base **permite que un item esté dentro de dos contenedores a la vez** — ya pasa con 6 items.

---

## 1. Hoy no hay una representación, hay tres

Tu ejemplo muestra la fila de `item_inv`, pero eso es solo una de las tres. Y hay una trampa de nombres: **`container_items` es a la vez una tabla y una columna de `item_inv`**, con formas y significados distintos.

| # | Dónde vive | Forma | Quién escribe | Quién lee |
|---|---|---|---|---|
| 1 | **Tabla `container_items`** | 1 fila por contenedor, hijos en un array JSON | `insertContainerItems` / `updateContainerItems` / `deleteContainerItem` (`mysql/controllers/item.js:2755+`) | `getContainerItems`, y **`allocateDeviceMarkedAsContainerInEvent`** (`items_events.js:682`) — el único consumidor real en un flujo de negocio |
| 2 | **Columna `item_inv.container_items`** | `varchar(50)` | `updateContentInContainerItem` (`item.js:1621`) | nadie |
| 3 | **Columnas `item_inv.isItInContainer` + `container_id`** | flag + id en el hijo | `containerItemsDetails` (`item.js:1570`), seeds | filtros de inventario, `display_item` |

Las tres se escriben desde caminos distintos y **ninguna es la fuente de verdad**. `seed/seed-school-locations.js:247` lo dice explícitamente en un comentario: *"container_items registry table (modern) + JSON column (legacy readers)"* — o sea, el doble write era consciente.

### Schema real de la tabla que ya existe

```sql
CREATE TABLE `container_items` (
  `container_item_id` int NOT NULL,
  `child_ids` json DEFAULT NULL,
  PRIMARY KEY (`container_item_id`)
)
```

Sin `company_id`, sin fechas, sin FK, sin índice por hijo, y los hijos en un array. Todo lo que pediste agregar, efectivamente, no está.

---

## 2. Lo que dice la base (2026-08-20, prod)

| Métrica | Valor |
|---|---|
| Filas en la tabla `container_items` | **7** |
| `item_inv` con `container = 1` (marcados como contenedor) | **227** |
| `item_inv` con `isItInContainer = 1` (marcados como hijo) | **37** |
| `item_inv.container_items` no vacío | **0** |
| Filas de `item_inv` en total | 15.170 |

Y la parte que decide el diseño:

- **226 de 227 contenedores no tienen fila en la tabla.** La tabla cubre el 0,4% de los contenedores.
- **6 de las 7 filas de la tabla apuntan a un padre que no existe** en `item_inv` (57103, 57114, 57125, 57152, 57153, 199907). Solo 199395 (compañía 136) tiene padre vivo.
- **Las 7 filas tienen 0 hijos coincidentes con `container_id`.** Las representaciones 1 y 3 describen mundos disjuntos: no hay un solo contenedor donde coincidan.
- **Los 37 hijos cuelgan de solo dos ids, 165189 (25) y 165191 (12), y ninguno de los dos existe** en `item_inv`. Están todos huérfanos — y con `display_item = 0` son **los únicos 37 items ocultos de la compañía 133** (sobre 1.625), todos `in-stock` en almacén: existen físicamente y no se ven en el inventario. Ver §6 fase 2.
- **6 items figuran como hijos de dos contenedores a la vez** (57104-57108, 57117). El array JSON lo permite, y `insertContainerItems` lo *garantiza*: usa `ON DUPLICATE KEY UPDATE child_ids = JSON_MERGE_PRESERVE(...)`, que acumula duplicados en vez de deduplicar.
- Distribución por compañía: **134 → 218 contenedores y 0 hijos**; **133 → 8 contenedores y 37 hijos**; **136 → 1 y 0**.
- No hay membresías cruzadas entre compañías, ni contenedores excedidos de `containerSpotLimit` — pero solo porque casi no hay datos vivos.

**Conclusión operativa:** no hay que planificar una migración de datos. Hay que planificar un **reemplazo**, con un backfill de lo poco que es coherente.

---

## 3. Trampas de tipos encontradas

Esto condiciona el DDL, así que va antes de la propuesta.

| Columna | Tipo real | Consecuencia |
|---|---|---|
| `item_inv.container_items` | **`varchar(50)`** | Nunca pudo guardar una lista de hijos: un array JSON de objetos pasa los 50 chars al primer elemento. La columna es estructuralmente incapaz de su función — por eso está en 0 filas. |
| `item_inv.container_id` | `varchar(50)` | Y encima pasa por `formatJsonField()` (`item.js:297`), o sea JSON dentro de un varchar(50). |
| `item_inv.company_id` | **`varchar(255)`** | Comparar una columna varchar contra un literal numérico fuerza conversión **de la columna** y mata el índice. |
| `item_inv.item_id` | `int` PK | Los joins por item quedan INT↔INT, sin cast. |

**Decisión que se deriva:** en la tabla nueva, `company_id` va **`INT`** y **nunca se joinea** contra `item_inv.company_id` — solo se filtra con parámetro numérico (`WHERE cm.company_id = ?`), que sí usa índice. Los joins van siempre por `item_id`.

---

## 4. Propuesta

Nombre **`container_membership`**, no `container_items`: hoy ese nombre ya está tomado dos veces (tabla + columna) y esa colisión es una fuente real de confusión al leer el código.

Con las decisiones del 2026-08-20 (§8): **sin anidamiento y sin historial**, así que no hace falta ni la columna generada ni el soft delete. Quitar un item del contenedor borra la fila.

```sql
CREATE TABLE container_membership (
  membership_id   INT          NOT NULL AUTO_INCREMENT,
  company_id      INT          NOT NULL,
  parent_item_id  INT          NOT NULL,   -- item_inv.item_id del contenedor
  child_item_id   INT          NOT NULL,   -- item_inv.item_id del contenido
  inserted_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inserted_by     INT          NULL,       -- staff_member.staff_id
  note            VARCHAR(255) NULL,

  PRIMARY KEY (membership_id),
  -- "un item está dentro de un solo contenedor" lo garantiza la base, no la app.
  UNIQUE KEY uq_child (child_item_id),
  KEY idx_parent (company_id, parent_item_id),
  KEY idx_company_inserted (company_id, inserted_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### Por qué cada cosa

- **Una fila por membresía**, no un array. Es lo que permite indexar por hijo, contar hijos con `COUNT(*)`, y que dos operarios editen dos contenedores sin pisarse. Hoy `updateContainerItems` hace `SET child_ids = ?` con el array completo: dos ediciones concurrentes = lost update silencioso.
- **`parent_item_id` / `child_item_id`** en vez de `parent_id` / `child_id`: explicita que apuntan a `item_inv.item_id`. Con `parent_id` pelado, en un repo donde `container_id` es un varchar con JSON adentro, la ambigüedad ya costó caro.
- **`company_id` desnormalizado**, como pediste. No es redundancia gratuita: es lo que permite gatear estos endpoints con `resolveCompanyContext` + `getStaffCompanyAccess`, igual que el resto. Hoy no se puede, y `mysql/routes/inventory.js:25` lo documenta como la razón por la que esas rutas solo piden login. Se valida en el write que padre e hijo pertenezcan a esa compañía.
- **`UNIQUE (child_item_id)`** es el corazón del cambio: convierte en imposible el estado que hoy existe 6 veces (un item dentro de dos contenedores).
- **`inserted_date`** como pediste, y **`inserted_by`** apuntando a `staff_member.staff_id`, que se llena desde `req.sqlStaffId` (el JWT ya lo trae). Nullable porque los caminos bulk y los seeds no siempre tienen staff.
- **`note`** opcional, para el caso "falta el cargador, se anotó al cerrar el case".

### Lo que la base NO puede garantizar sola

**Un solo nivel** (decisión 1: sin anidamiento) no se puede expresar en el schema sin un trigger, porque depende de `item_inv.container` del hijo. Va validado en la app, en el write: **rechazar la membresía si el hijo está marcado `container = 1`**. Conviene que el script de integridad (§6) lo verifique también, porque es exactamente la clase de invariante que se filtra por un camino bulk que nadie revisó.

Sin historial (decisión 2), la pregunta "¿qué había dentro de este case en junio?" sigue sin respuesta. Si algún día hace falta, se agrega `removed_date` + una columna generada `active_child_id INT AS (IF(removed_date IS NULL, child_item_id, NULL)) STORED` con el UNIQUE movido ahí — MySQL no tiene índices únicos parciales, y los NULL no colisionan en un UNIQUE. Queda anotado para no re-derivarlo.
- **Sin FOREIGN KEY.** El repo no tiene ni una, ni siquiera en `container_items`, y la base es PlanetScale/Vitess. Consistencia con el esquema existente > pureza. El precio se paga con un chequeo de integridad periódico (ver §6) — y es exactamente el precio que ya se está pagando: 6 de 7 filas con padre inexistente es lo que pasa cuando nada lo verifica.

### La capacidad se queda donde está

`container` (es-contenedor) y `containerSpotLimit` (capacidad) son propiedades **del item contenedor**, no de la membresía: se quedan en `item_inv`. Validar la capacidad pasa a ser un `COUNT(*)` sobre la tabla nueva en vez de `JSON_LENGTH`, y por primera vez se puede hacer con `FOR UPDATE` para que dos inserciones simultáneas no pasen el límite.

---

## 5. Qué pasa con las 5 columnas actuales

| Columna | Destino | Por qué |
|---|---|---|
| `container` | **se queda** | propiedad del item, no de la relación |
| `containerSpotLimit` | **se queda** | idem |
| `container_items` (varchar 50) | **se queda por ahora** (decisión 2026-08-20) | 0 filas y estructuralmente inservible, pero el borrado se posterga. Cuando se haga: no requiere backfill, es un `DROP COLUMN` seco. Mientras siga ahí, `updateContentInContainerItem` la sigue escribiendo sin que nadie lea. |
| `isItInContainer` | **se deprecia** | pasa a ser `EXISTS(SELECT 1 FROM container_membership WHERE child_item_id = ? AND removed_date IS NULL)`. Mantenerla sincronizada como caché es opcional y es deuda. |
| `container_id` | **se deprecia** | lo reemplaza `parent_item_id`, con tipo correcto |
| `display_item` | **se queda**, marcada como derivada | hoy la togglea `containerItemsDetails` junto con lo demás; es una preocupación de UI, no del modelo |

---

## 6. Trabajo que implica

### Call sites a tocar

**CRUD de la tabla** (`mysql/controllers/item.js`, montado en `mysql/routes/inventory.js`) — se reescribe contra el modelo nuevo:
- `insertContainerItems` (`:2755`), `getContainerItems` (`:2822`), `deleteContainerItem` (`:~2940`), `updateContainerItems` (`:~2990`)

**Escrituras a las columnas de `item_inv`:**
- `containerItemsDetails` (`item.js:1570`) — el UPDATE masivo de `container_id`/`isItInContainer`/`display_item`
- `updateContentInContainerItem` (`item.js:1621`) — escribe la columna varchar(50) muerta; se elimina
- `item.js:735-738` — lista blanca de campos actualizables
- `mysql/controllers/company.js:268` — copiar grupo de items copia `container`/`containerSpotLimit`

**Consumidor real:**
- `allocateDeviceMarkedAsContainerInEvent` (`items_events.js:682`) — el `JOIN container_items` pasa a ser un JOIN a la tabla nueva filtrando `removed_date IS NULL`. Es el único lugar donde la expansión de contenedores mueve inventario de verdad.

**Go worker** (necesita `go build`):
- `controllers.go:311` y `:385` — los INSERT bulk escriben `container`, `containerSpotLimit`, `container_id`
- `controllers.go:1118` — `container_id` en la lista blanca de campos JSON
- `queue/handlers/inventoryBulkInsert.js`, `queue/handlers/bulkInsertItemRange.js`

**Seeds:** `seed/seed-school-locations.js:236-252` (hoy hace el triple write).

### Fases

1. **Crear la tabla** (no destructivo, nadie la lee todavía).
2. **Backfill de lo coherente**: la única fila sana de `container_items` (199395, compañía 136) y los hijos cuyo `container_id` apunte a un item existente — hoy **cero**. La tabla nueva arranca con **una** membresía real.

   Los 227 contenedores son reales (decisión 3), así que **siguen existiendo como contenedores; lo que no existe es el registro de qué tienen adentro**, y la base no lo sabe. Eso se re-captura desde el piso, por compañía — 218 de ellos son de la 134 y nunca tuvieron un hijo registrado. Es trabajo de operación, no de migración, y el modelo nuevo no lo empeora: hoy tampoco está.

   **Tarea aparte y accionable ya (no depende de la tabla nueva):** los 37 hijos huérfanos de la compañía 133 cuelgan de `container_id` 165189 y 165191, que no existen en `item_inv` (el `max(item_id)` es 200637, así que existieron y se borraron). Los 37 tienen `display_item = 0` y son **exactamente los únicos 37 items ocultos de esa compañía** (de 1.625), todos `warehouse = 1` / `in-stock`: están físicamente en almacén e invisibles en el inventario. Corregirlos es un UPDATE que limpia `isItInContainer`, `container_id` y devuelve `display_item = 1`. Requiere confirmación del usuario de la 133 sobre si esos equipos siguen dentro de algún case físico.
3. **Doble escritura** durante una ventana: los caminos nuevos escriben en la tabla nueva y siguen manteniendo `isItInContainer`/`container_id` para los lectores que aún los filtran.
4. **Migrar los lectores**, empezando por `allocateDeviceMarkedAsContainerInEvent`, que es el que tiene consecuencia operativa.
5. **Cortar**: borrar `container_items` (tabla y columna), y `container_id`/`isItInContainer` cuando no queden lectores.
6. **Script de integridad** read-only, reutilizable, al estilo de `mysql/scripts/audit-scoped-roles-failclosed.js`: membresías con padre o hijo inexistente, padre no marcado como `container`, hijo en dos contenedores, compañía del hijo distinta de la del padre, contenedores excedidos. Es el reemplazo de las FKs que no vamos a poner.

**Esfuerzo estimado:** S-M. La tabla y el CRUD son mecánicos; lo que hay que hacer con cuidado son las fases 3-4 y el `go build`. Sin migración de datos pesada, porque no hay datos.

---

## 7. Bugs encontrados en el camino

Ninguno tocado. Los tres primeros son del código que este rediseño reemplaza, así que se resuelven solos si se hace.

1. **`getContainerItems` tiene un `ReferenceError` latente** (`item.js:2841`): usa `cleanJson`, pero la línea que la declara está comentada justo arriba. Si `child_ids` llega como string, tira `cleanJson is not defined` → lo atrapa el catch interno y responde 400 "parse error" en vez del contenido. Hoy no salta siempre porque la columna es `json` y mysql2 la devuelve ya parseada.
2. **`insertContainerItems` acumula duplicados a propósito**: `JSON_MERGE_PRESERVE` preserva repetidos, así que agregar dos veces el mismo hijo lo deja dos veces en el array. Es el origen de los 6 items en dos contenedores.
3. **`updateContainerItems` tiene lost update**: `SET child_ids = ?` con el array completo, sin control de concurrencia.
4. **Estos endpoints no scopean por compañía** — no es un olvido, es que la tabla no tiene con qué. Documentado en `mysql/routes/inventory.js:25`.

---

## 8. Decisiones tomadas — 2026-08-20

| # | Pregunta | Decisión | Consecuencia en el diseño |
|---|---|---|---|
| 1 | ¿Anidamiento (contenedor dentro de contenedor)? | **No** | Un solo nivel. No se puede expresar en el schema: se valida en el write rechazando un hijo con `container = 1`, y el script de integridad lo verifica. Sin ciclos que resolver. |
| 2 | ¿Se conserva historial? | **No** | Fuera `removed_date` / `removed_by` / la columna generada. El UNIQUE va directo en `child_item_id`; quitar un item borra la fila. La receta para agregar historial más adelante quedó anotada en §4. |
| 3 | ¿Los 227 contenedores son reales? | **Sí, son reales** | No se descarta nada. Siguen siendo contenedores; lo que falta es el contenido, y se re-captura desde el piso (§6 fase 2). Aparte, los 37 items ocultos de la compañía 133 son un bug de datos accionable ya. |
| 4 | ¿Se borra `item_inv.container_items`? | **Todavía no** | La columna se queda; `updateContentInContainerItem` la sigue escribiendo al vacío. Es un `DROP COLUMN` seco cuando se decida. |

Con esto el diseño queda cerrado y la implementación no tiene bloqueos de diseño pendientes. Lo único que necesita input externo es el punto 3: confirmar con el usuario de la compañía 133 si esos 37 equipos siguen dentro de un case físico antes de devolverlos al inventario visible.
