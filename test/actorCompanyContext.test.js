'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createActorCompanyContext } = require('../helpers/actorCompanyContext');

function fakeRedis() {
  const store = new Map();
  const calls = { set: 0 };
  return {
    calls,
    client: {
      set: async (k, v) => { calls.set++; store.set(k, v); },
      get: async (k) => store.get(k) ?? null,
    },
  };
}

test('recuerda y devuelve la compañía por usuario', async () => {
  const r = fakeRedis();
  const ctx = createActorCompanyContext({ getRedis: async () => r.client });
  await ctx.remember('u1', 'co1');
  assert.equal(await ctx.recall('u1'), 'co1');
  assert.equal(await ctx.recall('u2'), null);
});

test('no reescribe Redis en cada petición si la compañía no cambió', async () => {
  const r = fakeRedis();
  let t = 0;
  const ctx = createActorCompanyContext({ getRedis: async () => r.client, now: () => t });
  await ctx.remember('u1', 'co1');
  await ctx.remember('u1', 'co1');
  assert.equal(r.calls.set, 1);
  await ctx.remember('u1', 'co2'); // cambió de compañía: se escribe
  assert.equal(r.calls.set, 2);
  t = 11 * 60 * 1000; // pasados 10 min se refresca el TTL
  await ctx.remember('u1', 'co2');
  assert.equal(r.calls.set, 3);
});

test('si Redis falla, ni remember ni recall rompen nada', async () => {
  const ctx = createActorCompanyContext({ getRedis: async () => { throw new Error('down'); } });
  await ctx.remember('u1', 'co1');
  assert.equal(await ctx.recall('u1'), null);
});
