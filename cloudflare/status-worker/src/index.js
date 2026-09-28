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
 * Y LO QUE NO PUEDE VER SONDEANDO se lo cuenta Kuma por `POST /ingest`: un
 * worker de la cola parado no cambia nada de `/health` ni de `/ready`, así que
 * desde fuera es invisible. Kuma es el sensor, este Worker el publicador.
 *
 * Sobre lo publicado se pueden escribir INCIDENTES a mano (`/admin`), porque el
 * estado automático contesta "¿está arriba?" y un cliente que ve rojo quiere
 * leer qué pasa y cuándo volverán a contarle algo.
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
      // Agregado diario, en la misma tanda: dos numeros por componente y dia.
      // Es lo que permite que la pagina no tenga que recorrer el historial.
      env.DB.prepare(
        `INSERT INTO daily_uptime (component, day, ok, total) VALUES (?, ?, ?, 1)
         ON CONFLICT(component, day) DO UPDATE SET
           ok = daily_uptime.ok + excluded.ok,
           total = daily_uptime.total + 1`
      ).bind(check.key, at.slice(0, 10), observed.status === "down" ? 0 : 1),
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
  //
  // UNA VEZ AL DÍA, NO EN CADA RONDA, y esto no es una optimización: es la causa
  // de una caída real. Este DELETE recorre la tabla entera, así que ejecutarlo
  // cada minuto eran ~8.900 filas leídas × 1.440 rondas ≈ 12,8 millones al día,
  // contra el límite gratuito de 5 millones de D1. El 2026-09-28 la cuota se
  // agotó a las 10:14 UTC y el vigilante se quedó mudo el resto del día — sin
  // avisar a nadie, porque el que avisa es él.
  //
  // A las 03:0x UTC, que es la franja más tranquila y no compite con nada.
  const now = new Date();
  if (now.getUTCHours() === 3 && now.getUTCMinutes() < 2) {
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
    await env.DB.prepare("DELETE FROM checks WHERE at < ?").bind(cutoff).run();
  }
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

  // Del agregado diario, no del historial crudo: 90 filas por componente en vez
  // de ~259.000. Ver el comentario de `daily_uptime` en schema.sql.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const uptime = await env.DB.prepare(
    `SELECT component, ROUND(100.0 * SUM(ok) / SUM(total), 2) AS pct
       FROM daily_uptime WHERE day >= ? AND total > 0 GROUP BY component`
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
    incident: await activeIncident(env),
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
  .incident { border: 1px solid var(--line); border-left: 3px solid var(--warn);
              border-radius: 12px; background: var(--card); padding: 20px; margin-bottom: 28px; }
  .incident h2 { font-size: 1rem; margin: 0 0 2px; }
  .incident .when { color: var(--muted); font-size: .8rem; margin-bottom: 14px; }
  .upd { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
  .upd:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
  .upd .head { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em;
               color: var(--warn); font-weight: 600; }
  .upd .at { color: var(--muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
  .upd p { margin: 4px 0 0; }
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

  ${
    snapshot.incident
      ? `<div class="incident">
    <h2>${escapeHtml(snapshot.incident.title)}</h2>
    <div class="when">Started ${escapeHtml(snapshot.incident.started_at)}</div>
    ${snapshot.incident.updates
      .map(
        (update) => `<div class="upd">
      <div class="head">${INCIDENT_LABEL[update.state] || escapeHtml(update.state)} <span class="at">· ${escapeHtml(update.at)}</span></div>
      <p>${escapeHtml(update.message)}</p>
    </div>`
      )
      .join("\n    ")}
  </div>`
      : ""
  }

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

/**
 * Formulario para publicar incidentes.
 *
 * POR QUÉ UNA PÁGINA Y NO SOLO `curl`: esto se usa con el servicio caído, con
 * prisa y probablemente desde el móvil. Un comando con comillas anidadas y una
 * cabecera es justo lo que no se acierta en ese momento. La página no contiene
 * ningún secreto: el token lo escribe quien la usa y solo vive en su navegador.
 */
const adminPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Post status update</title>
<style>
  :root { --bg:#fbfbfa; --fg:#1a1a18; --muted:#6b6b66; --card:#fff; --line:#e6e6e2; --accent:#b8791f; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#16161a; --fg:#ececea; --muted:#9a9a95; --card:#1e1e23; --line:#2c2c33; --accent:#d69a3c; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width:560px; margin:0 auto; padding:40px 16px 64px; }
  h1 { font-size:1.2rem; margin:0 0 4px; }
  p.sub { color:var(--muted); font-size:.88rem; margin:0 0 24px; }
  label { display:block; font-size:.82rem; font-weight:600; margin:16px 0 6px; }
  input, select, textarea { width:100%; padding:10px 12px; font:inherit; color:var(--fg);
    background:var(--card); border:1px solid var(--line); border-radius:8px; }
  textarea { min-height:120px; resize:vertical; }
  button { margin-top:20px; padding:11px 18px; font:inherit; font-weight:600; cursor:pointer;
    background:var(--accent); color:#fff; border:none; border-radius:8px; }
  #out { margin-top:16px; font-size:.86rem; color:var(--muted); white-space:pre-wrap; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Post a status update</h1>
  <p class="sub">Publishes to the public status page. Each update is kept — the timeline is the point.</p>

  <label for="token">Token</label>
  <input id="token" type="password" autocomplete="off" placeholder="INGEST_TOKEN">

  <label for="title">Title <span style="font-weight:400;color:var(--muted)">(only used when opening a new incident)</span></label>
  <input id="title" type="text" placeholder="Delayed emails and exports">

  <label for="state">State</label>
  <select id="state">
    ${INCIDENT_STATES.map((s) => `<option value="${s}">${INCIDENT_LABEL[s]}</option>`).join("\n    ")}
  </select>

  <label for="message">Message</label>
  <textarea id="message"></textarea>

  <button id="send">Publish</button>
  <div id="out"></div>
</div>
<script>
  var TEMPLATES = ${JSON.stringify(INCIDENT_TEMPLATE)};
  var state = document.getElementById('state');
  var message = document.getElementById('message');
  var out = document.getElementById('out');

  function applyTemplate() { message.placeholder = TEMPLATES[state.value] || ''; }
  state.addEventListener('change', applyTemplate);
  applyTemplate();

  // El token se recuerda solo en esta pestaña: sobrevive a un envio y muere al
  // cerrarla. Nada de localStorage en un dispositivo que puede ser compartido.
  try { document.getElementById('token').value = sessionStorage.getItem('t') || ''; } catch (e) {}

  document.getElementById('send').addEventListener('click', async function () {
    var token = document.getElementById('token').value.trim();
    try { sessionStorage.setItem('t', token); } catch (e) {}
    out.textContent = 'Publishing...';
    try {
      var response = await fetch('/incident', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-status-token': token },
        body: JSON.stringify({
          state: state.value,
          title: document.getElementById('title').value,
          message: message.value
        })
      });
      var body = await response.text();
      out.textContent = response.status + ' ' + body;
      if (response.ok) message.value = '';
    } catch (error) {
      out.textContent = 'Failed: ' + error.message;
    }
  });
</script>
</body>
</html>`;

/**
 * Versión compacta para empotrar en la aplicación, sin título, sin pie y sin
 * fondo propio: hereda el del contenedor.
 *
 * ES OTRO TRABAJO, NO LA MISMA PÁGINA MÁS PEQUEÑA. Dentro de la aplicación, a
 * un usuario con la sesión iniciada le sirve para entender por qué su
 * exportación va lenta. La página de `/` sirve para cuando NO puede entrar —
 * por eso vive fuera, y por eso es la que va en una propuesta comercial o en un
 * correo de incidencia. Empotrar no sustituye a tener la dirección directa.
 */
const embedPage = (snapshot) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Service status</title>
<style>
  :root { --fg:#1a1a18; --muted:#6b6b66; --line:#e6e6e2; --ok:#2f8f5b; --warn:#b8791f; --bad:#c0392b; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --fg:#ececea; --muted:#9a9a95; --line:#2c2c33; --ok:#4caf7d; --warn:#d69a3c; --bad:#e06c5a; } }
  * { box-sizing:border-box; }
  /* Fondo transparente a proposito: el contenedor pone el suyo y no hay un
     rectangulo de otro color flotando dentro de la aplicacion. */
  body { margin:0; background:transparent; color:var(--fg);
         font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .row { display:flex; align-items:center; gap:10px; padding:10px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:none; }
  .dot { width:9px; height:9px; border-radius:50%; flex:none; }
  .dot.operational { background:var(--ok); } .dot.degraded { background:var(--warn); }
  .dot.down { background:var(--bad); } .dot.unknown { background:var(--muted); }
  .head { font-weight:600; display:flex; align-items:center; gap:10px; padding-bottom:8px; }
  .state { margin-left:auto; font-size:.84rem; color:var(--muted); }
  .state.operational { color:var(--ok); } .state.degraded { color:var(--warn); }
  .state.down { color:var(--bad); }
  .note { font-size:.84rem; color:var(--muted); margin:8px 0 0; }
  a { color:inherit; font-size:.8rem; }
</style>
</head>
<body>
  <div class="head"><span class="dot ${snapshot.overall}"></span>${HEADLINE[snapshot.overall] || HEADLINE.unknown}</div>
  ${
    snapshot.incident
      ? `<p class="note"><strong>${escapeHtml(snapshot.incident.title)}</strong><br>${escapeHtml(
          (snapshot.incident.updates[0] || {}).message || ""
        )}</p>`
      : ""
  }
  ${snapshot.components
    .map(
      (component) => `<div class="row">
    <span class="dot ${component.status}"></span>
    <span>${component.name}</span>
    <span class="state ${component.status}">${LABEL[component.status] || component.status}</span>
  </div>`
    )
    .join("\n  ")}
</body>
</html>`;

/* ------------------------------------------------------------------ *
 * Rutas
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Incidentes escritos a mano
 *
 * El estado automático contesta «¿está arriba?». Un cliente que ve rojo quiere
 * leer otra cosa: qué pasa, a qué le afecta y cuándo vuelven a contarle algo.
 * Eso no lo genera un sondeo, lo escribe una persona.
 *
 * EL VOCABULARIO ES EL ESTÁNDAR DE LA INDUSTRIA (investigating → identified →
 * monitoring → resolved) y no un invento nuestro, por una razón práctica: es el
 * que ya han visto en la página de estado de cualquier proveedor suyo, así que
 * no hay que explicarlo. Y el texto es libre: los cuatro estados dan la forma,
 * la frase la escribe quien sabe qué está pasando.
 * ------------------------------------------------------------------ */

const INCIDENT_STATES = ["investigating", "identified", "monitoring", "resolved"];

const INCIDENT_LABEL = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

/** Texto sugerido para cada estado, en inglés porque la página lo está. */
const INCIDENT_TEMPLATE = {
  investigating:
    "We're investigating an issue affecting [component]. We'll post an update within 30 minutes.",
  identified:
    "We've identified the cause and are working on a fix. [What customers can expect meanwhile.]",
  monitoring:
    "A fix has been applied and we're monitoring the results.",
  resolved:
    "This incident has been resolved. [One line on what happened, if useful.]",
};

/**
 * Quién puede empotrar la página.
 *
 * `FRAME_ANCESTORS` es una lista de orígenes separados por espacios. Sin ella no
 * se manda la cabecera y cualquiera puede empotrarla — que para una página de
 * estado pública no es grave, pero acotarlo evita que alguien la monte dentro de
 * una web suya y la haga pasar por propia.
 *
 * `/admin` NO usa esto: va siempre a `'none'`, pase lo que pase en el entorno.
 */
const frameHeaders = (env) =>
  env.FRAME_ANCESTORS
    ? { "content-security-policy": `frame-ancestors ${env.FRAME_ANCESTORS}` }
    : {};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const activeIncident = async (env) => {
  const incident = await env.DB.prepare(
    "SELECT id, title, state, started_at FROM incidents WHERE resolved_at IS NULL ORDER BY started_at DESC LIMIT 1"
  ).first();
  if (!incident) return null;

  const updates = await env.DB.prepare(
    "SELECT at, state, message FROM incident_updates WHERE incident_id = ? ORDER BY at DESC"
  )
    .bind(incident.id)
    .all();

  return { ...incident, updates: updates.results || [] };
};

/**
 * Publica una actualización de incidente.
 *
 * Abre uno si no hay ninguno abierto, y lo cierra cuando el estado es
 * `resolved`. Deliberadamente NO borra: un incidente resuelto deja su rastro en
 * la tabla, porque el valor de esto para vender no es enseñar que nunca falla
 * nada — es enseñar que cuando falla algo se cuenta y se cierra.
 */
const postIncident = async (request, env) => {
  if (!env.INGEST_TOKEN) return new Response("not configured", { status: 503 });

  const provided =
    request.headers.get("x-status-token") ||
    new URL(request.url).searchParams.get("token");
  if (provided !== env.INGEST_TOKEN) return new Response("unauthorized", { status: 401 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const state = String(payload.state || "").toLowerCase();
  const message = String(payload.message || "").trim();

  if (!INCIDENT_STATES.includes(state)) {
    return Response.json({ ok: false, msg: `state must be one of: ${INCIDENT_STATES.join(", ")}` }, { status: 400 });
  }
  if (!message) {
    return Response.json({ ok: false, msg: "message is required" }, { status: 400 });
  }

  const at = new Date().toISOString();
  let incident = await env.DB.prepare(
    "SELECT id FROM incidents WHERE resolved_at IS NULL ORDER BY started_at DESC LIMIT 1"
  ).first();

  if (!incident) {
    // Cerrar algo que no está abierto no crea un incidente fantasma.
    if (state === "resolved") {
      return Response.json({ ok: false, msg: "no open incident to resolve" }, { status: 409 });
    }
    const title = String(payload.title || "Service incident").trim();
    const created = await env.DB.prepare(
      "INSERT INTO incidents (title, state, started_at) VALUES (?, ?, ?) RETURNING id"
    )
      .bind(title, state, at)
      .first();
    incident = created;
  } else {
    await env.DB.prepare(
      `UPDATE incidents SET state = ?, resolved_at = ? WHERE id = ?`
    )
      .bind(state, state === "resolved" ? at : null, incident.id)
      .run();
  }

  await env.DB.prepare(
    "INSERT INTO incident_updates (incident_id, at, state, message) VALUES (?, ?, ?, ?)"
  )
    .bind(incident.id, at, state, message)
    .run();

  return Response.json({ ok: true, incident: incident.id, state });
};

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
  INCIDENT_STATES,
  INCIDENT_TEMPLATE,
  escapeHtml,
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
    try {
      return await route(request, env);
    } catch (error) {
      // Sin esto, una excepción se convierte en el error 1101 de Cloudflare: una
      // página blanca sin una sola pista, ni en la respuesta ni en los logs.
      // Para un vigilante eso es lo peor que puede pasarle — el unico sitio al
      // que alguien mira cuando algo falla, fallando en silencio.
      console.log(`fetch failed on ${new URL(request.url).pathname}: ${error && error.stack ? error.stack : error}`);
      return new Response(
        JSON.stringify({ ok: false, msg: "status worker error", detail: String(error && error.message ? error.message : error) }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  },
};

const route = async (request, env) => {
    const url = new URL(request.url);

    if (url.pathname === "/ingest") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return ingest(request, env);
    }

    if (url.pathname === "/incident") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return postIncident(request, env);
    }

    if (url.pathname === "/admin") {
      return new Response(adminPage(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          // NUNCA empotrable, y esta sí es una cabecera que importa: es la única
          // página con un campo de token. Dentro del iframe de otro, un
          // formulario de credenciales es un robo esperando a ocurrir.
          "content-security-policy": "frame-ancestors 'none'",
        },
      });
    }

    if (url.pathname === "/embed") {
      const snapshot = await buildSnapshot(env);
      return new Response(embedPage(snapshot), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=30",
          ...frameHeaders(env),
        },
      });
    }

    if (url.pathname === "/api/status.json") {
      const snapshot = await buildSnapshot(env);
      return Response.json(snapshot, {
        headers: { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" },
      });
    }

    // Sondeo del propio Worker — y ahora dice algo.
    //
    // Antes devolvia "ok" mientras el proceso respondiera, que es exactamente lo
    // que fallo el 2026-09-28: el cron llevaba horas muerto por cuota agotada,
    // `/healthz` seguia en verde, y nadie se entero. Un vigilante sin vigilante
    // es un vigilante hasta que se rompe.
    //
    // Ahora informa de la EDAD del ultimo sondeo y responde 503 si es mayor que
    // la ventana de caducidad, para que Kuma pueda avisarnos desde dentro de la
    // VM -- que es la unica pieza que sigue viva si esto se cae.
    if (url.pathname === "/healthz") {
      // No puede lanzar: si la base no contesta -- cuota agotada, por ejemplo --
      // eso ES el diagnostico, y tiene que salir como 503 legible y no como una
      // excepcion. Esta ruta es la que alguien sondea para saber si confiar en
      // el resto de la pagina.
      try {
        const last = await env.DB.prepare("SELECT MAX(updated_at) AS at FROM component_state").first();
        const ageMs = last && last.at ? Date.now() - Date.parse(last.at) : null;
        const stale = ageMs === null || ageMs > STALE_AFTER_MS;
        return Response.json(
          {
            ok: !stale,
            lastCheckAt: last ? last.at : null,
            ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
          },
          { status: stale ? 503 : 200, headers: { "cache-control": "no-store" } }
        );
      } catch (error) {
        return Response.json(
          { ok: false, reason: "state unreadable", detail: String(error && error.message ? error.message : error) },
          { status: 503, headers: { "cache-control": "no-store" } }
        );
      }
    }

    if (url.pathname === "/") {
      const snapshot = await buildSnapshot(env);
      return new Response(page(snapshot), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=30",
          ...frameHeaders(env),
        },
      });
    }

    return new Response("Not found", { status: 404 });
};
