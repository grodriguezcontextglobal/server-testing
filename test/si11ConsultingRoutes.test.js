'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildEqualityFilter } = require('../helpers/sqlEqualityFilter');

// Logger falso: respondInternalError registra el detalle y hay que poder
// comprobar QUE lo registra, que es la otra mitad del arreglo.
const logged = [];
const loggerPath = require.resolve('../helpers/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    error: (message, detail) => logged.push({ message, detail }),
    warn: () => {},
    info: () => {},
    http: () => {},
  },
};

const { respondInternalError, requestIdOf } = require('../helpers/internalError');

const COLUMNS = new Set(['item_id', 'category_name', 'company_id']);

const makeResponse = () => {
  const response = { statusCode: null, body: null };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (payload) => {
    response.body = payload;
    return response;
  };
  return response;
};

const makeRequest = (overrides = {}) => ({
  method: 'POST',
  originalUrl: '/api/db_item/consulting-item?x=1',
  uid: '507f1f77bcf86cd799439011',
  headers: {},
  get: (name) => makeRequestHeaders[name.toLowerCase()],
  ...overrides,
});
const makeRequestHeaders = {};

describe('helpers/sqlEqualityFilter', () => {
  // El caso exacto que midió el dashboard: {} producía `WHERE ;` y el error del
  // motor viajaba al cliente.
  test('cuerpo vacío: 400, y no se llega a consultar', () => {
    const result = buildEqualityFilter({}, COLUMNS, { subject: 'item_inv' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.msg, /At least one filter/);
  });

  test('columna fuera de la lista: 400 nombrándola', () => {
    const result = buildEqualityFilter({ password: 'x' }, COLUMNS);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.msg, /password/);
  });

  test('un valor undefined no llega al driver', () => {
    const result = buildEqualityFilter({ item_id: undefined }, COLUMNS);
    assert.equal(result.ok, false);
    assert.match(result.msg, /Empty value/);
  });

  test('cuerpo válido: WHERE con placeholders y los valores aparte', () => {
    const result = buildEqualityFilter({ item_id: 7, category_name: 'Laptop' }, COLUMNS);
    assert.equal(result.ok, true);
    assert.equal(result.where, '`item_id`=? AND `category_name`=?');
    assert.deepEqual(result.values, [7, 'Laptop']);
  });

  // Los nombres se interpolan, así que la lista cerrada es la defensa: nada que
  // no esté en ella llega nunca a la consulta.
  test('ningún nombre de columna se interpola sin estar en la lista', () => {
    const injection = { '`item_id`=1 OR 1=1 -- ': 'x' };
    const result = buildEqualityFilter(injection, COLUMNS);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('un cuerpo que no es objeto: 400', () => {
    for (const body of [null, undefined, 'texto', 42, ['a']]) {
      const result = buildEqualityFilter(body, COLUMNS);
      assert.equal(result.ok, false, String(body));
      assert.equal(result.status, 400);
    }
  });
});

describe('helpers/internalError', () => {
  test('el cliente recibe un mensaje genérico; el detalle va al log', () => {
    logged.length = 0;
    const response = makeResponse();
    const request = makeRequest();
    respondInternalError(response, request, new Error('syntax error at position 29'), {
      operation: 'consultingItem',
      table: 'item_inv',
    });

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.ok, false);
    // Lo que no puede salir: el texto del motor, la tabla, la consulta.
    assert.doesNotMatch(JSON.stringify(response.body), /syntax error|position 29|item_inv/);
    assert.match(response.body.msg, /Internal error/);

    assert.equal(logged.length, 1);
    assert.equal(logged[0].message, 'consultingItem');
    assert.equal(logged[0].detail.error, 'syntax error at position 29');
    assert.equal(logged[0].detail.table, 'item_inv');
    assert.equal(logged[0].detail.path, '/api/db_item/consulting-item');
  });

  test('con X-Request-ID, el cliente se lo lleva para soporte', () => {
    logged.length = 0;
    const response = makeResponse();
    const request = makeRequest({ get: (name) => (name === 'X-Request-ID' ? 'req-123' : undefined) });
    respondInternalError(response, request, new Error('boom'), {});
    assert.equal(response.body.requestId, 'req-123');
    assert.equal(logged[0].detail.requestId, 'req-123');
  });

  // Mejor decir que no hubo id que inventar uno que no está en los registros.
  test('sin X-Request-ID, requestId es null', () => {
    const response = makeResponse();
    respondInternalError(response, makeRequest(), new Error('boom'), {});
    assert.equal(response.body.requestId, null);
    assert.equal(requestIdOf({ headers: {} }), null);
    assert.equal(requestIdOf({ headers: { 'x-request-id': '  ' } }), null);
  });
});
