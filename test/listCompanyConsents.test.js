'use strict';

// POST /api/school/consent/list — revisión company-wide de consentimientos en
// cualquier estado, con filtro por status y paginación.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/school.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const staffActivityLogPath = path.resolve(__dirname, '../models/StaffActivityLog.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');
const queuePath = path.resolve(__dirname, '../helpers/queue.js');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadSchoolController({ pool }) {
  const originals = new Map(
    [controllerPath, dbPath, staffActivityLogPath, loggerPath, queuePath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ])
  );

  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  require.cache[staffActivityLogPath] = { exports: {} };
  require.cache[loggerPath] = { exports: { error() {}, info() {} } };
  require.cache[queuePath] = { exports: { enqueue: async () => {} } };
  const controller = require(controllerPath);

  return {
    controller,
    restore() {
      for (const [modulePath, cachedModule] of originals) {
        if (cachedModule) require.cache[modulePath] = cachedModule;
        else delete require.cache[modulePath];
      }
    },
  };
}

/** Pool que registra cada query y responde el total y las filas indicadas. */
function createPool({ total = 0, rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)')) return [[{ total }]];
      return [rows];
    },
  };
}

test('listCompanyConsents exige company_id', async () => {
  const loaded = loadSchoolController({ pool: createPool() });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.msg, /company_id/);
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents rechaza un status desconocido', async () => {
  const loaded = loadSchoolController({ pool: createPool() });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 1, status: 'revoked' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /agreed, pending, refused, expired/);
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents rechaza paginación no entera', async () => {
  const loaded = loadSchoolController({ pool: createPool() });
  try {
    for (const body of [{ company_id: 1, page: 0 }, { company_id: 1, page_size: -5 }, { company_id: 1, page: 'x' }]) {
      const res = createResponse();
      await loaded.controller.listCompanyConsents({ body }, res);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.match(res.body.msg, /positive integers/);
    }
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents sin filtro devuelve cualquier estado y no expone el OTC', async () => {
  const pool = createPool({
    total: 3,
    rows: [
      { id: 'c1', member_id: 5, status: 'agreed', otc_expires_at: null },
      { id: 'c2', member_id: 6, status: 'pending', otc_expires_at: '2099-01-01 00:00:00' },
      { id: 'c3', member_id: 7, status: 'refused', otc_expires_at: null },
    ],
  });
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 42 } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total, 3);
    assert.equal(res.body.count, 3);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.page_size, 50);
    assert.equal(res.body.total_pages, 1);
    assert.deepEqual(
      res.body.consents.map((c) => c.status),
      ['agreed', 'pending', 'refused']
    );

    const select = pool.calls.find((c) => !c.sql.includes('COUNT(*)'));
    assert.ok(!/\botc\b|otc_hash/.test(select.sql), 'la SELECT no debe traer el OTC');
    assert.ok(select.sql.includes('LIMIT ? OFFSET ?'));
    assert.deepEqual(select.params, [42, 50, 0]);
    // sin filtro de status no debe haber condición extra sobre sc.status
    assert.ok(!select.sql.includes('sc.status ='));
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents pagina: page 3 con page_size 10 -> OFFSET 20', async () => {
  const pool = createPool({ total: 25, rows: [] });
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 1, page: 3, page_size: 10 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total_pages, 3);
    const select = pool.calls.find((c) => !c.sql.includes('COUNT(*)'));
    assert.deepEqual(select.params, [1, 10, 20]);
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents topa page_size en 200', async () => {
  const pool = createPool({ total: 0, rows: [] });
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 1, page_size: 5000 } }, res);
    assert.equal(res.body.page_size, 200);
    const select = pool.calls.find((c) => !c.sql.includes('COUNT(*)'));
    assert.deepEqual(select.params, [1, 200, 0]);
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents filtra por status con placeholder', async () => {
  const pool = createPool({ total: 1, rows: [{ id: 'c1', status: 'refused', otc_expires_at: null }] });
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 7, status: 'REFUSED' } }, res);
    assert.equal(res.statusCode, 200);
    const [count, select] = [pool.calls[0], pool.calls[1]];
    assert.ok(count.sql.includes('sc.status = ?'));
    assert.deepEqual(count.params, [7, 'refused']);
    assert.deepEqual(select.params, [7, 'refused', 50, 0]);
  } finally {
    loaded.restore();
  }
});

test('status=expired busca pending con ventana OTC vencida; pending excluye los vencidos', async () => {
  const expiredPool = createPool();
  let loaded = loadSchoolController({ pool: expiredPool });
  try {
    await loaded.controller.listCompanyConsents({ body: { company_id: 1, status: 'expired' } }, createResponse());
    const sql = expiredPool.calls[0].sql;
    assert.ok(sql.includes("sc.status = 'pending'"));
    assert.ok(sql.includes('sc.otc_expires_at < NOW()'));
    assert.deepEqual(expiredPool.calls[0].params, [1]);
  } finally {
    loaded.restore();
  }

  const pendingPool = createPool();
  loaded = loadSchoolController({ pool: pendingPool });
  try {
    await loaded.controller.listCompanyConsents({ body: { company_id: 1, status: 'pending' } }, createResponse());
    const sql = pendingPool.calls[0].sql;
    assert.ok(sql.includes("sc.status = 'pending'"));
    assert.ok(sql.includes('sc.otc_expires_at >= NOW()'), 'pending no debe incluir los vencidos');
  } finally {
    loaded.restore();
  }
});

test('cada fila trae el flag expired calculado en el servidor', async () => {
  const pool = createPool({
    total: 2,
    rows: [
      { id: 'c1', status: 'pending', otc_expires_at: '2000-01-01 00:00:00' },
      { id: 'c2', status: 'pending', otc_expires_at: '2999-01-01 00:00:00' },
    ],
  });
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 1 } }, res);
    assert.deepEqual(
      res.body.consents.map((c) => c.expired),
      [true, false]
    );
  } finally {
    loaded.restore();
  }
});

test('listCompanyConsents responde 500 si la consulta falla', async () => {
  const pool = { query: async () => { throw new Error('db down'); } };
  const loaded = loadSchoolController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.listCompanyConsents({ body: { company_id: 1 } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
  } finally {
    loaded.restore();
  }
});

test('la ruta POST /consent/list existe y va detrás de canRead', () => {
  const routerPath = path.resolve(__dirname, '../mysql/routes/school.js');
  delete require.cache[routerPath];
  const router = require(routerPath);
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/consent/list' && l.route.methods.post
  );
  assert.ok(layer, 'la ruta POST /consent/list debe existir');
  const names = layer.route.stack.map((s) => s.name);
  for (const mw of ['validateJWT', 'checkTokenVersion', 'listCompanyConsents']) {
    assert.ok(names.includes(mw), `falta ${mw} en la cadena: ${names.join(', ')}`);
  }
  // requireIndustry("Education") y authorizePermission devuelven closures anónimas:
  // se comprueba que la cadena tenga los 5 eslabones de canRead + el handler.
  assert.equal(layer.route.stack.length, 5, `cadena inesperada: ${names.join(', ')}`);
});
