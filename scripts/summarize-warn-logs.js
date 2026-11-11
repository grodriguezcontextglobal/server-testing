'use strict';

/**
 * Resumen de los modos `warn` en los logs (FedRAMP A7 · AC-3, CA-7).
 *
 *   node scripts/summarize-warn-logs.js                  # logs/ de este directorio
 *   node scripts/summarize-warn-logs.js D:\ruta\a\logs   # otra carpeta
 *   node scripts/summarize-warn-logs.js --since 2026-10-20 --top 15 --ips
 *   node scripts/summarize-warn-logs.js --json           # salida para guardar como evidencia
 *
 * Cada control nuevo se despliega en `warn`: deja pasar lo que en `enforce`
 * rechazaría, y lo registra. Pasar a `enforce` es seguro cuando el log confirma
 * que ya no llega nada legítimo por ese camino. Este script lee combined*.log
 * (todas las rotaciones) y cuenta, por modo, cuántas veces se habría
 * rechazado, desde qué ruta, origen y motivo.
 *
 * Para los modos ya pasados a `enforce` cuenta también los rechazos reales
 * (sección "Rechazos en enforce"): si ahí aparece app.devitrak.net o
 * admin.devitrak.net, se está bloqueando a un cliente legítimo. Tres modos
 * (RECEIPT_PUBLIC_READ, DB_COMPANY_PUBLIC, SESSION) responden 401 en enforce
 * sin escribir en el log: para ellos no hay nada que contar.
 *
 * Lo más importante del informe es la VENTANA: winston rota a los 5 MB y guarda
 * 5 ficheros, así que los logs cubren lo que cubren. "0 eventos" en una ventana
 * de 6 horas no demuestra nada; en una de 7 días con tráfico normal, sí.
 *
 * Solo lee. No necesita .env ni bases de datos: se puede correr en la VM o con
 * una copia de la carpeta logs.
 */

const fs = require('fs');
const path = require('path');

// ─── qué mensaje es de qué modo ─────────────────────────────────────────────

// `match`: lo que registra en warn (se habría rechazado). `enforce`: lo que
// registra al rechazar de verdad; null cuando enforce no escribe en el log.
// Cada `enforce` tiene que excluir el mensaje de warn del mismo modo.
const MODES = [
  {
    mode: 'COMPANY_AUTH_MODE',
    match: /^company: unauthenticated request allowed/,
    enforce: /^company: refused an unauthenticated request/,
  },
  {
    mode: 'NODEMAILER_AUTH_MODE',
    match: /^nodemailer: unauthenticated notification allowed/,
    enforce: /^nodemailer: refused an unauthenticated notification/,
  },
  {
    mode: 'CONTRACT_LINK_MODE',
    match: /^contract link: (.+) \(mode=warn/,
    // Solo los motivos de refuse(): el resto de "contract link: ..." son fallos
    // de Redis o del correo, no rechazos.
    enforce: /^contract link: (sin token o token inválido|el token no coincide con la petición|token ya usado)$/,
  },
  {
    mode: 'ATTENDANCE_LINK_MODE',
    match: /^attendance link: dashboard call without session allowed/,
    enforce: /^attendance link: refused a dashboard call without session/,
  },
  {
    mode: 'CONSUMER_TOKEN_MODE',
    match: /^consumer token: (.+) \(mode=warn/,
    enforce: /^consumer token: (?![^]*\(mode=warn)(.+)$/,
  },
  { mode: 'RECEIPT_PUBLIC_READ_MODE', match: /RECEIPT_PUBLIC_READ_MODE=warn/, enforce: null },
  { mode: 'DB_COMPANY_PUBLIC_MODE', match: /DB_COMPANY_PUBLIC_MODE=warn/, enforce: null },
  { mode: 'SESSION_MODE', match: /SESSION_MODE=warn/, enforce: null },
  {
    mode: 'STRIPE_OWNERSHIP_MODE',
    match: /^stripe ownership: (\S+) \(STRIPE_OWNERSHIP_MODE=warn/,
    enforce: /^stripe ownership: (\S+)$/,
  },
  {
    mode: 'COMPANY_CONTEXT_MODE',
    match: /^company context: body and header disagree \(COMPANY_CONTEXT_MODE=warn/,
    enforce: /^company context: body and header disagree, rejected/,
  },
  {
    mode: 'NOSQL_INPUT_MODE',
    match: /^nosql input: (operator in \S+) allowed \(NOSQL_INPUT_MODE=warn/,
    enforce: /^nosql input: rejected (operator in \S+)/,
  },
  {
    mode: 'PLAN_LIMITS_MODE',
    match: /^plan limits: would refuse (\S+) \(PLAN_LIMITS_MODE=warn/,
    enforce: /^plan limits: refused (\S+)/,
  },
  {
    mode: 'STAFF_INACTIVITY_MODE',
    match: /^staff inactivity: would disable account \(STAFF_INACTIVITY_MODE=warn/,
    enforce: /^staff inactivity: account disabled/,
  },
];

// ─── lectura de los logs ────────────────────────────────────────────────────

/**
 * Valor de una línea `  clave: valor,` de util.inspect. Devuelve undefined
 * para lo que no es un escalar (objetos anidados, arrays).
 */
function parseScalar(raw) {
  const v = raw.replace(/,$/, '').trim();
  const quoted = /^(['"`])([\s\S]*)\1$/.exec(v);
  if (quoted) return quoted[2].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
  if (v === 'undefined' || v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return undefined;
}

/**
 * Registros de un combined.log. Admite los dos formatos que ha tenido el
 * logger: prettyPrint (bloques `{ ... }` de varias líneas, el actual) y JSON
 * de una línea. Solo se quedan los campos de primer nivel.
 */
function parseRecords(text) {
  const records = [];
  let current = null;
  let pendingKey = null;
  for (const line of text.split(/\r?\n/)) {
    if (current === null) {
      if (line.startsWith('{"')) {
        try {
          records.push(JSON.parse(line));
        } catch {}
        continue;
      }
      if (line === '{') current = {};
      continue;
    }
    if (line === '}') {
      records.push(current);
      current = null;
      pendingKey = null;
      continue;
    }
    // Continuación de un string partido: `'aaa' +` y en la siguiente `'bbb'`.
    if (pendingKey && /^\s+(['"`])/.test(line)) {
      const piece = line.trim().replace(/ \+$/, '');
      current[pendingKey] = (current[pendingKey] ?? '') + (parseScalar(piece) ?? '');
      if (!/ \+$/.test(line)) pendingKey = null;
      continue;
    }
    pendingKey = null;
    const m = /^ {2}([A-Za-z_$][\w$]*|'[^']+'): (.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].replace(/^'|'$/g, '');
    if (/ \+$/.test(m[2])) {
      current[key] = parseScalar(m[2].replace(/ \+$/, ''));
      pendingKey = key;
      continue;
    }
    const value = parseScalar(m[2]);
    if (value !== undefined) current[key] = value;
  }
  return records;
}

// ─── resumen ────────────────────────────────────────────────────────────────

/** /api/foo/66f1…/bar?x=1 → /api/foo/:id/bar: agrupa la misma ruta. */
const normalizeRoute = (route) =>
  String(route ?? '(sin ruta)')
    .split('?')[0]
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, '/:uuid');

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** { mode, kind: 'warn' | 'enforce', reason } o null. */
function classify(record) {
  const message = String(record.message ?? '');
  for (const { mode, match } of MODES) {
    const m = match.exec(message);
    if (m) return { mode, kind: 'warn', reason: record.reason ?? m[1] ?? null };
  }
  for (const { mode, enforce } of MODES) {
    const m = enforce?.exec(message);
    if (m) return { mode, kind: 'enforce', reason: record.reason ?? m[1] ?? null };
  }
  return null;
}

/**
 * modes: lo que se habría rechazado (warn). rejected: lo rechazado de verdad
 * (enforce); undefined para los modos que en enforce no registran nada.
 */
function summarize(records, { since } = {}) {
  const window = { from: null, to: null, records: 0, days: new Set() };
  const modes = new Map(MODES.map(({ mode }) => [mode, null]));
  const rejected = new Map(MODES.map(({ mode, enforce }) => [mode, enforce ? null : undefined]));

  for (const r of records) {
    const ts = typeof r.timestamp === 'string' ? r.timestamp : null;
    if (since && ts && ts < since) continue;
    window.records++;
    if (ts) {
      window.days.add(ts.slice(0, 10));
      if (!window.from || ts < window.from) window.from = ts;
      if (!window.to || ts > window.to) window.to = ts;
    }
    const hit = classify(r);
    if (!hit) continue;
    const bucket = hit.kind === 'enforce' ? rejected : modes;
    let s = bucket.get(hit.mode);
    if (!s) {
      s = { count: 0, first: null, last: null, routes: new Map(), origins: new Map(), reasons: new Map(), ips: new Map() };
      bucket.set(hit.mode, s);
    }
    s.count++;
    if (ts && (!s.first || ts < s.first)) s.first = ts;
    if (ts && (!s.last || ts > s.last)) s.last = ts;
    bump(s.routes, `${r.method ? `${r.method} ` : ''}${normalizeRoute(r.route ?? r.path ?? r.url)}`);
    bump(s.origins, r.origin ?? '(sin origin)');
    if (hit.reason) bump(s.reasons, hit.reason);
    if (r.ip) bump(s.ips, r.ip);
  }
  return { window, modes, rejected };
}

const hoursBetween = (a, b) => (a && b ? (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 36e5 : 0);

const statsJSON = (s, n) => ({
  count: s.count,
  first: s.first,
  last: s.last,
  distinctIps: s.ips.size,
  routes: Object.fromEntries(top(s.routes, n)),
  origins: Object.fromEntries(top(s.origins, n)),
  reasons: Object.fromEntries(top(s.reasons, n)),
});

function toJSON({ window, modes, rejected }, n) {
  const out = {
    window: { ...window, days: window.days.size, hours: Math.round(hoursBetween(window.from, window.to)) },
    modes: {},
    rejected: {},
  };
  for (const [mode, s] of modes) out.modes[mode] = s ? statsJSON(s, n) : { count: 0 };
  for (const [mode, s] of rejected) {
    out.rejected[mode] = s === undefined ? { count: null, logged: false } : s ? statsJSON(s, n) : { count: 0 };
  }
  return out;
}

function renderStats(lines, label, s, { n, ips }) {
  lines.push(`${label}: ${s.count} eventos (${s.first} → ${s.last}), ${s.ips.size} IPs distintas`);
  for (const [route, c] of top(s.routes, n)) lines.push(`    ${String(c).padStart(6)}  ${route}`);
  const origins = top(s.origins, n).map(([o, c]) => `${o} (${c})`).join(', ');
  lines.push(`    origen: ${origins}`);
  if (s.reasons.size) lines.push(`    motivo: ${top(s.reasons, n).map(([r, c]) => `${r} (${c})`).join(', ')}`);
  if (ips) lines.push(`    ip: ${top(s.ips, n).map(([ip, c]) => `${ip} (${c})`).join(', ')}`);
}

function render(summary, { n = 10, ips = false } = {}) {
  const { window, modes, rejected = new Map() } = summary;
  const hours = hoursBetween(window.from, window.to);
  const lines = [];
  lines.push(`Ventana: ${window.from ?? '?'} → ${window.to ?? '?'} (${Math.round(hours)} h, ${window.records} registros)`);
  // Las rotaciones no tienen por qué ser contiguas: los días con registros
  // dicen cuánto se ha observado de verdad.
  lines.push(`Días con registros: ${window.days.size}`);
  if (hours < 72 || window.days.size < 3) {
    lines.push('AVISO: menos de 3 días de logs. Un modo sin eventos aquí no basta para pasarlo a enforce.');
  }
  lines.push('');
  for (const [mode, s] of modes) {
    if (!s) {
      lines.push(`${mode}: 0 eventos en la ventana`);
      continue;
    }
    renderStats(lines, mode, s, { n, ips });
  }

  // Solo los modos con rechazos: los que están en warn no tienen ninguno y
  // repetir 13 líneas de "0" esconde lo que importa.
  lines.push('');
  lines.push('Rechazos en enforce:');
  const withRejections = [...rejected].filter(([, s]) => s);
  if (!withRejections.length) lines.push('  ninguno en la ventana');
  for (const [mode, s] of withRejections) renderStats(lines, `  ${mode}`, s, { n, ips });
  const silent = [...rejected].filter(([, s]) => s === undefined).map(([mode]) => mode);
  if (silent.length) lines.push(`  (no registran rechazos en enforce: ${silent.join(', ')})`);

  lines.push('');
  lines.push('Un modo con 0 eventos en una ventana larga y con tráfico normal es candidato a enforce.');
  lines.push('Uno con eventos: mirar rutas y origen antes. app.devitrak.net = app de consumidor;');
  lines.push('admin.devitrak.net = dashboard; sin origin = servidor a servidor o herramienta.');
  lines.push('Un rechazo en enforce desde app. o admin. es un cliente real bloqueado: volver a warn y revisar la ruta.');
  return lines.join('\n');
}

function logFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^combined\d*\.log$/.test(f))
    .map((f) => path.join(dir, f));
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const optionValues = new Set([option('--since'), option('--top')].filter(Boolean));
  const dir = args.find((a) => !a.startsWith('--') && !optionValues.has(a)) || path.join(__dirname, '..', 'logs');
  const n = Number(option('--top')) || 10;

  const files = logFiles(dir);
  if (!files.length) {
    console.error(`No hay combined*.log en ${dir}`);
    process.exit(2);
  }
  const records = files.flatMap((f) => parseRecords(fs.readFileSync(f, 'utf8')));
  const summary = summarize(records, { since: option('--since') });
  if (flag('--json')) console.log(JSON.stringify(toJSON(summary, n), null, 2));
  else console.log(render(summary, { n, ips: flag('--ips') }));
}

if (require.main === module) main();

module.exports = { parseRecords, summarize, classify, normalizeRoute, render, toJSON, MODES };
