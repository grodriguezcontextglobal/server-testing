'use strict';

/**
 * Enlace firmado de un solo uso para /display-contracts (consumidor) — Fase 4.1
 * de PLAN_rutas_sin_autenticacion_2026-10-14.md.
 *
 * Antes bastaba con los ids de la URL para leer los datos del consumidor y
 * firmar en su nombre. Ahora el correo lleva un token firmado por el servidor,
 * de 5 días como mucho, que se gasta al firmar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

// ── ids ─────────────────────────────────────────────────────────────────────
const CO = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CONSUMER = 'cccccccccccccccccccccccc';
const OTHER_CONSUMER = 'dddddddddddddddddddddddd';
const VER = 'eeeeeeeeeeeeeeeeeeeeeeee';
const STAFF = '111111111111111111111111';
const OUTSIDER = '222222222222222222222222';
const URL_A = 'https://s3/contract-a.pdf';
const URL_B = 'https://s3/contract-b.pdf';

// ── stubs ───────────────────────────────────────────────────────────────────
const chain = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
const admins = {
  [STAFF]: { _id: STAFF, email: 'staff@co.com', active: true, tokenVersion: 1 },
  [OUTSIDER]: { _id: OUTSIDER, email: 'out@x.com', active: true, tokenVersion: 1 },
};
stub('models/AdminUser.js', { findById: (id) => chain(admins[id] ?? null) });
stub('models/User.js', {
  findById: (id) => chain(id === CONSUMER ? { _id: CONSUMER, email: 'Ana@Example.com' } : null),
});
stub('models/VerificationConsumersLeaseContracts.js', {
  findById: (id) =>
    chain(
      id === VER
        ? {
            _id: VER,
            company_id: CO,
            consumer_member_id: CONSUMER,
            contract_list: [{ document_url: URL_A }, { document_url: URL_B }],
          }
        : null,
    ),
});
stub('models/Company.js', {
  findOne: () => ({ lean: async () => ({ employees: [{ userId: STAFF, user: 'staff@co.com' }] }) }),
});
const logs = [];
stub('helpers/logger.js', {
  warn: (m) => logs.push(m),
  error: (m) => logs.push(m),
  info: () => {},
});

const redis = { keys: new Set(), down: false };
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => {
    if (redis.down) throw new Error('ECONNREFUSED');
    return {
      set: async (k, _v, opts) => {
        if (opts?.NX && redis.keys.has(k)) return null;
        redis.keys.add(k);
        return 'OK';
      },
      del: async (k) => redis.keys.delete(k),
    };
  },
});

const {
  MAX_TTL_S,
  signEmailLinkToken,
  readEmailLinkToken,
  consumeEmailLinkToken,
} = require('../helpers/emailLinkToken');
const { contractLinkGate, attachContractLinkTokens, CONTRACT_LINK_PURPOSE } = require('../middlewares/contractLinkAuth');

const claimsFor = (over = {}) => ({
  company_id: CO,
  consumer_member_id: CONSUMER,
  verification_id: VER,
  contract_url: URL_A,
  ...over,
});
const linkToken = (over) => signEmailLinkToken(CONTRACT_LINK_PURPOSE, claimsFor(over));

const req = ({ origin = 'https://admin.devitrak.net', token, body = {}, params = {}, uid, tokenVersion } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(token ? { 'x-link-token': token } : {}) };
  return { headers, header: (n) => headers[n.toLowerCase()], body, params, uid, tokenVersion, ip: '1.2.3.4', originalUrl: '/x' };
};
const res = () => {
  const r = { listeners: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.on = (ev, fn) => { r.listeners[ev] = fn; };
  return r;
};
const run = async (mw, request, response = res()) => {
  let nexted = false;
  await mw(request, response, () => { nexted = true; });
  return { nexted, response };
};
const withMode = async (m, fn) => {
  const prev = process.env.CONTRACT_LINK_MODE;
  process.env.CONTRACT_LINK_MODE = m;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.CONTRACT_LINK_MODE; else process.env.CONTRACT_LINK_MODE = prev;
  }
};

const readGate = contractLinkGate({
  subject: (r) => ({ company_id: r.body.company_id, consumer_member_id: r.body.consumer_member_id, contract_url: r.body.contract_url }),
});
const signGate = contractLinkGate({
  subject: (r) => ({ verification_id: r.body.verification_id, contract_url: r.body.contract_url }),
  consume: true,
});
const sharedGate = contractLinkGate({
  subject: (r) => ({ consumer_member_id: r.params.id }),
  sharedWithConsumerApp: true,
});
const readBody = { company_id: CO, consumer_member_id: CONSUMER, contract_url: URL_A };
const signBody = { verification_id: VER, contract_url: URL_A };

// ── helper ──────────────────────────────────────────────────────────────────

test('emailLinkToken: lee lo que firma y no sirve para otro propósito', () => {
  const t = signEmailLinkToken('contract_signing', { a: 1 });
  assert.equal(readEmailLinkToken('contract_signing', t).a, 1);
  assert.equal(readEmailLinkToken('attendance', t), null);
  assert.equal(readEmailLinkToken('contract_signing', 'basura'), null);
});

test('emailLinkToken: la caducidad nunca pasa de 5 días', () => {
  const t = signEmailLinkToken('p', {}, { ttlSeconds: 30 * 24 * 3600 });
  const { iat, exp } = jwt.decode(t);
  assert.equal(exp - iat, MAX_TTL_S);
  assert.equal(MAX_TTL_S, 5 * 24 * 3600);
});

test('emailLinkToken: un token caducado no vale', () => {
  const expired = jwt.sign(
    { purpose: 'p', jti: 'x', exp: Math.floor(Date.now() / 1000) - 10 },
    `${process.env.SECRET_JWT_SEED}:email_link:p`,
  );
  assert.equal(readEmailLinkToken('p', expired), null);
});

test('emailLinkToken: se consume una vez; sin Redis responde "unavailable"', async () => {
  const claims = readEmailLinkToken('p', signEmailLinkToken('p', {}));
  assert.equal(await consumeEmailLinkToken(claims), 'consumed');
  assert.equal(await consumeEmailLinkToken(claims), 'already_used');
  redis.down = true;
  try {
    assert.equal(await consumeEmailLinkToken(readEmailLinkToken('p', signEmailLinkToken('p', {}))), 'unavailable');
  } finally {
    redis.down = false;
  }
});

// ── gate en enforce ─────────────────────────────────────────────────────────

test('enforce: sin token desde el dashboard → 401', () =>
  withMode('enforce', async () => {
    const { nexted, response } = await run(readGate, req({ body: readBody }));
    assert.equal(nexted, false);
    assert.equal(response.statusCode, 401);
  }));

test('enforce: con el token de ese contrato pasa y deja req.contractLink', () =>
  withMode('enforce', async () => {
    const r = req({ token: linkToken(), body: readBody });
    const { nexted } = await run(readGate, r);
    assert.equal(nexted, true);
    assert.equal(r.contractLink.consumer_member_id, CONSUMER);
  }));

test('enforce: el token de un consumidor no sirve para otro', () =>
  withMode('enforce', async () => {
    const { nexted, response } = await run(readGate, req({ token: linkToken(), body: { ...readBody, consumer_member_id: OTHER_CONSUMER } }));
    assert.equal(nexted, false);
    assert.equal(response.statusCode, 401);
  }));

test('enforce: el token de un contrato no sirve para otro contrato', () =>
  withMode('enforce', async () => {
    const { response } = await run(readGate, req({ token: linkToken(), body: { ...readBody, contract_url: URL_B } }));
    assert.equal(response.statusCode, 401);
  }));

test('enforce: si falta un id en la petición no pasa', () =>
  withMode('enforce', async () => {
    const { response } = await run(readGate, req({ token: linkToken(), body: { company_id: CO, contract_url: URL_A } }));
    assert.equal(response.statusCode, 401);
  }));

test('enforce: las lecturas no gastan el token; firmar sí, y la segunda vez da 410', () =>
  withMode('enforce', async () => {
    const t = linkToken();
    for (let i = 0; i < 3; i++) {
      assert.equal((await run(readGate, req({ token: t, body: readBody }))).nexted, true, 'lectura');
    }
    const first = await run(signGate, req({ token: t, body: signBody }));
    assert.equal(first.nexted, true);
    first.response.statusCode = 200;
    first.response.listeners.finish?.();

    const second = await run(signGate, req({ token: t, body: signBody }));
    assert.equal(second.nexted, false);
    assert.equal(second.response.statusCode, 410);
  }));

test('enforce: si la firma falla, el enlace sigue valiendo', () =>
  withMode('enforce', async () => {
    const t = linkToken();
    const first = await run(signGate, req({ token: t, body: signBody }));
    first.response.statusCode = 500;
    first.response.listeners.finish();
    await new Promise((r) => setImmediate(r));
    assert.equal((await run(signGate, req({ token: t, body: signBody }))).nexted, true);
  }));

test('enforce: sin Redis la firma pasa (el controller comprueba si ya está firmado)', () =>
  withMode('enforce', async () => {
    redis.down = true;
    try {
      const r = req({ token: linkToken(), body: signBody });
      assert.equal((await run(signGate, r)).nexted, true);
      assert.ok(r.contractLink, 'el controller sabe que viene por enlace');
    } finally {
      redis.down = false;
    }
  }));

test('enforce: el staff con sesión vigente pasa sin token', () =>
  withMode('enforce', async () => {
    assert.equal((await run(readGate, req({ uid: STAFF, tokenVersion: 1, body: readBody }))).nexted, true);
  }));

test('enforce: una sesión de staff cerrada no cuenta', () =>
  withMode('enforce', async () => {
    const { response } = await run(readGate, req({ uid: STAFF, tokenVersion: 0, body: readBody }));
    assert.equal(response.statusCode, 401);
  }));

test('enforce: ruta compartida — la app del consumidor pasa sin token, el dashboard sin sesión no', () =>
  withMode('enforce', async () => {
    assert.equal((await run(sharedGate, req({ origin: 'https://app.devitrak.net', params: { id: CONSUMER } }))).nexted, true);
    assert.equal((await run(sharedGate, req({ origin: null, params: { id: CONSUMER } }))).nexted, true);
    const { response } = await run(sharedGate, req({ params: { id: CONSUMER } }));
    assert.equal(response.statusCode, 401);
    assert.equal((await run(sharedGate, req({ token: linkToken(), params: { id: CONSUMER } }))).nexted, true);
    assert.equal((await run(sharedGate, req({ token: linkToken(), params: { id: OTHER_CONSUMER } }))).response.statusCode, 401);
  }));

// ── warn (por defecto) y off ────────────────────────────────────────────────

test('warn por defecto: sin token registra y deja pasar (correos viejos)', async () => {
  delete process.env.CONTRACT_LINK_MODE;
  logs.length = 0;
  const { nexted } = await run(readGate, req({ body: readBody }));
  assert.equal(nexted, true);
  assert.ok(logs.some((m) => /mode=warn/.test(m)));
});

test('off: no comprueba nada', () =>
  withMode('off', async () => {
    assert.equal((await run(readGate, req({ body: readBody }))).nexted, true);
  }));

// ── emisión en el correo ────────────────────────────────────────────────────

const mailBody = (over = {}) => ({
  company_id: CO,
  verification_id: VER,
  consumer: { email: 'ana@example.com', consumer_member_id: CONSUMER },
  contract_list: [{ view_url: URL_A }, { view_url: URL_B }, { view_url: 'https://s3/ajeno.pdf' }],
  ...over,
});
const mailReq = (body, session = { uid: STAFF, tokenVersion: 1 }) => ({ body, notificationSession: session });

test('correo: staff de la compañía → un token por contrato de la verificación', async () => {
  const r = mailReq(mailBody());
  await run(attachContractLinkTokens, r);
  const tokens = r.body.contract_link_tokens;
  assert.deepEqual(Object.keys(tokens).sort(), [URL_A, URL_B], 'el contrato ajeno a la verificación no lleva token');
  const claims = readEmailLinkToken(CONTRACT_LINK_PURPOSE, tokens[URL_B]);
  assert.equal(claims.contract_url, URL_B);
  assert.equal(claims.consumer_member_id, CONSUMER);
  assert.equal(claims.verification_id, VER);
});

test('correo: sin token si el email no es el del consumidor en BD', async () => {
  const r = mailReq(mailBody({ consumer: { email: 'atacante@x.com', consumer_member_id: CONSUMER } }));
  await run(attachContractLinkTokens, r);
  assert.equal(r.body.contract_link_tokens, undefined);
});

test('correo: sin token sin sesión de staff, o si el staff es de otra compañía', async () => {
  const anon = mailReq(mailBody(), null);
  await run(attachContractLinkTokens, anon);
  assert.equal(anon.body.contract_link_tokens, undefined);

  const outsiderCompany = {
    findOne: () => ({ lean: async () => ({ employees: [] }) }),
  };
  require.cache[path.join(root, 'models/Company.js')].exports.findOne = outsiderCompany.findOne;
  try {
    const r = mailReq(mailBody(), { uid: OUTSIDER, tokenVersion: 1 });
    await run(attachContractLinkTokens, r);
    assert.equal(r.body.contract_link_tokens, undefined);
  } finally {
    require.cache[path.join(root, 'models/Company.js')].exports.findOne = () => ({
      lean: async () => ({ employees: [{ userId: STAFF, user: 'staff@co.com' }] }),
    });
  }
});

test('correo: sin token si la verificación es de otro consumidor', async () => {
  const r = mailReq(mailBody({ consumer: { email: 'ana@example.com', consumer_member_id: OTHER_CONSUMER } }));
  await run(attachContractLinkTokens, r);
  assert.equal(r.body.contract_link_tokens, undefined);
});

test('correo: los tokens que mande el cliente se descartan', async () => {
  const r = mailReq(mailBody({ contract_link_tokens: { [URL_A]: 'fabricado' } }), null);
  await run(attachContractLinkTokens, r);
  assert.equal(r.body.contract_link_tokens, undefined);
});

test('correo: el enlace del contrato lleva el token', () => {
  const { liabilityContractConsumerNotificationMessageHtml } = require('../nodeMailer/returningDeviceMessage');
  const html = liabilityContractConsumerNotificationMessageHtml(
    {
      company_name: 'Co',
      email_admin: 'a@co.com',
      consumer: { name: 'Ana', email: 'ana@example.com', consumer_member_id: CONSUMER },
      contract_list: [{ view_url: URL_A, document_name: 'A' }],
      items: [{ item_id: 1, serial_number: 'S1' }],
      company_id: CO,
      verification_id: VER,
      date_reference: 'd',
      contract_link_tokens: { [URL_A]: 'TOKEN123' },
    },
    {},
  );
  assert.match(html, /display-contracts\?[^"]*token=TOKEN123/);
});

// ── rutas ───────────────────────────────────────────────────────────────────

test('las 6 rutas de /display-contracts pasan por el gate', () => {
  const has = (mod, method, p) => {
    const router = require(mod);
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    assert.ok(layer, `${method} ${p} no registrada`);
    return layer.route.stack.length;
  };
  // Cada una suma el gate a su cadena; el número exacto lo fija el router.
  assert.ok(has('../routes/document', 'post', '/download/documentUrl') >= 3);
  assert.ok(has('../routes/document', 'post', '/verification/consumer_member/check_signed_document') >= 3);
  assert.ok(has('../routes/document', 'patch', '/verification/consumer_member/signing_document') >= 3);
  assert.ok(has('../routes/company', 'post', '/consumer-signatures') >= 3);
  assert.ok(has('../routes/company', 'post', '/signatures-for-consumer-member') >= 3);
  assert.ok(has('../routes/auth', 'get', '/:id') >= 3);
});
