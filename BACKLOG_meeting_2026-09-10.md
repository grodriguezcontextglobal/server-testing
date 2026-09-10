# Backend: qué sale de la reunión, y el plan de concurrencia y volumen

> **Fuente:** transcripción de la demo con Fredrik y Cesar · **Revisado:** 2026-09-10
> Cada afirmación de estado está verificada leyendo el código, con `archivo:línea`.
> Lo que no pude verificar se dice como pregunta abierta, no como hecho.

---

## 1. El bug de la reunión, con causa raíz

**Minuto 25:20 → 27:03.** Fredrik asigna un dispositivo con un documento legal
adjunto, recibe `Request failed with status 400`, y al reintentar le sale *"These
units are no longer available in this location"*. Su diagnóstico es correcto:

> *"if you are going to give an error message, it should not be transferred"*

Y el suyo del efecto en el usuario también:

> *"now if this was somebody else, they would just be confused here, couldn't
> click on anything, and then they would cancel, and then they wouldn't know
> that the unit was assigned already"*

> **CORRECCIÓN (2026-09-10, después de leer el handler).** La primera versión de
> esta sección culpaba a `insertNewRowINMemberAssignedDeviceTableForLeaseTracking`
> por no abrir transacción. **Es falso, y la conclusión cambia entera.** Ese
> handler tiene **seis retornos 4xx y los seis van antes** de su único
> `INSERT INTO member_assigned_device_lease`: valida y luego escribe, que es el
> orden correcto, y una sola sentencia es atómica por sí misma.
>
> La causa real es peor, porque ninguna transacción la puede arreglar. **La
> entrega de un equipo son dos llamadas a dos procesos distintos:**
>
> - Mover el ítem va por `/api/db_inventory/update-large-data`, que delega en el
>   **worker de Go** (de ahí que el fix de `returnedRentedInfo` necesitara un
>   `go build`, no un deploy de Node).
> - Registrar la cesión va por `POST .../new-member-assigned-device-lease`, que
>   escribe desde **Node** a MySQL. En toda esa familia de rutas
>   (`mysql/routes/members.js`) no hay ninguna que mueva el ítem.
>
> Así que el 400 del documento salta en la segunda llamada cuando la primera ya
> movió el equipo, y **una transacción de MySQL abierta en Node no puede cubrir
> una escritura que hace otro proceso**. Es exactamente lo que advierte
> `DESIGN_go_incremental_services.md` §1.3: *"las transacciones no cruzan
> procesos... la unidad que se puede mover es la operación transaccional
> completa, no el archivo"*.
>
> **El arreglo, entonces, no es envolver nada en `beginTransaction`.** Es un
> endpoint único que posea la entrega completa —validar todo, incluido el
> documento que produjo el 400, y solo entonces escribir ambas cosas— o que la
> operación sea un job de la cola que la posea de principio a fin. Las dos son
> aditivas: no rompen el contrato actual, y el frontend migra cuando pueda.
>
> Lo que sigue abajo (el recuento de escrituras sin transacción) **sigue siendo
> válido y sigue siendo deuda real**, solo que no es la causa de lo que vio
> Fredrik.

**Escrituras sin transacción, medido** — deuda real, aunque no sea la causa de §1:

| Fichero | Sentencias de escritura | Bloques `beginTransaction` |
|---|---|---|
| **`mysql/controllers/members.js`** | **8** | **0** |
| `mysql/controllers/lease.js` | 4 | 0 |
| `mysql/controllers/school.js` | 10 | 2 |
| `mysql/controllers/item.js` | 26 | 6 |

### El caso concreto encontrado al verificar esto

`updateSubLocation` (`mysql/controllers/item.js:3172`) renombra una locación o
sub-locación y **propaga el nombre nuevo a `item_inv` con un segundo `UPDATE`,
sin transacción**. Tiene dos caminos y los dos son iguales:

| Camino | Escritura 1 | Escritura 2 |
|---|---|---|
| `currentIndex === 0` | `UPDATE locations SET location_name` | `UPDATE item_inv SET location` |
| `currentIndex > 0` | `UPDATE sub_locations SET name` | `UPDATE item_inv` con el path nuevo |

Si la segunda falla, la locación queda renombrada y **los ítems siguen
apuntando al nombre viejo**: desaparecen de la locación nueva sin aparecer en
ninguna otra. Es el mismo tipo de daño que vio Fredrik —estado a medias que
nadie deshace— y este sí se arregla con una transacción.

**Con una trampa que hay que resolver al hacerlo:** el handler tiene varios
`return res.status(404)` en medio. Un `return` dentro de una transacción sin
`rollback` devuelve la conexión al pool **con la transacción abierta**, y
`mysql2` no la deshace al liberarla: la hereda quien la reciba después. Bajo
carga eso agota el pool, que es precisamente un fallo de concurrencia. La forma
correcta es convertir esos retornos en excepciones con `statusCode` —el patrón
que `performUpdateLargeData` ya usa en este mismo fichero— y dejar que un solo
`catch` haga rollback y un solo `finally` libere.

---

## 2. Lo que ya está implementado (y por qué en la demo no se vio)

| Punto de la reunión | Estado real |
|---|---|
| MFA (`45:01`) | **Hecho.** `speakeasy` en dependencias, y en la demo salió activo |
| Renombrar roles (`43:51`) | **Hecho.** Es lo que Gustavo mostró; los roles por categoría están en producción desde julio |
| Identificadores escaneables / RFID por serial (`7:06`) | **Hecho.** Tabla `item_identifier`, `normalizeIdentifier()`, `reconcile()` y las rutas de registro están en producción, con el binario del worker verificado el 09-sep |
| Audit trail de un ítem (`57:44`) | **Hecho, y Fredrik lo reconoce**: es el *custody history*. Solo hay que llamarlo audit trail |
| Registro de actividad de staff (`55:14`) | **Hecho.** `POST`/`GET /api/admin/activity-logs` |
| Pie de correo *"unmonitored account, do not reply / contact"* (`35:13`) | **YA EXISTE** en el chasis: `nodeMailer/emailLayout.js:321-322`, con variante que incluye el contacto |

Ese último merece detenerse, porque explica el resto. El pie que Fredrik pide ya
está escrito **en el chasis de plantillas** — pero el recordatorio que él recibió
no lo mostraba. La conclusión es que **esa plantilla no pasa por el chasis**, que
es exactamente el hueco que el frontend preguntó por su lado
(`BACKEND_email_branding_coverage_REPLY.md`).

**Son la misma tarea con dos peticionarios distintos.** Migrar las plantillas
pendientes al chasis le da a Fredrik su pie de correo y al frontend su cobertura
de branding, de una vez.

---

## 3. Tareas de backend pendientes, de la reunión

Ordenadas por lo que cuesta y lo que rompe si no se hace.

1. **Atomicidad del flujo de asignación** (§1). Es la única de esta lista que
   ya causó un dato incorrecto delante del cliente.
2. **Dirección no obligatoria** (`24:43`). Fredrik lo pidió dos veces y dio el
   motivo: *"most of these answers are going to be the school address... do you
   really need to have that in this database? Probably not."* Es relajar una
   validación; hay que localizarla porque puede estar en el backend, en el
   frontend, o en ambos.
3. **Migrar al chasis las plantillas que faltan** (§2), empezando por el
   recordatorio a miembros y `massive-event-customer-notification`, el mensaje a
   todos los asistentes de un evento.
4. **Cabecera del correo con el nombre de la cuenta** (`33:47`): *"This message
   was sent from Bridges Public Charter School's inventory system"*. El chasis ya
   recibe el branding de la compañía, así que sale del mismo trabajo del punto 3.
5. **Audit trail por entidad** (`55:48`-`56:31`). Hoy hay un registro global;
   Fredrik quiere el de *la cosa que estás mirando*, como Bill.com con una
   factura. Es una consulta filtrada por entidad, no un sistema nuevo.
6. **Desambiguar usuarios en el audit trail** (`56:31`). Dos apellidos iguales en
   un colegio de 200 empleados es el caso normal, no el raro. Gustavo propuso
   combinar con el email, que es único; hay que devolverlo en la consulta.
7. **Enum de condición de devolución** (`39:25`). Quitar `none` como opción y
   describir `network` y `hardware`. Si la validación del enum está en el
   backend, es cambio de contrato: coordinarlo con el frontend.
8. **Deduplicar seriales al escanear** (`10:29`). Fredrik preguntó qué pasa si
   escanea dos veces el mismo y la respuesta quedó a medias. Ojo con una trampa
   ya documentada: `item_inv` **tiene seriales duplicados por diseño** en
   producción, así que la deduplicación es por lote de escaneo, no un UNIQUE en
   la tabla.
9. **Ingesta del lector RFID no-HID (OR2505)** (`1:00:17`-`1:04:42`). Ver §4.E:
   es la única tarea de la reunión que es de volumen, no de corrección.

### Lo que NO es backend, para no gastar tiempo ahí

- **Logo y 4 páginas duplicadas en los recibos** (`37:20`, `45:13`). El backend
  **no genera PDFs**: no hay ninguna librería de PDF en `dependencies`, así que
  la impresión es del cliente. Lo único que le toca al servidor es servir el
  logo de la compañía, que ya está en el registro de compañía.
- Renombrar "staff activity" a "audit trail", el botón *add new member* fuera de
  lugar, el asterisco de campo obligatorio, la X para vaciar un select, y toda
  la terminología *members* vs *students*.
- Roles personalizados con matriz de permisos al estilo QuickBooks/Bill.com
  (`46:29`-`55:05`): la UI es de Cesar, pero **necesita backend nuevo** — ver §5.

---

## 4. Concurrencia, volumen y peticiones que se quedan muertas

Esta es la parte que Fredrik no pidió y que su bug ilustra perfectamente: el
problema no fue la carga, fue que **una operación a medias no se deshizo y el
cliente se quedó colgado**. Eso es lo que hay que atacar, en este orden.

### A. Atomicidad — el que ya nos costó un dato malo

Lo de §1, generalizado: hay 20 ficheros de controlador con escrituras y **siete
de ellos no abren una transacción jamás** (`members.js`, `lease.js`,
`categories_groups.js`, `events.js`, `consumer.js`, `location_manager.js`,
`sub_location.js`, `stripe.js`). No todos la necesitan — una escritura suelta no
la necesita — pero los de cesiones y asignaciones sí, porque tocan varias tablas
por operación.

**Criterio para no revisar 20 ficheros a ciegas:** hace falta transacción cuando
un handler escribe en **más de una tabla** o cuando valida **después** de
escribir. Ese segundo caso es el que produce el bug de Fredrik y se detecta
buscando `status(4xx)` por debajo de un `INSERT`/`UPDATE` en el mismo handler.

### B. Idempotencia — hoy no protege nada

`middlewares/idempotencyMutationCache.js:4` es un `new Map()` **en memoria del
proceso**, y producción corre **cuatro procesos** bajo `pm2-runtime -i max`. Dos
peticiones con la misma clave que caigan en workers distintos **pasan las dos**.

Es el middleware que debería evitar cobros dobles y asignaciones dobles, y es
justo el escenario de la reunión: el usuario recibe un 400, reintenta, y sin
idempotencia el reintento vuelve a ejecutar lo que ya se había ejecutado.

**El arreglo no necesita infraestructura nueva:** `redis` y `rate-limit-redis`
ya están en `dependencies`, y Redis ya está en uso (`clientRedis()`). Es mover
el store.

### C. La cola es la parte buena — hay que extenderla

Lo que ya está bien y conviene no rediseñar: `queue/worker.js` reclama trabajo
con `claimOne()` usando un `findOneAndUpdate` **atómico**, y tiene
`recoverStale()` para lo que quedó a medias. Eso significa que **un job aceptado
no se pierde aunque el servidor se caiga en medio** — es exactamente la garantía
que se pide en "que no queden peticiones pendientes muertas", y ya existe.

Dos límites conocidos:

1. **Los jobs no corren en paralelo**: cada worker drena de uno en uno, así que
   un insert de 15.000 seriales retiene el tick. La respuesta hasta ahora ha
   sido separar servicios (`EmailWorker`, `BulkWorker`, `DeleteWorker`), que
   funciona pero no escala indefinidamente. El siguiente paso es concurrencia
   dentro del worker: reclamar N y procesarlos con un pool acotado.
2. **El patrón híbrido ya resuelve lo del cliente colgado.**
   `helpers/queuedController.js` espera el resultado hasta 4 s y si no degrada a
   `202` con un `jobId`. Extender ese patrón a la asignación y la entrega es lo
   que evita literalmente la pantalla congelada que describió Fredrik: o
   responde con el resultado, o responde con un identificador que se puede
   consultar. Nunca queda nada en el aire.

### D. Estado en memoria que rompe con varios procesos

Tres cosas más, todas del mismo tipo:

- **Rate limit**: `index.js:82` usa el store en memoria, así que con cuatro
  procesos el límite real por IP es ~4×300, no 300 — y `API_CLIENT_GUIDELINES.md`
  §1 le promete 300 al cliente. `rate-limit-redis` está instalado y sin usar.
- **Caché** (`cache/cacheInstance.js`, `node-cache`): es por proceso, así que hay
  cuatro cachés que divergen. Con lecturas de inventario esto se nota como "guardé
  y sigo viendo lo viejo" según a qué worker caiga la petición.
- **Circuit breaker** hacia el worker de Go (`helpers/circuitBreaker.js`): su
  estado también es por proceso, así que un worker puede tenerlo abierto y los
  otros tres seguir intentando.

### E. Volumen: el perfil de carga nuevo que trae la reunión

El lector **OR2505** que Fredrik quiere para las demos (`1:03:07`: *"I bring my
cart with me with 100 receivers in it... we just scan all these ones in"*) no es
un teclado: no es HID, así que no entra por el mismo camino que el 08.

Eso es una **ingesta por lotes**, y las piezas ya existen de la Fase RFID: la
tabla `item_identifier`, `normalizeIdentifier()` y `reconcile()` con techo de
2000 identificadores. Lo que falta es el endpoint que reciba el lote del SDK del
lector y lo pase por la cola devolviendo un `jobId`. Con eso, 100 o 1.000 tags
en una pasada son un job, no 1.000 peticiones HTTP.

Y un desperdicio concreto en el camino más caliente del módulo escolar:
`members.js` hace **`SHOW COLUMNS`** siete veces, una por petición, para
descubrir el esquema antes de escribir. Es un viaje extra a la base de datos en
cada asignación, contra un disco que ya medimos lento. Se resuelve leyendo el
esquema una vez al arrancar.

### F. No se puede optimizar lo que no se mide

`BACKLOG_infra.md` T1 sigue entero: no hay `/ready` que distinga "vivo" de
"listo", no hay latencia ni tasa de error **por endpoint**, y no hay alertas.
`GET /health` devuelve `{"server":"standby"}` con la cadena **fijada en el
código** (`index.js:224`) y sin tocar la base de datos, así que responde `ok`
aunque MySQL esté caído.

Sin p95 por ruta, cualquier decisión sobre concurrencia es una apuesta. Es la
tarea que paga las otras: la Fase 0 de la migración a Go pide el mismo dato.

### G. El techo de la topología actual

Producción es **una** VM Windows con cuatro procesos Node detrás de IIS. Antes
de poder poner una segunda máquina hay que cerrar B y D, y además:

- **Los schedulers eligen dueño por "primera instancia" de la máquina**
  (`index.js:356`). Con dos máquinas, cada una tiene su primera instancia y los
  recordatorios se disparan dos veces. Hace falta un lock fuera del proceso.
- El `connectionLimit` de MySQL se multiplica por número de procesos y hay que
  contarlo contra el límite de la cuenta de PlanetScale.

---

## 5. Roles personalizados: lo que Fredrik pidió necesita backend

Lo de `46:29`-`55:05` no es UI. Hoy el sistema tiene **roles con niveles fijos**
(`root_admin`=0 … `category_assistant`=9) y los permisos se comprueban con
`authorizePermission` / `authorizeMongoPermission` contra ese nivel. Renombrar un
rol ya funciona; lo que Fredrik enseñó de QuickBooks es otra cosa:

> *"you can go in and they can view, they can create, they can edit, they can
> delete... and then you can save that to a particular role"*

Eso es un **catálogo de permisos** y una **matriz por rol**, con roles creados
por el cliente. Implica tabla de permisos, tabla rol↔permiso, y que los
middlewares consulten la matriz en vez del nivel. Es la tarea más grande de toda
la reunión y conviene dimensionarla aparte antes de prometer fecha.

Nota de camino: FedRAMP (`1:06:52`) empuja en la misma dirección — control de
acceso granular y audit trail son dos de sus controles. Y ahí también cuenta lo
que cerramos ayer: `/api/company` tenía 17 rutas sin autenticación de 18.

---

## 6. Orden propuesto

```
1. Transacción en el flujo de asignación        ← el bug de la demo, sin infra nueva
2. Idempotencia a Redis                         ← hace seguros los reintentos
3. Métricas por endpoint + /ready real          ← para que lo demás se mida
4. Plantillas al chasis                         ← pie de correo (Fredrik) + branding (frontend)
5. Rate limit a Redis · decidir la caché
6. Concurrencia en el worker + híbrido 202 en escrituras lentas
7. Ingesta por lotes del OR2505
8. Audit trail por entidad + email en el listado
9. Lock de schedulers fuera del proceso         ← requisito para una 2ª máquina
10. Roles personalizados                        ← dimensionar antes
```

Los tres primeros son los que cambian el comportamiento en producción esta
semana. El 1 evita repetir el dato incorrecto que vio el cliente, el 2 hace que
un reintento no duplique nada, y el 3 es lo que convierte "mejorar la
concurrencia" en algo medible en vez de una intuición.
