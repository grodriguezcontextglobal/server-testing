'use strict';

/**
 * APP-2026-013 · SI-11: el respondedor de errores comun.
 *
 * Lo que estos tests defienden no es un formato, es una frontera: nada que
 * venga del error puede acabar en la respuesta. El ultimo bloque la comprueba
 * sobre el codigo real, porque un doble que yo escribo no puede contradecirme.
 */

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { respondError, attachErrorRef, detail, newRef, GENERIC_MESSAGE } =
  require('../helpers/errorResponder');

const makeResponse = () => {
  const response = { statusCode: 200, body: null, headers: {}, headersSent: false };
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (body) => { response.body = body; response.headersSent = true; return response; };
  response.setHeader = (k, v) => { response.headers[k] = v; };
  return response;
};

const makeRequest = (extra = {}) => ({
  method: 'POST',
  originalUrl: '/api/db_item/consulting-item',
  headers: {},
  ...extra,
});

describe('la frontera: el error no sale', () => {
  // El caso exacto del POA&M: hoy esta ruta devuelve el mensaje del motor SQL.
  test('el mensaje del motor SQL no llega al cliente', () => {
    const response = makeResponse();
    const error = Object.assign(new Error('syntax error at position 29'), {
      code: 'ER_PARSE_ERROR',
      sqlState: '42000',
      sql: "SELECT * FROM item_inv WHERE serial_number = 'ABC-001'",
    });

    respondError(makeRequest({ errorRef: 'abc123456789' }), response, error);

    const body = JSON.stringify(response.body);
    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(body, /syntax error/, 'el mensaje del motor no puede salir');
    assert.doesNotMatch(body, /ER_PARSE_ERROR/);
    assert.doesNotMatch(body, /42000/);
    assert.doesNotMatch(body, /item_inv/, 'ni el nombre de la tabla');
    assert.doesNotMatch(body, /ABC-001/, 'ni los parametros, que son datos de cliente');
  });

  test('la respuesta lleva la referencia para poder encontrar el detalle', () => {
    const response = makeResponse();
    respondError(makeRequest({ errorRef: 'abc123456789' }), response, new Error('boom'));
    assert.equal(response.body.ref, 'abc123456789');
    assert.equal(response.body.ok, false);
    assert.equal(response.body.msg, GENERIC_MESSAGE);
  });

  // Un mensaje nuestro SI puede salir; lo que no puede es venir del error.
  test('se puede dar una frase propia, con su estado', () => {
    const response = makeResponse();
    respondError(makeRequest(), response, new Error('cast failed'), {
      status: 404,
      msg: 'Event not found',
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.msg, 'Event not found');
    assert.doesNotMatch(JSON.stringify(response.body), /cast failed/);
  });

  test('si ya se respondio, no se responde dos veces', () => {
    const response = makeResponse();
    response.headersSent = true;
    respondError(makeRequest(), response, new Error('boom'));
    assert.equal(response.body, null, 'no puede escribir sobre una respuesta ya enviada');
  });

  test('sin middleware delante sigue habiendo referencia', () => {
    const response = makeResponse();
    respondError(makeRequest(), response, new Error('boom'));
    assert.match(response.body.ref, /^[0-9a-f]{12}$/, 'se genera una en el momento');
  });
});

describe('la referencia', () => {
  test('la genera el servidor y no se lee de la cabecera', () => {
    const request = makeRequest({ headers: { 'x-request-id': 'inventada-por-el-cliente' } });
    const response = makeResponse();
    attachErrorRef(request, response, () => {});
    assert.match(request.errorRef, /^[0-9a-f]{12}$/);
    assert.notEqual(request.errorRef, 'inventada-por-el-cliente');
  });

  test('viaja en una cabecera, no solo en los errores', () => {
    const request = makeRequest();
    const response = makeResponse();
    attachErrorRef(request, response, () => {});
    assert.equal(response.headers['X-Error-Ref'], request.errorRef);
  });

  // Dos fallos en una peticion son UN incidente, no dos.
  test('la misma peticion conserva su referencia', () => {
    const request = makeRequest({ errorRef: 'yaexistia1234' });
    attachErrorRef(request, makeResponse(), () => {});
    assert.equal(request.errorRef, 'yaexistia1234');
  });

  test('doce hexadecimales: se dicta por telefono', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) {
      const ref = newRef();
      assert.match(ref, /^[0-9a-f]{12}$/);
      seen.add(ref);
    }
    assert.equal(seen.size, 500, 'sin repeticiones en 500');
  });
});

describe('lo que se registra', () => {
  test('el detalle lleva lo necesario para diagnosticar', () => {
    const d = detail(Object.assign(new Error('boom'), { code: 'ER_X', sqlState: '42000' }));
    assert.equal(d.message, 'boom');
    assert.equal(d.code, 'ER_X');
    assert.equal(d.sqlState, '42000');
    assert.ok(d.stack);
  });

  // Un error de driver puede traer colgando la consulta CON sus parametros, y
  // los parametros son datos de cliente: registrarlos convierte el archivo de
  // log en una copia parcial de la base de datos (AU-9 por otro camino).
  test('el detalle NO arrastra el objeto entero', () => {
    const error = Object.assign(new Error('boom'), {
      sql: "SELECT * FROM members_info WHERE email = 'ann@x.test'",
      parameters: ['ann@x.test'],
    });
    const d = JSON.stringify(detail(error));
    assert.doesNotMatch(d, /ann@x\.test/);
    assert.doesNotMatch(d, /members_info/);
  });

  test('un error que no es Error tampoco revienta', () => {
    assert.equal(detail('cadena suelta').message, 'cadena suelta');
    assert.equal(detail(null).message, null);
  });
});

describe('el codigo real como juez', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  // Los 19 peores: arrastraban el objeto entero del error.
  test('no queda ningun JSON.stringify(error) en los controladores', () => {
    const dirs = [['controller'], ['mysql', 'controllers']];
    const offenders = [];
    for (const dir of dirs) {
      const base = path.join(__dirname, '..', ...dir);
      for (const file of fs.readdirSync(base).filter((f) => f.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(base, file), 'utf8');
        if (/JSON\.stringify\(error\)/.test(source)) offenders.push(path.join(...dir, file));
      }
    }
    assert.deepEqual(offenders, [], 'estos devuelven el objeto entero del error');
  });

  test('el middleware se monta antes que el resto', () => {
    const source = read('index.js');
    const ref = source.indexOf('app.use(attachErrorRef)');
    const log = source.indexOf('app.use(requestLogger)');
    assert.ok(ref > 0, 'attachErrorRef no esta montado');
    assert.ok(ref < log, 'tiene que ir antes, para que un rechazo temprano tambien se pueda nombrar');
  });

  // Un servidor que dice mas o menos segun una variable de entorno es un
  // servidor que un dia dice de mas: esa variable se pone a mano en una VM.
  test('el handler global ya no revela el error segun NODE_ENV', () => {
    const source = read('index.js');
    const handler = source.slice(source.indexOf('Unhandled Error'), source.indexOf('Unhandled Error') + 1400);
    assert.doesNotMatch(handler, /NODE_ENV[^\n]*err\.message|err\.message[^\n]*NODE_ENV/);
  });
});
