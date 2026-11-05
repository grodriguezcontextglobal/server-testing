/**
 * extract-api-payloads.js
 *
 * Extrae, desde el código fuente, el payload esperado de cada endpoint HTTP del
 * servidor (body / params / query / headers) y genera dos artefactos para el
 * cliente:
 *
 *   docs/api-payloads.md    — tabla por módulo, con archivo:línea del handler
 *   docs/api-payloads.d.ts  — interfaces TS + mapa `ApiEndpoints` por "METHOD /path"
 *
 * Uso:
 *   node scripts/extract-api-payloads.js            # regenera los dos artefactos
 *   node scripts/extract-api-payloads.js --json     # además escribe docs/api-payloads.json
 *
 * Cómo funciona (y sus límites):
 *   - Lee cada router de `routes/` y `mysql/routes/`, resuelve el handler final
 *     (el último identificador de la lista de middlewares) hasta su controlador,
 *     y recolecta los campos que el handler lee de `req.body|params|query`.
 *   - Sigue un nivel de indirección para los handlers generados por factories
 *     (`createQueuedEmailController(buildX)`, `createQueuedJobController(...)`),
 *     entrando al builder y a las plantillas que reciben el mismo `body`.
 *   - Los comentarios se eliminan antes de parsear: hay rutas comentadas en el
 *     repo (p. ej. en `mysql/routes/stripe.js`) que NO existen en runtime.
 *   - Es análisis estático por regex, no ejecución: los tipos del .d.ts se
 *     INFIEREN del nombre del campo y deben verificarse contra el controlador
 *     antes de tratarlos como contrato. La columna "requerido" solo lista campos
 *     con validación explícita en el handler (`if (!campo) return 400`).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Prefijo de montaje real, tomado de configureRoutes() en index.js.
const MOUNTS = {
  'routes/admin.js': '/api/admin',
  'routes/article.js': '/api/article',
  'routes/auth.js': '/api/auth',
  'routes/registration.js': '/api/registration',
  'routes/cashReport.js': '/api/cash-report',
  'routes/company.js': '/api/company',
  'routes/devitrakApp.js': '/api/devitrak',
  'routes/document.js': '/api/document',
  'routes/errorLog.js': '/api/error_log',
  'routes/event.js': '/api/event',
  'routes/eventLog.js': '/api/event-log',
  'routes/feedback.js': '/api/feedback',
  'routes/heavyTask.js': '/api/heavy-task',
  'routes/image.js': '/api/image',
  'routes/inventory.js': '/api/inventory',
  'routes/item.js': '/api/item',
  'routes/jobs.js': '/api/jobs',
  'routes/lease.js': '/api/lease',
  'routes/nodeMailer.js': '/api/nodemailer',
  'routes/notificationLog.js': '/api/notificationlog',
  'routes/post.js': '/api/post',
  'routes/receivers.js': '/api/receiver',
  'routes/search.js': '/api/search',
  'routes/staff.js': '/api/staff',
  'routes/staffActivityLog.js': '/api/staff-activity-log',
  'routes/stripe.js': '/api/stripe',
  'routes/subscription.js': '/api/subscription',
  'routes/transaction.js': '/api/transaction',
  'routes/transactionAuditLog.js': '/api/transaction-audit-log',
  'routes/cache_route.js': '/api/cache_update',
  'routes/consumer.js': '/api/consumer',
  'routes/status.js': '/api',
  'mysql/routes/company.js': '/api/db_company',
  'mysql/routes/consumerAttendingEvent.js': '/api/db_consumer_attending_event_record',
  'mysql/routes/consumers.js': '/api/db_consumer',
  'mysql/routes/events.js': '/api/db_event',
  'mysql/routes/item.js': '/api/db_item',
  'mysql/routes/identifier.js': '/api/db_identifier',
  'mysql/routes/recordEvent.js': '/api/db_record',
  'mysql/routes/staff.js': '/api/db_staff',
  'mysql/routes/stripe.js': '/api/db_stripe',
  'mysql/routes/lease.js': '/api/db_lease',
  'mysql/routes/inventory.js': '/api/db_inventory',
  'mysql/routes/members.js': '/api/db_member',
  'mysql/routes/location.js': '/api/db_location',
  'mysql/routes/sub_location.js': '/api/db_sub_location',
  'mysql/routes/shipment.js': '/api/db_shipment',
  'mysql/routes/school.js': '/api/school',
};

// Routers presentes en el repo pero NO montados en index.js (no existen en runtime).
const UNMOUNTED = ['routes/twilio.js', 'mysql/routes/location_manager.js', 'routes/cloudinary.js'];

/**
 * Endpoints que no salen de un `router.method(...)` y hay que declarar a mano.
 * `app.use("/api/cloudinary", cloudinaryUploader)` monta un HANDLER pelado, no un
 * router: cualquier método y cualquier subpath bajo /api/cloudinary caen en él
 * (`/api/cloudinary/upload-image` incluido, que es lo que llama el cliente).
 */
const MANUAL_ROUTES = [
  {
    method: 'POST',
    endpoint: '/api/cloudinary/upload-image',
    file: 'cloudinary/connection.js',
    handler: 'cloudinaryUploader',
    routeFile: 'index.js:209',
    note: 'montado como middleware directo (`app.use("/api/cloudinary", handler)`): CUALQUIER método y subpath bajo `/api/cloudinary` llega a este handler; `routes/cloudinary.js` no está montado',
  },
];

const SKIP_MEMBERS = new Set([
  'map', 'filter', 'forEach', 'length', 'toString', 'hasOwnProperty', 'reduce',
  'find', 'findIndex', 'some', 'every', 'join', 'slice', 'splice', 'trim',
  'includes', 'push', 'pop', 'shift', 'sort', 'flat', 'flatMap', 'concat',
  'split', 'replace', 'replaceAll', 'toLowerCase', 'toUpperCase', 'then',
  'catch', 'finally', 'keys', 'values', 'entries', 'constructor', 'indexOf',
  'padStart', 'padEnd', 'charAt', 'match', 'startsWith', 'endsWith', 'repeat',
]);

const NON_CALLEES = new Set([
  'if', 'for', 'while', 'switch', 'return', 'typeof', 'await', 'new', 'JSON',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'console',
  'logger', 'Math', 'Date', 'Set', 'Map',
]);

// ---------------------------------------------------------------- utilidades

/** Reemplaza comentarios por espacios (conserva \n para no mover line numbers). */
function stripComments(src) {
  let out = '';
  let i = 0;
  let state = 'code'; // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    // dentro de string/template
    if (c === '\\') { out += c + (n || ''); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
    out += c; i++; continue;
  }
  return out;
}

const fileCache = {};
function read(p) {
  if (fileCache[p] === undefined) {
    fileCache[p] = fs.existsSync(p) && fs.statSync(p).isFile()
      ? stripComments(fs.readFileSync(p, 'utf8'))
      : null;
  }
  return fileCache[p];
}

function resolveModule(fromFile, mod) {
  if (!mod || !mod.startsWith('.')) return null;
  const base = path.dirname(fromFile);
  for (const cand of [mod, mod + '.js', path.join(mod, 'index.js')]) {
    const p = path.resolve(base, cand);
    if (read(p) !== null) return p;
  }
  return null;
}

/** identificador importado -> ruta del módulo (soporta destructuring anidado). */
function parseImports(text) {
  const map = {};
  const re = /const\s*(\{[\s\S]*?\}|[\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1];
    const mod = m[2];
    if (spec.startsWith('{')) {
      spec.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
        const parts = s.split(':').map((x) => x.trim());
        const orig = parts[0].replace(/[{}]/g, '').trim();
        const alias = (parts[1] || parts[0]).replace(/[{}]/g, '').trim();
        // `{ updateBulkItemsInTransaction: ...Worker }`: en el módulo destino la
        // función se llama `orig`, no `alias`. Sin esto la recursión no la halla.
        if (/^[\w$]+$/.test(alias)) map[alias] = { mod, name: orig };
      });
    } else {
      map[spec] = { mod, name: spec };
    }
  }
  return map;
}

/** Balancea desde text[i] (que debe ser un delimitador de apertura). */
function matchDelim(text, i) {
  const open = text[i];
  const close = open === '{' ? '}' : open === '(' ? ')' : ']';
  let depth = 1;
  let j = i + 1;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (c === open) depth++;
    else if (c === close) depth--;
    j++;
  }
  return j; // índice justo después del cierre
}

const skipWs = (text, i) => { while (i < text.length && /\s/.test(text[i])) i++; return i; };

/**
 * Encuentra una función nombrada; devuelve {params, body, line}.
 * El escaneo balancea paréntesis en vez de usar `[^)]*`: hay factories con
 * defaults que contienen arrows (`({ fn = (id) => X } = {}) => ...`) y con el
 * regex simple quedaban sin resolver.
 */
function findFn(text, name) {
  const esc = name.replace(/[$]/g, '\\$');
  const decl = new RegExp('(?:const|let|var)\\s+' + esc + '\\s*=\\s*').exec(text);
  if (decl) {
    let i = skipWs(text, decl.index + decl[0].length);
    if (text.startsWith('async', i)) i = skipWs(text, i + 5);
    let params = [];
    if (text[i] === '(') {
      const end = matchDelim(text, i);
      params = splitArgs(text.slice(i + 1, end - 1)).map((s) => s.split('=')[0].trim()).filter(Boolean);
      i = skipWs(text, end);
    } else {
      const idm = /^([\w$]+)/.exec(text.slice(i));
      if (!idm) return findFnDecl(text, esc);
      params = [idm[1]];
      i = skipWs(text, i + idm[1].length);
    }
    if (!text.startsWith('=>', i)) return findFnDecl(text, esc);
    i = skipWs(text, i + 2);
    // Arrows currificadas: `({opts} = {}) => async (req, res) => {...}`. Nos
    // interesan los parámetros y el cuerpo de la arrow MÁS INTERNA (el handler).
    for (let guard = 0; guard < 6; guard++) {
      if (text.startsWith('async', i)) i = skipWs(text, i + 5);
      if (text[i] === '(') {
        const end = matchDelim(text, i);
        const after = skipWs(text, end);
        if (text.startsWith('=>', after)) {
          params = splitArgs(text.slice(i + 1, end - 1)).map((s) => s.split('=')[0].trim()).filter(Boolean);
          i = skipWs(text, after + 2);
          continue;
        }
        return { params, body: text.slice(i, end), line: lineOf(text, decl.index) };
      }
      const idm = /^([\w$]+)\s*=>/.exec(text.slice(i));
      if (idm) { params = [idm[1]]; i = skipWs(text, i + idm[0].length); continue; }
      break;
    }
    if (text[i] === '{') return { params, body: text.slice(i, matchDelim(text, i)), line: lineOf(text, decl.index) };
    const end = text.indexOf(';', i);
    return { params, body: text.slice(i, end < 0 ? i + 400 : end), line: lineOf(text, decl.index) };
  }
  return findFnDecl(text, esc);
}

function findFnDecl(text, esc) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + esc + '\\s*\\(').exec(text);
  if (!m) return null;
  const open = text.indexOf('(', m.index + m[0].length - 1);
  const end = matchDelim(text, open);
  const params = splitArgs(text.slice(open + 1, end - 1)).map((s) => s.split('=')[0].trim()).filter(Boolean);
  const b = skipWs(text, end);
  if (text[b] !== '{') return null;
  return { params, body: text.slice(b, matchDelim(text, b)), line: lineOf(text, m.index) };
}

/** Separa argumentos de primer nivel (ignora comas dentro de (), {}, []). */
function splitArgs(raw) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of raw) {
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** `const handler = factory(argA, {opts})` -> {factory, args, argsRaw}. */
function findFactoryCall(text, name) {
  const esc = name.replace(/[$]/g, '\\$');
  const m = new RegExp('(?:const|let|var)\\s+' + esc + '\\s*=\\s*([\\w$]+)\\s*\\(').exec(text);
  if (!m) return null;
  const i = text.indexOf('(', m.index + m[0].length - 1);
  let depth = 1;
  let j = i + 1;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    j++;
  }
  const argsRaw = text.slice(i + 1, j - 1);
  const args = argsRaw.split(/,(?![^({[]*[)}\]])/).map((s) => s.trim()).filter(Boolean);
  return { factory: m[1], args, argsRaw, line: lineOf(text, m.index) };
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

const cleanField = (raw) => {
  const f = String(raw).split('\n').pop().trim();
  const name = f.split(':')[0].split('=')[0].replace(/[^\w$]/g, '').trim();
  return name ? name + (f.includes('=') ? '?' : '') : null;
};

// -------------------------------------------------------------- recolección

/**
 * Extrae los campos de nivel 1 de un `Schema({...})` de Mongoose con su tipo.
 * Varios handlers Mongo pasan `req.body` COMPLETO al modelo (`new Model(req.body)`
 * o `Model.find(req.body)`), así que ahí el esquema ES el contrato del payload.
 */
function parseSchemaFields(text) {
  const m = /(?:new\s+)?(?:mongoose\.)?Schema\s*\(\s*\{/.exec(text);
  if (!m) return null;
  const start = text.indexOf('{', m.index + m[0].length - 1);
  let depth = 1;
  let i = start + 1;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  const inner = text.slice(start + 1, i - 1);
  const chunks = [];
  let d = 0;
  let buf = '';
  for (const ch of inner) {
    if ('{['.includes(ch)) d++;
    if ('}]'.includes(ch)) d--;
    if (ch === ',' && d === 0) { chunks.push(buf); buf = ''; continue; }
    buf += ch;
  }
  chunks.push(buf);
  const TYPES = {
    String: 'string', Number: 'number', Boolean: 'boolean', Date: 'string',
    Array: 'unknown[]', Object: 'Record<string, unknown>', Buffer: 'unknown',
    'Schema.Types.ObjectId': 'string', 'mongoose.Schema.Types.ObjectId': 'string',
    'Schema.Types.Mixed': 'unknown', 'mongoose.Schema.Types.Mixed': 'unknown',
  };
  const fields = {};
  for (const chunk of chunks) {
    const km = /^\s*["']?([\w$]+)["']?\s*:\s*([\s\S]*)$/.exec(chunk);
    if (!km) continue;
    const val = km[2].trim();
    let t;
    if (val.startsWith('[')) t = 'unknown[]';
    else if (val.startsWith('{')) {
      const tm = /\btype\s*:\s*([\w.$]+)/.exec(val);
      t = tm ? tm[1] : null;
      if (!t) { fields[km[1]] = 'Record<string, unknown>'; continue; }
    } else t = val.replace(/[,;]$/, '');
    fields[km[1]] = TYPES[t] || (t === 'unknown[]' ? 'unknown[]' : 'unknown');
  }
  return Object.keys(fields).length ? fields : null;
}

/** `new Model(req.body)` / `Model.find(req.body)` -> modelos que reciben el body. */
function mongooseTargets(body) {
  const out = [];
  let m;
  const ctor = /new\s+([A-Z][\w$]*)\s*\(\s*(?:req|request)\.body/g;
  while ((m = ctor.exec(body))) out.push({ model: m[1], kind: 'create' });
  const call = /\b([A-Z][\w$]*)\s*\.\s*(find|findOne|create|insertMany|countDocuments|deleteOne|deleteMany|updateOne|updateMany|findOneAndUpdate|findOneAndDelete)\s*\(\s*(?:req|request)\.body/g;
  while ((m = call.exec(body))) out.push({ model: m[1], kind: m[2] });
  return out;
}

function newAcc() {
  return {
    body: new Set(), params: new Set(), query: new Set(), headers: new Set(),
    required: new Set(), dynamic: new Set(), notes: new Set(), factories: new Set(),
    codes: new Set(), allowed: new Set(), identifiers: new Set(), schemaTypes: {},
    optionalHints: new Set(),
  };
}

/** Campos leídos de req.body|params|query dentro de un cuerpo de función. */
function collectReq(body, acc) {
  for (const kind of ['body', 'params', 'query']) {
    let m;
    const destr = new RegExp('\\{([^{}]*)\\}\\s*=\\s*(?:req|request)\\.' + kind, 'g');
    while ((m = destr.exec(body))) {
      m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((f) => {
        if (f.startsWith('...')) { acc.notes.add('rest-spread `' + f.trim() + '`: acepta campos extra'); return; }
        const name = cleanField(f);
        if (name) acc[kind].add(name);
      });
    }
    const dot = new RegExp('(?:req|request)\\.' + kind + '\\.([A-Za-z_$][\\w$]*)', 'g');
    while ((m = dot.exec(body))) acc[kind].add(m[1]);
    const brk = new RegExp('(?:req|request)\\.' + kind + '\\[\\s*["\']([^"\']+)["\']', 'g');
    while ((m = brk.exec(body))) acc[kind].add(m[1]);
  }
  // Alias local del body: `const body = request.body || {}` (patrón muy común en
  // los controladores MySQL) — sin esto, los endpoints que trabajan sobre el
  // alias y no sobre `request.body` parecen no tener payload.
  let am;
  const alias = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:req|request)\.body\b/g;
  while ((am = alias.exec(body))) {
    collectParam(body, am[1], acc);
    if (new RegExp('Object\\.(keys|values|entries)\\s*\\(\\s*' + am[1] + '\\b').test(body)) {
      acc.dynamic.add('cuerpo DINÁMICO: se itera el body (`Object.entries`) para armar el SQL');
    }
  }
  // Listas blancas de columnas/identificadores: en los updates dinámicos ESTAS
  // son el contrato real del payload, no el destructuring.
  const wl = /(?:const|let|var)\s+([\w$]+)\s*=\s*new Set\(\s*\[([^\]]*)\]/g;
  while ((am = wl.exec(body))) {
    const name = am[1];
    const fields = (am[2].match(/["']([^"']+)["']/g) || []).map((s) => s.slice(1, -1));
    if (!fields.length) continue;
    if (/identifier|where|target|lookup/i.test(name)) fields.forEach((f) => acc.identifiers.add(f));
    else if (/allow|white|valid|permitted|editable|column|updatable|known/i.test(name)) fields.forEach((f) => { acc.allowed.add(f); acc.body.add(f + '?'); });
  }
  let m;
  const hdr = /(?:req|request)\.(?:get|header)\(\s*["']([^"']+)["']/g;
  while ((m = hdr.exec(body))) acc.headers.add(m[1]);
  const hdr2 = /(?:req|request)\.headers\[\s*["']([^"']+)["']/g;
  while ((m = hdr2.exec(body))) acc.headers.add(m[1]);
  if (/(?:req|request)\._parsedUrl\.(?:query|search)/.test(body)) {
    acc.dynamic.add('lee el QUERY STRING crudo (`request._parsedUrl.query`) y lo parte por `&`: el orden y el formato de los parámetros importan, revisar el handler');
  }
  if (/Object\.(keys|values|entries)\s*\(\s*(?:req|request)\.body/.test(body)) {
    acc.dynamic.add('cuerpo DINÁMICO: los pares del body se convierten en columnas/filtros SQL (`Object.keys(req.body)`)');
  }
  const optBody = /([A-Za-z_$][\w$]*)\s*!==\s*undefined/g;
  while ((m = optBody.exec(body))) acc.optionalHints.add(m[1]);
  const code = /status\(\s*(\d{3})\s*\)/g;
  while ((m = code.exec(body))) acc.codes.add(m[1]);
  // Requeridos: guardas `if (<cond>) ... status(400|403|422)`. Se toma CADA
  // `!campo` de la condición (no solo el primero: `if (!a || !b)` exige ambos) y
  // luego se intersecta con los campos del payload, así que las variables locales
  // que también se niegan (userAccess, connection, ...) se descartan solas.
  const ifRe = /\bif\s*\(/g;
  while ((m = ifRe.exec(body))) {
    const condEnd = matchDelim(body, m.index + m[0].length - 1);
    const cond = body.slice(m.index + m[0].length, condEnd - 1);
    const tail = body.slice(condEnd, condEnd + 320);
    // Dos formas de rechazar en el repo: `response.status(400)` y los validadores
    // de los controladores encolados, que devuelven `{ status: 400, body: {...} }`.
    if (!/status\s*[(:]\s*(?:400|403|409|422)\s*[)},]/.test(tail)) continue;
    let g;
    const neg = /!\s*(?:(?:req|request)\.body\.)?([A-Za-z_$][\w$]*)/g;
    while ((g = neg.exec(cond))) acc.required.add(g[1]);
    const eq = /([A-Za-z_$][\w$]*)\s*===?\s*(?:undefined|null)/g;
    while ((g = eq.exec(cond))) acc.required.add(g[1]);
    // `if (!Array.isArray(staffEmails) || staffEmails.length === 0) -> 400`
    const optH = /([A-Za-z_$][\w$]*)\s*!==\s*undefined/g;
    while ((g = optH.exec(cond))) acc.optionalHints.add(g[1]);
    const arr = /!\s*Array\.isArray\(\s*([A-Za-z_$][\w$]*)/g;
    while ((g = arr.exec(cond))) acc.required.add(g[1]);
    // Guardas por helper: `if (hasBlankRequiredId(company_id)) -> 400`. Es el
    // patrón del módulo school; sin esto sus endpoints salían sin requeridos.
    const helper = /\b(?:has|is)\w*(?:Blank|Missing|Empty|Invalid|Required)\w*\(\s*([A-Za-z_$][\w$]*)/g;
    while ((g = helper.exec(cond))) acc.required.add(g[1]);
  }
}

/** Campos leídos de un parámetro que transporta el body (builders de email, etc.). */
function collectParam(body, param, acc) {
  const esc = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m;
  const dot = new RegExp('\\b' + esc + '\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
  while ((m = dot.exec(body))) if (!SKIP_MEMBERS.has(m[1])) acc.body.add(m[1]);
  const brk = new RegExp('\\b' + esc + '\\s*\\??\\[\\s*["\']([^"\']+)["\']', 'g');
  while ((m = brk.exec(body))) acc.body.add(m[1]);
  const destr = new RegExp('\\{([^{}]*)\\}\\s*=\\s*' + esc + '\\b', 'g');
  while ((m = destr.exec(body))) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((f) => {
      if (f.startsWith('...')) { acc.notes.add('rest-spread `' + f.trim() + '`: acepta campos extra'); return; }
      const name = cleanField(f);
      if (name) acc.body.add(name);
    });
  }
}

function walk(file, fnName, paramHint, acc, seen, depth) {
  if (depth > 4) return null;
  // parseImports puede devolver un trozo de código en vez de un nombre (p. ej.
  // un require dentro de una expresión); usado en un RegExp, tumbaba el script.
  if (typeof fnName !== 'string' || !/^[\w$]+$/.test(fnName)) return null;
  const key = file + '#' + fnName;
  if (seen.has(key)) return null;
  seen.add(key);
  const text = read(file);
  if (!text) return null;

  const fn = findFn(text, fnName);
  if (!fn) {
    const fc = findFactoryCall(text, fnName);
    if (!fc) return null;
    acc.factories.add(fc.factory);
    const imp = parseImports(text);
    // la factory misma (createQueuedJobController, ...) lee req.body/headers
    const fimp = imp[fc.factory];
    const fpath = fimp ? resolveModule(file, fimp.mod) : null;
    if (fpath) walk(fpath, fimp.name, 'body', acc, seen, depth + 1);
    else walk(file, fc.factory, 'body', acc, seen, depth + 1);
    // sus argumentos son los builders que consumen el body
    fc.args.filter((a) => /^[\w$]+$/.test(a)).forEach((a) => {
      const ai = imp[a];
      const p = ai ? resolveModule(file, ai.mod) : null;
      walk(p || file, p ? ai.name : a, 'body', acc, seen, depth + 1);
    });
    let mm;
    const props = /([\w$]+)\s*:\s*([\w$]+)\s*[,}]/g;
    while ((mm = props.exec(fc.argsRaw))) {
      if (/^(build|normalize|validate|extract|idempotency)/i.test(mm[2])) walk(file, mm[2], 'body', acc, seen, depth + 1);
    }
    // Solo arrows cuyo parámetro ES el body. `buildSuccessBody: (job) => ...`
    // no describe el payload: metía `id` y `payload` (de `job.id`/`job.payload`)
    // como si fueran campos del request.
    const inlineArrow = /\(?\s*(body)\s*\)?\s*=>/g;
    while ((mm = inlineArrow.exec(fc.argsRaw))) collectParam(fc.argsRaw, mm[1], acc);
    return { line: fc.line, viaFactory: fc.factory };
  }

  collectReq(fn.body, acc);
  const p0 = fn.params[0];
  // Un primer parámetro desestructurado (factory con opciones) no transporta el body.
  const param = (p0 && /^[\w$]+$/.test(p0) ? p0 : null) || paramHint;
  // Si el primer parámetro NO es la request, transporta el body (builder/plantilla).
  if (param && !/^(req|request)$/.test(param)) collectParam(fn.body, param, acc);
  // Builders devueltos por otra función: `createBuildX() { return async (body) => {...} }`.
  // Sin esto se perdían campos como `supplierInfo` en los emails con adjuntos.
  let ia;
  const innerBody = /\(\s*(body)\s*\)\s*=>/g;
  while ((ia = innerBody.exec(fn.body))) collectParam(fn.body, ia[1], acc);

  const imp = parseImports(text);
  const carrier = param && !/^(req|request)$/.test(param) ? param : null;
  if (carrier) {
    const callRe = new RegExp('([A-Za-z_$][\\w$]*)\\s*\\(\\s*' + carrier.replace(/[$]/g, '\\$') + '\\b', 'g');
    let m;
    while ((m = callRe.exec(fn.body))) {
      const callee = m[1];
      if (NON_CALLEES.has(callee)) continue;
      if (findFn(text, callee) || findFactoryCall(text, callee)) { walk(file, callee, carrier, acc, seen, depth + 1); continue; }
      const ci = imp[callee];
      const p = ci ? resolveModule(file, ci.mod) : null;
      if (p) walk(p, ci.name, carrier, acc, seen, depth + 1);
    }
  } else {
    // controlador: seguir helpers que reciben req.body completo
    const callRe = /([A-Za-z_$][\w$]*)\s*\(\s*(?:req|request)\.body\b/g;
    let m;
    while ((m = callRe.exec(fn.body))) {
      const callee = m[1];
      if (NON_CALLEES.has(callee)) continue;
      if (findFn(text, callee) || findFactoryCall(text, callee)) { walk(file, callee, 'body', acc, seen, depth + 1); continue; }
      const ci = imp[callee];
      const p = ci ? resolveModule(file, ci.mod) : null;
      if (p) walk(p, ci.name, 'body', acc, seen, depth + 1);
    }
    // req.body -> modelo Mongo: ahí el esquema del modelo es el contrato real.
    const mongo = mongooseTargets(fn.body);
    for (const t of mongo) {
      const mi = imp[t.model];
      const mp = mi ? resolveModule(file, mi.mod) : null;
      const mtext = mp ? read(mp) : null;
      const fields = mtext ? parseSchemaFields(mtext) : null;
      if (!fields) { acc.notes.add('pasa `req.body` completo a `' + t.model + '.' + t.kind + '()`'); continue; }
      const rel = path.relative(ROOT, mp).replace(/\\/g, '/');
      Object.entries(fields).forEach(([f, ty]) => { acc.body.add(f + '?'); acc.schemaTypes[f] = ty; });
      acc.notes.add(t.kind === 'create'
        ? 'el body se pasa completo a `new ' + t.model + '()`: los campos son los del esquema `' + rel + '`'
        : 'el body se usa como FILTRO Mongo en `' + t.model + '.' + t.kind + '()`: cualquier subconjunto de los campos de `' + rel + '` (`{}` trae todo)');
    }
    if (!mongo.length && /\b(?:req|request)\.body\s*[,)]/.test(fn.body)) acc.notes.add('pasa `req.body` completo a otra capa (revisar el controlador para el detalle)');
  }
  return { line: fn.line };
}

// ------------------------------------------------------------ parseo de rutas

function parseRouter(text) {
  const out = [];
  const re = /router\.(get|post|put|patch|delete)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const inner = text.slice(re.lastIndex, i - 1);
    const pm = inner.match(/^\s*["'`]([^"'`]*)["'`]\s*,?/);
    if (!pm) continue;
    const args = inner.slice(pm[0].length).split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
    out.push({
      method: m[1].toUpperCase(),
      subpath: pm[1],
      args,
      line: lineOf(text, m.index),
    });
  }
  return out;
}

/** Deja un solo `campo` por nombre; si aparece con y sin `?`, gana el requerido. */
function dedupeFields(list) {
  const bare = new Set(list.filter((f) => !f.endsWith('?')));
  const seen = new Set();
  const out = [];
  for (const f of list.slice().sort()) {
    const b = f.replace(/\?$/, '');
    if (seen.has(b)) continue;
    seen.add(b);
    out.push(bare.has(b) ? b : f);
  }
  return out.sort();
}

function buildInventory() {
  const rows = [];
  for (const [routeFile, mount] of Object.entries(MOUNTS)) {
    const abs = path.join(ROOT, routeFile);
    const text = read(abs);
    if (!text) { console.error('WARN: no se pudo leer ' + routeFile); continue; }
    const imp = parseImports(text);
    for (const r of parseRouter(text)) {
      const idents = r.args.filter((a) => /^[A-Za-z_$][\w$.]*(\(.*\))?$/.test(a));
      const handler = idents.length ? idents[idents.length - 1] : null;
      const middlewares = idents.slice(0, -1);
      const acc = newAcc();
      let source = null;
      let viaFactory = null;
      if (handler) {
        const hname = handler.replace(/\(.*/, '');
        const hi = imp[hname];
        const ctrl = hi ? resolveModule(abs, hi.mod) : null;
        if (ctrl) {
          const res = walk(ctrl, hi.name, null, acc, new Set(), 0);
          const rel = path.relative(ROOT, ctrl).replace(/\\/g, '/');
          source = res && res.line ? rel + ':' + res.line : rel + ' (handler no localizado)';
          viaFactory = res && res.viaFactory ? res.viaFactory : null;
        } else {
          source = hi ? 'módulo ' + hi.mod : 'handler inline';
        }
      }
      [...acc.identifiers].forEach((f) => acc.body.add(f + '?'));
      // Un mismo campo puede llegar por dos patrones (`x` y `x?`): se queda una
      // sola entrada, y la variante NO opcional gana.
      const bodyF = dedupeFields([...acc.body]);
      const paramsF = [...acc.params].sort();
      const queryF = [...acc.query].sort();
      const known = new Set([...bodyF, ...paramsF, ...queryF].map((f) => f.replace(/\?$/, '')));
      rows.push({
        method: r.method,
        endpoint: (mount + r.subpath).replace(/\/+$/, '') || mount,
        routeFile: routeFile + ':' + r.line,
        handler,
        middlewares,
        source,
        viaFactory,
        body: bodyF,
        params: paramsF,
        query: queryF,
        headers: [...acc.headers].sort(),
        // Un campo con guarda `x !== undefined` es opcional aunque su forma se valide.
        required: [...acc.required].filter((f) => known.has(f) && !acc.optionalHints.has(f)).sort(),
        schemaTypes: acc.schemaTypes,
        ignoresBody: r.method !== 'GET' && !acc.body.size && !acc.dynamic.size,
        allowed: [...acc.allowed].sort(),
        identifiers: [...acc.identifiers].sort(),
        dynamic: [...acc.dynamic],
        notes: [...acc.notes],
        statusCodes: [...acc.codes].sort(),
      });
    }
  }
  for (const mr of MANUAL_ROUTES) {
    const abs = path.join(ROOT, mr.file);
    const acc = newAcc();
    const res = read(abs) ? walk(abs, mr.handler, null, acc, new Set(), 0) : null;
    const bodyF = dedupeFields([...acc.body]);
    const known = new Set(bodyF.map((f) => f.replace(/\?$/, '')));
    rows.push({
      method: mr.method,
      endpoint: mr.endpoint,
      routeFile: mr.routeFile,
      handler: mr.handler,
      middlewares: [],
      source: res && res.line ? mr.file + ':' + res.line : mr.file,
      viaFactory: null,
      body: bodyF,
      params: [...acc.params].sort(),
      query: [...acc.query].sort(),
      headers: [...acc.headers].sort(),
      required: [...acc.required].filter((f) => known.has(f)).sort(),
      schemaTypes: acc.schemaTypes,
      ignoresBody: false,
      allowed: [],
      identifiers: [],
      dynamic: [...acc.dynamic],
      notes: [mr.note, ...acc.notes],
      statusCodes: [...acc.codes].sort(),
    });
  }
  rows.sort((a, b) => (a.endpoint + a.method).localeCompare(b.endpoint + b.method));
  return rows;
}

// ------------------------------------------------------------------ emisores

const NUMERIC = /(^|_)(id|ids|qty|quantity|cost|price|amount|total|count|limit|offset|page|size|fee|balance|deposit|version|days|percent|index|number)$/i;
const BOOLEAN = /^(is|has|can|should|allow|enable|display|active|used|paid|signed|force|skip|include|only)[_A-Z]|^(active|ok|status_bool)$/;
const DATEISH = /(^|_)(date|at|time|timestamp|deadline|due|expiry|expires)$/i;
const OBJECTISH = /^(consumer|member|staff|user|admin|item|device|location|sub_location|container|company|event|transaction|payment|card|address|guardian|student|filters?|criteria|options|payload|data|metadata|template|contract|signature)$|(_info|_data|_object|_details|_payload)$/i;
const ARRAYISH = /^(items|devices|serial_numbers|serials|records|emails|list|ids|rows|members|staffs|consumers|images|files|attachments|receivers|leases|containers|locations|events|transactions|jobs|criteria_list)$|_list$|_array$/i;

function inferType(field, endpoint) {
  const f = field.replace(/\?$/, '');
  if (ARRAYISH.test(f)) return 'unknown[]';
  if (OBJECTISH.test(f)) return 'Record<string, unknown>';
  if (BOOLEAN.test(f)) return 'boolean';
  if (DATEISH.test(f)) return 'string';
  if (NUMERIC.test(f)) {
    // MySQL (/api/db_*, /api/school) usa PK numéricas; Mongo usa ObjectId string.
    return /^\/api\/(db_|school)/.test(endpoint) ? 'number' : 'string';
  }
  return 'string';
}

function ifaceName(row, used) {
  const base = row.endpoint
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => seg.replace(/^:/, 'by_').replace(/[^\w]/g, '_'))
    .map((seg) => seg.split(/[_-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(''))
    .join('');
  let name = (row.method[0] + row.method.slice(1).toLowerCase()) + (base || 'Root');
  let n = name;
  let k = 2;
  while (used.has(n)) n = name + k++;
  used.add(n);
  return n;
}

function emitDts(rows) {
  const used = new Set();
  const out = [];
  out.push('/**');
  out.push(' * api-payloads.d.ts — GENERADO por `node scripts/extract-api-payloads.js`. No editar a mano.');
  out.push(' *');
  out.push(' * Payload esperado por cada endpoint del servidor, extraído del código de los');
  out.push(' * controladores. Para tipar un fetch, usa el mapa `ApiEndpoints` al final:');
  out.push(' *');
  out.push(' *   type Body<K extends keyof ApiEndpoints> = ApiEndpoints[K]["body"];');
  out.push(' *   const body: Body<"POST /api/db_item/delete-item"> = { item_id: 1, company_id: 2 };');
  out.push(' *');
  out.push(' * ADVERTENCIAS');
  out.push(' * - Los TIPOS son inferidos por nombre de campo (id/cost -> number, *_info -> objeto,');
  out.push(' *   etc.). El nombre del campo sí viene del código; el tipo hay que confirmarlo.');
  out.push(' * - Un campo marcado `?` es opcional porque el handler le da default o porque no hay');
  out.push(' *   validación explícita. Los NO opcionales son los que el handler valida con 400.');
  out.push(' * - Los endpoints con cuerpo dinámico (`Object.keys(req.body)` -> columnas SQL) se');
  out.push(' *   tipan con `[key: string]: unknown` y llevan nota.');
  out.push(' */');
  out.push('');
  const registry = [];
  const registryKeys = new Set();
  for (const row of rows) {
    if (!row.body.length && !row.params.length && !row.query.length && !row.dynamic.length && !row.ignoresBody) continue;
    const name = ifaceName(row, used);
    const auth = row.middlewares.length ? row.middlewares.join(', ') : 'sin middleware de auth en la ruta';
    out.push('/**');
    out.push(' * `' + row.method + ' ' + row.endpoint + '`');
    out.push(' * handler: ' + (row.handler || '?') + ' — ' + (row.source || '?'));
    out.push(' * ruta: ' + row.routeFile);
    out.push(' * auth: ' + auth);
    if (row.headers.length) out.push(' * headers: ' + row.headers.join(', '));
    if (row.viaFactory) out.push(' * generado por factory: ' + row.viaFactory);
    row.dynamic.forEach((d) => out.push(' * NOTA: ' + d));
    if (row.identifiers.length) out.push(' * NOTA: hay que enviar al menos uno de estos identificadores: ' + row.identifiers.join(', '));
    if (row.allowed.length) out.push(' * NOTA: los campos actualizables vienen de una lista blanca en el handler (los demás se ignoran en silencio)');
    row.notes.forEach((n) => out.push(' * NOTA: ' + n));
    if (row.ignoresBody) out.push(' * NOTA: el handler NO lee el body: manda `{}` (o nada).');
    if (row.statusCodes.length) out.push(' * status: ' + row.statusCodes.join(', '));
    out.push(' */');
    const parts = [];
    const emit = (suffix, fields, kind) => {
      if (!fields.length) {
        if (kind === 'body' && row.dynamic.length) {
          out.push('export interface ' + name + suffix + ' {');
          out.push('  /** cuerpo dinámico: cada par clave/valor se traduce a filtro/columna SQL */');
          out.push('  [key: string]: unknown;');
          out.push('}');
          return name + suffix;
        }
        return null;
      }
      const iname = name + suffix;
      out.push('export interface ' + iname + ' {');
      const emitted = new Set();
      for (const f of fields) {
        const bare = f.replace(/\?$/, '');
        if (emitted.has(bare)) continue; // el mismo campo puede venir de dos patrones
        emitted.add(bare);
        const optional = f.endsWith('?') || (kind === 'body' && !row.required.includes(bare));
        // Si el campo viene de un esquema Mongoose, el tipo es REAL (no inferido).
        const t = (kind === 'body' && row.schemaTypes[bare]) || inferType(bare, row.endpoint);
        out.push('  ' + bare + (optional ? '?' : '') + ': ' + t + ';');
      }
      if (row.dynamic.length && kind === 'body') out.push('  [key: string]: unknown;');
      out.push('}');
      return iname;
    };
    const b = emit('Body', row.body, 'body');
    const p = emit('Params', row.params, 'params');
    const q = emit('Query', row.query, 'query');
    if (b) parts.push('body: ' + b);
    if (p) parts.push('params: ' + p);
    if (q) parts.push('query: ' + q);
    out.push('');
    const rkey = row.method + ' ' + row.endpoint;
    if (!registryKeys.has(rkey)) {
      registryKeys.add(rkey);
      registry.push('  "' + rkey + '": { ' + parts.join('; ') + ' };');
    }
  }
  out.push('/** Mapa "METHOD /path" -> payload. Útil para un wrapper de fetch tipado. */');
  out.push('export interface ApiEndpoints {');
  out.push(...registry);
  out.push('}');
  out.push('');
  return out.join('\n');
}

function emitMarkdown(rows) {
  const groups = {};
  for (const row of rows) {
    const g = '/' + row.endpoint.split('/').slice(1, 3).join('/');
    (groups[g] = groups[g] || []).push(row);
  }
  const total = rows.length;
  const withPayload = rows.filter((r) => r.body.length || r.params.length || r.query.length || r.dynamic.length).length;
  const out = [];
  out.push('# Payloads de la API (generado)');
  out.push('');
  out.push('> GENERADO por `node scripts/extract-api-payloads.js` — no editar a mano.');
  out.push('> Regenerar después de tocar rutas o controladores.');
  out.push('');
  out.push('Contrapartida tipada: **`docs/api-payloads.d.ts`** (interfaces + mapa `ApiEndpoints`).');
  out.push('');
  out.push('## Cómo leer esta tabla');
  out.push('');
  out.push('- **Requeridos**: campos que el handler valida explícitamente (responde `400` si faltan).');
  out.push('- **Opcionales / otros**: campos que el handler lee pero no valida, o que tienen default.');
  out.push('  Muchos son obligatorios *de facto* (la columna SQL es `NOT NULL`); la ausencia de');
  out.push('  validación no es permiso para omitirlos.');
  out.push('- **Auth**: middlewares de la ruta. `validateJWT` = header **`x-token`** con el JWT');
  out.push('  (no `Authorization: Bearer`). `checkTokenVersion` invalida tokens de sesiones revocadas.');
  out.push('  `authorizePermission("recurso","acción")` exige ese permiso en el rol del staff.');
  out.push('- **Fuente**: `archivo:línea` del handler. Es la autoridad final; esta tabla es un índice.');
  out.push('- Los tipos NO están en esta tabla a propósito: viven en el `.d.ts`, donde se marca que');
  out.push('  son inferidos.');
  out.push('');
  out.push('Cobertura: **' + withPayload + ' de ' + total + '** endpoints montados tienen payload detectado.');
  out.push('Routers presentes en el repo pero **no montados** en `index.js` (no existen en runtime): ' + UNMOUNTED.map((u) => '`' + u + '`').join(', ') + '.');
  out.push('');
  for (const g of Object.keys(groups).sort()) {
    out.push('## `' + g + '`');
    out.push('');
    out.push('| Método | Ruta | Requeridos (400 si faltan) | Opcionales / otros | Params | Query | Auth | Fuente |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of groups[g]) {
      const req = r.required.filter((f) => r.body.includes(f) || r.body.includes(f + '?'));
      const rest = r.body.map((f) => f.replace(/\?$/, '')).filter((f) => !req.includes(f));
      const code = (arr) => (arr.length ? arr.map((f) => '`' + f + '`').join(' ') : '—');
      const notes = [...r.dynamic, ...r.notes];
      if (r.ignoresBody) notes.push('el handler IGNORA el body (mandar `{}`)');
      if (r.identifiers.length) notes.push('identificadores (al menos uno): ' + r.identifiers.map((f) => '`' + f + '`').join(' '));
      if (r.allowed.length) notes.push('campos actualizables por lista blanca (el resto se ignora)');
      out.push('| ' + [
        r.method,
        '`' + r.endpoint + '`',
        code(req),
        code(rest) + (notes.length ? ' ⚠️ ' + notes.join(' · ') : ''),
        code(r.params.map((f) => f.replace(/\?$/, ''))),
        code(r.query.map((f) => f.replace(/\?$/, ''))),
        r.middlewares.length ? r.middlewares.map((m) => '`' + m + '`').join(' ') : '—',
        r.source ? '`' + r.source + '`' : '—',
      ].join(' | ') + ' |');
    }
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------- main

const rows = buildInventory();
const docsDir = path.join(ROOT, 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir);
fs.writeFileSync(path.join(docsDir, 'api-payloads.md'), emitMarkdown(rows), 'utf8');
fs.writeFileSync(path.join(docsDir, 'api-payloads.d.ts'), emitDts(rows), 'utf8');
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(docsDir, 'api-payloads.json'), JSON.stringify(rows, null, 1), 'utf8');
}
const withPayload = rows.filter((r) => r.body.length || r.params.length || r.query.length || r.dynamic.length);
console.log('endpoints montados: ' + rows.length);
console.log('con payload detectado: ' + withPayload.length);
console.log('sin payload (GET simples / handler no resuelto): ' + (rows.length - withPayload.length));
rows.filter((r) => !r.source || /no localizado|inline/.test(r.source))
  .forEach((r) => console.log('  handler sin resolver: ' + r.method + ' ' + r.endpoint + ' -> ' + r.handler + ' [' + r.source + ']'));
