'use strict';

/**
 * Latidos hacia un monitor externo (el monitor "Push" de Uptime Kuma hoy; el
 * Worker de Cloudflare mañana — ver DESIGN_monitoring_uptime_kuma.md §4 y §8.2).
 *
 * POR QUÉ EMPUJAR EN VEZ DE SONDEAR. Los tres workers de la cola y los dos
 * schedulers no tienen superficie HTTP: `queue/standalone.js` abre Mongo, llama
 * a `worker.start()` y vive de su timer. No hay nada que sondear, así que hoy la
 * única forma de saber si `DevitrakBulkWorker` sigue trabajando es mirar si los
 * jobs avanzan. Con un latido, el monitor marca el servicio caído cuando **deja
 * de llegar** — que además cubre el fallo realista: el servicio vivo con el
 * bucle atascado, donde un sondeo de proceso diría que todo está bien.
 *
 * LA CONFIGURACIÓN VA EN EL `.env` DEL REPOSITORIO, NO EN nssm. Deliberado:
 * `nssm set <servicio> AppEnvironmentExtra` **reemplaza el bloque entero**, y
 * así es como se borró `GO_WORKER_PORT` en el despliegue del 2026-09-22 —
 * exactamente el incidente del 2026-08-06 (ver DEPLOY.md § Estado real de
 * producción). Los cuatro servicios cargan el mismo `.env` con dotenv, así que
 * una variable por servicio ahí dentro no obliga a tocar nssm ni una vez.
 *
 * UNA VARIABLE POR SERVICIO, con el nombre derivado del servicio:
 *
 *   HEARTBEAT_URL_QUEUE_EMAIL    → DevitrakEmailWorker   (QUEUE_GROUP=email)
 *   HEARTBEAT_URL_QUEUE_BULK     → DevitrakBulkWorker    (QUEUE_GROUP=bulk)
 *   HEARTBEAT_URL_QUEUE_DELETE   → DevitrakDeleteWorker  (QUEUE_GROUP=delete)
 *   HEARTBEAT_URL_QUEUE_HEAVY    → DevitrakHeavyWorker   (QUEUE_GROUP=heavy)
 *   HEARTBEAT_URL_QUEUE_API      → el worker en proceso de DevitrakServer
 *   HEARTBEAT_URL_SCHEDULER_OVERDUE  → recordatorios diarios
 *   HEARTBEAT_URL_SCHEDULER_CONSENT  → barrido diario de consentimientos
 *
 * **Sin variable, no hace nada.** Ni una petición, ni un log, ni un error. Eso
 * mantiene intactos los tests y el entorno de desarrollo, y permite desplegar
 * el código antes de que exista el monitor.
 *
 * TRES REGLAS QUE NO SON NEGOCIABLES, porque un vigilante jamás debe estorbar a
 * lo vigilado:
 *
 *   1. **No lanza nunca.** Todo error se traga aquí dentro. Un monitor caído no
 *      puede tumbar el worker que vigila.
 *   2. **No se espera.** Quien llama no hace `await`: el latido no entra en el
 *      camino del trabajo real.
 *   3. **Tiene timeout.** Sin él, un monitor que acepta la conexión y no
 *      responde deja sockets colgados en el worker, que es la forma elegante de
 *      provocar justo la avería que se quería detectar.
 */

const logger = require("./logger");

/** A qué ritmo se late como mucho. El bucle de la cola hace tick cada 300ms en
 *  los workers dedicados (QUEUE_POLL_MS=300): sin este freno serían ~200
 *  peticiones por minuto al monitor, por servicio, para no decir nada nuevo. */
const DEFAULT_MIN_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;

/** Estado por servicio: cuándo se latió y con qué estado. Por proceso, que es
 *  la granularidad correcta — cada servicio nssm es un proceso. */
const state = new Map();

/** `queue_bulk` → `HEARTBEAT_URL_QUEUE_BULK`. */
const envKeyFor = (name) =>
  `HEARTBEAT_URL_${String(name || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

const resolveHeartbeatUrl = (name, env = process.env) => {
  const value = env[envKeyFor(name)];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Nombre del servicio para el worker de la cola, deducido de cómo está
 * configurado ese proceso — así no hace falta una variable más en nssm.
 *
 * `QUEUE_GROUP=bulk,heavy` → `queue_bulk`: se usa el PRIMER grupo porque es el
 * que da nombre al servicio (`DevitrakBulkWorker` sirve `bulk` y de paso
 * `heavy`). Sin `QUEUE_GROUP` es el worker en proceso de la API.
 */
const resolveQueueServiceName = (env = process.env) => {
  const explicit = String(env.HEARTBEAT_SERVICE || "").trim();
  if (explicit) return explicit;
  const firstGroup = String(env.QUEUE_GROUP || "").split(",")[0].trim();
  return firstGroup ? `queue_${firstGroup}` : "queue_api";
};

/** Los tres parámetros que define el protocolo de push y que ponemos nosotros. */
const PROTOCOL_PARAMS = /^(status|msg|ping)=/i;

const buildUrl = (base, { status, msg, pingMs }) => {
  // El protocolo de push de Kuma es `?status=up|down&msg=...&ping=<ms>`.
  //
  // POR QUÉ SE LIMPIA LA URL EN VEZ DE AÑADIR DETRÁS (2026-09-23, incidente
  // real): el panel de Kuma muestra la URL de push CON parámetros de ejemplo
  // —`?status=up&msg=OK&ping=`— y copiarla entera es lo natural. Si nos
  // limitáramos a concatenar los nuestros, `status` viajaría DOS VECES; Express
  // parsea un parámetro repetido como **array**, la comparación `status === "up"`
  // del lado de Kuma falla, y el latido se registra como **caída**.
  //
  // Ese es el peor fallo posible aquí: el servicio late, el monitor se pone
  // rojo, y parece una avería real que no existe. Un vigilante que inventa
  // caídas se desactiva en una semana.
  //
  // Se conserva cualquier otro parámetro de la URL por si el monitor lo
  // necesitara, y se descartan solo los tres del protocolo.
  const [path, query = ""] = String(base).split("?");
  const preserved = query.split("&").filter((part) => part && !PROTOCOL_PARAMS.test(part));

  const params = [
    ...preserved,
    `status=${encodeURIComponent(status)}`,
    `msg=${encodeURIComponent(msg)}`,
  ];
  if (Number.isFinite(pingMs)) params.push(`ping=${encodeURIComponent(Math.round(pingMs))}`);

  return `${path}?${params.join("&")}`;
};

/**
 * Manda un latido, si toca.
 *
 * Cuándo SÍ se manda aunque el freno diga que no: **cuando el estado cambia**.
 * Una caída tiene que salir en el instante en que se detecta, no en el próximo
 * minuto redondo; y la recuperación, igual. Lo que el freno evita es repetir
 * cien veces lo mismo, no avisar de algo nuevo.
 *
 * No lanza y no hace falta esperarlo. Devuelve una promesa —siempre resuelta—
 * con lo que hizo, que es lo que los tests miran.
 *
 * @returns {Promise<{sent: boolean, reason: string}>}
 */
const sendHeartbeat = async (
  name,
  {
    status = "up",
    msg = "OK",
    pingMs,
    force = false,
    env = process.env,
    fetchImpl,
    now = Date.now,
    minIntervalMs,
    timeoutMs,
  } = {}
) => {
  const base = resolveHeartbeatUrl(name, env);
  if (!base) return { sent: false, reason: "disabled" };

  const interval = Number.isFinite(minIntervalMs)
    ? minIntervalMs
    : Number(env.HEARTBEAT_MIN_INTERVAL_MS) || DEFAULT_MIN_INTERVAL_MS;

  const at = now();
  const previous = state.get(name);
  const statusChanged = !previous || previous.status !== status;

  if (!force && !statusChanged && previous && at - previous.at < interval) {
    return { sent: false, reason: "throttled" };
  }

  // Marcar ANTES de salir a la red: si el envío tarda, los ticks que caigan
  // mientras tanto no deben acumular peticiones en vuelo contra el monitor.
  state.set(name, { at, status });

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") return { sent: false, reason: "no-fetch" };

  const limit = Number.isFinite(timeoutMs)
    ? timeoutMs
    : Number(env.HEARTBEAT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  try {
    const options = {};
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      options.signal = AbortSignal.timeout(limit);
    }
    const response = await doFetch(buildUrl(base, { status, msg, pingMs }), options);

    // Un token equivocado en la URL es el fallo de configuración más probable, y
    // sin esta comprobación sería INVISIBLE: la petición sale, el monitor
    // responde 404, y desde aquí parecería un latido perfecto mientras el
    // monitor se pone rojo por no recibir nada. Ese es justo el tipo de silencio
    // que este trabajo venía a eliminar, así que se registra y se nombra la
    // variable que hay que revisar.
    if (response && response.ok === false) {
      logger.warn(
        `heartbeat '${name}': el monitor respondió ${response.status} — revisa el token de ${envKeyFor(name)}`
      );
      return { sent: false, reason: "rejected" };
    }

    return { sent: true, reason: "ok" };
  } catch (error) {
    // `warn`, no `error`: que el monitor no conteste no es una avería de este
    // servicio. Y sale como mucho una vez por intervalo, porque el envío ya
    // viene frenado — un monitor caído no puede además llenar los logs.
    logger.warn(`heartbeat '${name}' no salió: ${error.message}`);
    return { sent: false, reason: "error" };
  }
};

/** Para los tests: olvida el freno y el último estado. */
const _resetHeartbeatState = () => state.clear();

module.exports = {
  sendHeartbeat,
  resolveHeartbeatUrl,
  resolveQueueServiceName,
  envKeyFor,
  buildUrl,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  _resetHeartbeatState,
};
