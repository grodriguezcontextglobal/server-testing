'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/item.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');
const companyContextPath = path.resolve(__dirname, '../mysql/helpers/companyContext.js');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/**
 * Fake PoolConnection recording the transaction lifecycle, so a test can assert
 * that a failure rolled back rather than leaving half the work applied.
 */
function makeConnection({ onExecute } = {}) {
  const calls = [];
  return {
    calls,
    began: false,
    committed: false,
    rolledBack: false,
    released: false,
    async beginTransaction() { this.began = true; },
    async commit() { this.committed = true; },
    async rollback() { this.rolledBack = true; },
    release() { this.released = true; },
    async execute(sql, params) {
      calls.push({ sql, params });
      return onExecute ? onExecute(sql, params) : [[]];
    },
  };
}

function loadController({ connection, context }) {
  const originals = new Map(
    [controllerPath, dbPath, loggerPath, companyContextPath].map((p) => [p, require.cache[p]])
  );

  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => ({ getConnection: async () => connection }) };
  require.cache[loggerPath] = { exports: { error() {}, info() {}, warn() {} } };
  require.cache[companyContextPath] = {
    exports: {
      COMPANY_HEADER: 's-company-lq',
      resolveCompanyContext: async () =>
        context || { ok: true, companyId: 133, access: {} },
    },
  };

  const controller = require(controllerPath);
  return {
    controller,
    restore() {
      for (const [p, cached] of originals) {
        if (cached) require.cache[p] = cached;
        else delete require.cache[p];
      }
    },
  };
}

const validBody = {
  event_id: 'evt-1',
  item_group: 'Chromebook',
  category_name: 'Laptops',
  serial_numbers: ['SN1', 'SN2'],
};

test('happy path: selecciona con FOR UPDATE, actualiza, borra y commitea', async () => {
  const connection = makeConnection({
    onExecute: (sql) => {
      if (/SELECT item_id/.test(sql)) return [[{ item_id: 10 }, { item_id: 11 }]];
      if (/UPDATE item_inv/.test(sql)) return [{ affectedRows: 2 }];
      if (/DELETE/.test(sql)) return [{ affectedRows: 2 }];
      return [[]];
    },
  });

  const loaded = loadController({ connection });
  try {
    const res = createResponse();
    await loaded.controller.returnEventDevicesToWarehouse({ body: validBody }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.returned_items, 2);
    assert.equal(res.body.removed_assignments, 2);
    assert.equal(connection.committed, true);
    assert.equal(connection.rolledBack, false);
    assert.equal(connection.released, true);

    // El bloqueo es lo que impide que una asignacion concurrente se cuele
    // entre la lectura y las escrituras.
    assert.match(connection.calls[0].sql, /FOR UPDATE/);
  } finally {
    loaded.restore();
  }
});

// La razon de ser de este endpoint: como tres llamadas separadas, un fallo en
// el DELETE dejaba el inventario marcado como devuelto Y todavia asignado.
test('si el DELETE falla, revierte el UPDATE (no queda estado a medias)', async () => {
  const connection = makeConnection({
    onExecute: (sql) => {
      if (/SELECT item_id/.test(sql)) return [[{ item_id: 10 }]];
      if (/UPDATE item_inv/.test(sql)) return [{ affectedRows: 1 }];
      if (/DELETE/.test(sql)) throw new Error('deadlock');
      return [[]];
    },
  });

  const loaded = loadController({ connection });
  try {
    const res = createResponse();
    await loaded.controller.returnEventDevicesToWarehouse({ body: validBody }, res);

    assert.equal(res.statusCode, 500);
    assert.equal(connection.rolledBack, true, 'debe revertir');
    assert.equal(connection.committed, false, 'no debe commitear');
    assert.equal(connection.released, true, 'debe liberar la conexion igual');
  } finally {
    loaded.restore();
  }
});

test('los item_id del DELETE salen de la consulta acotada por compañía, no del cliente', async () => {
  const connection = makeConnection({
    onExecute: (sql) => {
      if (/SELECT item_id/.test(sql)) return [[{ item_id: 10 }]];
      if (/UPDATE item_inv/.test(sql)) return [{ affectedRows: 1 }];
      if (/DELETE/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    },
  });

  const loaded = loadController({ connection });
  try {
    const res = createResponse();
    // El cliente intenta colar ids ajenos; deben ser ignorados por completo.
    await loaded.controller.returnEventDevicesToWarehouse(
      { body: { ...validBody, item_ids: [999, 1000] } },
      res
    );

    assert.equal(res.statusCode, 200);
    const select = connection.calls.find((c) => /SELECT item_id/.test(c.sql));
    assert.equal(select.params[0], 133, 'la consulta se acota por la compañía verificada');

    const del = connection.calls.find((c) => /DELETE/.test(c.sql));
    assert.deepEqual(del.params, ['evt-1', 10], 'solo el id derivado en el servidor');
    assert.ok(!del.params.includes(999));
  } finally {
    loaded.restore();
  }
});

test('reporta los seriales que no matchearon en vez de descartarlos en silencio', async () => {
  const connection = makeConnection({
    onExecute: (sql) => {
      // Solo 1 de los 2 seriales pedidos pertenece a esta compañía.
      if (/SELECT item_id/.test(sql)) return [[{ item_id: 10 }]];
      if (/UPDATE item_inv/.test(sql)) return [{ affectedRows: 1 }];
      if (/DELETE/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    },
  });

  const loaded = loadController({ connection });
  try {
    const res = createResponse();
    await loaded.controller.returnEventDevicesToWarehouse({ body: validBody }, res);
    assert.equal(res.body.skipped_serials, 1);
  } finally {
    loaded.restore();
  }
});

test('404 y rollback cuando ningún serial pertenece a la compañía', async () => {
  const connection = makeConnection({ onExecute: () => [[]] });

  const loaded = loadController({ connection });
  try {
    const res = createResponse();
    await loaded.controller.returnEventDevicesToWarehouse({ body: validBody }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(connection.rolledBack, true);
    assert.equal(connection.committed, false);
    assert.equal(connection.released, true);
  } finally {
    loaded.restore();
  }
});

test('propaga el status de resolveCompanyContext y no abre transacción', async () => {
  const connection = makeConnection();
  const loaded = loadController({
    connection,
    context: { ok: false, status: 403, msg: 'Not an active staff member of this company.' },
  });
  try {
    const res = createResponse();
    await loaded.controller.returnEventDevicesToWarehouse({ body: validBody }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(connection.began, false, 'no debe tocar la BD sin compañía verificada');
  } finally {
    loaded.restore();
  }
});

test('valida la entrada antes de resolver compañía o abrir conexión', async () => {
  const connection = makeConnection();
  const loaded = loadController({ connection });
  try {
    for (const body of [
      {},
      { event_id: 'e' },
      { ...validBody, serial_numbers: [] },
      { ...validBody, serial_numbers: 'no-es-array' },
      { ...validBody, serial_numbers: [null, '', '   '] },
    ]) {
      const res = createResponse();
      await loaded.controller.returnEventDevicesToWarehouse({ body }, res);
      assert.equal(res.statusCode, 400, `debe rechazar ${JSON.stringify(body)}`);
    }
    assert.equal(connection.began, false);
  } finally {
    loaded.restore();
  }
});

test('deduplica seriales repetidos', async () => {
  const connection = makeConnection({
    onExecute: (sql) => {
      if (/SELECT item_id/.test(sql)) return [[{ item_id: 10 }]];
      if (/UPDATE item_inv/.test(sql)) return [{ affectedRows: 1 }];
      if (/DELETE/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    },
  });

  const loaded = loadController({ connection });
  try {
    const res = createResponse();
    await loaded.controller.returnEventDevicesToWarehouse(
      { body: { ...validBody, serial_numbers: ['SN1', 'SN1', 'SN1'] } },
      res
    );

    const select = connection.calls.find((c) => /SELECT item_id/.test(c.sql));
    // company_id + item_group + category_name + 1 serial unico
    assert.equal(select.params.length, 4);
  } finally {
    loaded.restore();
  }
});
