/**
 * Vigilante externo + página de estado — Cloudflare Worker.
 *
 * POR QUÉ EXISTE, Y POR QUÉ NO LO HACE KUMA. Uptime Kuma corre DENTRO de la VM
 * de producción, así que:
 *
 *   1. No puede sondear `https://db.devitrak.net` — hairpin NAT: la petición
 *      sale a la IP pública y el cortafuegos no la devuelve hacia dentro. La
 *      cadena externa (DNS, TLS, IIS) es invisible desde allí.
 *   2. Si la VM se apaga, Kuma se apaga con ella y NO AVISA DE NADA. El fallo
 *      más grande es justo el que no cubre.
 *
 * Este Worker cierra las dos cosas, y de paso es quien puede sostener una
 * página de estado pública: vive fuera, así que sigue respondiendo el día que
 * el servidor no responde — que es el único día en que alguien la mira.
 *
 * REPARTO DE PAPELES (DESIGN_monitoring_uptime_kuma.md §8.5):
 *   - Kuma  → vigilancia interna profunda: localhost:7453, la cola, los latidos
 *             de los workers. Todo el detalle que NO se publica.
 *   - Este  → la verdad publicada: ¿se llega al servicio desde internet?
 *
 * LO QUE ESTA PRIMERA VERSIÓN NO HACE, a propósito: no recibe latidos empujados
 * desde la VM. Con ellos podría publicar componentes como "Correos" o
 * "Informes"; sin ellos solo puede hablar de lo que sondea. Se añade cuando haga
 * falta, no antes.
 */

/* ------------------------------------------------------------------ *
 * Qué se publica
 *
 * La regla de §8.1: la página pública habla de COMPONENTES DE NEGOCIO, no de
 * dependencias técnicas. Un cliente no sabe qué es Redis ni tiene por qué; sabe
 * si puede asignar un equipo esta mañana. Y ese vocabulario además protege: no
 * revela la arquitectura ni de quién dependemos.
 *
 * Por eso el sondeo interno y el nombre público están separados aquí: se puede
 * cambiar lo que se enseña sin tocar lo que se mide.
 * ------------------------------------------------------------------ */

const COMPONENTS = [
  {
    key: "application",
    label: "Application",
    source: "probe",
    // Las etiquetas y descripciones son TEXTO DE CARA AL CLIENTE, así que van en
    // inglés aunque los comentarios de este repositorio estén en español.
    description: "The service responds over the public internet",
    path: "/health",
    evaluate: (response) => (response.ok ? "operational" : "down"),
  },
  {
    key: "core_services",
    label: "Core services",
    source: "probe",
    description: "Database and supporting services",
    path: "/ready",
    // `/ready` devuelve 503 solo si cae una dependencia CRÍTICA (MySQL o Mongo);
    // Redis y el worker de Go degradan manteniendo el 200. Se respeta esa
    // distinción, pero sin publicar CUÁL de ellas está mal.
    evaluate: (response, body) => {
      if (!response.ok) return "down";
      if (body && body.status === "degraded") return "degraded";
      return "operational";
    },
  },
  {
    key: "background_jobs",
    label: "Background jobs",
    source: "push",
    description: "Emails, exports and bulk operations",
  },
];

/** Los que este Worker sondea por su cuenta. */
const CHECKS = COMPONENTS.filter((component) => component.source === "probe");

/* ------------------------------------------------------------------ *
 * Lo que Kuma cuenta desde dentro
 *
 * Un worker de la cola parado NO se ve desde fuera: `/ready` comprueba MySQL,
 * Mongo, Redis y el worker de Go, y los tres workers de Node no están en esa
 * lista. Kuma sí lo ve, porque no sondea: espera un latido. Así que Kuma es el
 * sensor y este Worker el publicador.
 *
 * REPARTO, para no duplicar avisos: quien avisa a Teams de estos cambios es
 * KUMA, que ya lo hace con sus reintentos y su anti-parpadeo. El `/ingest` solo
 * actualiza lo que se publica. Si notificara también, cada incidente llegaría
 * dos veces al canal y en una semana nadie los leería.
 * ------------------------------------------------------------------ */

/**
 * Qué monitor de Kuma alimenta qué componente público.
 *
 * Un monitor que no esté aquí se IGNORA a propósito: crear un monitor nuevo en
 * Kuma no puede cambiar por accidente lo que ven los clientes. Para publicar
 * algo nuevo hay que añadirlo aquí, que es una decisión y deja rastro.
 *
 * Los monitores de la API y de las dependencias no aparecen: esos los sondea
 * este Worker por su cuenta, y dejar que Kuma los tocara sería que dos fuentes
 * se pisaran el mismo componente.
 */
const MONITOR_COMPONENT = {
  "Email worker": "background_jobs",
  "Bulk worker (bulk + heavy)": "background_jobs",
  "Delete worker": "background_jobs",
  "In-process worker (API)": "background_jobs",
  "Overdue reminders (daily)": "background_jobs",
  "Consent expiry (daily)": "background_jobs",
};

/** Estados de latido de Kuma: 0 caído, 1 arriba, 2 pendiente, 3 mantenimiento. */
const kumaStatus = (value) => {
  if (value === 1 || value === "1") return "operational";
  if (value === 0 || value === "0") return "down";
  return null; // pendiente o mantenimiento: todavía no es un hecho
};

/**
 * De los monitores al componente.
 *
 * Un worker parado es **degraded**, no **down**, y la distinción importa: la
 * cola es durable (`claimOne` reclama de forma atómica y `recoverStale` rescata
 * lo que quedó a medias), así que el trabajo no se pierde — se retrasa. Decirle
 * a un cliente que está "caído" algo que solo va con retraso es exagerar, y una
 * página de estado que exagera se deja de mirar igual que una que miente.
 */
const componentFromMonitors = (rows) =>
  rows.some((row) => row.status === "down") ? "degraded" : "operational";

/** Fallos consecutivos antes de cambiar el estado publicado. Ver §8.3: un
 *  tropiezo de red no puede anunciarle a tus clientes que estás caído. */
const FAILURES_BEFORE_DOWN = 2;

const PROBE_TIMEOUT_MS = 10_000;
const HISTORY_DAYS = 90;

/**
 * A partir de aquí, un estado guardado deja de ser creíble y se publica como
 * «sin datos».
 *
 * POR QUÉ ES IMPRESCINDIBLE: si el cron dejara de ejecutarse —cuota agotada,
 * despliegue roto, un cambio de plan— las filas se quedarían congeladas y la
 * página seguiría afirmando que todo va bien **indefinidamente**, con datos de
 * hace semanas. Una página de estado que miente en verde es peor que no
 * tenerla: es la única que un cliente mira cuando algo le falla.
 *
 * Diez minutos son diez rondas perdidas. Suficiente para no saltar por un
 * reintento del propio Cloudflare, y poco para no sostener una mentira.
 */
const STALE_AFTER_MS = 10 * 60_000;

/* ------------------------------------------------------------------ *
 * Sondeo
 * ------------------------------------------------------------------ */

const probe = async (origin, check) => {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${origin}${check.path}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "devitrak-status-worker" },
      cf: { cacheTtl: 0 },
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      // Un cuerpo que no es JSON no invalida el sondeo: `/health` podría cambiar
      // y el código de estado sigue siendo la señal principal.
    }

    return {
      status: check.evaluate(response, body),
      latencyMs: Date.now() - startedAt,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      // El mensaje se guarda para nosotros; NUNCA se publica (ver buildSnapshot).
      detail: error.name === "TimeoutError" ? "timeout" : String(error.message || error),
    };
  }
};

/* ------------------------------------------------------------------ *
 * Estado, con freno al parpadeo
 * ------------------------------------------------------------------ */

const OPERATIONAL = "operational";

/**
 * Decide el estado PUBLICADO a partir del observado.
 *
 * Subir es inmediato y salir de «operational» cuesta N observaciones seguidas, a
 * propósito: anunciar una recuperación de más dura un minuto, anunciar una caída
 * de más quema la credibilidad de la página — que es lo único que la hace valer
 * para vender.
 *
 * `degraded` cuenta igual que `down` para el freno: lo que se frena es
 * *abandonar* el verde, venga de donde venga.
 */
const nextState = (previous, observed) => {
  // Primera observación de este componente: se fija sin avisar. Un despliegue
  // nuevo no debe abrir con un mensaje de "recuperado" de algo que nunca cayó.
  if (!previous) return { status: observed, failures: 0, changed: true, first: true };

  if (observed === previous.status) return { status: observed, failures: 0, changed: false };

  if (observed === OPERATIONAL) return { status: observed, failures: 0, changed: true };

  const failures = previous.failures + 1;
  if (failures < FAILURES_BEFORE_DOWN) {
    // Todavía no se publica: se mantiene el estado anterior y se cuenta.
    return { status: previous.status, failures, changed: false };
  }
  return { status: observed, failures: 0, changed: true };
};

/* ------------------------------------------------------------------ *
 * Aviso a Teams
 * ------------------------------------------------------------------ */

const STATUS_COLOR = {
  operational: "good",
  degraded: "warning",
  down: "attention",
};

const notifyTeams = async (env, { label, status, previous, detail }) => {
  if (!env.TEAMS_WEBHOOK_URL) return;

  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.5",
          body: [
            {
              type: "TextBlock",
              size: "Medium",
              weight: "Bolder",
              color: STATUS_COLOR[status] || "default",
              // En inglés, igual que las alertas de Uptime Kuma: caen en el
              // mismo canal y mezclar idiomas hace ilegible un hilo de incidente.
              text: `[${label}] ${status === "operational" ? "recovered" : `went ${status}`}`,
            },
            {
              type: "FactSet",
              facts: [
                { title: "Source", value: "External watchdog (Cloudflare)" },
                { title: "Previous", value: previous || "—" },
                { title: "Detail", value: detail || "—" },
                { title: "Time (UTC)", value: new Date().toISOString() },
              ],
            },
          ],
        },
      },
    ],
  };

  try {
    await fetch(env.TEAMS_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    // Que el canal no conteste no puede tumbar la ronda de sondeos: el estado
    // ya quedó guardado y la página lo enseñará igual.
    console.log(`teams notify failed: ${error.message}`);
  }
};

/* ------------------------------------------------------------------ *
 * La ronda
 * ------------------------------------------------------------------ */

const runChecks = async (env) => {
  const origin = env.TARGET_ORIGIN;
  const at = new Date().toISOString();

  for (const check of CHECKS) {
    const observed = await probe(origin, check);

    const previous = await env.DB.prepare(
      "SELECT status, failures FROM component_state WHERE component = ?"
    )
      .bind(check.key)
      .first();

    const next = nextState(previous, observed.status);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO checks (component, at, observed, latency_ms, detail) VALUES (?, ?, ?, ?, ?)"
      ).bind(check.key, at, observed.status, observed.latencyMs, observed.detail),
      env.DB.prepare(
        `INSERT INTO component_state (component, status, failures, since, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(component) DO UPDATE SET
           status = excluded.status,
           failures = excluded.failures,
           since = CASE WHEN component_state.status = excluded.status
                        THEN component_state.since ELSE excluded.since END,
           updated_at = excluded.updated_at`
      ).bind(check.key, next.status, next.failures, at, at),
    ]);

    if (next.changed) {
      await env.DB.prepare(
        "INSERT INTO events (component, at, from_status, to_status, detail) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(check.key, at, previous ? previous.status : null, next.status, observed.detail)
        .run();

      if (!next.first) {
        await notifyTeams(env, {
          label: check.label,
          status: next.status,
          previous: previous ? previous.status : null,
          detail: observed.detail,
        });
      }
    }
  }

  // Poda: el historial que se publica son 90 días, y sin esto la tabla crece sin
  // techo a 1.440 filas por componente y día.
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  await env.DB.prepare("DELETE FROM checks WHERE at < ?").bind(cutoff).run();
};

/* ------------------------------------------------------------------ *
 * El snapshot público
 *
 * ESTE es el único sitio donde se decide qué sale a internet. Si un dato no se
 * construye aquí, no hay forma de que se filtre a la página — ni el `detail` de
 * los sondeos (que puede llevar mensajes de error), ni los nombres de las
 * dependencias, ni latencias por ruta.
 * ------------------------------------------------------------------ */

/**
 * El estado publicable de un componente: lo guardado, salvo que sea viejo.
 * «No lo sé» es una respuesta honesta; «todo bien» con datos de ayer no lo es.
 */
const publishedStatus = (state, now = Date.now(), { source = "probe" } = {}) => {
  if (!state) return "unknown";

  // La caducidad solo aplica a lo que SONDEAMOS, porque eso se refresca cada
  // minuto y su silencio es una anomalía. Lo que llega empujado desde Kuma solo
  // llega cuando algo CAMBIA: un sistema sano puede pasar semanas sin decir
  // nada, y caducarlo lo pondría en "sin datos" justo por ir todo bien.
  //
  // La contrapartida, y hay que tenerla presente: si Kuma dejara de funcionar
  // con la VM en pie, este componente se quedaría congelado en su último valor.
  // Esa clase de fallo la cubre el sondeo de `/health` y `/ready`, no esto.
  if (source === "push") return state.status;

  const updatedAt = Date.parse(state.updated_at);
  if (!Number.isFinite(updatedAt) || now - updatedAt > STALE_AFTER_MS) return "unknown";
  return state.status;
};

/**
 * El titular de la página.
 *
 * El orden importa: una caída conocida manda sobre un componente sin datos
 * —es más accionable—, pero `unknown` manda sobre `operational`, porque no
 * tener datos NO es estar bien.
 */
const overallOf = (components) => {
  if (components.some((c) => c.status === "down")) return "down";
  if (components.some((c) => c.status === "degraded")) return "degraded";
  if (components.some((c) => c.status === "unknown")) return "unknown";
  return "operational";
};

const buildSnapshot = async (env) => {
  const states = await env.DB.prepare(
    "SELECT component, status, since, updated_at FROM component_state"
  ).all();
  const byComponent = new Map((states.results || []).map((row) => [row.component, row]));

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const uptime = await env.DB.prepare(
    `SELECT component,
            ROUND(100.0 * SUM(CASE WHEN observed = 'down' THEN 0 ELSE 1 END) / COUNT(*), 2) AS pct
       FROM checks WHERE at >= ? GROUP BY component`
  )
    .bind(since)
    .all();
  const uptimeBy = new Map((uptime.results || []).map((row) => [row.component, row.pct]));

  const components = COMPONENTS.map((check) => {
    const state = byComponent.get(check.key);
    const status = publishedStatus(state, Date.now(), { source: check.source });
    return {
      key: check.key,
      name: check.label,
      description: check.description,
      status,
      // Si el dato es viejo, tampoco se publica desde cuándo: sería una fecha
      // que sugiere una certeza que ya no tenemos.
      since: status === "unknown" ? null : state.since,
      uptime90d: uptimeBy.has(check.key) ? uptimeBy.get(check.key) : null,
    };
  });

  return {
    overall: overallOf(components),
    components,
    generatedAt: new Date().toISOString(),
  };
};

/* ------------------------------------------------------------------ *
 * La página
 * ------------------------------------------------------------------ */

const LABEL = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "No recent data",
};

const HEADLINE = {
  operational: "All systems operational",
  degraded: "Partially degraded service",
  down: "Service disruption",
  // Nunca "todo bien": si no hay datos recientes, se dice.
  unknown: "Status data unavailable",
};

const page = (snapshot) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Devitrak Status</title>
<style>
  :root {
    --bg: #fbfbfa; --fg: #1a1a18; --muted: #6b6b66; --card: #ffffff;
    --line: #e6e6e2; --ok: #2f8f5b; --warn: #b8791f; --bad: #c0392b;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #16161a; --fg: #ececea; --muted: #9a9a95; --card: #1e1e23;
      --line: #2c2c33; --ok: #4caf7d; --warn: #d69a3c; --bad: #e06c5a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 48px 16px 64px; }
  h1 { font-size: 1.35rem; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: .9rem; margin: 0 0 32px; }
  .overall {
    display: flex; align-items: center; gap: 12px; padding: 18px 20px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    margin-bottom: 28px; font-weight: 600;
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .operational .dot, .dot.operational { background: var(--ok); }
  .degraded .dot, .dot.degraded { background: var(--warn); }
  .down .dot, .dot.down { background: var(--bad); }
  .unknown .dot, .dot.unknown { background: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line);
       border-radius: 12px; background: var(--card); overflow: hidden; }
  li { display: flex; align-items: center; gap: 12px; padding: 16px 20px;
       border-top: 1px solid var(--line); }
  li:first-child { border-top: none; }
  .name { font-weight: 500; }
  .desc { color: var(--muted); font-size: .82rem; }
  .right { margin-left: auto; text-align: right; font-size: .82rem; color: var(--muted); }
  .state { font-weight: 500; font-size: .9rem; }
  .state.operational { color: var(--ok); }
  .state.degraded { color: var(--warn); }
  .state.down { color: var(--bad); }
  footer { color: var(--muted); font-size: .78rem; margin-top: 28px; }
  @media (max-width: 480px) { .wrap { padding-top: 32px; } .desc { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Devitrak Status</h1>
  <p class="sub">Current availability of the Devitrak platform.</p>

  <div class="overall ${snapshot.overall}">
    <span class="dot"></span>
    <span>${HEADLINE[snapshot.overall] || HEADLINE.unknown}</span>
  </div>

  <ul>
    ${snapshot.components
      .map(
        (component) => `<li>
      <span class="dot ${component.status}"></span>
      <span>
        <div class="name">${component.name}</div>
        <div class="desc">${component.description}</div>
      </span>
      <span class="right">
        <div class="state ${component.status}">${LABEL[component.status] || component.status}</div>
        ${component.uptime90d === null ? "" : `<div>${component.uptime90d}% · 90 days</div>`}
      </span>
    </li>`
      )
      .join("\n    ")}
  </ul>

  <footer>Checked every minute from outside our network · Updated ${snapshot.generatedAt}</footer>
</div>
</body>
</html>`;

/* ------------------------------------------------------------------ *
 * Rutas
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * /ingest — lo que Kuma empuja
 * ------------------------------------------------------------------ */

/**
 * Recibe una notificación webhook de Uptime Kuma y actualiza el componente que
 * corresponda.
 *
 * NO HAY FRENO AL PARPADEO AQUÍ, y es deliberado: Kuma ya lo aplicó antes de
 * mandar nada (dos reintentos de 120 s antes de dar un monitor por caído). Un
 * segundo freno encima solo añadiría minutos al aviso sin quitar ni un falso
 * positivo.
 *
 * TAMPOCO AVISA A TEAMS: Kuma acaba de hacerlo. Ver el comentario de
 * MONITOR_COMPONENT.
 */
const ingest = async (request, env) => {
  if (!env.INGEST_TOKEN) {
    return new Response("ingest not configured", { status: 503 });
  }

  const provided =
    request.headers.get("x-status-token") ||
    new URL(request.url).searchParams.get("token");
  if (provided !== env.INGEST_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const monitorName = payload && payload.monitor ? payload.monitor.name : null;
  const component = MONITOR_COMPONENT[monitorName];
  // Se responde 200 a lo que se ignora, no un error: un monitor sin mapear no
  // es un fallo de Kuma, y devolverle un error llenaría SU panel de alertas.
  if (!component) return Response.json({ ok: true, ignored: monitorName || "unknown monitor" });

  const status = kumaStatus(payload.heartbeat ? payload.heartbeat.status : null);
  if (!status) return Response.json({ ok: true, ignored: "pending or maintenance" });

  const at = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO monitor_state (monitor, component, status, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(monitor) DO UPDATE SET
       component = excluded.component,
       status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(monitorName, component, status, at)
    .run();

  const rows = await env.DB.prepare(
    "SELECT status FROM monitor_state WHERE component = ?"
  )
    .bind(component)
    .all();
  const derived = componentFromMonitors(rows.results || []);

  const previous = await env.DB.prepare(
    "SELECT status FROM component_state WHERE component = ?"
  )
    .bind(component)
    .first();

  const changed = !previous || previous.status !== derived;

  await env.DB.prepare(
    `INSERT INTO component_state (component, status, failures, since, updated_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(component) DO UPDATE SET
       status = excluded.status,
       since = CASE WHEN component_state.status = excluded.status
                    THEN component_state.since ELSE excluded.since END,
       updated_at = excluded.updated_at`
  )
    .bind(component, derived, at, at)
    .run();

  if (changed) {
    await env.DB.prepare(
      "INSERT INTO events (component, at, from_status, to_status, detail) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(component, at, previous ? previous.status : null, derived, `kuma: ${monitorName} ${status}`)
      .run();
  }

  return Response.json({ ok: true, component, status: derived, monitor: monitorName });
};

/** Se exportan las piezas puras para poder probarlas: son las que deciden lo que
 *  ve un cliente, y equivocarse ahí es anunciar caídas que no existen. */
export {
  nextState,
  CHECKS,
  COMPONENTS,
  FAILURES_BEFORE_DOWN,
  publishedStatus,
  overallOf,
  STALE_AFTER_MS,
  MONITOR_COMPONENT,
  kumaStatus,
  componentFromMonitors,
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ingest") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return ingest(request, env);
    }

    if (url.pathname === "/api/status.json") {
      const snapshot = await buildSnapshot(env);
      return Response.json(snapshot, {
        headers: { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" },
      });
    }

    // Sondeo del propio Worker, para poder vigilar al vigilante.
    if (url.pathname === "/healthz") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/") {
      const snapshot = await buildSnapshot(env);
      return new Response(page(snapshot), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
