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

describe('la frontera tiene una puerta: los errores de validacion propios', () => {
  const { publicError, isExposed } = require('../helpers/errorResponder');

  // SI-11 habla de errores INTERNOS. "sortBy must be one of..." no es un error
  // interno escapandose: es la respuesta de la validacion, escrita por
  // nosotros, y ocultarla deja al cliente sin saber que corregir.
  test('un error marcado como publico conserva su mensaje', () => {
    const response = makeResponse();
    respondError(makeRequest(), response, publicError('sortBy must be one of: serial, group'), {
      status: 400,
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.msg, /sortBy must be one of/);
    assert.ok(response.body.ref, 'y sigue llevando referencia');
  });

  test('un error cualquiera NO conserva el suyo, aunque sea un 400', () => {
    const response = makeResponse();
    respondError(makeRequest(), response, new Error('syntax error at position 29'), { status: 400 });
    assert.equal(response.body.msg, GENERIC_MESSAGE);
  });

  // Que un error de libreria no pueda colarse diciendo que es publico.
  test('la marca tiene que ser exactamente true', () => {
    assert.equal(isExposed(Object.assign(new Error('x'), { expose: 'yes' })), false);
    assert.equal(isExposed(Object.assign(new Error('x'), { expose: 1 })), false);
    assert.equal(isExposed(new Error('x')), false);
    assert.equal(isExposed(null), false);
    assert.equal(isExposed(publicError('x')), true);
  });

  test('un msg explicito gana al del error publico', () => {
    const response = makeResponse();
    respondError(makeRequest(), response, publicError('detalle interno'), { msg: 'No encontrado' });
    assert.equal(response.body.msg, 'No encontrado');
  });

  // Las tres clases de validacion que existen hoy.
  test('las clases de validacion del repo estan marcadas', () => {
    const { QueryParamError } = require('../mysql/queries/inventoryQueryCatalog');
    assert.equal(new QueryParamError('x').expose, true);
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'mysql', 'queries', 'inventoryImportQuery.js'), 'utf8'
    );
    assert.match(source, /this\.expose = true/, 'ImportValidationError sin marcar');
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
        // Solo lineas vivas: los comentarios NOMBRAN el patron para explicar
        // por que se quito, y un centinela que lee comentarios acaba
        // prohibiendo que se documente la decision.
        const live = fs.readFileSync(path.join(base, file), 'utf8')
          .split('\n')
          .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
          .join('\n');
        if (/JSON\.stringify\(error\)/.test(live)) offenders.push(path.join(...dir, file));
      }
    }
    assert.deepEqual(offenders, [], 'estos devuelven el objeto entero del error');
  });

  // Las rutas de sondeo se montan FUERA de configureMiddleware a proposito
  // (index.js), asi que un attachErrorRef que viviera ahi dentro nunca pasaria
  // por ellas: /ready devolvia `ref: null` siempre. Una referencia que nunca
  // apunta a nada invita a buscar en el registro algo que no se escribio.
  test('attachErrorRef se monta antes que las rutas de sondeo', () => {
    // Se mira DENTRO de initializeApp, que es donde se decide el orden real:
    // `configureMiddleware` se define arriba del fichero pero se llama abajo,
    // asi que comparar posiciones en el texto entero no dice nada.
    const source = read('index.js');
    const body = source.slice(source.indexOf('const initializeApp'));

    const ref = body.indexOf('app.use(attachErrorRef)');
    const health = body.indexOf('app.use(require("./routes/health"))');
    const middleware = body.indexOf('configureMiddleware(app)');

    assert.ok(ref > 0, 'attachErrorRef no esta montado en initializeApp');
    assert.ok(health > 0, 'no se encontro el montaje de /health');
    assert.ok(ref < health, '/health y /ready tienen que recibir la referencia');
    assert.ok(
      ref < middleware,
      'y tiene que ir antes del resto de la cadena, que es la que puede rechazar'
    );
  });

  test('/ready no promete una referencia que no existe', () => {
    const source = read('routes/health.js');
    if (!/ref:/.test(source)) return; // si deja de devolverla, nada que fijar
    assert.match(
      source,
      /request\.errorRef/,
      'si /ready devuelve `ref`, tiene que salir de la peticion'
    );
  });

  // Un servidor que dice mas o menos segun una variable de entorno es un
  // servidor que un dia dice de mas: esa variable se pone a mano en una VM.
  test('el handler global ya no revela el error segun NODE_ENV', () => {
    const source = read('index.js');
    const handler = source.slice(source.indexOf('Unhandled Error'), source.indexOf('Unhandled Error') + 1400);
    assert.doesNotMatch(handler, /NODE_ENV[^\n]*err\.message|err\.message[^\n]*NODE_ENV/);
  });
});
