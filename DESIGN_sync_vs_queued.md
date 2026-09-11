# Qué responde inmediato y qué se encola: veredicto

> **Fecha:** 2026-09-11 · Responde a la propuesta de *"Stripe y logins inmediatos
> con prioridad absoluta, lo demás encolable"*. Cierra el punto T4 de
> `BACKLOG_infra.md`.

---

## Veredicto en dos líneas

**De acuerdo con la primera mitad, y sin matices:** autenticación y pagos
—depósitos, reembolsos, capturas y cargos— son síncronos obligatorios. El
usuario está mirando la pantalla esperando saber si entró o si le cobraron.

**En desacuerdo con la segunda.** «Lo demás se puede encolar» no se sostiene, y
no por criterio sino por aritmética: **solo unos 32 de 486 endpoints (un 7 %)
son encolables por naturaleza**, y la mayoría ya lo están. Pero el desacuerdo de
fondo es otro y es más importante: **encolar el resto no le daría prioridad a
los pagos.** Eso se consigue con otra cosa.

---

## 1. Los números, medidos sobre los 486 endpoints del inventario

| | | |
|---|---|---|
| **Lecturas** | 177 | **36 %** — no se pueden encolar jamás |
| Escrituras | 194 | 40 % |
| Sin clasificar | 115 | 24 % — necesitan ojo humano, no heurística |

De las 194 escrituras, **solo 32 son encolables por naturaleza** (email,
notificaciones, masivas, subidas, webhooks, logs, recordatorios): el 16 % de las
escrituras, el 7 % del total. Y 66 endpoints tocan pagos o autenticación.

**Encolar una lectura no significa nada.** El cliente pide datos para pintar una
pantalla; devolverle un `jobId` y decirle que vuelva luego no es asincronía, es
no contestar. Ese 36 % cierra el debate sobre «lo demás» por sí solo.

---

## 2. El criterio correcto no es la importancia

Ese es el error de encuadre. Un email de recibo puede ser importantísimo para el
negocio y aun así encolarse; una lectura de inventario puede ser trivial y aun
así tiene que ser síncrona. La pregunta que decide es otra:

> **¿El que llama necesita el RESULTADO para continuar, o le basta con saber que
> se recibió?**

| Categoría | Criterio | En este repo |
|---|---|---|
| **Síncrono obligatorio** | Sin el valor devuelto, el cliente no puede seguir | Todas las lecturas · login · pagos · asignar un dispositivo (el usuario tiene que saber si se hizo) |
| **Encolable** | El efecto es lateral; con «recibido» basta | Emails y notificaciones · webhooks · logs de auditoría · subidas a S3 · masivas · informes |
| **Híbrido** | Depende del tamaño de la operación | Ya existe: `waitForJobOutcome` espera 4 s y si no degrada a `202` + `jobId` |

**El híbrido es la respuesta para casi todo el medio, y ya está construido.**
Asignar un dispositivo: síncrono. Asignar quinientos: el mismo endpoint devuelve
`202` con un `jobId`. Lo decide el tamaño, no una lista fija —
`test/syncOrQueuedController.test.js` ya cubre ese patrón.

---

## 3. Encolar no crea capacidad, la mueve

Tres consecuencias que conviene tener presentes antes de encolar nada más:

1. **El trabajo sigue siendo el mismo.** Las mismas escrituras, el mismo CPU, la
   misma máquina de cuatro núcleos. Lo que se gana es que el cliente no espera,
   que un reintento sobrevive a una caída y que una ráfaga se absorbe. No se
   gana throughput.
2. **Los jobs no corren en paralelo.** Cada worker drena de uno en uno. Encolar
   más tipos sin añadir concurrencia solo hace la cola más lenta.
3. **Una cola que no drena es peor que una respuesta lenta.** Una respuesta
   lenta termina; un «pendiente» que no avanza no le dice al usuario ni que
   falló ni que funcionó.

---

## 4. Y aquí está el problema de verdad: encolar no da prioridad

Este es el punto que cambia la propuesta. **Los jobs encolados corren en los
mismos cuatro núcleos que atienden el login y los pagos**, y en diez casos,
dentro de los mismos procesos.

`DevitrakServer` arranca con `QUEUE_EXCLUDE_GROUPS=dedicated`, o sea que consume
**todo lo que no esté en un grupo dedicado**. Medido sobre los 18 tipos
registrados:

```
Tipos en grupos dedicados (email, bulk, delete):   8   -> servicios aparte
Tipos consumidos DENTRO de la API:                10
    log:event · log:notification · log:staff-activity · log:error
    go-worker:insert-device-event-container · webhook:trigger
    document:upload-pdf
    inventory:bulk-insert-alphanumeric        <- masiva, y NO esta en el grupo bulk
    inventory:bulk-update-alphanumeric        <- masiva, y NO esta en el grupo bulk
    event:bulk-update-item-shipping           <- masiva, y NO esta en el grupo bulk
```

**Tres operaciones masivas se están drenando dentro de los procesos que sirven
el login.** Casi seguro es un descuido: existen `DevitrakBulkWorker` y
`DevitrakDeleteWorker` justo para esto, y estos tres tipos se quedaron fuera de
`BULK_WRITE_TYPES` en `constants/queueTypeGroups.js`.

Así que encolar más cosas, tal como está montado hoy, **empeoraría** la
prioridad de los pagos: más trabajo compitiendo por el mismo event loop.

---

## 5. Lo que sí da prioridad a pagos y login

Por orden de rentabilidad:

1. **Mover esos tres tipos masivos al grupo `bulk`.** Es una línea en
   `constants/queueTypeGroups.js`, y saca el trabajo pesado de los procesos que
   atienden a los usuarios. Es lo más barato de esta lista con diferencia.
2. **`UV_THREADPOOL_SIZE=16`.** El techo de logins es hoy ~106/s en toda la
   máquina porque bcrypt hashea en los 4 hilos por defecto de libuv (16 en los
   cuatro procesos). Con 16 por proceso pasa a ~426/s. Una variable de entorno.
3. **Presupuestos de rate limit separados.** Los pagos ya lo tienen
   (`PUBLIC_PAYMENTS_CREATE_LIMIT` y `AUTH_PAYMENTS_CREATE_LIMIT`, ver
   `docs/payments-dual-lane.md`). El login comparte el global de 300/15min con
   todo lo demás: una ráfaga de cualquier otra cosa desde la misma IP puede
   dejar a un usuario sin poder entrar.
4. **Descarte selectivo bajo saturación.** Cuando el p95 se dispara, rechazar
   rápido lo no crítico antes que lo crítico. Requiere saber el p95 por
   endpoint, que es justo lo que acaba de entrar con `/api/metrics`.

Ninguna de las cuatro es «encolar más cosas».

---

## 6. Lo que sí conviene encolar, y no lo está

De los 32 encolables por naturaleza, revisando los que hoy responden síncronos:

- **Informes y exportaciones** (`/student/export`, informes de inventario). El
  usuario acepta perfectamente «te aviso cuando esté», y hoy retienen un proceso
  mientras se generan.
- **Subidas a S3** que no bloqueen la pantalla. `document:upload-pdf` ya está
  encolado; conviene revisar si quedan rutas que suban de forma síncrona.
- **Los borrados masivos que siguen siendo síncronos**:
  `POST /api/db_company/delete-bulk-items` y `POST /api/db_item/delete-bulk-items`
  (ambos en `mysql/controllers/item.js:3645`, vía worker de Go síncrono). Ojo:
  moverlos es cambio de contrato para el frontend.

---

## 7. Orden propuesto

```
1. Los tres tipos masivos al grupo bulk        <- una linea, saca peso de la API
2. UV_THREADPOOL_SIZE=16                       <- una variable, x4 el techo de login
3. Presupuesto de rate limit propio para login <- que una rafaga ajena no impida entrar
4. Clasificar los 115 sin clasificar           <- con las metricas, no a ojo
5. Encolar informes y exportaciones
6. Evaluar los borrados masivos sincronos      <- con el frontend, es contrato
```

Los dos primeros se hacen hoy y son los que más mueven la aguja para lo que
preguntabas: que pagos y autenticación respondan siempre, incluso cuando el
resto del sistema está ocupado.
