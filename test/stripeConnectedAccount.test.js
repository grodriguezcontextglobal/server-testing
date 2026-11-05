'use strict';

/**
 * A qué cuenta de Stripe se cobra.
 *
 * El test que más importa de este fichero es el primero del bloque A: mientras
 * ninguna compañía tenga `acct_` guardado, TODO tiene que comportarse igual que
 * antes de este cambio. Si eso se rompe, se rompe el cobro de ContextGlobal y
 * el de todos los demás a la vez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripeModeFromKey,
  resolveConnectedAccountId,
  stripeOptionsFor,
  persistConnectedAccountId,
  resolveStripeContextForRequest,
} = require('../helpers/stripeConnectedAccount');

/* ---------------------------------------------------------------- *
 * Bloque A — hoy no cambia nada
 * ---------------------------------------------------------------- */

test('sin cuenta conectada no se manda cabecera: cobra la cuenta madre', () => {
  assert.deepEqual(stripeOptionsFor(null), {});
  assert.deepEqual(stripeOptionsFor(undefined), {});
  assert.deepEqual(stripeOptionsFor(''), {});
});

test('una compañía sin el campo, o con el campo vacío, cae al caso null', () => {
  assert.equal(resolveConnectedAccountId(null), null);
  assert.equal(resolveConnectedAccountId({}), null);
  assert.equal(resolveConnectedAccountId({ stripe_connected_account: null }), null);
  assert.equal(
    resolveConnectedAccountId({ stripe_connected_account: { test: null, live: null } }),
    null,
    'es el valor por defecto del modelo: todas las companias estan asi hoy'
  );
});

test('un valor a medias NO produce una cabecera inválida', () => {
  // Cadena vacía, un undefined serializado, un identificador de otro tipo, un
  // objeto sin `id`. Todos tienen que cobrar en la cuenta madre, nunca provocar
  // una llamada con una cabecera que Stripe rechace.
  const casos = [
    { test: '' },
    { test: 'undefined' },
    { test: 'cus_123' },
    { test: 12345 },
    { test: { login_links: {} } },
    { test: { id: 'cus_123' } },
  ];
  for (const stripe_connected_account of casos) {
    assert.equal(
      resolveConnectedAccountId({ stripe_connected_account }, { mode: 'test' }),
      null,
      `deberia caer a null: ${JSON.stringify(stripe_connected_account)}`
    );
  }
});

test('la forma REAL de producción resuelve: el objeto entero de accounts.create', () => {
  // Lo que el dashboard guarda hoy, copiado de una compañía real. Si esto no
  // resolviera, la cuenta conectada existiria y no se usaria nunca -- que es
  // exactamente el fallo que tenia la primera version de este helper.
  const company = {
    stripe_connected_account: {
      test: {
        id: 'acct_1U3wd6JNGnMoHT28',
        login_links: { object: 'list', data: [], has_more: false, total_count: 0 },
      },
      live: null,
    },
  };

  assert.equal(
    resolveConnectedAccountId(company, { mode: 'test' }),
    'acct_1U3wd6JNGnMoHT28'
  );
  assert.equal(
    resolveConnectedAccountId(company, { mode: 'live' }),
    null,
    'esa compania no tiene cuenta en produccion: cobra la cuenta madre'
  );
});

test('las dos formas conviven y resuelven igual', () => {
  const objeto = { stripe_connected_account: { test: { id: 'acct_X' } } };
  const cadena = { stripe_connected_account: { test: 'acct_X' } };

  assert.equal(
    resolveConnectedAccountId(objeto, { mode: 'test' }),
    resolveConnectedAccountId(cadena, { mode: 'test' }),
    'normalizar en la lectura evita migrar datos y coordinar un despliegue con el frontend'
  );
});

/* ---------------------------------------------------------------- *
 * Bloque B — y cuando sí la hay
 * ---------------------------------------------------------------- */

test('con cuenta conectada se manda la cabecera', () => {
  assert.deepEqual(stripeOptionsFor('acct_123'), { stripeAccount: 'acct_123' });
  assert.deepEqual(
    resolveConnectedAccountId(
      { stripe_connected_account: { test: 'acct_T', live: 'acct_L' } },
      { mode: 'live' }
    ),
    'acct_L'
  );
});

test('prueba y producción no se confunden: el modo sale de la clave en uso', () => {
  assert.equal(stripeModeFromKey('sk_live_abc'), 'live');
  assert.equal(stripeModeFromKey('sk_test_abc'), 'test');
  assert.equal(stripeModeFromKey(''), 'test', 'sin clave, nunca se asume produccion');

  const company = { stripe_connected_account: { test: 'acct_T', live: 'acct_L' } };
  assert.equal(resolveConnectedAccountId(company, { mode: 'test' }), 'acct_T');
  assert.equal(resolveConnectedAccountId(company, { mode: 'live' }), 'acct_L');
});

test('una compañía con cuenta solo en prueba no cobra contra ella en producción', () => {
  const company = { stripe_connected_account: { test: 'acct_T', live: null } };

  assert.equal(resolveConnectedAccountId(company, { mode: 'live' }), null);
});

/* ---------------------------------------------------------------- *
 * Bloque C — guardar el mapa
 * ---------------------------------------------------------------- */

test('se guarda con clave anidada, para no borrar el otro modo', async () => {
  const calls = [];
  const Company = { updateOne: async (filter, update) => { calls.push({ filter, update }); } };

  const ok = await persistConnectedAccountId(Company, 'c1', 'acct_X', { mode: 'live' });

  assert.equal(ok, true);
  assert.deepEqual(calls[0].update, { $set: { 'stripe_connected_account.live': 'acct_X' } });
  assert.deepEqual(calls[0].filter, { _id: 'c1' });
});

test('no se guarda basura', async () => {
  const Company = { updateOne: async () => { throw new Error('no deberia llamarse'); } };

  assert.equal(await persistConnectedAccountId(Company, 'c1', 'cus_123'), false);
  assert.equal(await persistConnectedAccountId(Company, 'c1', null), false);
  assert.equal(await persistConnectedAccountId(Company, null, 'acct_X'), false);
});

test('si la base falla al guardar, NO se propaga: la cuenta ya existe en Stripe', async () => {
  const warned = [];
  const Company = { updateOne: async () => { throw new Error('mongo caido'); } };

  const ok = await persistConnectedAccountId(Company, 'c1', 'acct_X', {
    logger: { error: (m) => warned.push(m) },
  });

  assert.equal(ok, false, 'devuelve false en vez de lanzar');
  assert.equal(warned.length, 1, 'y deja rastro, porque el mapa se quedo sin escribir');
});

/* ---------------------------------------------------------------- *
 * Bloque D — la resolución por request
 * ---------------------------------------------------------------- */

test('sin contexto de compañía no se va a la base', async () => {
  let consultas = 0;
  const Company = { findById: () => { consultas++; throw new Error('no deberia consultarse'); } };

  const result = await resolveStripeContextForRequest({}, {
    Company,
    resolveCompany: () => null,
  });

  assert.deepEqual(result.options, {});
  assert.equal(result.companyId, null);
  assert.equal(consultas, 0, 'la mayoria de las llamadas publicas no traen compania');
});

test('con compañía sin cuenta conectada: consulta, y sigue cobrando la cuenta madre', async () => {
  const Company = {
    findById: () => ({ select: () => ({ lean: async () => ({ stripe_connected_account: { test: null, live: null } }) }) }),
  };

  const result = await resolveStripeContextForRequest({}, {
    Company,
    resolveCompany: () => 'c1',
  });

  assert.deepEqual(result.options, {});
  assert.equal(result.companyId, 'c1', 'el companyId sale igual, porque va en la metadata del cobro');
  assert.equal(result.accountId, null);
});

test('con cuenta conectada, el cobro va a su cuenta', async () => {
  const Company = {
    findById: () => ({ select: () => ({ lean: async () => ({ stripe_connected_account: { test: 'acct_T', live: 'acct_L' } }) }) }),
  };

  const result = await resolveStripeContextForRequest({}, {
    Company,
    resolveCompany: () => 'c1',
  });

  const esperado = stripeModeFromKey() === 'live' ? 'acct_L' : 'acct_T';
  assert.deepEqual(result.options, { stripeAccount: esperado });
});

test('si la base falla al resolver, se cobra en la cuenta madre y no se lanza', async () => {
  const warned = [];
  const Company = { findById: () => { throw new Error('mongo caido'); } };

  const result = await resolveStripeContextForRequest({}, {
    Company,
    resolveCompany: () => 'c1',
    logger: { warn: (m) => warned.push(m) },
  });

  assert.deepEqual(result.options, {}, 'un fallo de lectura no puede impedir un cobro');
  assert.equal(warned.length, 1);
});
