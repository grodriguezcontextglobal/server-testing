'use strict';

/**
 * scripts/summarize-warn-logs.js (FedRAMP A7): lee el formato real de
 * combined.log (winston prettyPrint) y cuenta por modo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecords, summarize, normalizeRoute, render, toJSON, MODES } = require('../scripts/summarize-warn-logs');

// Copiado del formato de logs/combined.log.
const SAMPLE = `{
  service: 'devitrak-server',
  route: '/api/company/search-company',
  method: 'POST',
  origin: 'https://admin.devitrak.net',
  ip: '10.0.0.1',
  userAgent: undefined,
  level: 'warn',
  message: 'company: unauthenticated request allowed (mode=warn)',
  timestamp: '2026-10-21 10:00:00'
}
{
  service: 'devitrak-server',
  route: '/api/document/66f1a2b3c4d5e6f7a8b9c0d1/sign?x=1',
  origin: undefined,
  ip: '10.0.0.2',
  level: 'warn',
  message: 'contract link: sin token (mode=warn, se deja pasar)',
  timestamp: '2026-10-22 11:00:00'
}
{
  service: 'devitrak-server',
  uid: '222222222222222222222222',
  reason: 'idle',
  level: 'warn',
  message: 'Staff session would be rejected (SESSION_MODE=warn)',
  timestamp: '2026-10-23 12:00:00'
}
{
  service: 'devitrak-server',
  meta: {
    nested: 'no es de primer nivel',
    message: 'company: unauthenticated request allowed (mode=warn)'
  },
  level: 'info',
  message: "it's an info line",
  timestamp: '2026-10-24 13:00:00'
}
{
  service: 'devitrak-server',
  level: 'info',
  message: 'línea partida ' +
    'en dos',
  timestamp: '2026-10-25 14:00:00'
}
{"level":"warn","message":"consumer token: sin token (mode=warn, se deja pasar)","route":"/api/transaction/5","method":"GET","timestamp":"2026-10-26 15:00:00"}
`;

test('parseRecords: bloques prettyPrint, campos de primer nivel, comillas, strings partidos y JSON de una línea', () => {
  const records = parseRecords(SAMPLE.replace(/\n/g, '\r\n'));
  assert.equal(records.length, 6);
  assert.equal(records[0].origin, 'https://admin.devitrak.net');
  assert.equal(records[0].userAgent, null);
  assert.equal(records[3].message, "it's an info line");
  assert.equal(records[3].nested, undefined, 'lo anidado no sube al primer nivel');
  assert.equal(records[4].message, 'línea partida en dos');
  assert.equal(records[5].route, '/api/transaction/5');
});

test('summarize: cuenta por modo con ruta normalizada, origen y motivo; ignora lo anidado', () => {
  const { window, modes } = summarize(parseRecords(SAMPLE));
  assert.equal(window.from, '2026-10-21 10:00:00');
  assert.equal(window.to, '2026-10-26 15:00:00');
  assert.equal(window.days.size, 6);

  const company = modes.get('COMPANY_AUTH_MODE');
  assert.equal(company.count, 1, 'el mensaje anidado del registro info no cuenta');
  assert.deepEqual([...company.routes], [['POST /api/company/search-company', 1]]);
  assert.deepEqual([...company.origins], [['https://admin.devitrak.net', 1]]);

  const contract = modes.get('CONTRACT_LINK_MODE');
  assert.deepEqual([...contract.routes], [['/api/document/:id/sign', 1]]);
  assert.deepEqual([...contract.reasons], [['sin token', 1]]);
  assert.deepEqual([...contract.origins], [['(sin origin)', 1]]);

  assert.deepEqual([...modes.get('SESSION_MODE').reasons], [['idle', 1]]);
  assert.deepEqual([...modes.get('CONSUMER_TOKEN_MODE').routes], [['GET /api/transaction/:n', 1]]);
  assert.equal(modes.get('ATTENDANCE_LINK_MODE'), null);
});

test('summarize --since descarta lo anterior', () => {
  const { window, modes } = summarize(parseRecords(SAMPLE), { since: '2026-10-23' });
  assert.equal(window.from, '2026-10-23 12:00:00');
  assert.equal(modes.get('COMPANY_AUTH_MODE'), null);
  assert.equal(modes.get('SESSION_MODE').count, 1);
});

test('render avisa cuando la ventana es corta; toJSON lista todos los modos', () => {
  const short = summarize(parseRecords(SAMPLE), { since: '2026-10-26' });
  assert.match(render(short), /AVISO: menos de 3 días/);
  const json = toJSON(summarize(parseRecords(SAMPLE)), 10);
  assert.deepEqual(Object.keys(json.modes), MODES.map((m) => m.mode));
  assert.equal(json.window.days, 6);
  assert.equal(json.modes.ATTENDANCE_LINK_MODE.count, 0);
});

test('normalizeRoute: ObjectId, números y uuid; sin query', () => {
  assert.equal(normalizeRoute('/a/66f1a2b3c4d5e6f7a8b9c0d1/b/12?q=1'), '/a/:id/b/:n');
  assert.equal(normalizeRoute('/a/123e4567-e89b-12d3-a456-426614174000'), '/a/:uuid');
  assert.equal(normalizeRoute(undefined), '(sin ruta)');
});

// Mensajes de enforce copiados de los middlewares (y los que NO son rechazos).
const ENFORCE_SAMPLE = [
  { message: 'nosql input: rejected operator in query', method: 'GET', path: '/api/health', origin: 'https://admin.devitrak.net', ip: '10.0.0.9', reason: 'operator in query' },
  { message: 'nosql input: rejected operator in body', method: 'POST', path: '/api/auth/login', ip: '10.0.0.9', reason: 'operator in body' },
  { message: 'contract link: token ya usado', route: '/api/document/66f1a2b3c4d5e6f7a8b9c0d1/sign' },
  { message: 'contract link: Redis no disponible, no se pudo marcar el token como usado' },
  { message: 'contract link: correo sin token (sin verification_id)' },
  { message: 'consumer token: sin token', route: '/api/transaction/5', method: 'GET' },
  { message: 'stripe ownership: not_owner', reason: 'not_owner' },
  { message: 'stripe ownership check failed' },
  { message: 'plan limits: refused staff' },
  { message: 'company: refused an unauthenticated request' },
].map((r, i) => ({ level: 'warn', timestamp: `2026-11-1${i % 3} 10:00:0${i}`, ...r }));

test('summarize cuenta los rechazos de enforce aparte de los avisos de warn', () => {
  const { modes, rejected } = summarize(ENFORCE_SAMPLE);
  for (const s of modes.values()) assert.equal(s, null, 'un rechazo no cuenta como aviso de warn');

  const nosql = rejected.get('NOSQL_INPUT_MODE');
  assert.equal(nosql.count, 2);
  assert.deepEqual([...nosql.reasons], [['operator in query', 1], ['operator in body', 1]]);
  assert.deepEqual([...nosql.origins], [['https://admin.devitrak.net', 1], ['(sin origin)', 1]]);

  assert.equal(rejected.get('CONTRACT_LINK_MODE').count, 1, 'los fallos de Redis/correo no son rechazos');
  assert.deepEqual([...rejected.get('CONTRACT_LINK_MODE').reasons], [['token ya usado', 1]]);
  assert.equal(rejected.get('CONSUMER_TOKEN_MODE').count, 1);
  assert.equal(rejected.get('STRIPE_OWNERSHIP_MODE').count, 1, '"check failed" no es un rechazo');
  assert.deepEqual([...rejected.get('PLAN_LIMITS_MODE').reasons], [['staff', 1]]);
  assert.equal(rejected.get('COMPANY_AUTH_MODE').count, 1);
  assert.equal(rejected.get('ATTENDANCE_LINK_MODE'), null);
  assert.equal(rejected.get('SESSION_MODE'), undefined, 'SESSION no registra en enforce');
});

test('los avisos de warn no cuentan como rechazos', () => {
  const { rejected } = summarize(parseRecords(SAMPLE));
  for (const s of rejected.values()) assert.ok(!s);
});

test('toJSON y render incluyen los rechazos de enforce', () => {
  const summary = summarize(ENFORCE_SAMPLE);
  const json = toJSON(summary, 10);
  assert.deepEqual(Object.keys(json.rejected), MODES.map((m) => m.mode));
  assert.equal(json.rejected.NOSQL_INPUT_MODE.count, 2);
  assert.equal(json.rejected.ATTENDANCE_LINK_MODE.count, 0);
  assert.deepEqual(json.rejected.DB_COMPANY_PUBLIC_MODE, { count: null, logged: false });

  const text = render(summary);
  assert.match(text, /Rechazos en enforce:\n[^]*\n {2}NOSQL_INPUT_MODE: 2 eventos/);
  assert.match(text, /no registran rechazos en enforce: RECEIPT_PUBLIC_READ_MODE, DB_COMPANY_PUBLIC_MODE, SESSION_MODE/);
  assert.match(render(summarize(parseRecords(SAMPLE))), /Rechazos en enforce:\n {2}ninguno en la ventana/);
});

test('los mensajes de enforce coinciden con lo que registran los middlewares', () => {
  const fs = require('fs');
  const path = require('path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(src('middlewares/rejectMongoOperators.js'), /`nosql input: rejected operator in \$\{source\}`/);
  assert.match(src('middlewares/companyAuth.js'), /'company: refused an unauthenticated request'/);
  assert.match(src('middlewares/notificationAuth.js'), /"nodemailer: refused an unauthenticated notification"/);
  assert.match(src('middlewares/attendanceLinkAuth.js'), /'attendance link: refused a dashboard call without session'/);
  assert.match(src('middlewares/authorizePermission.js'), /"company context: body and header disagree, rejected"/);
  assert.match(src('helpers/planLimits.js'), /`plan limits: refused \$\{resource\}`/);
  assert.match(src('scheduler/staffInactivity.js'), /'staff inactivity: account disabled'/);
  for (const reason of ['sin token o token inválido', 'el token no coincide con la petición', 'token ya usado']) {
    assert.ok(src('middlewares/contractLinkAuth.js').includes(`'${reason}'`), reason);
  }
});
