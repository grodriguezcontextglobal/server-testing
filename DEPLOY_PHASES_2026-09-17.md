# Fases que faltan para desplegar lo hecho

> **Situación:** `origin/main` está en `7074f67`. Producción corre una
> compilación **anterior al 10 de septiembre**, así que le faltan **31 commits**,
> 20 de ellos con efecto en runtime.
>
> Verificado por sondeo HTTP el 2026-09-17 contra el servidor real:
>
> ```
> GET /health        200  {"server":"standby","status":"operational"}
> GET /ready         404  Cannot GET /ready
> GET /api/metrics   404
> ```
>
> `/ready` y `/api/metrics` los introdujo `ab4dd86` (10-sep). Quien responde el
> 404 es el propio Express, no un proxy. El corte es inequívoco: lo último
> desplegado es `c13cfd2` o anterior.
>
> Complementa a `DEPLOY.md`, que tiene los comandos y las trampas de la máquina.
> Esto es el **orden**, y por qué no se puede hacer de una vez.

---

## 0. La razón por la que esto necesita fases

`git pull` en la VM trae los 31 commits **de golpe**, y entre ellos están los
que cambian el contrato de siete rutas. No hay forma de separarlos tirando de
`main`: hay que **desplegar a un commit concreto**.

El corte limpio es `94d7076`. Todo lo anterior es aditivo o interno; lo que
viene después rompe.

Con una trampa, y es la razón de que la Fase 1 no sea "haz checkout y ya":
**`8f9edab`, el arreglo que hace legible `/api/metrics`, está DESPUÉS del bloque
que rompe.** Desplegar hasta `94d7076` a secas deja el endpoint de métricas
devolviendo 401 a todo — justo lo que la Fase 2 necesita leer.

**Comprobado, no supuesto:** `8f9edab` se hace cherry-pick sobre `94d7076` sin
conflicto, y esa combinación pasa la suite — **1272 tests, 1271 en verde**, con
el único fallo el preexistente de `routes/auth.js`.

---

## Lo que NO hace falta en ninguna fase

Verificado sobre el rango `c13cfd2..HEAD`:

| | |
|---|---|
| `npm ci` | **No.** `package.json` y `package-lock.json` no cambian. Vale `git pull` + `nssm restart`, o `deploy-node.ps1 -SkipInstall` |
| Migraciones SQL | **No.** Ningún `.sql` tocado |
| `go build` | **No.** `go-worker/` no cambia. El worker de Go se queda como está |
| Variables obligatorias | **No.** Las tres nuevas tienen default seguro (ver Fase 0) |

Es decir: el despliegue en sí es barato. Lo que cuesta es el **orden** y dos
interruptores que no son inocuos.

---

# Fase 0 · Prevuelo

**Dónde:** en la VM, sin desplegar nada todavía.
**Bloquea a:** todo.

### 0.1 · El estado de git en la VM, primero

No es paranoia: el `main` de la VM ya pisó a `origin` una vez y **borró tres
ficheros**, que hubo que recuperar con `e27aa4d`. Antes de tirar de nada:

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git status
git log --oneline -5
git stash list
```

Si hay commits locales o cambios sin commitear, **parar y resolverlo aquí**. Un
`git pull` sobre eso es como se perdieron los ficheros la vez anterior.

### 0.2 · Las tres variables nuevas

Ninguna es obligatoria; todas tienen default seguro. Se listan para que nadie
las descubra en caliente:

| Variable | Default | Qué pasa si no se pone |
|---|---|---|
| `COMPANY_AUTH_MODE` | `warn` | Registra los accesos sin sesión a `/api/company` y **no bloquea**. Es lo que queremos en Fase 1 |
| `PAYMENTS_MUTATION_IDEMPOTENCY_STORE` | `auto` | Usa Redis si hay `REDIS_HOST`/`REDIS_PASSWORD`; si no, memoria del proceso |
| `PAYMENTS_MUTATION_IDEMPOTENCY_INFLIGHT_TTL_MS` | `30000` | Vida de una reserva sin respuesta |

### 0.3 · Dos decisiones que hay que tomar ANTES, no durante

**(a) ¿Quién va a drenar el grupo `heavy`?** — Es la más importante de todo este
documento. Ver Fase 1.1.

**(b) ¿Lecturas de Mongo desde secundaria, sí o no?** — `MONGO_SECONDARY_READS`
**viene en `on` por defecto**, así que el despliegue las activa solo. Si no se
quiere todavía, hay que poner `MONGO_SECONDARY_READS=off` en el `.env` **antes**
de reiniciar. Es un interruptor, no un cambio de código: se puede volver atrás
sin desplegar nada.

### 0.4 · Comprobaciones de entorno

```powershell
node --version            # >= 20.11.0; .npmrc tiene engine-strict
nssm status DevitrakServer
nssm status DevitrakGoWorker
nssm status DevitrakEmailWorker
nssm status DevitrakBulkWorker
nssm status DevitrakDeleteWorker
```

Redis tiene que estar accesible: las métricas agregan el cluster por Redis y la
idempotencia de pagos reserva allí. Ninguna de las dos tumba el servidor si Redis
falla, pero **degradan de forma distinta y conviene saber cuál es cuál**:

| | Si Redis no responde | ¿Avisa? |
|---|---|---|
| Idempotencia de pagos | Cae al `Map` por proceso — con cuatro procesos deja de proteger contra el cobro doble | **Sí**, registra (como mucho una vez por minuto) |
| Métricas | `flush()` repone los contadores en memoria y no se pierde el dato, pero no llega a Redis | **No. En silencio** — `startFlushing` hace `flush().catch(() => {})` |

O sea: si Redis se cae, **no habrá ninguna línea de log diciendo que las métricas
dejaron de agregarse**. El síntoma es `/api/metrics` devolviendo `503 metrics
unavailable` (la lectura sí falla fuerte) y `/ready` marcando Redis como
degradado. Mirar esos dos, no los logs.

---

# Fase 1 · Observabilidad y lo aditivo

**Qué entra:** `c13cfd2..94d7076` + `8f9edab`.
**Rompe contrato:** no.
**Bloquea a:** Fase 2.

Trae las métricas por endpoint, el `/ready` real, la página de estado, el
control de acceso de `/api/company` **en modo observación**, el trabajo de
capacidad, las lecturas desde secundaria, el grupo `heavy` y las tres rutas
nuevas de inventario (que nadie llama todavía).

### 1.1 · ⚠️ Antes de reiniciar: dar consumidor al grupo `heavy`

Tres tipos de job —`inventory:bulk-insert-alphanumeric`,
`inventory:bulk-update-alphanumeric` y `event:bulk-update-item-shipping`— no
estaban en ningún grupo, así que los drenaba `DevitrakServer` dentro de los
procesos que atienden login y pagos. Con este código pasan a tener grupo propio,
y `DevitrakServer` (que excluye `dedicated`) **deja de tomarlos en cuanto
arranque**.

> **Si nadie sirve `heavy`, esos jobs se quedan encolados para siempre, sin
> error y sin que nada lo señale.**

Dos salidas, las dos válidas:

```powershell
# OPCIÓN A — rápida, sin servicio nuevo. Comparte worker con bulk.
nssm set DevitrakBulkWorker AppEnvironmentExtra QUEUE_GROUP=bulk,heavy
nssm restart DevitrakBulkWorker
```

```powershell
# OPCIÓN B — correcta. Servicio propio, poll normal porque nadie espera.
#   (seguir el patrón de DevitrakBulkWorker en DEPLOY.md § "Split services")
#   QUEUE_GROUP=heavy
```

**El orden importa:** arrancar el consumidor **antes** de reiniciar
`DevitrakServer`. Al revés queda una ventana sin nadie tomando esos tipos.
Durante el solape compiten, y eso es inofensivo: el claim es atómico.

### 1.2 · Preparar la rama de despliegue

Desde la máquina de desarrollo, no en la VM:

```powershell
git checkout -b release/observabilidad 94d7076
git cherry-pick 8f9edab
git push origin release/observabilidad
```

### 1.3 · Desplegar

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git fetch origin
git checkout release/observabilidad

# package-lock NO cambia en este rango, así que no hace falta npm ci
nssm restart DevitrakServer
```

### 1.4 · Verificar

```powershell
nssm status DevitrakServer                                        # SERVICE_RUNNING
(Invoke-WebRequest "http://localhost:34001/health" -UseBasicParsing).Content
(Invoke-WebRequest "http://localhost:34001/ready"  -UseBasicParsing).Content
Invoke-RestMethod "http://localhost:34001/api/metrics?hours=1" -Headers @{ "x-token" = $token }
```

Las tres tienen que responder. **`/ready` y `/api/metrics` daban 404 antes de
esta fase: que respondan es la prueba de que el despliegue entró.**

Y comprobar que el grupo `heavy` tiene quien lo drene:

```powershell
Invoke-RestMethod "http://localhost:34001/api/jobs/stats" -Headers @{ "x-token" = $token }
```

### 1.5 · Vuelta atrás

`git checkout c13cfd2` + `nssm restart DevitrakServer`. Sin migraciones que
deshacer y sin `node_modules` que reinstalar, la vuelta atrás es un checkout.
Si se tocó `QUEUE_GROUP` del BulkWorker, revertirlo también.

---

# Fase 2 · Medir

**Duración:** 3 días como mínimo.
**Bloquea a:** Fases 4 y 5.

Es la fase que no se puede acelerar, y la única entrada real que tienen las dos
decisiones que quedan.

### 2.1 · La ventana son 3 horas, no 3 días

`METRICS_WINDOW_TTL_S` son 3 h y la ruta topa `hours` en 3. **`/api/metrics` no
acumula días: muestra las últimas tres horas.** Ampliarlo no es subir la
constante — la consulta hace un `KEYS` de Redis por cada hora de la ventana, y
eso bloquea; haría falta un índice de claves.

**Consecuencia operativa:** hay que **muestrear varias veces al día y guardar la
salida**, no mirar una vez al final. Una ruta muy llamada sale en cualquier
muestra; un botón que se usa dos veces al día **puede dar cero y parecer que no
lo usa nadie**.

### 2.2 · Qué se está buscando

1. **Las cuatro rutas que hoy devuelven 401** y que la Fase 4 despierta:
   `POST /api/db_identifier/register`, `/register-bulk`,
   `DELETE /api/db_consumer/:id` y `DELETE /api/db_event/:id`. Si acumulan 4xx,
   alguien las llama y hay que hablar con el frontend antes de la Fase 4.
2. **Las siete rutas que cambian de contrato**, para saber a quién rompen.
3. **Tráfico sin sesión a `/api/company`**, que es lo que siembra la lista de
   exenciones de la Fase 5:

```powershell
Select-String -Path "C:\Users\CGAdmin\Documents\Github\server-testing\logs\*.log" `
  -Pattern "company: unauthenticated request allowed"
```

---

# Fase 3 · Cerrar con el frontend

**Bloquea a:** Fase 4.
**En paralelo con:** Fase 2.

Está todo en `FRONTEND_work_order_2026-09-16.md`. Faltan **cuatro respuestas**:

1. De las cuatro rutas en 401: cuáles llaman, si mandan `company_id` en la query,
   y qué hace su UI con un 401.
2. Cuántos consumidores tienen `db_item/inventory-pagination` y las tres rutas
   sin gemelo.
3. Confirmación de que el **409** de pagos se trata como "petición en curso" y
   sin reintento automático.
4. Si borran consumidores que aún no asisten a ningún evento (la limitación
   conocida del scope de `deleteCustomer`).

La 3 es la que más riesgo tiene de empeorar las cosas si se ajusta deprisa: un
reintento automático sobre un 409 convierte la protección en un bucle.

---

# Fase 4 · Lo que rompe contrato

**Qué entra:** `94d7076..7074f67` (el resto).
**Requiere:** Fases 2 y 3 cerradas.

Siete rutas cambian de contrato, cuatro rutas muertas despiertan, y el borrado
de consumidor pasa a tener scope de compañía.

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git fetch origin
git checkout main          # 7074f67
nssm restart DevitrakServer
```

### Qué vigilar las primeras horas

- **401 nuevos** en las seis rutas endurecidas → algún cliente no manda `x-token`.
- **400 `Unsupported filter(s)`** en las dos de paginación → filtro fuera de la
  lista blanca.
- **404 en `DELETE /api/db_consumer/:id`** → o es de otra compañía, o es un
  consumidor sin ningún evento (limitación conocida del esquema).
- **409 en las ocho rutas de Stripe** → correcto por diseño; lo que no es
  correcto es que se repitan en bucle desde el mismo cliente.

### Vuelta atrás

`git checkout release/observabilidad` + restart. Vuelve a la Fase 1 sin perder
la observabilidad, que es exactamente para lo que existe esa rama.

---

# Fase 5 · Cutovers a `enforce`

**Requiere:** Fase 2, con días de tráfico real.

Dos interruptores, cada uno con su evidencia. **No a la vez.**

| Variable | De | A | Evidencia previa |
|---|---|---|---|
| `COMPANY_AUTH_MODE` | `warn` | `enforce` | Las líneas `company: unauthenticated request allowed` de los logs, volcadas en `PUBLIC_ROUTES` **antes** de enforce |
| `NODEMAILER_AUTH_MODE` | `warn` | `enforce` | Ya documentado en `DEPLOY.md` § Notificaciones |

> Poner `enforce` a ciegas es lo que dejó
> `POST /api/db_company/delete-bulk-items` respondiendo 403 a un flujo real
> durante tres semanas en julio. La lista de exenciones de `/api/company` está
> **sembrada a partir de los nombres de las rutas, no de evidencia** — por eso
> esta fase va después de medir, y no antes.

---

# Fase 6 · Dependabot

**Independiente.** Puede correr en paralelo desde ya.

Ocho ramas abiertas. `npm audit` local está en **0**, así que ninguna es urgente:

- **En tanda:** `npm-menores`, `dotenv`, `stripe 22.6.1`, `go-menores`, las dos
  de Docker.
- **`express-rate-limit 8.7.0`:** mirarla junto al trabajo pendiente de mover el
  rate limit a Redis, no antes.
- **`express 5`, aparte y con calma:** cambia el manejo de errores asíncronos y
  este repositorio depende de `express-async-errors`.

Esta tanda **sí** toca `package-lock.json`, así que aquí ya no vale el atajo:
toca `deploy-node.ps1` completo, con sus cinco trampas.

---

## Resumen

```
Fase 0  Prevuelo ····························· 1 h    bloquea a todo
Fase 1  Observabilidad + aditivo ············· 1 h    ← se puede hacer HOY
Fase 2  Medir ······························· 3 días  no se puede acelerar
Fase 3  Respuestas del frontend ············· ?       en paralelo con la 2
Fase 4  Cambios que rompen ·················· 1 h    requiere 2 y 3
Fase 5  Cutovers a enforce ·················· 30 min  requiere 2, uno por vez
Fase 6  Dependabot ·························· aparte  independiente
```

**Lo único que está listo para hoy es la Fase 1**, y su valor es que sin ella no
hay con qué decidir el resto: hoy estamos eligiendo a ciegas porque el endpoint
que mide no existe en producción.

Los dos riesgos que no perdonan un despiste, los dos en la Fase 1: **dar
consumidor al grupo `heavy` antes de reiniciar**, y **decidir a conciencia lo de
`MONGO_SECONDARY_READS`**, que se activa solo.

---

# Fase 0 · Resultado de la revisión (2026-09-17)

Lo que se pudo comprobar desde la máquina de desarrollo está hecho. Lo que exige
estar en la VM queda listado con su comando, porque desde aquí no hay acceso.

## ✅ Verificado

| # | Comprobación | Resultado |
|---|---|---|
| 1 | ¿Hace falta `npm ci`? | **No.** `c13cfd2..HEAD` no toca `package.json` ni `package-lock.json` |
| 2 | ¿Migraciones SQL? | **Ninguna.** Cero ficheros `.sql` en el rango |
| 3 | ¿Rebuild del worker de Go? | **No.** `go-worker/` sin cambios |
| 4 | ¿Existe `deploy-node.ps1 -SkipInstall`? | **Sí**, `scripts/deploy-node.ps1:65` |
| 5 | Variables nuevas y sus defaults | 3, todas con default seguro (§0.2) |
| 6 | `MONGO_SECONDARY_READS` | Default **`on`** — `helpers/mongoRead.js:42`. Se activa solo al desplegar |
| 7 | Candidato de Fase 1 (`94d7076` + `8f9edab`) | Cherry-pick limpio, **1272 tests, 1271 en verde** (solo el fallo preexistente de `auth.js`) |

## ⚠️ El riesgo del grupo `heavy`, medido

No es una advertencia heredada del mensaje de un commit: se ejecutó
`resolveWorkerScope` con la configuración documentada de los cinco servicios.

```
DESPUÉS del deploy, sin tocar nada:
  DevitrakServer       QUEUE_EXCLUDE_GROUPS=dedicated  -> toma heavy: NINGUNO
  DevitrakBulkWorker   QUEUE_GROUP=bulk                -> toma heavy: NINGUNO
  DevitrakDeleteWorker QUEUE_GROUP=delete              -> toma heavy: NINGUNO
  DevitrakEmailWorker  QUEUE_GROUP=email               -> toma heavy: NINGUNO

Remedios, los dos funcionan:
  QUEUE_GROUP=bulk,heavy   -> toma los 3
  QUEUE_GROUP=heavy        -> toma los 3
```

`dedicated` expande a la **unión de todos los grupos** (`constants/queueTypeGroups.js:92`),
y `heavy` es ahora uno de ellos. Por eso el server deja de tomarlos.

### Qué deja de procesarse si no se hace nada

| Ruta | Qué hace |
|---|---|
| `POST /api/db_item/bulk-item-alphanumeric` | Alta masiva de inventario por serial alfanumérico |
| `POST /api/db_company/update-items-based-on-alphanumeric-serial-number` | Actualización masiva por criterio o lista de seriales |
| `PUT /api/db_item/event-items/bulk-update` | Actualización masiva de envío de equipos de un evento |

Las tres responden **`202 + jobId`**, así que el cliente ve éxito y el trabajo
**no se hace nunca**. Es el modo de fallo más caro de detectar.

### ⚠️ Pero antes: esto depende de una suposición sin verificar

Todo lo anterior asume que `DevitrakServer` tiene de verdad
`QUEUE_EXCLUDE_GROUPS=dedicated`. Sale de `DEPLOY.md`, no de la máquina. **Si
no la tuviera, no hay riesgo ninguno:**

```
DevitrakServer SIN QUEUE_EXCLUDE_GROUPS  -> toma heavy: 3/3  (no hay problema)
DevitrakServer CON dedicated             -> toma heavy: 0/3  (hay que dar consumidor)
```

Es la primera comprobación que hay que hacer en la VM, y decide si el paso 1.1
es obligatorio o innecesario.

## ⏳ Pendiente en la VM

Para pegar tal cual en PowerShell **como Administrador**:

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"

# --- 0.1 estado de git: lo que decide si se puede tirar de nada ---
git status
git log --oneline -3
git stash list

# --- LA COMPROBACIÓN QUE DECIDE EL PASO 1.1 ---
nssm get DevitrakServer AppEnvironmentExtra
nssm get DevitrakBulkWorker AppEnvironmentExtra

# --- 0.4 entorno ---
node --version                      # >= 20.11.0
nssm status DevitrakServer
nssm status DevitrakGoWorker
nssm status DevitrakEmailWorker
nssm status DevitrakBulkWorker
nssm status DevitrakDeleteWorker

# --- Redis, del que dependen métricas e idempotencia ---
Select-String -Path ".env" -Pattern "^REDIS_(HOST|PORT)="
```

Lo que hay que mirar en cada una:

1. **`git status` / `git log -3`** — si hay commits locales o cambios sin
   commitear, **parar**. El `main` de esta VM ya pisó a `origin` una vez y borró
   tres ficheros (`e27aa4d` fue el rescate). `git log -3` confirma además en qué
   commit está de verdad, que es el dato que el sondeo HTTP solo pudo acotar.
2. **`nssm get … AppEnvironmentExtra`** — decide si el paso 1.1 hace falta.
3. **`node --version`** — por debajo de 20.11.0, `engine-strict` hace fallar
   `npm` (no avisa: falla). No aplica a esta tanda, que no instala, pero sí a la
   Fase 6.
4. **Los cinco `nssm status`** — todos `SERVICE_RUNNING` antes de empezar. Si
   alguno ya está caído, eso es un problema anterior a este despliegue.
5. **`REDIS_HOST`** — si no está, métricas e idempotencia arrancan degradadas, y
   las métricas **lo hacen en silencio** (ver §0.4).

## Corrección respecto a la primera versión de este documento

Decía que si Redis falla «las dos degradan y lo registran». Es cierto para la
idempotencia de pagos; **no para las métricas**, que degradan sin escribir una
línea. Corregido en §0.4.
