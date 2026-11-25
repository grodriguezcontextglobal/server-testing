'use strict';

/**
 * DC3, segunda tanda: /inventory, /transactions, /events, /activity y
 * /companies/:id.
 *
 * Los dobles de aqui NO son libres: el test de abajo que compara los campos de
 * cada filtro contra `schema.paths` del modelo REAL existe porque un doble que
 * yo escribo no puede contradecirme. Asi fue como se colo `$createdAt` en
 * gatherCompanies y en el asistente: los dos pasaban todos sus tests mientras
 * devolvian cero para siempre.
 */

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCompany,
  companyIndex,
  inventoryRow,
  transactionRow,
  eventRow,
  activityRow,
  companyDetailBody,
} = require('../helpers/platformConsole');

const {
  platformInventory,
  platformTransactions,
  platformEvents,
  platformActivity,
  platformCompanyDetail,
} = require('../controller/platform');

const StaffActivityLogModel = require('../models/StaffActivityLog');

const makeResponse = () => {
  const response = { statusCode: 200, body: null };
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (body) => { response.body = body; return response; };
  return response;
};

/** Dos compañias: una que cruza a SQL y otra que no. */
const CROSSWALK_DEPS = {
  Company: {
    find: () => ({ select: () => ({ lean: async () => [
      { _id: 'mongoA', company_name: 'Acme' },
      { _id: 'mongoB', company_name: 'Beta' },
    ] }) }),
  },
  CompanySubscription: {
    find: () => ({ select: () => ({ lean: async () => [
      { company: 'mongoA', sql_company_id: 7 },
    ] }) }),
  },
};

const sqlCompanyRows = [{ company_id: 7, company_name: 'Acme' }];

// ─────────────────────────────────────────────────────────── helpers puros ───

describe('resolver la compañia de una fila', () => {
  const index = companyIndex([{ id: 'mongoA', name: 'Acme' }]);

  test('resuelve por id de Mongo', () => {
    assert.deepEqual(resolveCompany('mongoA', index), {
      companyId: 'mongoA', companyName: 'Acme', companyRef: 'mongoA',
    });
  });

  // `Transaction.company` se escribe con `new Transaction(request.body)`, asi
  // que a veces lleva el nombre. Si no se probara tambien por nombre, esas
  // filas saldrian huerfanas.
  test('resuelve por nombre, sin distinguir mayusculas', () => {
    assert.equal(resolveCompany('acme', index).companyId, 'mongoA');
  });

  // Lo importante de esta funcion no es lo que resuelve: es lo que se NIEGA a
  // resolver. Una fila atribuida al cliente equivocado le enseña el movimiento
  // de una empresa a otra.
  test('lo que no casa va a null y conserva el valor crudo', () => {
    assert.deepEqual(resolveCompany('Desconocida', index), {
      companyId: null, companyName: null, companyRef: 'Desconocida',
    });
  });

  test('vacio no inventa un companyRef', () => {
    assert.equal(resolveCompany('', index).companyRef, null);
  });
});

describe('forma de las filas', () => {
  test('inventario: warehouse 0 es fuera, cualquier otra cosa es almacen', () => {
    assert.equal(inventoryRow({ row: { warehouse: 0 } }).status, 'out');
    assert.equal(inventoryRow({ row: { warehouse: 1 } }).status, 'in_warehouse');
  });

  // Mismo motivo que `revenue30dCents`: ningun modelo de transaccion guarda el
  // importe. Un 0 diria "fue de cero dolares", que es una frase distinta.
  test('transaccion: el importe es null, nunca 0', () => {
    const row = transactionRow({ doc: { _id: 'tx1', type: 'rental' } });
    assert.equal(row.amountCents, null);
    assert.notEqual(row.amountCents, 0);
  });

  test('transaccion: la fecha sale de created_at antes que de date', () => {
    const at = transactionRow({ doc: { created_at: 1763000000000, date: '2020-01-01' } }).at;
    assert.equal(at, new Date(1763000000000).toISOString());
  });

  test('evento: nombre y fechas salen de eventInfoDetail', () => {
    const row = eventRow({ doc: { _id: 'e1', active: true, eventInfoDetail: { eventName: 'Expo' } } });
    assert.equal(row.name, 'Expo');
    assert.equal(row.active, true);
  });

  test('actividad: la fecha es timestamp', () => {
    const when = new Date('2026-11-20T10:00:00.000Z');
    assert.equal(activityRow({ doc: { timestamp: when } }).at, when.toISOString());
  });
});

// ─────────────────────────────────────────────────────── rutas completas ────

describe('GET /api/platform/inventory', () => {
  const deps = (capture) => ({
    ...CROSSWALK_DEPS,
    query: async (sql, params) => {
      if (/FROM company_info/.test(sql)) return [sqlCompanyRows];
      capture.push({ sql, params });
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 2 }]];
      return [[
        { item_id: 1, serial_number: 'SN1', warehouse: 0, company_name: 'Acme', location: 'Miami' },
        { item_id: 2, serial_number: 'SN2', warehouse: 1, company_name: 'Sin cruce', location: 'Dallas' },
      ]];
    },
  });

  test('devuelve filas con su compañia y el total de verdad', async () => {
    const capture = [];
    const response = makeResponse();
    await platformInventory(deps(capture))({ query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.total, 2);
    assert.equal(response.body.data[0].companyId, 'mongoA');
    assert.equal(response.body.data[0].status, 'out');
    // La segunda no cruza: sin compañia, pero la fila existe y se ve.
    assert.equal(response.body.data[1].companyId, null);
  });

  // Si una compañia no cruza a SQL, filtrar por ella NO puede ser "sin
  // filtro": eso devolveria el inventario de todos los clientes a quien pidio
  // el de uno.
  test('companyId que no cruza a SQL devuelve vacio, no todo', async () => {
    const capture = [];
    const response = makeResponse();
    await platformInventory(deps(capture))({ query: { companyId: 'mongoB' } }, response);
    assert.ok(capture.every((c) => /1 = 0/.test(c.sql)), 'el filtro tiene que ser imposible, no ausente');
  });

  test('el limite se pasa como parametro, no interpolado', async () => {
    const capture = [];
    await platformInventory(deps(capture))({ query: { limit: '5' } }, makeResponse());
    const page = capture.find((c) => /LIMIT \? OFFSET \?/.test(c.sql));
    assert.ok(page, 'LIMIT y OFFSET tienen que ir con placeholders');
    assert.deepEqual(page.params.slice(-2), [5, 0]);
  });
});

describe('GET /api/platform/transactions', () => {
  const docs = [
    { _id: 'tx1', company: 'mongoA', type: 'rental', created_at: 2 },
    { _id: 'tx2', company: 'Acme', type: 'deposit', created_at: 1 },
    { _id: 'tx3', company: 'Fantasma', type: 'fee', created_at: 0 },
  ];
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: async () => [sqlCompanyRows],
    Transaction: {
      countDocuments: async (f) => { capture.count = f; return docs.length; },
      find: (f) => {
        capture.filter = f;
        return { sort: (s) => { capture.sort = s; return { skip: () => ({ limit: () => ({ lean: async () => docs }) }) }; } };
      },
    },
  });

  test('resuelve la compañia tanto por id como por nombre', async () => {
    const response = makeResponse();
    await platformTransactions(deps())({ query: {} }, response);
    assert.equal(response.body.data[0].companyId, 'mongoA');
    assert.equal(response.body.data[1].companyId, 'mongoA');
    assert.equal(response.body.data[2].companyId, null);
    assert.equal(response.body.data[2].companyRef, 'Fantasma');
  });

  test('filtrar por compañia busca el id Y el nombre', async () => {
    const capture = {};
    await platformTransactions(deps(capture))({ query: { companyId: 'mongoA' } }, makeResponse());
    assert.deepEqual(capture.filter.company.$in.sort(), ['Acme', 'mongoA'].sort());
  });

  test('ordena por created_at descendente', async () => {
    const capture = {};
    await platformTransactions(deps(capture))({ query: {} }, makeResponse());
    assert.equal(capture.sort.created_at, -1);
  });
});

describe('GET /api/platform/events', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: async () => [sqlCompanyRows],
    Event: {
      countDocuments: async () => 1,
      find: (f) => {
        capture.filter = f;
        return { sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [
          { _id: 'e1', company_id: 'mongoA', active: true, eventInfoDetail: { eventName: 'Expo' }, deviceSetup: [1, 2] },
        ] }) }) }) };
      },
    },
  });

  // `company` se escribe con cuatro cosas distintas segun el camino
  // (controller/event.js 370, 574, 698, 721). `company_id` es el unico fiable.
  test('filtra por company_id, nunca por company', async () => {
    const capture = {};
    await platformEvents(deps(capture))({ query: { companyId: 'mongoA' } }, makeResponse());
    assert.equal(capture.filter.company_id, 'mongoA');
    assert.equal(capture.filter.company, undefined, 'company no identifica a nadie');
  });

  test('active=false filtra los terminados', async () => {
    const capture = {};
    await platformEvents(deps(capture))({ query: { active: 'false' } }, makeResponse());
    assert.equal(capture.filter.active, false);
  });
});

describe('GET /api/platform/activity', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: async () => [sqlCompanyRows],
    StaffActivityLog: {
      countDocuments: async () => 1,
      find: (f) => {
        capture.filter = f;
        return { sort: (s) => { capture.sort = s; return { skip: () => ({ limit: () => ({ lean: async () => [
          { _id: 'a1', company_id: 'mongoA', timestamp: new Date('2026-11-24T00:00:00.000Z'), action: 'READ' },
        ] }) }) }; } };
      },
    },
  });

  test('filtra y ordena por timestamp', async () => {
    const capture = {};
    const response = makeResponse();
    await platformActivity(deps(capture))({ query: {} }, response);
    assert.ok(capture.filter.timestamp?.$gte instanceof Date);
    assert.equal(capture.sort.timestamp, -1);
    assert.equal(response.body.filters.range, '30d');
  });

  test('un rango invalido cae a 30d, no a un error', async () => {
    const response = makeResponse();
    await platformActivity(deps())({ query: { range: 'siempre' } }, response);
    assert.equal(response.body.filters.range, '30d');
  });
});

describe('GET /api/platform/companies/:id', () => {
  const deps = {
    ...CROSSWALK_DEPS,
    query: async (sql) => {
      if (/FROM company_info/.test(sql)) return [sqlCompanyRows];
      if (/GROUP BY company_id/.test(sql)) return [[{ company_id: 7, total: 4, out_now: 1 }]];
      return [[]];
    },
    StaffActivityLog: {
      aggregate: async () => [],
      countDocuments: async () => 3,
    },
    Event: { countDocuments: async () => 2 },
    Transaction: { countDocuments: async () => 5 },
  };

  test('devuelve la ficha con los conteos', async () => {
    const response = makeResponse();
    const d = { ...deps, CompanySubscription: {
      ...CROSSWALK_DEPS.CompanySubscription,
      findOne: () => ({ lean: async () => ({ plan: 'Pro', status: 'active' }) }),
    } };
    await platformCompanyDetail(d)({ params: { id: 'mongoA' }, query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.id, 'mongoA');
    assert.equal(response.body.data.subscription.plan, 'Pro');
    assert.deepEqual(response.body.data.counts, { events: 2, transactions: 5, activity30d: 3 });
  });

  test('un id que no existe es 404, no una ficha vacia', async () => {
    const response = makeResponse();
    const d = { ...deps, CompanySubscription: {
      ...CROSSWALK_DEPS.CompanySubscription, findOne: () => ({ lean: async () => null }),
    } };
    await platformCompanyDetail(d)({ params: { id: 'noexiste' }, query: {} }, response);
    assert.equal(response.statusCode, 404);
  });
});

// ──────────────────────────────────────────── el esquema real como juez ────

describe('los campos que se consultan existen en el esquema', () => {
  const paths = Object.keys(StaffActivityLogModel.schema.paths);

  // ESTE es el test que habria cogido el `$createdAt` de gatherCompanies y el
  // del asistente. Mongo no se queja de un campo inexistente: no casa con
  // nada y devuelve cero, para siempre y en silencio.
  test('StaffActivityLog tiene `timestamp` y NO tiene `createdAt`', () => {
    assert.ok(paths.includes('timestamp'), 'el campo de fecha es `timestamp`');
    assert.ok(
      !paths.includes('createdAt'),
      'si algun dia se añade timestamps:true, revisar las consultas que asumen `timestamp`'
    );
  });

  test('ni el controlador ni los helpers consultan createdAt sobre el log', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'controller', 'platform.js'), 'utf8');
    const live = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.doesNotMatch(
      live,
      /\$createdAt|createdAt:\s*-?1|createdAt:\s*\{/,
      'StaffActivityLog no tiene createdAt: filtrar u ordenar por ahi devuelve cero sin error'
    );
  });

  test('companyDetailBody no inventa un importe', () => {
    const body = companyDetailBody({ row: { id: 'x', revenue30dCents: null } });
    assert.equal(body.data.revenue30dCents, null);
  });
});
