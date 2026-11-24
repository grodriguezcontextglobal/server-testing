'use strict';

/**
 * El asistente de staff: el catálogo (puro) y el controlador (con dependencias
 * inyectadas, sin Mongo ni MySQL delante).
 *
 * Lo que más importa de este fichero no son los emparejamientos sino los tres
 * bloques del final: que la identidad NO sale del cuerpo, que el alcance viaja
 * dentro de cada consulta, y que una lectura sin fila de auditoría no se sirve.
 * Esas tres son las propiedades por las que este endpoint se puede añadir a un
 * servidor en certificación.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATALOG,
  UNSUPPORTED,
  MAX_QUESTION_LENGTH,
  matchQuestion,
  validateChoice,
  catalogOffer,
  checkQuestionLength,
} = require('../helpers/assistantCatalog');

const { assistantAsk } = require('../controller/assistant');

// ─────────────────────────────────────────────────────── el catálogo ────────

test('empareja preguntas en español', () => {
  assert.equal(matchQuestion('¿cuántos equipos tengo fuera?').question_id, 'company_devices_out');
  assert.equal(matchQuestion('qué eventos activos hay').question_id, 'company_events_active');
  assert.equal(matchQuestion('enséñame el personal').question_id, 'company_staff_list');
  assert.equal(matchQuestion('qué plan tengo contratado').question_id, 'company_subscription_status');
});

test('empareja preguntas en inglés', () => {
  assert.equal(matchQuestion('how many devices do we have?').question_id, 'company_inventory_summary');
  assert.equal(matchQuestion('show me active events').question_id, 'company_events_active');
  assert.equal(matchQuestion('recent activity please').question_id, 'company_activity_recent');
});

test('las tildes y las mayúsculas no cambian el resultado', () => {
  assert.equal(
    matchQuestion('CUÁNTOS EQUIPOS').question_id,
    matchQuestion('cuantos equipos').question_id
  );
});

test('gana la coincidencia más larga, no la primera del catálogo', () => {
  // "eventos activos" es más concreto que "eventos" y tiene que ganar aunque
  // las dos casen con la misma entrada: lo que se comprueba es que el peso va
  // por longitud y no por orden de declaración.
  const vago = matchQuestion('eventos');
  const concreto = matchQuestion('eventos activos');
  assert.equal(concreto.question_id, 'company_events_active');
  assert.ok(concreto.confidence > vago.confidence);
});

test('lo que no encaja es unsupported, nunca la primera entrada', () => {
  for (const texto of ['', '   ', 'hazme un café', 'asdkjfhaskdjfh', '¿quién ganó el mundial?']) {
    assert.equal(matchQuestion(texto).question_id, UNSUPPORTED, `falló con: "${texto}"`);
  }
});

test('el rango sale de la pregunta cuando la pregunta lo nombra', () => {
  assert.equal(matchQuestion('actividad de esta semana').params.range, '7d');
  assert.equal(matchQuestion('actividad del último trimestre').params.range, '90d');
  assert.equal(matchQuestion('actividad reciente').params.range, '30d'); // por defecto
});

// ──────────────────────────────────────────────── la lista cerrada ──────────

test('validateChoice rechaza un id que no está en el catálogo', () => {
  const r = validateChoice({ question_id: 'company_secrets', params: { limit: 10 } });
  assert.equal(r.question_id, UNSUPPORTED);
  assert.deepEqual(r.params, {});
});

test('validateChoice RECONSTRUYE los parámetros: lo inventado no pasa', () => {
  const r = validateChoice({
    question_id: 'company_activity_recent',
    params: { range: '7d', limit: 5, company_id: 'otra', sql: 'DROP TABLE', __proto__: {} },
  });
  assert.deepEqual(Object.keys(r.params).sort(), ['limit', 'range']);
  assert.equal(r.params.company_id, undefined);
  assert.equal(r.params.sql, undefined);
});

test('validateChoice recorta el limit al tope del servidor', () => {
  assert.equal(validateChoice({ question_id: 'company_activity_recent', params: { limit: 99999 } }).params.limit, 100);
  assert.equal(validateChoice({ question_id: 'company_activity_recent', params: { limit: -3 } }).params.limit, 25);
  assert.equal(validateChoice({ question_id: 'company_activity_recent', params: { limit: 'diez' } }).params.limit, 25);
});

test('un rango fuera del vocabulario cae al de por defecto, no es un error', () => {
  assert.equal(validateChoice({ question_id: 'company_activity_recent', params: { range: '1y' } }).params.range, '30d');
});

test('una pregunta sin parámetros no recibe ninguno', () => {
  assert.deepEqual(validateChoice({ question_id: 'company_devices_out' }).params, {});
});

test('el tope de longitud es el acordado con el dashboard', () => {
  assert.equal(MAX_QUESTION_LENGTH, 1000);
  assert.equal(checkQuestionLength('a'.repeat(1000)).ok, true);
  assert.equal(checkQuestionLength('a'.repeat(1001)).ok, false);
  assert.equal(checkQuestionLength('   ').ok, false);
});

/**
 * TRIPWIRE. No prueba una regla, protege una ausencia.
 *
 * El dinero no está guardado en ninguno de los dos modelos de transacción, y
 * `devicesOverdue` todavía no se calcula. Una pregunta del catálogo sobre
 * cualquiera de los dos contestaría con silencio, y un silencio redactado en
 * una frase se lee como un dato. Si alguien las añade antes de que los datos
 * existan, que falle aquí.
 */
test('el catálogo NO contiene preguntas cuyos datos hoy son null', () => {
  const prohibidos = /revenue|ingreso|dinero|importe|facturac|overdue|vencid/i;
  const malas = CATALOG.filter(
    (q) => prohibidos.test(q.id) || prohibidos.test(q.label) || q.keywords.some((k) => prohibidos.test(k))
  );
  assert.deepEqual(
    malas.map((q) => q.id),
    [],
    'el dinero y los equipos vencidos no se guardan todavía: una pregunta sobre ellos contesta silencio'
  );
});

test('la oferta del catálogo es legible y no filtra el funcionamiento interno', () => {
  const oferta = catalogOffer();
  assert.equal(oferta.length, CATALOG.length);
  for (const entrada of oferta) {
    assert.deepEqual(Object.keys(entrada).sort(), ['id', 'label']);
  }
});

// ──────────────────────────────────────────────────── el controlador ────────

/** Respuesta de Express, lo justo para leer el código y el cuerpo. */
const fakeResponse = () => {
  const r = { code: null, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

/** Cadena `.select().lean()` de mongoose, resuelta a un valor fijo. */
const chain = (value) => ({ select: () => ({ lean: async () => value }) });

const baseDeps = (overrides = {}) => {
  const audit = [];
  const queries = [];
  return {
    audit,
    queries,
    deps: {
      resolveCompanyContextFn: async () => ({
        ok: true,
        companyId: 12,
        access: { role_level: 1, role_type: 'admin', scoped: false, locations: [], categories: [], categoryNames: [] },
      }),
      CompanySubscription: {
        findOne: () => chain({ company: '65f0aaaaaaaaaaaaaaaaaaaa', plan: 'Pro', status: 'active', sql_company_id: '12' }),
      },
      Company: { findById: () => chain(null), findOne: () => chain(null) },
      Event: {},
      StaffActivityLog: { create: async (row) => (audit.push(row), row) },
      query: async (sql, params) => {
        queries.push({ sql, params });
        return [[{ total: 10, out_now: 4 }]];
      },
      ...overrides,
    },
  };
};

const ask = async (question, overrides = {}, request = {}) => {
  const { deps, audit, queries } = baseDeps(overrides);
  const res = fakeResponse();
  await assistantAsk(deps)(
    { body: { question }, uid: '65f0bbbbbbbbbbbbbbbbbbbb', name: 'Ana', ...request },
    res
  );
  return { res, audit, queries };
};

test('contesta una pregunta del catálogo', async () => {
  const { res } = await ask('cuántos equipos tengo');
  assert.equal(res.code, 200);
  assert.equal(res.body.question_id, 'company_inventory_summary');
  assert.deepEqual(res.body.data, { deviceCount: 10, devicesOut: 4, inWarehouse: 6 });
});

test('LA IDENTIDAD NO SALE DEL CUERPO: company_id y staff_member_id se ignoran', async () => {
  // El cuerpo pide la compañía 999; quien decide es resolveCompanyContext, que
  // dice 12. La consulta tiene que llevar 12.
  const { queries } = await ask(
    'cuántos equipos tengo',
    {},
    { body: { question: 'cuántos equipos tengo', company_id: { sql: 999, nosql: 'otra' }, staff_member_id: { sql: 777 } } }
  );
  const inventario = queries.find((q) => q.sql.includes('item_inv'));
  assert.ok(inventario, 'no se consultó el inventario');
  assert.equal(inventario.params[0], 12);
  assert.ok(!JSON.stringify(inventario.params).includes('999'), 'el company_id del cuerpo llegó a la consulta');
});

test('EL ALCANCE VIAJA DENTRO DE LA CONSULTA: rol scoped por categoría', async () => {
  const { queries } = await ask('cuántos equipos tengo', {
    resolveCompanyContextFn: async () => ({
      ok: true,
      companyId: 12,
      access: {
        role_level: 9, // category_assistant
        role_type: 'category_assistant',
        scoped: true,
        locations: [],
        categories: [3],
        categoryNames: ['Audio'],
      },
    }),
  });
  const inventario = queries.find((q) => q.sql.includes('item_inv'));
  assert.match(inventario.sql, /category_name IN \(\?\)/);
  assert.deepEqual(inventario.params, [12, 'Audio']);
});

test('un rol scoped SIN asignaciones consulta 1=0, no el inventario entero', async () => {
  const { queries } = await ask('cuántos equipos tengo', {
    resolveCompanyContextFn: async () => ({
      ok: true,
      companyId: 12,
      access: { role_level: 9, role_type: 'category_assistant', scoped: true, locations: [], categories: [], categoryNames: [] },
    }),
  });
  const inventario = queries.find((q) => q.sql.includes('item_inv'));
  assert.match(inventario.sql, /1=0/);
});

test('la respuesta avisa de que es parcial cuando el rol está acotado', async () => {
  const { res } = await ask('cuántos equipos tengo', {
    resolveCompanyContextFn: async () => ({
      ok: true,
      companyId: 12,
      access: { role_level: 9, role_type: 'category_assistant', scoped: true, locations: [], categories: [3], categoryNames: ['Audio'] },
    }),
  });
  assert.equal(res.body.scope.scoped, true);
  assert.equal(res.body.scope.roleType, 'category_assistant');
});

test('un 403 de resolveCompanyContext se devuelve tal cual', async () => {
  const { res, queries } = await ask('cuántos equipos tengo', {
    resolveCompanyContextFn: async () => ({ ok: false, status: 403, msg: 'Not an active staff member of this company.' }),
  });
  assert.equal(res.code, 403);
  assert.equal(queries.length, 0, 'no se puede consultar nada tras un 403');
});

test('toda lectura deja fila de auditoría, y NO guarda el texto de la pregunta', async () => {
  const { audit } = await ask('cuántos equipos tengo fuera');
  assert.equal(audit.length, 1);
  const fila = audit[0];
  assert.equal(fila.target_label, 'company_devices_out');
  assert.equal(fila.display.resource, 'inventory');
  assert.equal(fila.display.outcome, 'answered');
  assert.equal(fila.company_sql_id, '12');
  assert.ok(!JSON.stringify(fila).includes('cuántos equipos tengo fuera'), 'el texto de la pregunta se guardó');
});

test('una lectura que no se puede registrar NO se sirve', async () => {
  const { res } = await ask('cuántos equipos tengo', {
    StaffActivityLog: {
      create: async () => {
        throw new Error('mysql down');
      },
    },
  });
  assert.equal(res.code, 500);
  assert.equal(res.body.ok, false);
});

test('lo que no está en el catálogo se audita igual y ofrece la lista', async () => {
  const { res, audit } = await ask('hazme un café');
  assert.equal(res.code, 200);
  assert.equal(res.body.question_id, UNSUPPORTED);
  assert.ok(Array.isArray(res.body.catalog) && res.body.catalog.length > 0);
  assert.equal(audit.length, 1, 'un "no sé" también es una pregunta que hay que registrar');
  assert.equal(audit[0].display.outcome, 'unsupported');
});

test('una pregunta demasiado larga se rechaza antes de tocar nada', async () => {
  const { res, queries, audit } = await ask('a'.repeat(1001));
  assert.equal(res.code, 400);
  assert.equal(queries.length, 0);
  assert.equal(audit.length, 0);
});
