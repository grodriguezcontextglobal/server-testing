'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRequirePlatformRead } = require('../middlewares/requirePlatformRead');

/**
 * `/api/metrics` y `/api/jobs/stats` agregan datos de TODAS las compañías, así
 * que su puerta no puede ser ninguno de los dos flags que ya existían:
 * `AdminUser.super_user` es bypass total de escritura, y el super_user de
 * compañía lo tiene el dueño de cada cliente — y estos endpoints incluyen un top
 * de clientes por volumen.
 *
 * Lo que se fija aquí es que el flag nuevo abre la puerta, que `super_user`
 * sigue abriéndola, y que nada más lo hace.
 */

const makeRes = () => {
  const sent = {};
  return {
    sent,
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
};

const run = async (user, req = { uid: 'u1' }) => {
  const handler = createRequirePlatformRead({ findAdminUser: async () => user });
  const res = makeRes();
  let passed = false;
  await handler(req, res, () => { passed = true; });
  return { res, passed };
};

test('deja pasar a platform_observer', async () => {
  const { res, passed } = await run({ platform_observer: true, super_user: false });
  assert.equal(passed, true);
  assert.equal(res.sent.status, undefined, 'no debe responder nada, solo llamar a next');
});

test('deja pasar a super_user: es un superconjunto deliberado', async () => {
  const { passed } = await run({ platform_observer: false, super_user: true });
  assert.equal(passed, true);
});

test('rechaza a quien no tiene ninguno de los dos, y dice cuál falta', async () => {
  const { res, passed } = await run({ platform_observer: false, super_user: false });
  assert.equal(passed, false);
  assert.equal(res.sent.status, 403);
  assert.match(
    res.sent.body.msg,
    /platform_observer/,
    'el 403 tiene que decir QUÉ hace falta: no decirlo costó una tarde',
  );
});

test('rechaza a un usuario desactivado aunque tenga el flag', async () => {
  const { res, passed } = await run({ platform_observer: true, active: false });
  assert.equal(passed, false);
  assert.equal(res.sent.status, 403);
});

test('rechaza si el usuario no existe', async () => {
  const { res, passed } = await run(null);
  assert.equal(passed, false);
  assert.equal(res.sent.status, 403);
});

// El bug de /api/metrics (8f9edab) fue montar el gate SIN validateJWT delante:
// sin `req.uid` no queda más estricto, queda inalcanzable.
test('sin req.uid responde 401, y el mensaje lo distingue de un token inválido', async () => {
  const { res, passed } = await run({ platform_observer: true }, {});
  assert.equal(passed, false);
  assert.equal(res.sent.status, 401);
  assert.match(res.sent.body.msg, /no session identity/);
});

test('un fallo de la consulta no deja pasar: responde 500', async () => {
  const handler = createRequirePlatformRead({
    findAdminUser: async () => { throw new Error('mongo caido'); },
  });
  const res = makeRes();
  let passed = false;
  await handler({ uid: 'u1' }, res, () => { passed = true; });

  assert.equal(passed, false, 'un error de autorización nunca puede fallar abierto');
  assert.equal(res.sent.status, 500);
});
