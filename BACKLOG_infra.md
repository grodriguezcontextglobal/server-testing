# Backlog de infraestructura y operación

> Agendado el **2026-08-25**. Nada de esto está implementado.
> Cada tarea dice **qué ya existe** (con `archivo:línea`) para no re-estudiar lo
> estudiado, y **qué decisión** hace falta antes de empezar.
>
> Documentos relacionados que ya cubren parte del terreno:
> `DESIGN_go_migration.md` (migración a Go), `DESIGN_task_queue.md` (cola),
> `DEPLOY.md` (topología de servicios en prod).

---

## T1 · Monitoreo y estado del servidor, endpoints y microservicios

**Por qué va primero:** el instrumento que hace falta aquí es el mismo que pide la
Fase 0 de `DESIGN_go_migration.md` (tráfico por endpoint) y el que hace falta para
dimensionar T3/T5. Una sola instrumentación paga tres tareas.

Lo que ya hay:

- `GET /health` (`index.js:220`) y `GET /api/status` — *liveness* plano, sin
  dependencias: responden OK aunque MySQL, Mongo o Redis estén caídos.
- `requestLogger` + `securityLogger` (`middlewares/requestLogger.js`) escribiendo a
  winston: hay datos por request, pero **nadie los agrega**.
- `GET /api/jobs/stats` (`controller/jobs.js:80`, exige `requireSuperUser`) — estado
  de la cola.
- Circuit breaker hacia el Go worker (`helpers/circuitBreaker.js`) con su estado
  en memoria, **por proceso** y no expuesto.

Lo que falta:

1. **Readiness real** (distinto de liveness): un `/ready` que verifique MySQL, Mongo,
   Redis y el Go worker, con el detalle por dependencia. Hoy no hay forma de saber
   por qué el servidor "está arriba" pero falla todo.
2. **Métricas por endpoint**: contador y latencia (p50/p95/p99) + tasa de 4xx/5xx por
   ruta. Sin librería nueva se puede agregar en memoria y exponer un
   `GET /api/metrics` (protegido) — o `prom-client` si se quiere Prometheus.
3. **Estado de los microservicios**: `DevitrakServer`, `DevitrakGoWorker`,
   `EmailWorker`, `DevitrakBulkWorker` son servicios nssm independientes. Falta una
   vista que diga si cada uno está arriba, su última señal de vida y su versión.
4. **Panel**: una página que consuma lo anterior. Candidato natural: un artifact o
   una ruta estática servida por el propio servidor.
5. **Alertas**: al menos 5xx sostenidos, cola con jobs `failed` acumulados, y worker
   caído. Hoy la detección es "alguien se da cuenta".

Esfuerzo: 2–3 semanas. Decisión pendiente: **Prometheus/Grafana o algo propio y
mínimo** (para el tamaño actual, propio y mínimo alcanza).

---

## T2 · Vulnerabilidades reportadas por GitHub (Dependabot)

Estado al último push: **39 alertas — 9 críticas, 15 altas, 13 moderadas, 2 bajas**
en la rama default.

Plan:

1. `npm audit --json` y cruzarlo con Dependabot para separar lo que está en el
   **camino de ejecución** de producción de lo que es transitivo de `nodemon`/dev.
2. `npm audit fix` para lo que sea semver-compatible, y revisar a mano los majors.
   Ojo con los tres que arrastran comportamiento: `mongoose` 8 (ya nos mordió al
   quitar paths del schema), `express` (4→5 cambia el manejo de errores async, y el
   repo depende de `express-async-errors`) y `stripe` (versión de API fijada).
3. Correr `npm test` (954 casos) después de cada tanda; son la red que hace esto
   viable sin QA manual.
4. Documentar lo que se decida **no** arreglar y por qué (versión mayor con
   breaking changes, o vulnerabilidad no alcanzable desde nuestro código).

Esfuerzo: 1 semana para la tanda segura; los majors por separado.
Nota: la migración a Go (`DESIGN_go_migration.md`) elimina a la larga la mayor parte
de esta superficie, pero **no es excusa para no parchear ahora**.

---

## T3 · Diseño escalable para tráfico alto

**No empezar de cero:** ya hay un estudio de escalado horizontal (2026-07-19) con
veredicto *factible* y 4 huecos. Estado hoy de esos huecos:

| Hueco del estudio | Estado hoy |
| --- | --- |
| Rate limit en memoria | **ABIERTO** — y peor de lo que decía: `rate-limit-redis` está en `package.json` pero **no se usa**; el limitador de `index.js:82` usa el store en memoria, así que con el cluster de 4 procesos el límite real ya es ~4×300 por IP, no 300. `API_CLIENT_GUIDELINES.md` §1 le promete 300 al cliente. |
| Colocación de workers (api vs worker) | **CERRADO** en la topología nssm (`DevitrakServer` / `GoWorker` / `EmailWorker` / `BulkWorker` separados) |
| Secretos fuera del `.env` en disco | ABIERTO |
| Plataforma (Windows+nssm → contenedores Linux) | ABIERTO, y es la decisión grande |

Lo que hay a favor (verificado): la cola es segura para N consumidores
(`queue/worker.js` `claimOne()` con `findOneAndUpdate` atómico + `recoverStale()`),
la API es stateless por JWT, no hay websockets y las subidas van a S3.

Lo que falta revisar y no estaba en el estudio:

1. **Caché en memoria**: `cache/cacheInstance.js` (`node-cache`) es por proceso. Con
   N réplicas hay N cachés divergentes; hay que decidir Redis o aceptar la deriva.
2. **Caché de idempotencia**: `middlewares/idempotencyMutationCache.js:4` es un
   `new Map()` en memoria del proceso. Con el cluster de 4 procesos **ya no
   protege**: dos requests con la misma clave que caigan en workers distintos pasan
   las dos. Es el middleware que debería evitar cobros dobles, así que esto es un
   hallazgo de hoy, no solo un riesgo de escalado. Fix: mover el store a Redis.
3. **Límite de conexiones**: `connectionLimit` de MySQL × réplicas contra
   `PLANETSCALE_DATABASE_LIMIT`.
4. **Schedulers**: hoy están bien — `index.js:356` los arranca dentro del guard
   `isNativeMaster || isPM2FirstInstance`, así que solo un proceso corre los cron, y
   el trabajo encolado es idempotente. El problema aparece **con varias máquinas o
   contenedores**: cada uno tendría su propia "primera instancia" y los
   recordatorios se dispararían N veces. Hace falta un dueño elegido fuera del
   proceso (lock en Redis o Mongo) antes de replicar.

Esfuerzo: 1 semana de revisión + el trabajo que decida. Decisión pendiente:
**contenedores/orquestador (Swarm vs ECS/K8s) o quedarse en Windows y escalar
verticalmente**; el estudio previo se inclina por contenedores, con la nota de que
Swarm está en modo mantenimiento en la industria.

---

## T4 · Qué responde inmediato y qué se encola

Ya existe la maquinaria: `DESIGN_task_queue.md`, `helpers/queuedController.js`
(`createQueuedJobController`), `nodeMailer/queueEmail.js` y 14 handlers en
`queue/handlers/`. Lo que falta no es infraestructura, es **la política escrita y
aplicada de forma consistente**.

Plan concreto (y hay una herramienta lista para hacerlo bien):

1. Partir de `docs/api-payloads.json` (486 endpoints ya inventariados) y clasificar
   cada uno en: **inmediato** (el cliente necesita el dato para pintar la pantalla),
   **encolable** (efecto secundario: email, bulk, webhook, log) o **híbrido**
   (`test/syncOrQueuedController.test.js` ya cubre ese patrón).
2. Criterios propuestos, para no decidir caso por caso:
   - Todo lo que sea **email o notificación** → encolado, siempre (ya lo está).
   - Toda operación **bulk sobre inventario o miembros** → encolada (ya lo está en
     4 de ellas; confirmar que no quedó ninguna síncrona).
   - **Lecturas** → inmediatas, con caché donde duela.
   - **Escrituras que el usuario espera confirmar** (asignar dispositivo, cobrar) →
     inmediatas, pero con idempotencia obligatoria.
   - Cualquier handler que hoy tarde **> 2 s en p95** → candidato a cola, y la
     medición sale de T1.
3. Salida: una columna nueva en la tabla del contrato (`sync` / `queued` / `hybrid`)
   y la lista de los que hay que mover.

Esfuerzo: 1 semana de clasificación (sale casi toda del inventario) + lo que se
mueva. **Depende de T1** para el criterio de los 2 s.

Detalle encontrado de paso: `index.js:110` reserva límite de body de 100MB para
`/api/nodemailer/returned-items-summary-notification`, un endpoint que **no
existe** — configuración muerta que además explica por qué el frontend lo buscaba
(ver `FRONTEND_api_payload_findings.md` §B3).

---

## T5 · Load balancer

Depende de T3: un balanceador delante de un servidor con estado en memoria mueve el
problema, no lo resuelve. El orden correcto es cerrar los cuatro puntos de T3
(rate limit, cachés, idempotencia, schedulers) y **después** balancear.

Cuando toque, las opciones para esta instalación:

| Opción | A favor | En contra |
| --- | --- | --- |
| Seguir con el cluster de Node (hoy, 4 procesos) | cero infra nueva | no cruza máquinas; no aísla fallos |
| Balanceador L7 en la misma máquina (IIS ARR / nginx / Caddy) | TLS, rate limit y logs centralizados; permite blue-green | una capa más en Windows |
| ALB de AWS + varias instancias | escala real, health checks, sin estado en el borde | requiere T3 cerrado y salir de la máquina única |
| El **gateway Go** de `DESIGN_go_migration.md` | ya va a existir; puede repartir por prefijo | no es un LB entre máquinas |

Nota importante: hoy **no** se puede poner un LB con varias instancias tal cual.
Tres cosas lo impiden, todas en T3: el Go worker se resuelve por `localhost:7453`
(`helpers/goWorker.js`, con `GO_WORKER_HOST` como salida), la caché de idempotencia
vive en memoria del proceso, y los cron eligen dueño por "primera instancia" de la
máquina — con N máquinas se disparan N veces.

Esfuerzo: 1–2 semanas una vez cerrado T3. Decisión pendiente: **¿el objetivo es
disponibilidad (dos máquinas) o rendimiento (más núcleos en una)?** La respuesta
cambia toda la elección.

---

## Orden sugerido

```
T1 (monitoreo)  ──►  T4 (sync vs cola, usa las métricas de T1)
      │
      └──────────►  T3 (escalabilidad: cierra los 4 puntos) ──►  T5 (load balancer)

T2 (vulnerabilidades) — independiente, se puede correr en paralelo desde ya
```

T1 primero porque hoy se está decidiendo a ciegas: no hay latencia por endpoint, ni
tráfico por ruta, ni estado por servicio. Esos tres datos son la entrada de T3, T4,
T5 y de la Fase 0 de la migración a Go.
