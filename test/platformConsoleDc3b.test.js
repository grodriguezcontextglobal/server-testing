'use strict';

/**
 * DC3, segunda tanda: /inventory, /transactions, /events, /activity y
 * /companies/:id, con la forma que lee el console
 * (FRONTEND_console_endpoints_2026-11-25.md).
 *
 * Los dobles de aqui NO son libres: el bloque final compara contra el esquema
 * REAL de mongoose, porque un doble que yo escribo no puede contradecirme. Asi
 * fue como se colo `$createdAt` en gatherCompanies y en el asistente: los dos
 * pasaban todos sus tests mientras devolvian cero para siempre.
 */

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCompany,
  companyIndex,
  INVENTORY_STATUS,
  EVENT_STATUS,
  filterSupport,
  eventStatus,
  activityCategory,
  createdAtFromId,
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
const CompanyModel = require('../models/Company');
const EventModel = require('../models/Event');

const makeResponse = () => {
  const response = { statusCode: 200, body: null };
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (body) => { response.body = body; return response; };
  return response;
};

const lean = (value) => ({ lean: async () => value });
const selectLean = (value) => ({ select: () => lean(value) });

/** Dos compañias: una que cruza a SQL y otra que no. */
const CROSSWALK_DEPS = {
  Company: {
    find: () => selectLean([
      { _id: 'mongoA', company_name: 'Acme' },
      { _id: 'mongoB', company_name: 'Beta' },
    ]),
  },
  CompanySubscription: {
    find: () => selectLean([{ company: 'mongoA', sql_company_id: 7 }]),
  },
};

const sqlCompanyRows = [{ company_id: 7, company_name: 'Acme' }];

// ─────────────────────────────────────────────────────────── helpers puros ───

describe('resolver la compañia de una fila', () => {
  const index = companyIndex([{ id: 'mongoA', name: 'Acme' }]);

  test('resuelve por id y por nombre', () => {
    assert.equal(resolveCompany('mongoA', index).companyId, 'mongoA');
    assert.equal(resolveCompany('acme', index).companyId, 'mongoA');
  });

  // Lo importante no es lo que resuelve: es lo que se NIEGA a resolver. Una
  // fila atribuida al cliente equivocado le enseña el movimiento de una
  // empresa a otra.
  test('lo que no casa va a null y conserva el valor crudo', () => {
    assert.deepEqual(resolveCompany('Desconocida', index), {
      companyId: null, companyName: null, companyRef: 'Desconocida',
    });
  });
});

describe('vocabularios que el servidor no sostiene enteros', () => {
  test('inventario sostiene available y assigned, no lost ni in_repair', () => {
    assert.deepEqual(INVENTORY_STATUS.supported, ['available', 'assigned']);
    assert.deepEqual(INVENTORY_STATUS.unmeasured, ['lost', 'in_repair']);
  });

  // Pedir `lost` no puede devolver "cero perdidos": tiene que decir que eso no
  // se registra, para que el desplegable lo desactive en vez de mentir.
  test('pedir un valor no medido se declara, no se aplica', () => {
    const f = filterSupport(INVENTORY_STATUS, 'lost');
    assert.equal(f.applied, null);
    assert.match(f.note, /no se registra/);
  });

  test('pedir uno soportado sale como aplicado', () => {
    assert.equal(filterSupport(INVENTORY_STATUS, 'assigned').applied, 'assigned');
  });

  test('`upcoming` se calcula pero no se filtra', () => {
    assert.ok(EVENT_STATUS.unmeasured.includes('upcoming'));
    assert.equal(eventStatus({ active: true, startsAt: '2099-01-01T00:00:00Z' }), 'upcoming');
    assert.equal(eventStatus({ active: true, startsAt: '2020-01-01T00:00:00Z' }), 'live');
    assert.equal(eventStatus({ active: false, startsAt: '2099-01-01T00:00:00Z' }), 'closed');
  });
});

describe('forma de las filas', () => {
  test('inventario: warehouse 0 es assigned, el resto available', () => {
    assert.equal(inventoryRow({ row: { warehouse: 0 } }).status, 'assigned');
    assert.equal(inventoryRow({ row: { warehouse: 1 } }).status, 'available');
  });

  test('inventario: deviceName sale de item_group', () => {
    assert.equal(inventoryRow({ row: { item_group: 'Laptop 14' } }).deviceName, 'Laptop 14');
  });

  // Mismo motivo que `revenue30dCents`: ningun modelo de transaccion guarda el
  // importe. Un 0 diria "fue de cero dolares", que es otra frase.
  test('transaccion: importe y estado son null, nunca 0 ni una cadena', () => {
    const row = transactionRow({ doc: { _id: 'tx1', type: 'rental' } });
    assert.equal(row.amountCents, null);
    assert.equal(row.status, null);
  });

  test('transaccion: createdAt sale de created_at antes que de date', () => {
    const row = transactionRow({ doc: { created_at: 1763000000000, date: '2020-01-01' } });
    assert.equal(row.createdAt, new Date(1763000000000).toISOString());
  });

  // Esta lista cruza clientes. El correo del consumidor solo se lee dentro de
  // la ficha de un cliente, nunca entre todos.
  test('transaccion: NO lleva el correo del consumidor', () => {
    const row = transactionRow({ doc: { consumerInfo: { name: 'Ann', email: 'ann@x.test' } } });
    assert.equal(row.consumerName, 'Ann');
    assert.equal(row.consumerEmail, undefined);
    assert.ok(!JSON.stringify(row).includes('ann@x.test'), 'el correo no puede salir por ningun campo');
  });

  test('evento: status, devicesAssigned y los dos null', () => {
    const row = eventRow({
      doc: { _id: 'e1', active: true, eventInfoDetail: { eventName: 'Expo' }, deviceSetup: [1, 2] },
    });
    assert.equal(row.name, 'Expo');
    assert.equal(row.status, 'live');
    assert.equal(row.devicesAssigned, 2);
    assert.equal(row.devicesNotReturned, null);
    assert.equal(row.revenueCents, null);
  });

  test('actividad: fecha de timestamp, categoria mapeada, sin correo', () => {
    const when = new Date('2026-11-20T10:00:00.000Z');
    const row = activityRow({
      doc: { timestamp: when, target_model: 'Event', actor: { name: 'Ann', email: 'ann@x.test' } },
    });
    assert.equal(row.at, when.toISOString());
    assert.equal(row.category, 'event');
    assert.equal(row.actorName, 'Ann');
    assert.ok(!JSON.stringify(row).includes('ann@x.test'), 'el correo del operador solo va en /audit');
  });

  // `target_model` es texto libre por diseño, asi que el mapa es parcial. Lo
  // que no casa NO puede caer en un cajon de sastre: una fila mal clasificada
  // desaparece del filtro que le tocaba y aparece en otro.
  test('una categoria desconocida es null, no un cajon de sastre', () => {
    assert.equal(activityCategory('Inventory'), 'inventory');
    assert.equal(activityCategory('AlgoQueNadieHaVisto'), null);
  });

  test('createdAt sale del ObjectId, que lleva la fecha dentro', () => {
    assert.equal(createdAtFromId('64f1a2b3c4d5e6f7a8b9c0d1'), '2023-09-01T08:37:07.000Z');
    assert.equal(createdAtFromId('no-es-un-objectid'), null);
  });
});

// ─────────────────────────────────────────────────────── rutas completas ────

describe('GET /api/platform/inventory', () => {
  const deps = (capture = []) => ({
    ...CROSSWALK_DEPS,
    query: async (sql, params) => {
      if (/FROM company_info/.test(sql)) return [sqlCompanyRows];
      capture.push({ sql, params });
      if (/SUM\(/.test(sql)) return [[{ total: 2, available: 1, assigned: 1 }]];
      if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 2 }]];
      return [[
        { item_id: 1, serial_number: 'SN1', item_group: 'Laptop', warehouse: 0, company_name: 'Acme', location: 'Miami' },
        { item_id: 2, serial_number: 'SN2', item_group: 'Tablet', warehouse: 1, company_name: 'Sin cruce', location: 'Dallas' },
      ]];
    },
  });

  test('filas, total y totals con lost en null', async () => {
    const response = makeResponse();
    await platformInventory(deps())({ query: {} }, response);

    assert.equal(response.body.total, 2);
    assert.deepEqual(response.body.totals, { total: 2, available: 1, assigned: 1, lost: null });
    assert.equal(response.body.data[0].companyId, 'mongoA');
    assert.equal(response.body.data[0].status, 'assigned');
    assert.equal(response.body.data[1].companyId, null, 'la que no cruza se ve, sin compañia');
  });

  test('filters declara lo que el servidor no mide', async () => {
    const response = makeResponse();
    await platformInventory(deps())({ query: { status: 'lost' } }, response);
    assert.equal(response.body.filters.status.applied, null);
    assert.deepEqual(response.body.filters.status.unmeasured, ['lost', 'in_repair']);
  });

  // Pedir `lost` no puede traducirse a un WHERE: devolveria cero filas y se
  // leeria como "no hay ninguno perdido".
  test('un estado no medido no entra en el SQL', async () => {
    const capture = [];
    await platformInventory(deps(capture))({ query: { status: 'lost' } }, makeResponse());
    // Solo el WHERE: la consulta de totales lleva `SUM(i.warehouse ...)`
    // siempre, y eso no es un filtro.
    assert.ok(
      capture.every((c) => !/warehouse/.test(c.sql.split('WHERE')[1] || '')),
      'un estado no medido no puede convertirse en un filtro de warehouse'
    );
  });

  test('available filtra por warehouse <> 0', async () => {
    const capture = [];
    await platformInventory(deps(capture))({ query: { status: 'available' } }, makeResponse());
    assert.ok(capture.some((c) => /WHERE[^]*warehouse <> 0/.test(c.sql)));
  });

  // Los totales son el reparto del conjunto, no de la vista: no pueden cambiar
  // al pulsar un filtro de estado.
  test('los totales se calculan sin la clausula de estado', async () => {
    const capture = [];
    await platformInventory(deps(capture))({ query: { status: 'assigned' } }, makeResponse());
    const breakdown = capture.find((c) => /SUM\(/.test(c.sql));
    const wherePart = (breakdown.sql.split('WHERE')[1] || '');
    assert.ok(!/warehouse/.test(wherePart), 'la consulta de totales no lleva el filtro de estado');
  });

  // Una compañia que no cruza a SQL no tiene inventario que enseñar. `1=0` y
  // no "sin filtro": lo segundo devolveria el inventario de TODOS.
  test('companyId que no cruza devuelve vacio, no todo', async () => {
    const capture = [];
    await platformInventory(deps(capture))({ query: { companyId: 'mongoB' } }, makeResponse());
    assert.ok(capture.every((c) => /1 = 0/.test(c.sql)));
  });

  test('el limite va como parametro, no interpolado', async () => {
    const capture = [];
    await platformInventory(deps(capture))({ query: { limit: '5' } }, makeResponse());
    const page = capture.find((c) => /LIMIT \? OFFSET \?/.test(c.sql));
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
      countDocuments: async () => docs.length,
      find: (f) => {
        capture.filter = f;
        return { sort: (s) => { capture.sort = s; return { skip: () => ({ limit: () => lean(docs) }) }; } };
      },
    },
  });

  test('resuelve por id y por nombre, y lo que no casa va a null', async () => {
    const response = makeResponse();
    await platformTransactions(deps())({ query: {} }, response);
    assert.equal(response.body.data[0].companyId, 'mongoA');
    assert.equal(response.body.data[1].companyId, 'mongoA');
    assert.equal(response.body.data[2].companyId, null);
    assert.equal(response.body.data[2].companyRef, 'Fantasma');
  });

  test('totals: el conteo es real, el dinero null', async () => {
    const response = makeResponse();
    await platformTransactions(deps())({ query: {} }, response);
    assert.deepEqual(response.body.totals, {
      count: 3, volumeCents: null, refundsCents: null, failed: null,
    });
  });

  test('filtra por tipo', async () => {
    const capture = {};
    await platformTransactions(deps(capture))({ query: { type: 'refund' } }, makeResponse());
    assert.equal(capture.filter.type, 'refund');
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
      countDocuments: async (f) => { (capture.counts = capture.counts || []).push(f); return 1; },
      find: (f) => {
        capture.filter = f;
        return { sort: () => ({ skip: () => ({ limit: () => lean([
          { _id: 'e1', company_id: 'mongoA', active: true, eventInfoDetail: { eventName: 'Expo' }, deviceSetup: [1, 2] },
        ]) }) }) };
      },
    },
  });

  // `company` se escribe con cuatro cosas distintas segun el camino. Solo
  // `company_id` identifica a alguien.
  test('filtra por company_id, nunca por company', async () => {
    const capture = {};
    await platformEvents(deps(capture))({ query: { companyId: 'mongoA' } }, makeResponse());
    assert.equal(capture.filter.company_id, 'mongoA');
    assert.equal(capture.filter.company, undefined);
  });

  // La coleccion `Event` guarda mas de una cosa y `type` llega del cuerpo de
  // la peticion. Sin este filtro la lista devuelve de mas y Mongo no se queja.
  test('solo type=event, en la lista y en los dos contadores', async () => {
    const capture = {};
    await platformEvents(deps(capture))({ query: {} }, makeResponse());
    assert.equal(capture.filter.type, 'event');
    assert.ok(capture.counts.length >= 2, 'total y live');
    for (const f of capture.counts) assert.equal(f.type, 'event');
  });

  test('status=closed filtra los terminados', async () => {
    const capture = {};
    await platformEvents(deps(capture))({ query: { status: 'closed' } }, makeResponse());
    assert.equal(capture.filter.active, false);
  });

  test('status=upcoming no se traduce a filtro y se declara', async () => {
    const capture = {};
    const response = makeResponse();
    await platformEvents(deps(capture))({ query: { status: 'upcoming' } }, response);
    assert.equal(capture.filter.active, undefined);
    assert.equal(response.body.filters.status.applied, null);
  });

  test('totals: live real, el resto null', async () => {
    const response = makeResponse();
    await platformEvents(deps())({ query: {} }, response);
    assert.equal(response.body.totals.live, 1);
    assert.equal(response.body.totals.upcoming, null);
    assert.equal(response.body.totals.revenueCents, null);
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
        return { sort: (s) => { capture.sort = s; return { skip: () => ({ limit: () => lean([
          { _id: 'a1', company_id: 'mongoA', timestamp: new Date('2026-11-24T00:00:00.000Z'), target_model: 'Item' },
        ]) }) }; } };
      },
    },
  });

  test('filtra y ordena por timestamp, y mapea la categoria', async () => {
    const capture = {};
    const response = makeResponse();
    await platformActivity(deps(capture))({ query: {} }, response);
    assert.ok(capture.filter.timestamp?.$gte instanceof Date);
    assert.equal(capture.sort.timestamp, -1);
    assert.equal(response.body.data[0].category, 'inventory');
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
    Company: {
      find: () => selectLean([
        { _id: 'mongoA', company_name: 'Acme', employees: [{ active: true }] },
        { _id: 'mongoB', company_name: 'Beta' },
      ]),
      findOne: () => selectLean({ phone: { main: '555-1017' } }),
    },
    query: async (sql) => {
      if (/FROM company_info/.test(sql)) return [sqlCompanyRows];
      if (/GROUP BY company_id/.test(sql)) return [[{ company_id: 7, total: 4, out_now: 1 }]];
      if (/members_info/.test(sql)) return [[{ total: 12 }]];
      return [[]];
    },
    StaffActivityLog: { aggregate: async () => [] },
    Event: { countDocuments: async () => 2 },
    User: { countDocuments: async () => 9 },
    Transaction: { countDocuments: async () => 5 },
  };

  test('registro PLANO con los campos que lee el console', async () => {
    const response = makeResponse();
    await platformCompanyDetail(deps)({ params: { id: 'mongoA' }, query: {} }, response);

    const data = response.body.data;
    assert.equal(response.statusCode, 200);
    assert.equal(data.id, 'mongoA');
    assert.equal(data.mongoId, 'mongoA');
    assert.equal(data.sqlId, 7);
    assert.equal(data.phone, '555-1017');
    assert.equal(data.eventsActive, 2);
    assert.equal(data.membersCount, 12);
    assert.equal(data.consumersCount, 9);
    // Plano: nada anidado que el console tenga que desenvolver.
    assert.equal(data.subscription, undefined);
    assert.equal(data.counts, undefined);
    // Y el estado sale de la MISMA fila que la lista, no recalculado.
    assert.equal(data.status, 'active');
    assert.equal(data.devicesOverdue, null);
    assert.equal(data.revenue30dCents, null);
  });

  // Sin cruce a SQL no hay alumnos que contar. Cero afirmaria que no los
  // tiene; null dice que no lo sabemos.
  test('una compañia sin cruce a SQL devuelve membersCount null, no 0', async () => {
    const response = makeResponse();
    await platformCompanyDetail(deps)({ params: { id: 'mongoB' }, query: {} }, response);
    assert.equal(response.body.data.sqlId, null);
    assert.equal(response.body.data.membersCount, null);
  });

  // `eventsActive` es el mismo numero que la pestaña de eventos del cliente:
  // si uno acota por type y el otro no, dos pantallas dicen cifras distintas.
  test('eventsActive cuenta solo type=event', async () => {
    const capture = {};
    const spy = {
      ...deps,
      Event: { countDocuments: async (f) => { capture.filter = f; return 2; } },
    };
    await platformCompanyDetail(spy)({ params: { id: 'mongoA' }, query: {} }, makeResponse());
    assert.equal(capture.filter.type, 'event');
    assert.equal(capture.filter.active, true);
    assert.equal(capture.filter.company_id, 'mongoA');
  });

  test('un id que no existe es 404, no una ficha vacia', async () => {
    const response = makeResponse();
    await platformCompanyDetail(deps)({ params: { id: 'noexiste' }, query: {} }, response);
    assert.equal(response.statusCode, 404);
  });
});

// ──────────────────────────────────────────── el esquema real como juez ────

describe('los campos que se consultan existen en el esquema', () => {
  // ESTE es el test que habria cogido el `$createdAt` de gatherCompanies y el
  // del asistente. Mongo no se queja de un campo inexistente: no casa con
  // nada y devuelve cero, para siempre y en silencio.
  test('StaffActivityLog tiene `timestamp` y NO tiene `createdAt`', () => {
    const paths = Object.keys(StaffActivityLogModel.schema.paths);
    assert.ok(paths.includes('timestamp'));
    assert.ok(!paths.includes('createdAt'));
  });

  // Por eso `createdAt` del cliente se deriva del ObjectId: si alguien añade
  // `timestamps: true` a Company, este test avisa de que ya hay un camino
  // mejor y de que los documentos viejos seguirian sin el campo.
  test('Company tampoco declara createdAt', () => {
    assert.ok(!Object.keys(CompanyModel.schema.paths).includes('createdAt'));
  });

  test('el controlador no consulta createdAt sobre el log', () => {
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

  // `type` existe en el esquema con default 'event', pero el unico punto de
  // escritura es `new Event(request.body)`: el valor lo pone el cliente. Si el
  // campo desapareciera del esquema, acotar por el devolveria cero en silencio
  // —el mismo fallo que `$createdAt`— y este test avisaria antes.
  test('Event declara `type`', () => {
    assert.ok(Object.keys(EventModel.schema.paths).includes('type'));
  });

  // Toda consulta a Event desde el console tiene que acotar por type. Sin el
  // filtro la respuesta sale de mas, que en una lista paginada no se ve.
  test('ninguna consulta a Event se deja el filtro de tipo', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'controller', 'platform.js'), 'utf8');
    const calls = source.match(/d\.Event\.(countDocuments|find)\(([^;]*?)\)/gs) || [];
    assert.ok(calls.length >= 3, 'se esperaban al menos tres consultas a Event');
    for (const call of calls) {
      assert.match(
        call,
        // O nombra EVENT_TYPE, o reusa el `filter` que ya lo lleva (los tests
        // de arriba comprueban que ese objeto se construye con el tipo).
        /EVENT_TYPE|filter\)|\.\.\.filter/,
        `consulta a Event sin acotar por type: ${call.replace(/\s+/g, ' ').slice(0, 90)}`
      );
    }
  });

  test('companyDetailBody no inventa un importe', () => {
    const body = companyDetailBody({ row: { id: 'x', revenue30dCents: null } });
    assert.equal(body.data.revenue30dCents, null);
  });
});
