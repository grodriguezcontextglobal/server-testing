'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createUpdateSubLocation } = require('../mysql/controllers/item');

/**
 * `updateSubLocation` renombra una locación y propaga el nombre a `item_inv`:
 * dos escrituras que antes no iban en una transacción. Si fallaba la segunda,
 * la locación quedaba renombrada y los ítems apuntando al nombre viejo.
 *
 * Lo que se afirma aquí es lo que no se ve en una lectura del diff: que se
 * deshace lo hecho, y que la conexión SIEMPRE vuelve al pool — incluso cuando
 * se sale por un 404 a media transacción, que es el camino que más fácil se
 * escapa y el que agota el pool bajo carga.
 */

const makePool = ({ failOn = null, rows = {} } = {}) => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      calls.push(`query:${String(sql).trim().split(/\s+/).slice(0, 3).join(' ')}`);
      if (failOn && String(sql).includes(failOn)) throw new Error('boom');
      for (const [needle, result] of Object.entries(rows)) {
        if (String(sql).includes(needle)) return [result];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const pool = { acquired: 0, async getConnection() { this.acquired += 1; return connection; } };
  return { pool, calls, connectionFn: () => pool };
};

const makeRes = () => {
  const sent = {};
  return { sent, status(code) { sent.status = code; return this; }, json(body) { sent.body = body; return this; } };
};

const contextOk = async () => ({ ok: true, companyId: '62', access: { scoped: false } });

test('camino feliz: las dos escrituras van dentro de una transacción y se confirman', async () => {
  const { calls, connectionFn } = makePool();
  const handler = createUpdateSubLocation({ connectionFn, resolveContextFn: contextOk });
  const res = makeRes();

  await handler({ body: { newName: 'Almacén 2', path: ['Almacén 1'], currentIndex: 0 } }, res);

  assert.equal(res.sent.status, 200);
  assert.equal(calls[0], 'begin');
  assert.ok(calls.includes('commit'));
  assert.ok(!calls.includes('rollback'));
  assert.equal(calls[calls.length - 1], 'release', 'la conexión vuelve al pool');
});

test('si falla la segunda escritura, se deshace la primera', async () => {
  // Este es el daño concreto: sin rollback, la locación queda renombrada y los
  // ítems siguen apuntando al nombre viejo.
  const { calls, connectionFn } = makePool({ failOn: 'UPDATE item_inv' });
  const handler = createUpdateSubLocation({ connectionFn, resolveContextFn: contextOk });
  const res = makeRes();

  await handler({ body: { newName: 'Almacén 2', path: ['Almacén 1'], currentIndex: 0 } }, res);

  assert.equal(res.sent.status, 500);
  assert.ok(calls.includes('rollback'), 'debe deshacerse el UPDATE de locations');
  assert.ok(!calls.includes('commit'));
  assert.equal(calls[calls.length - 1], 'release');
});

test('un 404 a media transacción también hace rollback y libera la conexión', async () => {
  // La trampa del arreglo: un `return` dentro de una transacción abierta
  // devuelve la conexión al pool CON la transacción viva, y mysql2 no la
  // deshace. Bajo carga eso agota el pool.
  const { calls, connectionFn } = makePool({ rows: { 'SELECT location_id': [] } });
  const handler = createUpdateSubLocation({ connectionFn, resolveContextFn: contextOk });
  const res = makeRes();

  await handler({ body: { newName: 'Sala 2', path: ['Edificio A', 'Sala 1'], currentIndex: 1 } }, res);

  assert.equal(res.sent.status, 404, 'el 404 se conserva, no se convierte en 500');
  assert.equal(res.sent.body.message, 'Location not found');
  assert.ok(calls.includes('rollback'));
  assert.equal(calls[calls.length - 1], 'release');
});

test('el company_id sale del contexto verificado, no del body', async () => {
  const { pool, connectionFn } = makePool();
  const handler = createUpdateSubLocation({ connectionFn, resolveContextFn: contextOk });
  const res = makeRes();

  await handler(
    { body: { newName: 'X', path: ['A'], currentIndex: 0, company_id: '77' } },
    res
  );

  assert.equal(res.sent.status, 400);
  assert.equal(res.sent.body.msg, 'Company mismatch between header and body');
  assert.equal(pool.acquired, 0, 'una petición rechazada no debe tomar conexión del pool');
});

test('sin contexto de compañía no se toca la base de datos', async () => {
  const { pool, connectionFn } = makePool();
  const handler = createUpdateSubLocation({
    connectionFn,
    resolveContextFn: async () => ({ ok: false, status: 401, msg: 'No staff identity on this request.' }),
  });
  const res = makeRes();

  await handler({ body: { newName: 'X', path: ['A'], currentIndex: 0 } }, res);

  assert.equal(res.sent.status, 401);
  assert.equal(pool.acquired, 0);
});
