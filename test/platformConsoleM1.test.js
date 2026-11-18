'use strict';

/**
 * M1 del console de plataforma: el gate (DC1), el registro de accesos (DC2) y la
 * retencion (AU-11).
 *
 * Los casos 1-3 y 7 de B5 (gate) y 4-6 (registro) son del dashboard
 * (FRONTEND_pending_work_asks_2026-11-16.md) y estan marcados.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { evaluatePlatformAccess, isPlatformDomain } = require('../helpers/platformAccess');
const { createRequirePlatformConsole } = require('../middlewares/requirePlatformConsole');
const { createAuditPlatformAccess } = require('../middlewares/auditPlatformAccess');
const { planRetention, retentionMode, retentionDays } = require('../scheduler/platformAuditRetention');
const { grantPlan, revokePlan, blockedBy } = require('../scripts/platform-observer-access');

// Un operador real de la lista cerrada: desde el 2026-11-18 el dominio por si
// solo ya no abre nada, asi que un correo inventado @devitrak.com no sirve ni
// para el camino feliz.
const OPERATOR = Object.freeze({
  _id: '507f1f77bcf86cd799439011',
  email: 'grodriguez@devitrak.com',
  active: true,
  mfaEnabled: true,
  platform_observer: true,
});

const makeResponse = () => {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.body = undefined;
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    response.emit('finish');
    return response;
  };
  return response;
};

const makeRequest = (overrides = {}) => ({
  method: 'GET',
  originalUrl: '/api/platform/me',
  baseUrl: '/api/platform',
  path: '/me',
  route: { path: '/me' },
  params: {},
  query: {},
  headers: {},
  ip: '203.0.113.9',
  uid: OPERATOR._id,
  ...overrides,
});

const runGate = async (user, requestOverrides = {}) => {
  const gate = createRequirePlatformConsole({ findAdminUser: async () => user });
  const request = makeRequest(requestOverrides);
  const response = makeResponse();
  let passed = false;
  await gate(request, response, () => { passed = true; });
  return { passed, request, response };
};

describe('requirePlatformConsole (DC1)', () => {
  test('una cuenta que cumple las cinco condiciones pasa', async () => {
    const { passed, request } = await runGate({ ...OPERATOR });
    assert.equal(passed, true);
    assert.equal(request.platformDeny, undefined);
    assert.equal(request.platformActor.email, OPERATOR.email);
  });

  // B5 caso 1. La trampa: al registrar una compañia, su dueño queda con
  // super_user. Si el gate lo admitiera, cada cliente leeria a los demas.
  test('B5-1: dueño de compañia cliente con super_user: 403', async () => {
    const { passed, response, request } = await runGate({
      _id: 'a'.repeat(24),
      email: 'owner@clientco.com',
      active: true,
      mfaEnabled: true,
      super_user: true,
      platform_observer: false,
    });
    assert.equal(passed, false);
    assert.equal(response.statusCode, 403);
    assert.equal(request.platformDeny.reason, 'not_platform_observer');
  });

  // B5 caso 2.
  test('B5-2: cuenta @devitrak.com sin el flag: 403 diciendo que falta', async () => {
    const { response } = await runGate({ ...OPERATOR, platform_observer: false });
    assert.equal(response.statusCode, 403);
    assert.match(response.body.msg, /platform_observer/);
  });

  // B5 caso 3.
  test('B5-3: con el flag pero correo de otro dominio: 403', async () => {
    const { response, request } = await runGate({ ...OPERATOR, email: 'me@contextglobal.com' });
    assert.equal(response.statusCode, 403);
    assert.equal(request.platformDeny.reason, 'wrong_domain');
    assert.match(response.body.msg, /devitrak\.com/);
  });

  // B5 caso 7: el flag se lee de la base en cada peticion, nunca del token.
  test('B5-7: quitado el flag, la peticion SIGUIENTE ya da 403', async () => {
    let user = { ...OPERATOR };
    const gate = createRequirePlatformConsole({ findAdminUser: async () => user });

    let passed = false;
    await gate(makeRequest(), makeResponse(), () => { passed = true; });
    assert.equal(passed, true, 'la primera pasa');

    user = { ...OPERATOR, platform_observer: false };
    const response = makeResponse();
    passed = false;
    await gate(makeRequest(), response, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(response.statusCode, 403);
  });

  test('sin MFA: 403 propio', async () => {
    const { response, request } = await runGate({ ...OPERATOR, mfaEnabled: false });
    assert.equal(response.statusCode, 403);
    assert.equal(request.platformDeny.reason, 'mfa_required');
    assert.match(response.body.msg, /MFA/);
  });

  // Cuenta inexistente y cuenta desactivada responden "Forbidden" a secas: un
  // mensaje mas util diria si la cuenta existe.
  test('cuenta desactivada o inexistente: 403 sin detalle', async () => {
    const off = await runGate({ ...OPERATOR, active: false });
    assert.equal(off.response.body.msg, 'Forbidden');
    assert.equal(off.request.platformDeny.reason, 'inactive_account');

    const none = await runGate(null);
    assert.equal(none.response.body.msg, 'Forbidden');
    assert.equal(none.request.platformDeny.reason, 'unknown_account');
  });

  test('sin validateJWT delante: 401 con mensaje distinguible', async () => {
    const { response, request } = await runGate({ ...OPERATOR }, { uid: undefined });
    assert.equal(response.statusCode, 401);
    assert.match(response.body.msg, /no session identity/);
    assert.equal(request.platformDeny.reason, 'no_session');
  });

  test('un fallo al comprobar no es un permiso: 500 y marcado como denegado', async () => {
    const gate = createRequirePlatformConsole({
      findAdminUser: async () => { throw new Error('mongo down'); },
    });
    const request = makeRequest();
    const response = makeResponse();
    let passed = false;
    await gate(request, response, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(response.statusCode, 500);
    assert.ok(request.platformDeny);
  });
});

describe('el dominio se compara exacto, no por sufijo', () => {
  test('acepta solo @devitrak.com, con espacios y mayusculas', () => {
    assert.equal(isPlatformDomain('  Ops@Devitrak.COM '), true);
  });

  test('rechaza los parecidos', () => {
    for (const email of [
      'x@devitrak.com.evil.io',
      'x@devitrak.co',
      'x@sub.devitrak.com',
      'x@evil.io@devitrak.com',
      'devitrak.com',
      '@devitrak.com',
      '',
      null,
    ]) {
      assert.equal(isPlatformDomain(email), false, String(email));
    }
  });
});

describe('evaluatePlatformAccess: un solo criterio para el gate y el login', () => {
  test('devuelve el primer motivo que falla, de lo general a lo concreto', () => {
    assert.deepEqual(evaluatePlatformAccess({ ...OPERATOR }), { ok: true, reason: null });
    assert.equal(evaluatePlatformAccess(null).reason, 'unknown_account');
    assert.equal(evaluatePlatformAccess({ ...OPERATOR, active: false }).reason, 'inactive_account');
    assert.equal(
      evaluatePlatformAccess({ ...OPERATOR, platform_observer: false }).reason,
      'not_platform_observer'
    );
    assert.equal(evaluatePlatformAccess({ ...OPERATOR, email: 'a@b.com' }).reason, 'wrong_domain');
    assert.equal(evaluatePlatformAccess({ ...OPERATOR, mfaEnabled: false }).reason, 'mfa_required');
  });

  // super_user es el bypass de ESCRITURA; no abre el console.
  test('super_user no sustituye a platform_observer', () => {
    const verdict = evaluatePlatformAccess({
      ...OPERATOR, platform_observer: false, super_user: true,
    });
    assert.equal(verdict.ok, false);
  });
});

describe('auditPlatformAccess (DC2)', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  const run = async ({ rows, failWrite = false, request, respond }) => {
    const middleware = createAuditPlatformAccess({
      writeRow: async (row) => {
        if (failWrite) throw new Error('table is missing');
        rows.push(row);
      },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    });
    const response = makeResponse();
    await middleware(request, response, () => {});
    respond(response);
    await settle();
    return response;
  };

  // B5 caso 4.
  test('B5-4: exactamente una fila por peticion servida', async () => {
    const rows = [];
    const request = makeRequest({ headers: { 'x-request-id': 'req-7', 'user-agent': 'console/1' } });
    request.platformActor = { id: OPERATOR._id, email: OPERATOR.email };
    const response = await run({
      rows, request,
      respond: (res) => res.status(200).json({ ok: true, data: [1, 2, 3] }),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, 'allowed');
    assert.equal(rows[0].reason, null);
    assert.equal(rows[0].action, 'view');
    assert.equal(rows[0].actorEmail, OPERATOR.email);
    assert.equal(rows[0].resource, 'GET /api/platform/me');
    assert.equal(rows[0].details.records, 3);
    assert.equal(rows[0].details.requestId, 'req-7');
    assert.equal(rows[0].details.status, 200);
    assert.deepEqual(response.body, { ok: true, data: [1, 2, 3] });
  });

  // La fila que un evaluador busca primero.
  test('B5-4: una denegacion tambien deja fila, con su motivo', async () => {
    const rows = [];
    const request = makeRequest();
    request.platformActor = { id: OPERATOR._id, email: 'nope@devitrak.com' };
    request.platformDeny = { reason: 'not_platform_observer' };
    await run({ rows, request, respond: (res) => res.status(403).json({ ok: false, msg: 'Forbidden' }) });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, 'denied');
    assert.equal(rows[0].reason, 'not_platform_observer');
  });

  // B5 caso 5: fail-closed.
  test('B5-5: si la escritura falla, la peticion falla y el cuerpo no sale', async () => {
    const rows = [];
    const request = makeRequest();
    const response = await run({
      rows, failWrite: true, request,
      respond: (res) => res.status(200).json({ ok: true, data: [{ secret: 'client row' }] }),
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.ok, false);
    assert.doesNotMatch(JSON.stringify(response.body), /client row/);
    assert.match(response.body.msg, /access log/);
  });

  test('dos llamadas a json no escriben dos filas', async () => {
    const rows = [];
    const request = makeRequest();
    await run({
      rows, request,
      respond: (res) => { res.json({ ok: true }); res.json({ ok: true }); },
    });
    assert.equal(rows.length, 1);
  });

  test('la compañia sale del parametro de ruta, y una busqueda se clasifica como search', async () => {
    const rows = [];
    const request = makeRequest({
      path: '/companies/abc/staff',
      route: { path: '/companies/:companyId/staff' },
      params: { companyId: 'abc123' },
      query: { search: 'laptop', page: '2' },
      // Un cuerpo que intenta decir otra compañia no debe influir.
      body: { companyId: 'otra' },
    });
    await run({ rows, request, respond: (res) => res.status(200).json({ ok: true, data: [] }) });

    assert.equal(rows[0].companyId, 'abc123');
    assert.equal(rows[0].action, 'search');
    assert.equal(rows[0].resource, 'GET /api/platform/companies/:companyId/staff');
    assert.equal(rows[0].details.query.page, '2');
  });

  // El registro dice QUE se leyo, no lo que se leyo.
  test('details no lleva el contenido de la respuesta', async () => {
    const rows = [];
    const request = makeRequest();
    await run({
      rows, request,
      respond: (res) => res.status(200).json({ ok: true, data: [{ serial: 'SN-0001' }] }),
    });
    assert.doesNotMatch(JSON.stringify(rows[0].details), /SN-0001/);
    assert.equal(rows[0].details.records, 1);
  });
});

describe('retencion de platform_audit_log (AU-11)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-11-18T03:40:00Z');

  test('una compañia que sigue existiendo no pierde ninguna fila', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(['c1']),
      absentSince: new Map(),
      now, days: 120,
    });
    assert.deepEqual(plan, { mark: [], clear: [], purge: [] });
  });

  test('la primera vez que falta se anota la fecha, no se borra nada', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(),
      absentSince: new Map(),
      now, days: 120,
    });
    assert.deepEqual(plan.mark, ['c1']);
    assert.equal(plan.purge.length, 0);
  });

  // B5 caso 6: ni un dia antes.
  test('B5-6: a los 119 dias no; a los 120, si', () => {
    const at119 = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(),
      absentSince: new Map([['c1', new Date(now.getTime() - 119 * DAY)]]),
      now, days: 120,
    });
    assert.equal(at119.purge.length, 0);

    const at120 = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(),
      absentSince: new Map([['c1', new Date(now.getTime() - 120 * DAY)]]),
      now, days: 120,
    });
    assert.equal(at120.purge.length, 1);
    assert.equal(at120.purge[0].companyId, 'c1');
  });

  test('si la compañia reaparece, el contador se reinicia', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(['c1']),
      absentSince: new Map([['c1', new Date(now.getTime() - 200 * DAY)]]),
      now, days: 120,
    });
    assert.deepEqual(plan.clear, ['c1']);
    assert.equal(plan.purge.length, 0);
  });

  // Borrar evidencia de auditoria empieza en warn, como el resto de modos.
  test('el modo por defecto es warn y el plazo 120 dias', () => {
    assert.equal(retentionMode({}), 'warn');
    assert.equal(retentionMode({ PLATFORM_AUDIT_RETENTION_MODE: 'ENFORCE' }), 'enforce');
    assert.equal(retentionMode({ PLATFORM_AUDIT_RETENTION_MODE: 'cualquiera' }), 'warn');
    assert.equal(retentionDays({}), 120);
    assert.equal(retentionDays({ PLATFORM_AUDIT_RETENTION_DAYS: '30' }), 30);
    assert.equal(retentionDays({ PLATFORM_AUDIT_RETENTION_DAYS: '0' }), 120);
  });
});

// La cadena se monta con router.use para que una ruta nueva de DC3 no pueda
// nacer sin puerta ni sin registro. Esto lo comprueba, porque "acordamos el
// orden" no sobrevive a veinte rutas mas.
describe('routes/platform: la cadena entera y en orden', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  test('el router aplica las cuatro, y la auditoria va ANTES del gate', () => {
    const router = require('../routes/platform');
    const uses = router.stack.filter((layer) => !layer.route);
    assert.ok(uses.length >= 4, 'faltan middlewares de router.use');

    const source = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'platform.js'), 'utf8'
    );
    const order = ['validateJWT', 'checkTokenVersion', 'auditPlatformAccess', 'requirePlatformConsole']
      .map((name) => source.indexOf(`router.use(${name})`));
    assert.ok(order.every((i) => i > 0), 'alguna no se monta con router.use');
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] > order[i - 1], 'la cadena esta en otro orden');
    }
  });

  test('toda ruta del console queda detras de la cadena', () => {
    const router = require('../routes/platform');
    const firstRoute = router.stack.findIndex((layer) => Boolean(layer.route));
    const lastUse = router.stack.reduce(
      (acc, layer, i) => (layer.route ? acc : i), -1
    );
    assert.ok(firstRoute > lastUse, 'hay una ruta declarada antes de la cadena');
  });

  test('index.js monta /api/platform', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.match(source, /app\.use\(\s*["']\/api\/platform["']\s*,\s*require\(["']\.\/routes\/platform["']\)\s*\)/);
  });
});

// APP-2026-015: en PlanetScale no se puede dar "solo INSERT y SELECT" sobre una
// tabla, asi que la propiedad de solo-insercion no la impone la base. La impone
// esto. Es mas debil que un permiso y por eso el POA&M sigue abierto, pero al
// menos reintroducir una escritura falla el CI en vez de pasar desapercibida.
describe('platform_audit_log es de solo insercion (control compensatorio)', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  const ROOT = path.join(__dirname, '..');
  const SKIP = new Set(['node_modules', '.git', 'logs', 'graphify-out', 'test', 'coverage']);
  // El unico sitio que puede borrar, y borra por antiguedad.
  const ALLOWED = path.join('scheduler', 'platformAuditRetention.js');

  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(js|sql)$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  test('nadie salvo el job de retencion escribe sobre la tabla', () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      const relative = path.relative(ROOT, file);
      if (relative === ALLOWED) continue;
      const source = fs.readFileSync(file, 'utf8');
      // Se mira la sentencia, no la mencion: los comentarios que explican POR
      // QUE no se puede hacer no deben fallar el test.
      const statements = source.match(
        /\b(UPDATE\s+platform_audit_log|DELETE\s+FROM\s+platform_audit_log)\b/gi
      );
      if (!statements) continue;
      // El fichero de migracion nombra los dos verbos dentro de comentarios SQL.
      const real = statements.filter((s) => {
        const at = source.indexOf(s);
        const lineStart = source.lastIndexOf('\n', at) + 1;
        const line = source.slice(lineStart, at);
        return !/^\s*(--|\*|\/\/|\/\*)/.test(line);
      });
      if (real.length) offenders.push(`${relative}: ${real.join(', ')}`);
    }
    assert.deepEqual(offenders, [], `escrituras no permitidas:\n${offenders.join('\n')}`);
  });
});

describe('la lista cerrada de operadores', () => {
  const { PLATFORM_CONSOLE_ALLOWLIST, isAllowedOperator } = require('../helpers/platformAccess');

  test('tener el flag y el dominio no basta: hay que estar en la lista', () => {
    const outsider = {
      ...OPERATOR, email: 'otro@devitrak.com', platform_observer: true, mfaEnabled: true,
    };
    const verdict = evaluatePlatformAccess(outsider);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'not_on_allowlist');
  });

  test('un operador de la lista con todo lo demas en regla entra', () => {
    const verdict = evaluatePlatformAccess({
      ...OPERATOR, email: PLATFORM_CONSOLE_ALLOWLIST[0],
    });
    assert.equal(verdict.ok, true);
  });

  // La guardia de la lista: si alguien añade aqui un correo de otro dominio, no
  // entra igualmente. La edicion falla en cerrado en vez de abrir una puerta.
  test('toda entrada de la lista es del dominio de plataforma', () => {
    for (const email of PLATFORM_CONSOLE_ALLOWLIST) {
      assert.equal(isPlatformDomain(email), true, email);
    }
  });

  test('se compara normalizado, no por igualdad de cadena', () => {
    assert.equal(isAllowedOperator(`  ${PLATFORM_CONSOLE_ALLOWLIST[0].toUpperCase()} `), true);
    assert.equal(isAllowedOperator('grodriguez@contextglobal.com'), false);
    assert.equal(isAllowedOperator('gars.software.dev@gmail.com'), false);
  });

  // Las dos cuentas que ya tenian platform_observer el 2026-11-18, concedido
  // para /api/metrics. Quedan fuera del console y conservan las metricas.
  test('las dos cuentas con el flag previo no entran al console', () => {
    for (const email of ['grodriguez@contextglobal.com', 'gars.software.dev@gmail.com']) {
      const verdict = evaluatePlatformAccess({ ...OPERATOR, email });
      assert.equal(verdict.ok, false, email);
      assert.equal(verdict.reason, 'wrong_domain', email);
    }
  });

  test('--grant se niega a conceder fuera de la lista', () => {
    const plan = grantPlan(
      [{ _id: '1', email: 'otro@devitrak.com', active: true, mfaEnabled: true, platform_observer: false }],
      ['otro@devitrak.com']
    );
    assert.equal(plan.grant.length, 0);
    assert.deepEqual(plan.notOperator, ['otro@devitrak.com']);
  });
});

describe('scripts/platform-observer-access', () => {
  const [OP1, OP2, OP3] = require('../helpers/platformAccess').PLATFORM_CONSOLE_ALLOWLIST;

  test('solo concede a operadores de la lista, activos y que no lo tengan ya', () => {
    const accounts = [
      { _id: '1', email: OP1, active: true, mfaEnabled: true, platform_observer: false },
      { _id: '2', email: 'b@clientco.com', active: true, mfaEnabled: true, platform_observer: false },
      { _id: '3', email: OP2, active: false, mfaEnabled: true, platform_observer: false },
      { _id: '4', email: OP3, active: true, mfaEnabled: true, platform_observer: true },
      { _id: '5', email: 'otro@devitrak.com', active: true, mfaEnabled: true, platform_observer: false },
    ];
    const plan = grantPlan(accounts, [
      OP1, 'b@clientco.com', OP2, OP3, 'otro@devitrak.com', 'nadie@devitrak.com',
    ]);
    assert.deepEqual(plan.grant.map((u) => u.email), [OP1]);
    assert.deepEqual(plan.wrongDomain, ['b@clientco.com']);
    assert.deepEqual(plan.notOperator, ['otro@devitrak.com']);
    assert.deepEqual(plan.inactive, [OP2]);
    assert.deepEqual(plan.already, [OP3]);
    assert.deepEqual(plan.missing, ['nadie@devitrak.com']);
  });

  // El flag se concede aunque falte MFA, pero avisando: la cuenta parecera
  // operativa en cualquier listado y el gate seguira rechazandola.
  test('sin MFA se concede, pero queda señalado', () => {
    const plan = grantPlan(
      [{ _id: '1', email: OP1, active: true, mfaEnabled: false, platform_observer: false }],
      [OP1]
    );
    assert.equal(plan.grant.length, 1);
    assert.deepEqual(plan.noMfa.map((u) => u.email), [OP1]);
    assert.equal(blockedBy(plan.grant[0]), 'not_platform_observer');
  });

  test('revocar solo toca a quien lo tiene', () => {
    const observers = [{ _id: '1', email: OP1 }];
    const plan = revokePlan(observers, [OP1, OP2]);
    assert.deepEqual(plan.revoke.map((u) => u.email), [OP1]);
    assert.deepEqual(plan.notObserver, [OP2]);
  });

  // No hay regla de "no te quedes sin ninguno", al reves que con super_user:
  // cero operadores es el estado de hoy y es el estado seguro.
  test('se puede revocar al ultimo operador', () => {
    const plan = revokePlan([{ _id: '1', email: OP1 }], [OP1]);
    assert.equal(plan.revoke.length, 1);
  });
});
