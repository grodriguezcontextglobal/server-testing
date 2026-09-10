'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { createReadinessLimiter, isForce } = require('../middlewares/readinessRateLimit');

/**
 * Levanta un servidor con el limitador y un handler que CUENTA sus ejecuciones.
 * Ese contador es lo que de verdad se mide aquí: un 429 que igualmente ejecuta
 * las comprobaciones no protege de nada, solo cambia el cuerpo de la respuesta.
 */
const withServer = async ({ max, maxForced }, run) => {
  const app = express();
  const state = { handlerRuns: 0 };
  app.get('/ready', createReadinessLimiter({ windowMs: 60_000, max, maxForced }), (req, res) => {
    state.handlerRuns += 1;
    res.status(200).json({ ready: true, forced: isForce(req) });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const get = async (path) => {
    const response = await fetch(base + path);
    let body = null;
    try { body = await response.json(); } catch { /* 429 sin cuerpo no rompe el test */ }
    return { status: response.status, body, headers: response.headers };
  };

  try {
    await run({ get, state });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('isForce: reconoce 1 y true, y nada mas', () => {
  assert.strictEqual(isForce({ query: { force: '1' } }), true);
  assert.strictEqual(isForce({ query: { force: 'true' } }), true);
  assert.strictEqual(isForce({ query: { force: '0' } }), false);
  assert.strictEqual(isForce({ query: { force: 'yes' } }), false);
  assert.strictEqual(isForce({ query: {} }), false);
  assert.strictEqual(isForce({}), false);
});

test('normal: deja pasar hasta el techo y luego responde 429', async () => {
  await withServer({ max: 3, maxForced: 2 }, async ({ get, state }) => {
    for (let i = 0; i < 3; i++) {
      const result = await get('/ready');
      assert.strictEqual(result.status, 200, `la peticion ${i + 1} deberia pasar`);
    }
    const excedida = await get('/ready');
    assert.strictEqual(excedida.status, 429);
    assert.strictEqual(excedida.body.status, 'rate_limited');
    assert.strictEqual(excedida.body.scope, 'total');
    assert.strictEqual(state.handlerRuns, 3, 'el handler NO debe correr en la rechazada');
  });
});

test('un 429 no ejecuta las comprobaciones, que es todo el objetivo', async () => {
  // Si el limitador se montara despues del handler, o si el handler corriera
  // igual, el ataque seguiria costando cuatro consultas por peticion y solo
  // cambiaria el codigo de respuesta.
  await withServer({ max: 2, maxForced: 1 }, async ({ get, state }) => {
    for (let i = 0; i < 12; i++) await get('/ready');
    assert.strictEqual(state.handlerRuns, 2, `corrio ${state.handlerRuns} veces, deberian ser 2`);
  });
});

test('force=1 tiene un techo MUCHO mas bajo, porque salta la cache del servidor', async () => {
  // Es el vector de amplificacion: cada force golpea MySQL, Mongo, Redis y el
  // worker de Go. Sin este techo, 200 bytes de peticion se convierten en cuatro
  // consultas.
  await withServer({ max: 50, maxForced: 2 }, async ({ get }) => {
    assert.strictEqual((await get('/ready?force=1')).status, 200);
    assert.strictEqual((await get('/ready?force=1')).status, 200);

    const tercera = await get('/ready?force=1');
    assert.strictEqual(tercera.status, 429);
    assert.strictEqual(tercera.body.scope, 'forced');
    assert.match(tercera.body.msg, /Drop \?force=1/);
  });
});

test('las peticiones normales no gastan el presupuesto de force', async () => {
  // Se sirven de la cache de 2s, asi que no cuesta lo mismo y no deben
  // consumir el presupuesto caro.
  await withServer({ max: 50, maxForced: 2 }, async ({ get }) => {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual((await get('/ready')).status, 200);
    }
    assert.strictEqual((await get('/ready?force=1')).status, 200, 'el force sigue teniendo sus dos');
    assert.strictEqual((await get('/ready?force=1')).status, 200);
    assert.strictEqual((await get('/ready?force=1')).status, 429);
  });
});

test('alternar force y normal no escapa de ninguno de los dos techos', async () => {
  await withServer({ max: 6, maxForced: 2 }, async ({ get }) => {
    const codigos = [];
    for (let i = 0; i < 8; i++) {
      codigos.push((await get(i % 2 === 0 ? '/ready?force=1' : '/ready')).status);
    }
    // Pares (force): 200, 200, 429, 429 -> el techo de force muerde al tercero.
    assert.deepStrictEqual([codigos[0], codigos[2], codigos[4], codigos[6]], [200, 200, 429, 429]);
    // Impares (normal): los cuatro caben en el techo total de 6, contando que
    // los force tambien consumen del total.
    assert.deepStrictEqual([codigos[1], codigos[3]], [200, 200]);
  });
});

test('expone las cabeceras estandar, para que un cliente sepa su presupuesto', async () => {
  await withServer({ max: 5, maxForced: 2 }, async ({ get }) => {
    const result = await get('/ready');
    assert.strictEqual(result.headers.get('ratelimit-limit'), '5');
    assert.ok(Number(result.headers.get('ratelimit-remaining')) >= 0);
  });
});
