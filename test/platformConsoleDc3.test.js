'use strict';

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  companyStatus,
  companyRow,
  filterCompanies,
  sortCompanies,
  readPaging,
  readRange,
  listBody,
  summaryBody,
  isPlatformResource,
  isCompanyResource,
  MAX_LIMIT,
} = require('../helpers/platformConsole');

const { platformCompanies, platformSummary } = require('../controller/platform');

const company = (id, name, employees = 1, owner = {}) => ({
  _id: id,
  company_name: name,
  owner: { first_name: 'Ann', last_name: 'Doe', email: `owner@${id}.test`, ...owner },
  employees: Array.from({ length: employees }, () => ({ active: true })),
});

const makeResponse = () => {
  const response = { statusCode: 200, body: null };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
};

describe('estado de un cliente', () => {
  test('sin suscripcion y sin vencidos es activo', () => {
    assert.equal(companyStatus({}), 'active');
  });

  test('dispositivos vencidos lo ponen en riesgo', () => {
    assert.equal(companyStatus({ devicesOverdue: 3 }), 'at_risk');
  });

  test('past_due es en riesgo', () => {
    assert.equal(companyStatus({ subscriptionStatus: 'past_due' }), 'at_risk');
  });

  test('trialing es trial', () => {
    assert.equal(companyStatus({ subscriptionStatus: 'trialing' }), 'trial');
  });

  // Una compañia pausada con vencidos SIGUE pausada: pintarla "en riesgo"
  // mandaria a alguien a perseguir a un cliente que ya se fue.
  test('cancelada manda sobre los vencidos', () => {
    assert.equal(
      companyStatus({ subscriptionStatus: 'canceled', devicesOverdue: 9 }),
      'paused'
    );
  });

  test('cancelled con dos eles tambien', () => {
    assert.equal(companyStatus({ subscriptionStatus: 'cancelled' }), 'paused');
  });

  // LOS DOS "incomplete" DE STRIPE, que se parecen y no son lo mismo.
  // `incomplete` es el primer cobro aun sin cuajar: queda ventana, alguien
  // deberia llamar. `incomplete_expired` es esa ventana ya cerrada.
  test('incomplete es en riesgo: todavia se puede salvar', () => {
    assert.equal(companyStatus({ subscriptionStatus: 'incomplete' }), 'at_risk');
  });

  // EL HUECO QUE ENCONTRO EL DASHBOARD (2026-11-20). Sin nombrarlo caia al
  // `active` del fondo: un cliente que nunca llego a pagar salia sano.
  test('incomplete_expired es pausada, no activa', () => {
    assert.equal(
      companyStatus({ subscriptionStatus: 'incomplete_expired' }),
      'paused'
    );
  });

  // Y manda sobre los vencidos, por la misma razon que `canceled`: la
  // suscripcion no puede revivir, asi que no hay a quien perseguir.
  test('incomplete_expired manda sobre los vencidos', () => {
    assert.equal(
      companyStatus({ subscriptionStatus: 'incomplete_expired', devicesOverdue: 4 }),
      'paused'
    );
  });

  // El orden de las dos lineas es load-bearing solo si alguna pasa a comparar
  // por prefijo. Hoy las dos son igualdad exacta, y este test lo fija.
  test('incomplete_expired no se cuela por la rama de incomplete', () => {
    assert.notEqual(
      companyStatus({ subscriptionStatus: 'incomplete_expired' }),
      companyStatus({ subscriptionStatus: 'incomplete' })
    );
  });
});

describe('fila de cliente', () => {
  test('lleva los nombres de campo que espera su tabla', () => {
    const row = companyRow({
      company: company('c1', 'Acme Corp', 3),
      counts: { deviceCount: 40, devicesOut: 12, devicesOverdue: 0 },
      subscription: { plan: 'Pro', status: 'active' },
      lastActivityAt: new Date('2026-11-20T10:00:00Z'),
    });
    assert.deepEqual(Object.keys(row).sort(), [
      'currency', 'deviceCount', 'devicesOut', 'devicesOverdue', 'id',
      'lastActivityAt', 'name', 'ownerEmail', 'ownerName', 'plan',
      'revenue30dCents', 'staffCount', 'status',
    ]);
    assert.equal(row.staffCount, 3);
    assert.equal(row.ownerName, 'Ann Doe');
    assert.equal(row.lastActivityAt, '2026-11-20T10:00:00.000Z');
  });

  // NINGUNO de los dos modelos de transaccion guarda el importe: el dinero
  // vive en Stripe. null dice "no lo se"; 0 diria "este cliente no facturo",
  // que es una frase distinta y falsa.
  test('el dinero es null, nunca cero', () => {
    const row = companyRow({ company: company('c1', 'Acme Corp') });
    assert.equal(row.revenue30dCents, null);
  });

  test('sin cruce con SQL, los conteos de inventario son desconocidos', () => {
    const row = companyRow({ company: company('c1', 'Acme Corp'), counts: {} });
    assert.equal(row.deviceCount, null);
    assert.equal(row.devicesOut, null);
  });

  test('sin suscripcion, el plan es Free', () => {
    assert.equal(companyRow({ company: company('c1', 'X') }).plan, 'Free');
  });

  test('el personal inactivo no cuenta', () => {
    const row = companyRow({
      company: { _id: 'c1', company_name: 'X', employees: [{ active: true }, { active: false }] },
    });
    assert.equal(row.staffCount, 1);
  });

  test('sin fecha de actividad, null y no una fecha inventada', () => {
    assert.equal(companyRow({ company: company('c1', 'X') }).lastActivityAt, null);
  });
});

describe('filtro de la lista de clientes', () => {
  const rows = [
    companyRow({ company: company('c1', 'Acme Corp'), subscription: { plan: 'Pro' } }),
    companyRow({ company: company('c2', 'Beta LLC'), subscription: { plan: 'Free' } }),
    companyRow({
      company: company('c3', 'Gamma SA'),
      subscription: { plan: 'Pro', status: 'past_due' },
    }),
  ];

  test('sin parametros no filtra nada', () => {
    assert.equal(filterCompanies(rows, {}).length, 3);
  });

  test('busca por nombre, sin importar mayusculas', () => {
    assert.deepEqual(filterCompanies(rows, { search: 'acme' }).map((r) => r.id), ['c1']);
  });

  test('busca tambien por el correo del dueño', () => {
    assert.deepEqual(filterCompanies(rows, { search: 'owner@c2' }).map((r) => r.id), ['c2']);
  });

  test('filtra por estado calculado', () => {
    assert.deepEqual(filterCompanies(rows, { status: 'at_risk' }).map((r) => r.id), ['c3']);
  });

  test('"all" no es un filtro', () => {
    assert.equal(filterCompanies(rows, { status: 'all', plan: 'all' }).length, 3);
  });

  // El trial es un estado, no un plan: "Pro" tiene que casar con "Pro (trial)".
  test('el plan casa por prefijo', () => {
    const conTrial = [
      ...rows,
      companyRow({ company: company('c4', 'Delta'), subscription: { plan: 'Pro (trial)' } }),
    ];
    assert.deepEqual(
      filterCompanies(conTrial, { plan: 'Pro' }).map((r) => r.id),
      ['c1', 'c3', 'c4']
    );
  });

  test('ordena por nombre', () => {
    const revueltas = [rows[2], rows[0], rows[1]];
    assert.deepEqual(sortCompanies(revueltas).map((r) => r.name), [
      'Acme Corp', 'Beta LLC', 'Gamma SA',
    ]);
  });
});

describe('paginacion', () => {
  test('por defecto, pagina 1 y 25', () => {
    assert.deepEqual(readPaging({}), { page: 1, limit: 25 });
  });

  // Pedir mas no es un error: te dan el tope, y `limit` en la respuesta dice
  // lo que te dieron, para que la cifra que pinta la pantalla sea la real.
  test('pedir mas del tope da el tope', () => {
    assert.equal(readPaging({ limit: 5000 }).limit, MAX_LIMIT);
  });

  test('basura en los parametros cae a los valores por defecto', () => {
    assert.deepEqual(readPaging({ page: 'x', limit: -4 }), { page: 1, limit: 25 });
  });

  test('total es el total, no lo que cabe en la pagina', () => {
    const body = listBody({ rows: [1, 2], page: 1, limit: 2, total: 57 });
    assert.equal(body.total, 57);
    assert.equal(body.data.length, 2);
    assert.equal(body.ok, true);
  });

  test('totals y filters solo salen si los hay', () => {
    const sin = listBody({ rows: [], page: 1, limit: 25, total: 0 });
    assert.ok(!('totals' in sin));
    assert.ok(!('filters' in sin));
    const con = listBody({ rows: [], page: 1, limit: 25, total: 0, totals: { a: 1 } });
    assert.deepEqual(con.totals, { a: 1 });
  });
});

describe('rango de /summary', () => {
  test('acepta los tres', () => {
    for (const r of ['7d', '30d', '90d']) assert.equal(readRange(r), r);
  });

  // Un rango desconocido no es un error: es 30d. Una pantalla no deberia
  // romperse por un parametro de la URL.
  test('cualquier otra cosa es 30d', () => {
    assert.equal(readRange('99d'), '30d');
    assert.equal(readRange(undefined), '30d');
  });
});

describe('lista cerrada de recursos', () => {
  test('people NO es un recurso de plataforma', () => {
    assert.equal(isPlatformResource('people'), false);
  });

  // staff per-cliente si, entre clientes no: una lista de todas las cuentas de
  // todos los clientes con su estado de MFA es lo mas util de este producto
  // para quien no deberia tenerla.
  test('staff existe dentro de un cliente y no entre clientes', () => {
    assert.equal(isCompanyResource('staff'), true);
    assert.equal(isPlatformResource('staff'), false);
  });

  test('members y consumers solo dentro de un cliente', () => {
    for (const r of ['members', 'consumers']) {
      assert.equal(isCompanyResource(r), true);
      assert.equal(isPlatformResource(r), false);
    }
  });

  test('un recurso inventado no vale en ninguno de los dos', () => {
    assert.equal(isPlatformResource('secrets'), false);
    assert.equal(isCompanyResource('secrets'), false);
  });
});

describe('GET /api/platform/companies', () => {
  const deps = {
    Company: { find: () => ({ select: () => ({ lean: async () => [
      company('c1', 'Acme Corp', 2),
      company('c2', 'Beta LLC', 1),
    ] }) }) },
    CompanySubscription: { find: () => ({ select: () => ({ lean: async () => [
      { company: 'c1', plan: 'Pro', status: 'active', sql_company_id: 7 },
    ] }) }) },
    StaffActivityLog: { aggregate: async () => [{ _id: 'c1', last: new Date('2026-11-19T08:00:00Z') }] },
    AdminUser: { countDocuments: async () => 0 },
    Event: { countDocuments: async () => 0 },
    query: async (sql) =>
      sql.includes('company_info')
        ? [[{ company_id: 7, company_name: 'Acme Corp' }, { company_id: 8, company_name: 'Beta LLC' }]]
        : [[{ company_id: 7, total: 40, out_now: 12 }]],
  };

  test('devuelve una fila por cliente, ordenadas y con el sobre acordado', async () => {
    const response = makeResponse();
    await platformCompanies(deps)({ query: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.total, 2);
    assert.deepEqual(response.body.data.map((r) => r.name), ['Acme Corp', 'Beta LLC']);
  });

  test('cruza el inventario por el id SQL', async () => {
    const response = makeResponse();
    await platformCompanies(deps)({ query: {} }, response);
    const acme = response.body.data.find((r) => r.id === 'c1');
    assert.equal(acme.deviceCount, 40);
    assert.equal(acme.devicesOut, 12);
  });

  // Cruza con SQL pero no tiene filas en item_inv: cero es un dato, no un
  // desconocido. Lo contrario —un "no se sabe" sobre algo medido— manda a
  // alguien a mirar lo que ya estaba contestado.
  test('una compañia que cruza y no tiene inventario cuenta cero', async () => {
    const response = makeResponse();
    await platformCompanies(deps)({ query: {} }, response);
    const beta = response.body.data.find((r) => r.id === 'c2');
    assert.equal(beta.deviceCount, 0);
  });

  test('el filtro de busqueda llega a la respuesta', async () => {
    const response = makeResponse();
    await platformCompanies(deps)({ query: { search: 'beta' } }, response);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.data[0].id, 'c2');
  });

  test('un fallo de la base es 500 con ok:false, no una lista vacia', async () => {
    const response = makeResponse();
    await platformCompanies({ ...deps, query: async () => { throw new Error('mysql down'); } })(
      { query: {} },
      response
    );
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.ok, false);
  });
});

describe('GET /api/platform/summary', () => {
  const deps = {
    Company: { find: () => ({ select: () => ({ lean: async () => [company('c1', 'Acme Corp')] }) }) },
    CompanySubscription: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    StaffActivityLog: { aggregate: async () => [] },
    AdminUser: { countDocuments: async (filter) => (filter.mfaEnabled ? 11 : 47) },
    Event: { countDocuments: async () => 4 },
    query: async (sql) =>
      sql.includes('company_info') ? [[{ company_id: 7, company_name: 'Acme Corp' }]] : [[]],
  };

  test('cuenta clientes, eventos vivos y MFA', async () => {
    const response = makeResponse();
    await platformSummary(deps)({ query: { range: '7d' } }, response);
    const data = response.body.data;
    assert.equal(data.range, '7d');
    assert.equal(data.rangeDays, 7);
    assert.equal(data.current.totalClients, 1);
    assert.equal(data.current.activeEvents, 4);
    assert.equal(data.current.staffAccounts, 47);
    assert.equal(data.current.staffWithMfa, 11);
  });

  // La unica pantalla del console que se puede dejar abierta en un monitor
  // compartido. Esa propiedad merece un test, no una buena intencion.
  test('no nombra a ningun cliente', async () => {
    const response = makeResponse();
    await platformSummary(deps)({ query: {} }, response);
    assert.ok(!JSON.stringify(response.body).includes('Acme Corp'));
    assert.deepEqual(response.body.data.topClientsByRevenue, []);
  });

  test('las cifras de dinero son null mientras vivan solo en Stripe', async () => {
    const response = makeResponse();
    await platformSummary(deps)({ query: {} }, response);
    assert.equal(response.body.data.current.revenueCents, null);
    assert.equal(response.body.data.previous, null);
  });
});
