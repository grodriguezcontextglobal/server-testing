# Uptime Kuma como vigilante de esta instalación — estudio

> **2026-09-23.** Estudio de viabilidad, **nada instalado ni ejecutado**.
> Todo lo que se afirma del repositorio está verificado con `archivo:línea`.
> Lo que hay que comprobar contra la versión de Kuma que se instale va marcado
> como **[verificar]**, porque no instalé nada para escribir esto.
>
> Contexto: `BACKLOG_infra.md` §T1 (monitoreo) pide cinco cosas y hoy hay dos y
> media. Esto evalúa si Kuma cubre el resto y a qué precio.

---

## Veredicto

**Sí, y encaja bien — pero cubre 3 de los 5 huecos de T1, no los 5.**

Uptime Kuma es un vigilante de *disponibilidad*: sondea, guarda el histórico,
pinta una página de estado y avisa. Lo que **no** es, y conviene decirlo antes
de instalar nada, es un agregador de métricas: no da p95 por ruta ni tasa de
4xx/5xx por endpoint. Eso ya lo da `/api/metrics` (`helpers/metrics.js`), que se
desplegó en la Fase 1 y **agrega los cuatro procesos vía Redis**.

Así que no compiten: **Kuma responde "¿está arriba?", `/api/metrics` responde
"¿va rápido y sin errores?"**. Instalar Kuma no quita trabajo a T1 punto 2; se
lo quita a los puntos 1, 3, 4 y 5.

| Hueco de T1 | Hoy | Con Kuma |
|---|---|---|
| 1 · Readiness real | ✅ ya existe (`/ready`) | lo **vigila**, que es lo que falta |
| 2 · Métricas por endpoint | ✅ `/api/metrics` | **no lo cubre** |
| 3 · Estado de los microservicios | ❌ | ✅ (con *push*, ver §4) |
| 4 · Panel | ❌ | ✅ página de estado incluida |
| 5 · Alertas | ❌ "alguien se da cuenta" | ✅ es su razón de ser |

Esfuerzo estimado: **~1 día** para instalación y los monitores HTTP, **+1–2
días** para los latidos de los workers (eso sí es cambio de código, pequeño).
T1 entero estaba estimado en 2–3 semanas.

---

## 1. Cómo se instala en ESTA máquina

Producción es una VM **Windows Server 2019** con servicios nativos `nssm` e IIS
delante (`DEPLOY.md` § Split services). Eso descarta el camino habitual:

- **Docker queda fuera.** La imagen oficial es Linux; Windows Server 2019 no
  corre contenedores Linux sin una VM de por medio. No merece la pena montar esa
  capa para un vigilante.
- **El camino que encaja es el mismo patrón que ya se usa cuatro veces**:
  instalación nativa de Node + servicio `nssm`, hermano de `DevitrakEmailWorker`
  / `DevitrakBulkWorker` / `DevitrakDeleteWorker`.

Tres reglas para que no se enrede con la aplicación:

1. **Directorio propio y `.env` propio.** Kuma **no** debe vivir dentro del
   repositorio ni leer su `.env`: `queue/standalone.js:22` carga ese fichero con
   dotenv, y ahí están las credenciales de AWS, Stripe y las bases. El vigilante
   no necesita ninguna.
2. **Su propio Node.** El repositorio pide `node >= 20.11.0` y la VM tiene
   20.11.0 justo. **[verificar]** qué versión pide la versión de Kuma elegida
   antes de instalar: si exige otra, se resuelve con una instalación aparte, no
   moviendo el Node de producción. Mover el Node de la VM para poder instalar un
   vigilante sería cambiar lo vigilado para poder vigilarlo.
3. **Puerto 3001 atado a `127.0.0.1`**, y si se quiere acceso remoto, por IIS
   ARR con autenticación o por VPN. Un panel que enumera tus servicios internos
   no se publica tal cual.

Sobre el almacenamiento: Kuma escribe un latido por monitor y por intervalo en
su propia base — **[verificar]** el motor y las opciones en la versión que se
instale. En esta VM el disco ya se midió lento, así que **intervalos de 60 s y
retención corta**, no los 20 s por defecto. Con ~10 monitores a 60 s son ~14.400
escrituras al día, asumible; a 20 s son 43.200 sin ganar nada — nada de lo que
vigilamos cambia de estado en 40 segundos de forma que importe.

---

## 2. El mapa de monitores propuesto

| # | Monitor | Tipo | Objetivo | Por qué este y no otro |
|---|---|---|---|---|
| 1 | API viva | HTTP | `http://localhost:34001/health` | Plano y sin dependencias (`routes/health.js`). Es lo que decide *reiniciar o no* |
| 2 | API pública | HTTP | `https://db.devitrak.net/health` | Cubre DNS + TLS + IIS, que el nº1 no ve. Y Kuma avisa de la **caducidad del certificado** con este mismo monitor |
| 3 | Dependencias críticas | HTTP | `https://db.devitrak.net/ready` | Da **503** si MySQL o Mongo caen (`routes/health.js:66`) |
| 4 | Redis degradado | **JSON query** | `/ready` → `checks.redis.ok` | **Imprescindible, ver §3.b** |
| 5 | Go worker degradado | **JSON query** | `/ready` → `checks.goWorker.ok` | ídem |
| 6 | Go worker directo | HTTP o TCP | `localhost:7453/health` | Es servicio propio desde el split; y el 7453 es justo el puerto que ya nos mordió dos veces |
| 7 | EmailWorker | **Push** | latido desde el bucle | §4 |
| 8 | BulkWorker (+ `heavy`) | **Push** | latido desde el bucle | §4 |
| 9 | DeleteWorker | **Push** | latido desde el bucle | §4 |
| 10 | Schedulers diarios | **Push** (dead-man) | ping al terminar la corrida | §4 |
| 11 | Cola sin atascos | **Push** desde tarea programada | `failed`/`pending` acumulados | §3.c explica por qué push y no HTTP |

Kuma trae además monitores nativos de **MySQL, MongoDB y Redis**
**[verificar]** en la versión elegida. Tentador, pero **recomiendo no usarlos
aquí**: exigen meter credenciales de producción en el vigilante, y lo que de
verdad importa no es "¿responde PlanetScale?" sino "¿lo alcanza *nuestro*
proceso?" — que es exactamente lo que ya contesta `/ready`, con el pool y la red
reales de por medio. Un monitor directo puede estar verde mientras la API no
conecta.

---

## 3. Las trampas de este repositorio

### a. `/health` miente por diseño

Devuelve `{"server":"standby","status":"operational"}` con la cadena **fijada en
el código** y **sin tocar ninguna dependencia** (`routes/health.js:52`). Es
correcto —eso es *liveness*— pero significa que **un monitor de palabra clave
sobre `/health` no prueba nada de la aplicación**: sigue en verde con MySQL
caído. Sirve para "¿el proceso atiende sockets?" y para nada más.

### b. `/ready` devuelve **200** con Redis o el Go worker caídos

Esta es la que convierte un panel bonito en un panel inútil. En
`helpers/readiness.js` solo MySQL y Mongo son **críticas**; Redis y el Go worker
**degradan** (`status: "degraded"`) pero mantienen el **200**, y con razón: sin
Redis la API sigue sirviendo casi todo.

Consecuencia directa: **un monitor por código de estado sobre `/ready` nunca
avisará de que Redis se cayó.** Y Redis caído no es cosmético — se lleva por
delante la caché, la idempotencia de pagos (`middlewares/idempotencyMutationCache`,
que desde `54dffdb` degrada al Map en memoria) y el volcado de `/api/metrics`.

Por eso los monitores 4 y 5 son de tipo **JSON query** contra `checks.redis.ok` y
`checks.goWorker.ok`, no de código de estado. Es el detalle que hay que acertar
en la instalación; el resto es teclear URLs.

### c. El JWT caduca, así que `/api/metrics` no se vigila con un bearer pegado

`/api/metrics` (`index.js:240`) y `/api/jobs/stats` (`routes/jobs.js:24`) exigen
`validateJWT + requirePlatformRead`, y `helpers/jwt.js:11` emite tokens de **12 h**
(sin opción de 30 días desde 2026-10-21). Un bearer copiado en la configuración de Kuma
**empieza a dar 401 a las 12 horas** y genera una alerta falsa — que es peor que
no tener alerta, porque enseña a ignorarlas.

Dos salidas, y prefiero la primera:

1. **Que el dato salga empujado, no sondeado.** Una tarea programada de Windows
   que se autentique, lea `/api/jobs/stats` y haga `GET` a la URL de *push* de
   Kuma con `status=up|down&msg=<backlog>`. El secreto vive en la tarea, no en el
   vigilante, y de paso permite alertar por **umbral** ("más de N jobs
   `failed`"), que un monitor HTTP no sabe hacer.
2. Un token de 30 días dedicado a un `AdminUser` con `platform_observer` y nada
   más. Funciona, pero hay que acordarse de renovarlo cada mes.

### d. Cuatro procesos detrás de un puerto: Kuma ve uno, no cuatro

Producción corre pm2 en cluster. Un sondeo HTTP cae en **el proceso que elija el
sistema**, así que un `/ready` en verde dice "uno de los cuatro está bien", no
"los cuatro lo están". La respuesta trae `pid` (`helpers/readiness.js`), lo que
permite *notarlo* pero no *cubrirlo*.

Lo que sí ve a los cuatro es `/api/metrics`, porque vuelca a Redis y suma. Otra
razón para no tratar a Kuma como sustituto de la Fase 2.

### e. El vigilante que vive en la máquina vigilada

Si la VM se apaga, Kuma se apaga con ella y **no avisa de nada** — el fallo más
grande es justo el que no cubre. Dos mitigaciones, no excluyentes:

- Un monitor **externo gratuito** (UptimeRobot, Better Stack y equivalentes)
  contra `https://db.devitrak.net/health`, que es público y no revela nada. Cinco
  minutos de configuración y cubre el punto ciego entero.
- Los monitores de **push** (7–11) invierten la dirección: si el worker deja de
  empujar, Kuma lo marca caído **sin tener que alcanzarlo**. Eso funciona incluso
  si el servicio está vivo pero con el bucle atascado, que es el fallo realista.

### f. La alerta no debe ir por SendGrid a Outlook

Documentado el 2026-08-17: Microsoft rechaza las IP compartidas de SendGrid con
`550 5.7.1 S3140`, y el correo se pierde **después** de que la cola lo dé por
enviado. Si el canal de alerta es correo a una cuenta `outlook.com`/`hotmail.com`,
las alertas pueden desaparecer exactamente igual de silenciosamente.

**Canal primario no-correo** (Kuma trae Slack, Teams, Telegram, ntfy, webhook,
PagerDuty y muchos más — **[verificar]** cuáles en la versión elegida), y el
correo como secundario. Y una prueba real del canal el día de la instalación, no
confiar en el botón de "Test".

---

## 4. Los latidos: el único cambio de código

Los tres workers y los dos schedulers **no tienen superficie HTTP**:
`queue/standalone.js` abre Mongo, llama a `worker.start()` y vive de su timer. No
hay nada que sondear — hoy la única forma de saber si `DevitrakBulkWorker` sigue
trabajando es mirar si los jobs avanzan.

El monitor **Push** de Kuma es exactamente la pieza: genera una URL, y si nadie
la llama en X segundos, el monitor pasa a caído. El cambio en nuestro lado es
pequeño y aislado:

- **Workers**: un `fetch` a la URL de push al final de cada ciclo del bucle (o
  cada N ciclos), detrás de una variable de entorno `KUMA_PUSH_URL_<servicio>`.
  Si la variable no está, no hace nada — así los tests y el entorno de desarrollo
  no cambian de comportamiento.
- **Schedulers** (`scheduler/overdueReminders.js`, `scheduler/consentExpiry.js`):
  un ping **al terminar la corrida diaria**, con el intervalo de Kuma puesto a
  algo más de 24 h. Eso es un *dead-man switch*: hoy, si el scheduler deja de
  dispararse, **nadie se entera** hasta que un colegio pregunta por qué no
  llegaron los recordatorios. Es, en mi opinión, el monitor que más valor añade
  de toda la lista, y el más barato.

Dos precauciones al escribirlo:

1. **El ping no puede tirar el worker.** `try/catch` y seguir; un vigilante
   inalcanzable jamás debe interrumpir el trabajo real.
2. **Solo el proceso dueño.** Los schedulers corren bajo el guard
   `isNativeMaster || isPM2FirstInstance` (`index.js:323`), así que el ping va
   dentro de ese guard o llegarían cuatro.

---

## 5. Lo que NO hay que esperar de esto

- **No da p95 ni tasa de error por ruta.** Ya lo da `/api/metrics`. Kuma mide el
  tiempo de *su propio sondeo*, que es otra cosa.
- **No es trazas ni logs.** Dice *que* algo falla, no *por qué*.
- **No sustituye a la Fase 2** del plan de despliegue. Esa mide tráfico real por
  ruta para decidir los cambios de contrato; Kuma no ve nada de eso.
- Si algún día se quiere Prometheus/Grafana, Kuma expone sus propias métricas en
  `/metrics` **[verificar]**, así que no es un callejón sin salida.

---

## 6. Recomendación

**Instalarlo, con este alcance y en este orden**:

1. Monitores 1–6 (HTTP y JSON query). Sin tocar código. Aquí está el 70 % del
   valor: readiness real vigilada, caducidad del certificado, y el Go worker.
2. El externo gratuito contra `/health` público (§3.e). Cinco minutos.
3. Canal de alerta no-correo, probado de verdad (§3.f).
4. Los latidos de workers y schedulers (§4). Es el cambio de código, y es el que
   cierra el hueco 3 de T1.
5. La tarea programada del backlog de la cola (§3.c), que además evita el lío del
   JWT.

**Lo que hay que decidir antes de empezar:**

- ¿Dónde vive: en la VM de producción o en otra máquina? En la VM es lo barato;
  en otra máquina desaparece el punto ciego de §3.e sin depender de un tercero.
- ¿Se publica la página de estado a los clientes, o es solo interna? Cambia la
  configuración de red, no la instalación.
- ¿Quién recibe las alertas? Un canal sin dueño es un canal que nadie lee.

---

## 7. Las tres preguntas del 2026-09-23

### 7.1 ¿Es recomendable que viva en la misma VM de producción?

**Sí, con una condición: que no sea lo único.** La respuesta corta es *Kuma
dentro + un sondeo externo gratuito fuera*, y eso cierra el asunto por ~0 €.

El argumento en contra —"el vigilante se cae con lo vigilado"— es real pero más
estrecho de lo que parece cuando se mira **qué falla de verdad en esta
instalación**. Repasando los incidentes documentados:

| Incidente | ¿Lo ve un Kuma dentro de la VM? |
|---|---|
| Node marcando el 7453 mientras el worker escuchaba en el 7452 (6-ago) | **Sí**, monitores 5 y 6 |
| Grupo `heavy` sin consumidor: 202 y el job no se hace nunca | **Sí**, monitor 11 |
| Redis con el singleton envenenado, login colgado 30 s | **Sí**, monitor 4 |
| `DevitrakDeleteWorker` parado | **Sí**, monitor 9 |
| Scheduler que deja de dispararse | **Sí**, monitor 10 |
| La VM entera apagada o sin red | **No** — y aquí el vigilante también está muerto |

Cinco de seis. **Casi todo lo que nos ha mordido es un fallo *dentro* de la
máquina**, y para eso el vigilante interno no solo vale: vale *más* que uno
externo, porque ve `localhost:7453`, ve los latidos de los workers y ve la cola.
Un Kuma en otra máquina **no alcanza nada de eso** salvo que se lo empujemos o se
abra puerto, que es exactamente lo que no queremos.

El único caso que no cubre —VM caída— se tapa con un monitor externo gratuito
contra `https://db.devitrak.net/health`. Es público, no revela nada, y son cinco
minutos. Esa es la recomendación: **interno para profundidad, externo para el
latido**.

Lo que sí hay que aceptar del interno:

- **Comparte disco con producción**, y el disco de esta VM ya se midió lento.
  Intervalos de 60 s y retención corta (§1).
- **Comparte destino en lo tonto**: disco lleno, o un reinicio de Windows, se
  llevan a los dos. El externo también cubre eso.
- ~100–200 MB de RAM y CPU despreciable. Al lado de cuatro procesos Node y un
  worker de Go, no se nota.

### 7.2 ¿Puede ser un endpoint de la app, interno y con autenticación de usuario?

Aquí hay que separar dos cosas que suenan iguales, porque una es buena idea y la
otra es justo lo que no se debe hacer.

**Panel: sí, y media pieza ya existe.** Un panel servido por la propia app,
protegido con tu usuario, es razonable — es literalmente lo que propone
`BACKLOG_infra.md` §T1 punto 4. Y el andamiaje está:

- `index.js:142` ya monta `app.use(express.static("public"))`, así que una página
  en `public/` se sirve hoy sin tocar nada.
- Los datos ya están detrás de tu autenticación: `/api/metrics` y
  `/api/jobs/stats` exigen `validateJWT + requirePlatformRead`, y ese middleware
  pide exactamente **`platform_observer`** (`middlewares/requirePlatformRead.js:53`)
  — el flag que sigue pendiente de conceder desde la Fase 1.5. O sea: *"que solo
  yo lo maneje"* ya tiene mecanismo, y es el mismo trámite que está bloqueando la
  Fase 2.
- Cuidado con una cosa: `express.static` **no autentica**. La página sería un
  cascarón público; los datos no. Así que la plantilla no puede llevar dentro
  nada sensible (ni nombres de servidores, ni rutas internas, ni claves) — solo
  el HTML que luego pide los datos con tu token.

**Alertas: no.** Un vigilante que vive **dentro del proceso que vigila** no es un
vigilante. Si el event loop se atasca —el fallo más frecuente de este servidor, y
el que motivó mover el export a la cola—, la página se atasca con él y, peor, la
alerta que debería avisarte la tendría que enviar ese mismo proceso atascado.
Lo mismo si pm2 reinicia, si Mongo se cae (el panel necesita Mongo para
autenticarte) o si el servicio no arranca: **no hay aviso, y el silencio parece
calma**.

Esa es la línea, y es limpia:

> **Mirar** puede vivir dentro de la app. **Vigilar y avisar** tiene que vivir
> fuera del proceso.

Kuma no se "mete" en la app: se queda en su puerto 3001 atado a `127.0.0.1`, con
su propio usuario y contraseña (y 2FA si quieres). Y ojo con la tentación de
proxearlo por detrás del JWT de la API: Kuma es una SPA con websockets, el
navegador no le va a poner tu cabecera `x-token` a sus propios recursos ni al
socket, así que eso no funciona. Para acceder desde fuera de la máquina: VPN,
túnel, o IIS ARR con su propia autenticación.

Combinación recomendada, entonces: **panel bonito en la app para mirar el día a
día, Kuma detrás para que te escriba cuando no estés mirando.**

### 7.3 ¿Se puede conectar a Teams?

**Sí, y además resuelve el pudor de exponerlo**: la notificación es una llamada
**saliente** por HTTPS. Kuma puede estar atado a `127.0.0.1`, sin un solo puerto
abierto hacia fuera, y aun así escribirte al canal. No hace falta publicar nada.

**Pero hay una trampa de calendario, y es la parte que hay que verificar antes de
prometerlo.** La integración clásica de Kuma con Teams usa los *Incoming
Webhooks* de Office 365, y **Microsoft ha ido retirando esos conectores en
Teams**, empujando todo hacia **Power Automate ("Workflows")**. El formato de
mensaje además cambia: el conector clásico comía `MessageCard`, y el flujo nuevo
espera *Adaptive Card*. **[verificar]** en tu tenant y en la versión de Kuma que
se instale:

1. Si el proveedor "Microsoft Teams" de Kuma funciona tal cual contra un webhook
   creado hoy → listo, no hay más.
2. Si no, el camino de repuesto es el proveedor **webhook genérico** de Kuma
   apuntando a un flujo de Power Automate con el disparador *"cuando se recibe
   una petición de webhook de Teams"*, y que el flujo componga la tarjeta. Es
   configuración, no código nuestro.

Dos recomendaciones al montarlo, las dos por experiencia de esta casa:

- **Canal propio para alertas**, no uno de trabajo. Si las alertas caen donde se
  conversa, se silencian en una semana.
- **No dejes el correo como único canal de respaldo si la dirección es
  `outlook.com`**: es el mismo `550 5.7.1 S3140` de agosto, y el rebote ocurre
  *después* de que la cola dé el correo por enviado (§3.f). Teams como primario
  es, de hecho, la mejor noticia de este apartado.

Y una prueba real el día uno: parar `DevitrakDeleteWorker` a propósito y
comprobar que el mensaje llega al canal. El botón de "Test" prueba el webhook,
no la cadena entera.

### 7.4 ¿Y una página en Cloudflare, con PocketBase de base si hace falta?

Esta idea **es mejor que las dos anteriores para una de las dos mitades**, y hay
que partirla igual que en §7.2, porque la respuesta no es la misma.

#### El panel en Cloudflare: sí, y mejor que servirlo desde la app

Punto por punto contra la opción de `public/`:

| | Panel en la app (`public/`) | Panel en Cloudflare |
|---|---|---|
| Si la API se atasca | el panel se atasca con ella | **carga igual** y muestra "no contesta", que es la información que buscabas |
| Autenticación | hay que inventarla en el HTML | **Cloudflare Access**: tu correo y nadie más, sin escribir una línea |
| Coste | 0 | 0 **[verificar]** (Access es gratis hasta 50 usuarios) |
| Máquina nueva que mantener | no | **no** |
| Riesgo | el cascarón HTML es público (`express.static` no autentica) | nada del panel vive en la VM |

Y no requiere nada del backend: la página pide los datos desde tu navegador a
`https://db.devitrak.net/api/metrics` con tu token. Lo único que hay que tocar es
**CORS**, para permitir ese origen. Si tu cuenta es de Entra ID —y lo es, si usáis
Teams— Access puede usar ese mismo inicio de sesión.

**Esto es, con diferencia, la mejor respuesta a "que solo yo lo maneje".** Mejor
que el `platform_observer` solo, porque son dos cerraduras en serie: Access decide
quién llega a la página, `platform_observer` decide quién puede leer los datos.

#### El vigilante en Cloudflare: se puede, pero te lo escribes tú

Un **Worker con Cron Trigger** (mínimo cada minuto **[verificar]**) puede hacer
las cuatro cosas: sondear, guardar, decidir y avisar a Teams. La arquitectura
funciona, con una limitación de fondo que la define entera:

> **Un Worker solo alcanza lo que es público.** `localhost:34001`,
> `localhost:7453`, los tres workers de la cola y los schedulers **no lo son**.

O sea que el modelo se invierte: todo lo interno tiene que **empujar** hacia
fuera (HTTPS saliente desde la VM con un secreto compartido), y el Worker se
encarga de notar **la ausencia** de latido. Es exactamente el modelo *push* de
§4, así que el cambio de código de nuestro lado es el mismo. Lo que cambia es
quién lo recibe.

Lo que sí sondea directo, sin ayuda: `/health` y `/ready` públicos — incluidos
los monitores 4 y 5 de §3.b, porque el JSON de `/ready` trae `checks.redis.ok` y
`checks.goWorker.ok` aunque el 200 no lo diga.

**La base de datos: D1, no PocketBase.** Y esto es lo importante de tu pregunta:

- **PocketBase es un binario que necesita una máquina encendida con disco
  persistente.** No corre en Cloudflare. Meterlo significa **alquilar un servidor
  más** — y si vas a tener un servidor más, ahí cabe Uptime Kuma entero, con
  historial, página de estado, 2FA y noventa notificadores ya escritos. Añadir
  PocketBase para vigilar es asumir el coste que estábamos evitando y quedarte
  con menos.
- **D1** (SQLite gestionado de Cloudflare) hace ese trabajo sin máquina y con
  plan gratuito **[verificar]**.
- **KV no sirve para esto**: su límite de **escrituras** en el plan gratuito es
  de ~1.000/día **[verificar]**, y cuatro latidos por minuto son 5.760. El
  historial va en D1; KV, como mucho, para "último estado conocido".
- **Durable Objects con alarmas** son el ajuste conceptual perfecto para un
  *dead-man switch* **[verificar]** disponibilidad en el plan gratuito.

**Lo que cuesta de verdad, y no es el código feliz.** Sondear y mandar un mensaje
a Teams son cincuenta líneas. Lo que se lleva el tiempo es todo lo que Kuma ya
resolvió y que solo se echa de menos a las tres semanas:

- **No repetir la misma alerta cada minuto** mientras dure la caída.
- **Avisar de la recuperación**, no solo de la caída.
- **Aguantar el parpadeo**: un `/ready` que falla una vez y vuelve no es una
  incidencia; exigir 2–3 fallos seguidos antes de gritar.
- Historial, porcentaje de disponibilidad, ventanas de mantenimiento para no
  recibir veinte alertas cada vez que despliegas.

Nada de eso es difícil. Todo junto es la diferencia entre un fin de semana y "ya
casi está" durante un mes.

#### Lo que recomiendo

**Las dos, repartidas por donde cada una es mejor:**

1. **Panel → Cloudflare Pages + Access.** Sustituye a la idea de `public/`, y es
   mejor por las razones de la tabla. Es tuyo, es gratis y no vive en la VM.
2. **Vigilancia interna → Kuma en la VM.** Es lo que ve `localhost:7453`, la cola
   y los latidos, que es donde han estado cinco de los seis incidentes reales
   (§7.1). Un día de trabajo y cero código.
3. **Vigilancia externa → un Worker de Cloudflare con cron**, en lugar del
   UptimeRobot gratuito que proponía §3.e. Sondea `/health` y `/ready` públicos,
   avisa a Teams, y **te vigila también el propio Kuma**: si la VM cae, el Worker
   lo cuenta. Eso es media tarde, no un mes, porque solo tiene dos monitores y no
   necesita historial — el historial lo tiene Kuma.

Si con el tiempo el Worker te acaba gustando más que Kuma, migrar es fácil: los
latidos ya salen de la VM empujados y solo cambian de URL. Al revés —montar todo
en Cloudflare primero y descubrir que echas de menos el historial y el
anti-parpadeo— es rehacerlo.

---

## 8. La página pública como herramienta de venta

> Añadido el 2026-09-23 sobre §7.4. Cambia el alcance: la página deja de ser un
> panel interno y pasa a ser **dos superficies con el mismo caño de datos**.

### 8.1 Lo primero: son dos páginas, no una con permisos

La tentación es hacer una sola página y enseñar más o menos según quién mire. No
lo hagas. Lo que hoy tenemos como datos de observabilidad **no se puede publicar
tal cual**, y no por pudor, sino porque son estas cosas:

| Dato que hoy existe | Por qué NO va a la pública |
|---|---|
| `checks.goWorker.target: "localhost:7453"` | Es un mapa de tu arquitectura interna |
| Nombres de dependencias (PlanetScale, Mongo, Redis, S3) | Le dice a cualquiera dónde atacar y de quién dependes |
| `pid`, `uptimeSeconds` | Delata reinicios y topología de procesos |
| p95 y 4xx/5xx **por ruta** | Publica tu superficie de API entera, endpoint a endpoint |
| Métricas por `tenant` | Datos de tus clientes. Nunca |
| Backlog de la cola en bruto | De ahí se deduce tu volumen de negocio |
| Mensajes de error | Filtran versiones, rutas y a veces datos |

La pública habla de **componentes de negocio**, no de dependencias técnicas:

```
Aplicación web              Operativo
Asignación y devolución     Operativo
Escaneo e identificadores   Operativo
Correos y notificaciones    Degradado — los envíos llevan retraso
Informes y exportaciones    Operativo
```

Un cliente no sabe qué es Redis ni tiene por qué. Sabe si puede asignar un equipo
esta mañana. Y ese vocabulario también te protege: "Correos degradado" es cierto
y no dice si el problema es SendGrid, la cola o el worker.

La interna (Cloudflare Access, §7.4) es donde vive todo lo demás sin recortar.

### 8.2 Cómo fluyen los datos, y por qué la página pública no llama a la API

**La página pública nunca debe llamar a `https://db.devitrak.net`.** Tres razones
y las tres bastan por sí solas: necesitaría un token (y `platform_observer`), le
pasaría a cada visitante la dirección de tu API, y si la API está caída —el día
que la página importa— la página no tendría nada que enseñar.

El flujo correcto tiene al Worker en medio, y le da su verdadera razón de ser:

```
VM (latidos empujados)  ─┐
                         ├─►  Worker (cron)  ─►  D1: estado + historial
Sondeo a /health,/ready ─┘         │
                                   ├─►  snapshot público (JSON curado)  ─►  Página pública
                                   ├─►  Teams (canal)
                                   └─►  detalle completo  ─►  Página interna (Access)
```

El **snapshot público** es un JSON pequeño, sin nada de la tabla de §8.1, que el
Worker reescribe cada minuto. La página pública solo lee eso. Consecuencias
buenas y gratuitas:

- **Sobrevive a la caída**, que es el único momento en que alguien la mira.
- **Un millón de visitas no tocan tu VM.** Ni una petición llega a la API.
- **Lo que se publica está decidido en un sitio**: si algo no está en el
  snapshot, no hay forma de que se filtre a la pública.

Dominio propio del tipo `status.devitrak.net`, que es lo que se pone en una
propuesta comercial.

### 8.3 El compromiso que asume una página de estado pública

Es una herramienta de venta **solo si es creíble**, y la credibilidad tiene
factura:

1. **Tiene que ponerse en rojo cuando toque.** Una página que siempre está verde
   la descubre el primer cliente que tuvo una caída y lo notó: a partir de ahí
   resta confianza en vez de sumarla. El valor comercial no está en no tener
   incidentes, está en **enseñar que los detectas y los cuentas**.
2. **El historial empieza a contar el día uno.** Publicar "99,9 %" el primer mes
   no dice nada; doce meses de historial real sí. Y por eso conviene arrancarla
   pronto aunque no se enlace todavía en ningún sitio.
3. **Hace falta poder escribir a mano.** El estado automático responde "¿está
   arriba?"; un cliente que ve rojo quiere leer *"estamos investigando, afecta a
   los envíos de correo, siguiente actualización en 30 min"*. Eso no lo genera un
   sondeo. Basta una fila en D1 que se pueda editar — pero tiene que existir
   desde el principio.
4. **Anti-parpadeo, y aquí es obligatorio.** Un `/ready` que falla una vez por un
   pico de red no puede anunciar a tus clientes que estás caído. Dos o tres
   fallos consecutivos antes de cambiar el estado público, siempre.

Y el ángulo comercial de verdad, más allá de la estética: en las compras de
colegios y en cualquier revisión de proveedor —la misma dirección que apunta
FedRAMP en `BACKLOG_meeting_2026-09-10.md` §5— piden disponibilidad histórica y
comunicación de incidentes. Una página de estado con historial es una casilla de
ese cuestionario ya marcada, y el *audit trail* es otra.

### 8.4 Teams: al canal, y que Teams gestione a la gente

**Sí, y es la forma correcta de montarlo.** La clave es que **el monitor no debe
saber quién es nadie**:

- El Worker (o Kuma) conoce **una URL de webhook por canal**. Nada más. Ni
  correos, ni nombres, ni una lista que mantener en la configuración.
- Añadir o quitar gente se hace **en Teams**, como con cualquier canal. El
  vigilante no se entera ni tiene que enterarse. Eso es exactamente lo que pedías,
  y sale gratis por la forma del diseño.

Recomendaciones al montarlo:

- **Canal dedicado a alertas**, no uno donde también se conversa. Si las alertas
  caen entre mensajes de trabajo, en una semana están silenciadas.
- **Dos canales si aparece ruido**: uno para lo que despierta a alguien (API
  caída, worker parado) y otro para lo informativo (despliegues, certificado que
  caduca en 30 días). Un solo canal con las dos cosas acaba ignorado.
- **Publica en Teams también los cambios de la página pública.** Que el equipo se
  entere por el mismo sitio que el cliente evita el ridículo de que lo pregunte
  antes un colegio.

⚠️ **La trampa de propiedad, que es nueva y no es obvia.** Con el camino de Power
Automate (§7.3), **el flujo pertenece a la cuenta que lo creó**. Si esa persona
sale de la organización o se le desactiva la licencia, **las alertas dejan de
llegar en silencio** — el fallo clásico de este tipo de montaje. Créalo con una
cuenta de servicio o en un entorno propiedad del equipo, no desde la cuenta
personal de quien lo configure ese día. Y una nota en `DEPLOY.md` diciendo de
quién depende.

### 8.5 Lo que esto le cambia a la recomendación de §7.4

Dos cosas, y una es una corrección de mi propia estimación:

1. **El Worker deja de ser opcional y pasa a ser el centro.** En §7.4 era "media
   tarde, dos monitores sin historial". Con una página pública encima, **es él
   quien posee la verdad publicada**: necesita D1, historial, anti-parpadeo y el
   snapshot curado. Eso son **un par de días**, no media tarde. Prefiero decirlo
   ahora que a mitad.
2. **Kuma se queda, pero cambia de papel.** Ya no es el que enseña el estado: es
   el vigilante interno profundo —`localhost:7453`, la cola, los latidos, el
   detalle que no se publica— y una segunda opinión para ti. Su página de estado
   propia **no sirve para esto**, porque vive en la VM y se cae con ella; la
   pública tiene que estar fuera, y por eso el Worker manda.

Orden sugerido, que además reparte el riesgo:

1. Kuma interno (§7.1). Un día, cero código, cubre hoy los cinco incidentes de
   la tabla de §7.1.
2. Latidos de workers y schedulers (§4). El mismo cambio de código sirve después
   para el Worker: solo cambia la URL.
3. Worker + D1 + snapshot + Teams. Aquí ya hay alertas fuera de la VM.
4. Página **interna** con Access sobre el snapshot completo.
5. Página **pública**, cuando el historial lleve semanas siendo correcto. No la
   enlaces en material comercial el primer día: que primero se equivoque contigo
   mirando, no con un cliente delante.

### 8.6 Lo que hay que decidir antes de empezar esto

- **Qué componentes se publican** y con qué nombres. Es una decisión de producto
  y de marketing, no técnica, y define el snapshot.
- **¿Se publica el porcentaje de disponibilidad, o solo el estado actual y los
  incidentes?** El porcentaje es un número del que luego respondes.
- **Quién escribe los mensajes de incidente**, y con qué rapidez se espera que
  aparezcan. Una página que tarda dos horas en reconocer una caída es peor que no
  tenerla.
- **De quién es el flujo de Power Automate** (§8.4).

---

**Lo que este estudio no afirma:** no he instalado Kuma ni comprobado su
compatibilidad con el Node de la VM, ni los tipos de monitor y notificadores
exactos de la versión actual — todo eso va marcado **[verificar]**. Lo verificado
de verdad es el lado de nuestro repositorio: qué exponen `/health` y `/ready`,
qué degrada sin cambiar el código de estado, qué autenticación piden
`/api/metrics` y `/api/jobs/stats`, cuánto duran los tokens, y que los workers y
schedulers no tienen nada que sondear.
