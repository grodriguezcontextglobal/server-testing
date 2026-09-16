'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDeleteCustomer } = require('../mysql/controllers/consumer');

/**
 * `deleteCustomer` ejecutaba `DELETE FROM consumer_info WHERE consumer_id = ?`
 * SIN filtro de compañía: el id bastaba para borrar el consumidor de cualquier
 * inquilino. No se notaba porque la ruta respondía 401 a toda petición
 * —`authorizePermission` no encontraba `company_id` en params, body ni query, y
 * no miraba el header—, así que al arreglar eso la ruta despierta.
 *
 * Lo que se afirma aquí es lo que no se ve leyendo el diff: que un id de OTRA
 * compañía no llega nunca al DELETE, y que la respuesta es 404 y no 403 (un 403
 * confirmaría que ese id existe).
 */

const makePool = ({ owns = true } = {}) => {
  const queries = [];
  const pool = {
    async execute(sql, values) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      if (String(sql).includes('consumer_attending_event')) {
        return [owns ? [{ found: 1 }] : []];
      }
      return [{ affectedRows: 1 }];
    },
  };
  return { pool, queries, connectionFn: async () => pool };
};

const makeRes = () => {
  const sent = {};
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
};

const okContext = async () => ({ ok: true, companyId: '7', access: {} });

const deletedQueries = (queries) =>
  queries.filter((q) => q.sql.startsWith('DELETE'));

test('deleteCustomer borra cuando el consumidor es de la compañía verificada', async () => {
  const { connectionFn, queries } = makePool({ owns: true });
  const handler = createDeleteCustomer({
    connectionFn,
    resolveCompanyContextFn: okContext,
  });

  const res = makeRes();
  await handler({ body: { consumer_id: '42' }, params: {} }, res);

  assert.equal(res.sent.status, 200);
  assert.equal(res.sent.body.ok, true);
  assert.equal(deletedQueries(queries).length, 1);
  assert.deepEqual(deletedQueries(queries)[0].values, ['42']);
});

test('deleteCustomer NO borra un consumidor de otra compañía, y responde 404', async () => {
  const { connectionFn, queries } = makePool({ owns: false });
  const handler = createDeleteCustomer({
    connectionFn,
    resolveCompanyContextFn: okContext,
  });

  const res = makeRes();
  await handler({ body: { consumer_id: '999' }, params: {} }, res);

  assert.equal(res.sent.status, 404, 'tiene que ser 404, no 403: un 403 confirma que el id existe');
  assert.equal(
    deletedQueries(queries).length,
    0,
    'el DELETE no puede llegar a ejecutarse para un id de otra compañía',
  );
});

test('deleteCustomer comprueba la pertenencia contra la compañía del contexto, no la del body', async () => {
  const { connectionFn, queries } = makePool({ owns: true });
  const handler = createDeleteCustomer({
    connectionFn,
    resolveCompanyContextFn: okContext,
  });

  await handler(
    // company_id del body a propósito distinto del que devuelve el contexto
    { body: { consumer_id: '42', company_id: '999' }, params: {} },
    makeRes(),
  );

  const ownership = queries.find((q) => q.sql.includes('consumer_attending_event'));
  assert.deepEqual(ownership.values, ['42', '7']);
});

test('deleteCustomer acepta el id por la URL cuando el body no lo trae', async () => {
  const { connectionFn, queries } = makePool({ owns: true });
  const handler = createDeleteCustomer({
    connectionFn,
    resolveCompanyContextFn: okContext,
  });

  const res = makeRes();
  await handler({ body: {}, params: { id: '55' } }, res);

  assert.equal(res.sent.status, 200);
  assert.deepEqual(deletedQueries(queries)[0].values, ['55']);
});

test('deleteCustomer propaga el error del contexto sin tocar la base de datos', async () => {
  const { connectionFn, queries } = makePool({ owns: true });
  const handler = createDeleteCustomer({
    connectionFn,
    resolveCompanyContextFn: async () => ({ ok: false, status: 403, msg: 'nope' }),
  });

  const res = makeRes();
  await handler({ body: { consumer_id: '42' }, params: {} }, res);

  assert.equal(res.sent.status, 403);
  assert.equal(queries.length, 0, 'sin contexto de compañía no se consulta nada');
});
