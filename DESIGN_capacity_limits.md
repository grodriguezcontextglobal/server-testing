# Capacidad bajo carga: dónde cae el servidor, y en qué orden

> **Fecha:** 2026-09-11 · **Máquina medida:** la VM de producción
> Todos los parámetros están leídos del código, con `archivo:línea`. Los techos
> son cálculos a partir de esos parámetros, no estimaciones a ojo — y se dice
> explícitamente cuáles están medidos y cuáles no.

---

## 0. La máquina

```
Windows · 4 núcleos · 32 GB RAM (25 GB libres) · VMware virtual disk SCSI
4 procesos Node (pm2-runtime -i max, y NUM_CPU topa en 4) detrás de IIS
```

**La RAM no va a ser el límite de nada.** Con 25 GB libres y cuatro procesos
Node, la memoria sobra por un orden de magnitud. Todo lo que sigue es CPU,
hilos, conexiones y colas.

> **Aviso sobre el `load` de `/api/status`:** los tres ceros que devuelve no
> significan que la máquina esté ociosa. `os.loadavg()` **siempre devuelve
> `[0,0,0]` en Windows** — no existe el concepto. Ese campo no informa de nada
> en esta plataforma y no debe usarse para decidir nada.

---

## 1. El orden en que se rompe

Bajo carga creciente, esto cae en este orden. No es una lista de riesgos: es una
secuencia, y atacar el número 3 antes que el 1 no sirve de nada porque nunca se
llega al 3.

### 1º — El rate limit global, a los tres segundos

`index.js` monta `rateLimit({ windowMs: 15min, max: 300 })` por IP, **sin
`store` externo**. Son **0,33 peticiones por segundo y por IP**.

Cualquier prueba de carga desde una sola IP choca con esto antes de rozar el
servidor. Y no es solo un problema de test: si el frontend hace ráfagas (una
pantalla que dispara veinte llamadas al abrirse), un usuario puede agotar su
presupuesto solo, y con cuatro procesos el límite real es errático — cada uno
lleva su propia cuenta, así que el techo efectivo está entre 300 y 1.200 según
cómo reparta IIS.

### 2º — El threadpool de libuv, si hay logins

> **CORRECCIÓN (2026-09-11, tras medirlo).** Lo que sigue en esta sección
> planteaba que `UV_THREADPOOL_SIZE=16` multiplicaría por cuatro el techo de
> autenticación. **Es falso, y la medición lo desmiente.**
>
> bcrypt es trabajo de **CPU pura**, así que el techo lo ponen los **núcleos**,
> no los hilos. Medido en una máquina de 8 núcleos, hasheando con coste 10:
>
> | threadpool | concurrencia | hashes/s |
> |---|---|---|
> | 4 (defecto) | 4 | **53** |
> | 4 (defecto) | 16 | 48 |
> | 8 | 16 | 58 |
> | 16 | 16 | **63** |
> | 16 | 32 | 59 |
>
> De 4 a 16 hilos se gana un **19 %**, no un 300 %. Y en producción sería peor:
> con 4 núcleos y 4 procesos de pm2 ya hay **16 hilos compitiendo por 4
> núcleos**, cuatro veces sobresuscrito. Subirlo a 16 por proceso daría 64
> hilos sobre 4 núcleos — más cambios de contexto, ninguna ganancia, y
> hambrearía al resto de usuarios del pool (`fs`, `dns`).
>
> **Y el techo importa menos de lo que dije.** bcrypt solo se ejecuta en login,
> registro y cambio de contraseña (`controller/admin.js`, `controller/registration.js`);
> `validateJWT` usa `jwt.verify`, que es barato. No está en ningún camino por
> petición, así que ~60 hashes/s de la máquina se reparten entre logins, que en
> un SaaS son una fracción mínima del tráfico.
>
> **Conclusión: este no es el segundo escalón.** No hay que tocar
> `UV_THREADPOOL_SIZE`, y la única palanca que subiría de verdad el techo de
> login sería bajar el coste de bcrypt — que es un compromiso de seguridad, no
> una mejora gratuita, y con coste 10 ya se está en el borde bajo de lo
> recomendable. **No se recomienda.**
>
> Lo que sigue se conserva porque el cálculo del threadpool es correcto en sí
> mismo; lo que estaba mal era suponer que los hilos, y no los núcleos, marcan
> el techo de un trabajo de CPU.

`UV_THREADPOOL_SIZE` **no está configurado en ninguna parte del repo**, así que
son los 4 hilos por defecto, **16 en toda la máquina**.

bcrypt nativo hashea en ese threadpool (que es justo lo que lo hace mejor que
bcryptjs: no bloquea el event loop). Con ~150 ms por operación —medido en su
día, y el comentario de `controller/admin.js` lo documenta— el techo es:

```
16 hilos / 0,150 s = ~106 logins por segundo en toda la maquina
```

Y ese número es optimista, porque el threadpool **también** atiende
`fs`, `dns` y `zlib`. Con los 16 hilos ocupados hasheando, cualquier lectura de
fichero y cualquier resolución DNS se pone a la cola detrás de ellos.

**Es el techo más bajo y más rígido que tiene el sistema**, y sube con una
variable de entorno: `UV_THREADPOOL_SIZE=16` daría 64 hilos y ~426 logins/s, a
costa de más memoria por proceso.

### 3º — El event loop, en cuanto entra un cuerpo grande

`index.js` acepta `express.json({ limit: "50mb" })` por defecto y **100 MB** en
cinco rutas. Parsear 50 MB de JSON es trabajo **síncrono**: ese proceso no
atiende nada más mientras tanto, y son cuatro procesos en total, así que cuatro
peticiones gordas simultáneas dejan la API entera parada.

(De paso: uno de esos cinco límites de 100 MB es para
`/api/nodemailer/returned-items-summary-notification`, un endpoint que **no
existe**.)

### 4º — Las colas de conexiones a base de datos

| Pool | Por proceso | En la máquina |
|---|---|---|
| MySQL (`mysql/database/config.js:29`) | 100 | **400** |
| Mongo (sin `maxPoolSize`, default del driver) | 100 | **400** |

400 conexiones contra PlanetScale hay que contrastarlas con el límite del plan:
si el plan da menos, el pool encola y la latencia se dispara sin que aparezca
ningún error — solo peticiones lentas.

Y en el camino más caliente del módulo escolar hay un desperdicio medible:
`mysql/controllers/members.js` ejecuta **`SHOW COLUMNS` en siete sitios, una vez
por petición**, para descubrir el esquema antes de escribir. Es un viaje extra a
la base de datos en cada asignación, contra un disco que ya medimos lento.

### 5º — Los puertos efímeros de Windows, solo si no hay keep-alive

Con ~16.000 puertos y `TIME_WAIT` de 4 minutos, el techo de **conexiones
nuevas** es ~66/s. No afecta al tráfico real (los navegadores reutilizan
conexiones) pero **sí arruina una prueba de carga mal hecha**, y hace que el
número que salga sea el de Windows, no el del servidor.

---

## 2. Fiabilidad: qué pasa cuando se pasa de ahí

Saturarse no es el problema; todo sistema se satura. El problema es **cómo**.

**Lo que está bien.** La cola (`queue/worker.js`) reclama trabajo con un
`findOneAndUpdate` atómico y tiene `recoverStale()`. Un job aceptado **no se
pierde aunque el proceso muera a mitad**. Y el patrón híbrido de
`helpers/queuedController.js` —esperar hasta 4 s y si no devolver `202` con un
`jobId`— es exactamente lo que evita que una petición se quede colgada para
siempre. Eso ya existe y funciona.

**Lo que no.** Tres piezas de estado viven en memoria del proceso, así que con
cuatro procesos no hacen lo que dicen hacer:

- **Idempotencia** (`middlewares/idempotencyMutationCache.js:4`, un `new Map()`).
  Dos peticiones con la misma clave en workers distintos **pasan las dos**. Es el
  middleware que debería evitar cobros y asignaciones dobles, y bajo carga —que
  es justo cuando los clientes reintentan— es cuando no protege.
- **Rate limit**, ya comentado.
- **Caché** (`cache/cacheInstance.js`): cuatro cachés que divergen.

Y el timeout de 30 s de `index.js` significa que, saturado, el cliente espera
medio minuto antes de recibir un 408. Con la rodilla identificada se puede bajar
ese número: fallar rápido libera capacidad, esperar 30 s la consume.

---

## 3. Cómo medirlo de verdad

`scripts/loadtest.js`, sin dependencias nuevas. Sube la concurrencia por etapas
y busca **la rodilla**: dónde el throughput deja de crecer mientras la latencia
se dispara. Todo lo que se mande por encima de ese punto solo engorda una cola.

```bash
node scripts/loadtest.js --url http://localhost:34001/health \
  --stages 1,5,10,25,50,100,200 --seconds 10
```

Validado contra un servidor de laboratorio con un techo conocido (8 trabajos
simultáneos de 20 ms): encontró la rodilla **exactamente en 8**, con el
throughput aplanándose en ~247 req/s y el p95 pasando de 39 ms a 129 ms por
encima. Mide lo que dice medir.

Tres salvaguardas, porque las tres formas de engañarse son fáciles:

- **Se niega a apuntar fuera de localhost** sin `--allow-remote`. Saturar
  producción con clientes reales trabajando no es un test.
- **Avisa en cuanto aparece un 429** y declara la medición sin valor: estarías
  midiendo el limitador. Hay que subir `RATE_LIMIT_MAX` en el entorno de prueba.
- **Declara inválida la medición** si más de la mitad de las peticiones no
  obtienen respuesta, en vez de anunciar cientos de "req/s" contra un puerto
  cerrado. (Este control salió de un fallo accidental durante su propio
  desarrollo, que reportaba alegremente 621 req/s de conexiones rechazadas.)

### El orden correcto de las pruebas

1. **`/health`** — el suelo. No toca nada, así que mide el techo puro de
   Node + IIS en esta máquina. Todo lo demás será más lento que esto.
2. **Una lectura con base de datos** — introduce el pool y la latencia de red
   contra PlanetScale.
3. **El login** — es el único que ejercita bcrypt, y donde debería aparecer el
   techo de ~106/s del punto 2 de este documento. Si aparece ahí, la teoría se
   confirma y `UV_THREADPOOL_SIZE` es la palanca.

**No lo he ejecutado contra una instancia real, y conviene decir por qué:** el
`.env` de este repositorio apunta a las bases de datos de **producción**.
Levantar el servidor aquí para medirlo habría metido carga sintética contra los
datos reales de los clientes. Hace falta un entorno con su propia base de datos,
o una ventana acordada fuera de horario.

---

## 4. Qué hacer con el resultado, por orden de rentabilidad

1. ~~`UV_THREADPOOL_SIZE=16`~~ — **descartado tras medirlo**, ver la corrección
   del §1.2º. Da un 19 %, no un 300 %, y en producción (4 núcleos, 16 hilos ya
   sobresuscritos) haría daño.
2. **Idempotencia a Redis.** Pasa a ser lo primero, y no por rendimiento sino
   por **corrección**: hoy es un `new Map()` por proceso con cuatro procesos, así
   que dos peticiones con la misma clave en workers distintos pasan las dos. Es
   el middleware que debe evitar cobros dobles, y falla justo bajo carga, que
   es cuando los clientes reintentan. `redis` ya está instalado.
3. **Rate limit a Redis**, o asumir explícitamente que el límite real es ×4 y
   documentarlo en `API_CLIENT_GUIDELINES.md`, que hoy promete 300. De paso,
   darle al login su propio presupuesto: hoy comparte el global, así que una
   ráfaga de cualquier otra cosa desde la misma IP puede impedir entrar.
4. **Bajar el límite de cuerpo de 50 MB** en las rutas que no suben ficheros, y
   quitar el de 100 MB del endpoint que no existe.
5. **Cachear el esquema** en vez de `SHOW COLUMNS` por petición.
6. **Medir y ajustar el timeout de 30 s** a partir del p95 real.

Los tres primeros no requieren tocar la topología. A partir de ahí, escalar
horizontalmente exige cerrar también el dueño de los schedulers
(`index.js` los arranca en la "primera instancia" **de la máquina**, así que dos
máquinas disparan los recordatorios dos veces).
