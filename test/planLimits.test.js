'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  effectivePlan,
  effectiveLimits,
  evaluateCapacity,
  withPlanCapacity,
  reservePlanCapacity,
  precheckPlanCapacity,
  buildRefusal,
  isPlanRefusal,
  COUNT_QUERIES,
} = require('../helpers/planLimits');

/** Dependencias falsas: una compañía SQL con su fila de plan y sus conteos. */
function fakeDeps({ record = null, staff = 0, items = 0, lockFails = false } = {}) {
  const calls = { queries: [], locks: [], releases: 0, activity: [] };
  const deps = {
    query: async (sql, params) => {
      calls.queries.push({ sql, params });
      if (sql === COUNT_QUERIES.staff) return [[{ n: staff }]];
      if (sql === COUNT_QUERIES.items) return [[{ n: items }]];
      if (sql.includes('company_name FROM company_info')) return [[{ company_name: 'Acme' }]];
      return [[]];
    },
    findSubscription: async () => record,
    findCompanyByName: async () => ({ _id: 'mongo-acme' }),
    acquireLock: async (key) => {
      calls.locks.push(key);
      if (lockFails) throw new Error('redis down');
      return async () => {
        calls.releases += 1;
      };
    },
    logActivity: async (data) => calls.activity.push(data),
  };
  return { deps, calls };
}

const ORIGINAL_MODE = process.env.PLAN_LIMITS_MODE;
const setMode = (m) => {
  if (m === undefined) delete process.env.PLAN_LIMITS_MODE;
  else process.env.PLAN_LIMITS_MODE = m;
};

describe('effectivePlan / effectiveLimits', () => {
  test('sin fila: Free (3 staff / 1000 items)', () => {
    assert.equal(effectivePlan(null), 'free');
    assert.deepEqual(effectiveLimits(null), { staff: 3, items: 1000 });
  });

  test('Pro al día: 10 / 4000; también trialing y past_due', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      assert.deepEqual(effectiveLimits({ plan: 'pro', status }), { staff: 10, items: 4000 });
    }
  });

  test('Pro que dejó de pagar vuelve a Free', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']) {
      assert.equal(effectivePlan({ plan: 'pro', status }), 'free');
    }
  });

  test('demo: plan Free sin topes, aunque tenga overrides', () => {
    const demo = { plan: 'free', status: 'active', demo: true, limit_overrides: { staff: 2 } };
    assert.equal(effectivePlan(demo), 'free');
    assert.deepEqual(effectiveLimits(demo), { staff: null, items: null });
  });

  test('Enterprise: sin tope salvo override; el override gana', () => {
    assert.deepEqual(effectiveLimits({ plan: 'enterprise', status: 'active' }), { staff: null, items: null });
    assert.deepEqual(
      effectiveLimits({ plan: 'enterprise', status: 'active', limit_overrides: { staff: 50 } }),
      { staff: 50, items: null }
    );
    assert.deepEqual(
      effectiveLimits({ plan: 'free', status: 'active', limit_overrides: { items: 1500 } }),
      { staff: 3, items: 1500 }
    );
  });
});

describe('evaluateCapacity', () => {
  beforeEach(() => setMode('enforce'));
  afterEach(() => setMode(ORIGINAL_MODE));

  test('cabe: sin rechazo', async () => {
    const { deps } = fakeDeps({ staff: 2 });
    const { refusal } = await evaluateCapacity({ resource: 'staff', sqlCompanyId: 7 }, deps);
    assert.equal(refusal, null);
  });

  test('en el tope: 403 PLAN_LIMIT_REACHED con la forma del contrato, y queda registrado', async () => {
    const { deps, calls } = fakeDeps({ staff: 3 });
    const { refusal } = await evaluateCapacity(
      { resource: 'staff', sqlCompanyId: 7, context: { uid: 'u1', route: 'POST /x' } },
      deps
    );
    assert.equal(refusal.ok, false);
    assert.equal(refusal.code, 'PLAN_LIMIT_REACHED');
    assert.equal(refusal.resource, 'staff');
    assert.equal(refusal.limit, 3);
    assert.equal(refusal.current, 3);
    assert.equal(refusal.requested, 1);
    assert.equal(refusal.plan, 'free');
    assert.match(refusal.msg, /Free plan includes up to 3 staff members/);
    assert.equal(calls.activity.length, 1);
    assert.equal(calls.activity[0].action, 'PLAN_LIMIT_REACHED');
    assert.equal(calls.activity[0].company_id, 'mongo-acme');
    assert.equal(calls.activity[0].details.route, 'POST /x');
  });

  test('bulk: rechaza el import ENTERO si no cabe, y dice cuántas caben', async () => {
    const { deps } = fakeDeps({ items: 900 });
    const { refusal } = await evaluateCapacity({ resource: 'items', sqlCompanyId: 7, requested: 150 }, deps);
    assert.equal(refusal.fits, 100);
    assert.equal(refusal.requested, 150);
    assert.match(refusal.msg, /100 of these 150 fit/);
  });

  test('bulk que cabe justo: pasa', async () => {
    const { deps } = fakeDeps({ items: 900 });
    const { refusal } = await evaluateCapacity({ resource: 'items', sqlCompanyId: 7, requested: 100 }, deps);
    assert.equal(refusal, null);
  });

  test('requested 0 no cuenta nada', async () => {
    const { deps, calls } = fakeDeps({ items: 5000 });
    const { refusal } = await evaluateCapacity({ resource: 'items', sqlCompanyId: 7, requested: 0 }, deps);
    assert.equal(refusal, null);
    assert.equal(calls.queries.length, 0);
  });

  test('cuenta demo muy por encima de Free: pasa sin contar', async () => {
    const { deps, calls } = fakeDeps({ record: { plan: 'free', status: 'active', demo: true }, staff: 40, items: 50000 });
    const { refusal } = await evaluateCapacity({ resource: 'items', sqlCompanyId: 7, requested: 500 }, deps);
    assert.equal(refusal, null);
    assert.equal(calls.queries.length, 0);
  });

  test('Enterprise sin override: no cuenta', async () => {
    const { deps, calls } = fakeDeps({ record: { plan: 'enterprise', status: 'active' }, items: 99999 });
    const { refusal } = await evaluateCapacity({ resource: 'items', sqlCompanyId: 7 }, deps);
    assert.equal(refusal, null);
    assert.equal(calls.queries.length, 0);
  });

  test('warn: no rechaza ni escribe en el activity log', async () => {
    setMode('warn');
    const { deps, calls } = fakeDeps({ staff: 3 });
    const { refusal } = await evaluateCapacity({ resource: 'staff', sqlCompanyId: 7 }, deps);
    assert.equal(refusal, null);
    assert.equal(calls.activity.length, 0);
  });

  test('sin modo configurado se comporta como warn', async () => {
    setMode(undefined);
    const { deps } = fakeDeps({ staff: 3 });
    const { refusal } = await evaluateCapacity({ resource: 'staff', sqlCompanyId: 7 }, deps);
    assert.equal(refusal, null);
  });

  test('off: ni consulta', async () => {
    setMode('off');
    const { deps, calls } = fakeDeps({ staff: 3 });
    await evaluateCapacity({ resource: 'staff', sqlCompanyId: 7 }, deps);
    assert.equal(calls.queries.length, 0);
  });

  test('sin compañía SQL resoluble: no decide (la ruta ya valida lo suyo)', async () => {
    const { deps, calls } = fakeDeps({ staff: 3 });
    const { refusal } = await evaluateCapacity({ resource: 'staff', sqlCompanyId: 'abc' }, deps);
    assert.equal(refusal, null);
    assert.equal(calls.queries.length, 0);
  });
});

describe('withPlanCapacity', () => {
  beforeEach(() => setMode('enforce'));
  afterEach(() => setMode(ORIGINAL_MODE));

  test('si cabe, corre la escritura CON el candado tomado y lo suelta después', async () => {
    const { deps, calls } = fakeDeps({ items: 10 });
    let releasesDuringWrite = null;
    const out = await withPlanCapacity({ resource: 'items', sqlCompanyId: 7 }, async () => {
      releasesDuringWrite = calls.releases;
      return 'written';
    }, deps);
    assert.deepEqual(out, { result: 'written' });
    assert.deepEqual(calls.locks, ['plan-limit:items:7']);
    assert.equal(releasesDuringWrite, 0);
    assert.equal(calls.releases, 1);
  });

  test('si no cabe, no escribe y suelta el candado', async () => {
    const { deps, calls } = fakeDeps({ items: 1000 });
    let wrote = false;
    const out = await withPlanCapacity({ resource: 'items', sqlCompanyId: 7 }, async () => {
      wrote = true;
    }, deps);
    assert.equal(wrote, false);
    assert.ok(isPlanRefusal(out.refusal));
    assert.equal(calls.releases, 1);
  });

  test('si la escritura falla, suelta el candado y propaga el error', async () => {
    const { deps, calls } = fakeDeps({ items: 1 });
    await assert.rejects(
      withPlanCapacity({ resource: 'items', sqlCompanyId: 7 }, async () => {
        throw new Error('boom');
      }, deps),
      /boom/
    );
    assert.equal(calls.releases, 1);
  });

  test('sin Redis: comprueba igual, sin candado', async () => {
    const { deps } = fakeDeps({ items: 1000, lockFails: true });
    const out = await withPlanCapacity({ resource: 'items', sqlCompanyId: 7 }, async () => 'x', deps);
    assert.ok(isPlanRefusal(out.refusal));
  });

  test('requested 0: ni candado', async () => {
    const { deps, calls } = fakeDeps();
    const out = await withPlanCapacity({ resource: 'staff', sqlCompanyId: 7, requested: 0 }, async () => 'x', deps);
    assert.deepEqual(out, { result: 'x' });
    assert.equal(calls.locks.length, 0);
  });

  test('dos altas a la vez con 1 hueco: solo pasa una (el candado serializa el conteo)', async () => {
    let count = 2; // tope Free de staff = 3
    let held = Promise.resolve();
    const deps = {
      query: async () => [[{ n: count }]],
      findSubscription: async () => null,
      findCompanyByName: async () => null,
      logActivity: async () => {},
      acquireLock: async () => {
        const previous = held;
        let free;
        held = new Promise((resolve) => {
          free = resolve;
        });
        await previous;
        return async () => free();
      },
    };
    const write = () => withPlanCapacity({ resource: 'staff', sqlCompanyId: 7 }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      count += 1;
      return 'ok';
    }, deps);
    const results = await Promise.all([write(), write()]);
    assert.equal(results.filter((r) => r.result === 'ok').length, 1);
    assert.equal(results.filter((r) => isPlanRefusal(r.refusal)).length, 1);
    assert.equal(count, 3);
  });
});

describe('reservePlanCapacity / precheckPlanCapacity', () => {
  beforeEach(() => setMode('enforce'));
  afterEach(() => setMode(ORIGINAL_MODE));

  test('reserve deja el candado tomado hasta release()', async () => {
    const { deps, calls } = fakeDeps({ staff: 0 });
    const r = await reservePlanCapacity({ resource: 'staff', sqlCompanyId: 7 }, deps);
    assert.equal(r.refusal, null);
    assert.equal(calls.releases, 0);
    await r.release();
    assert.equal(calls.releases, 1);
  });

  test('precheck no toma candado', async () => {
    const { deps, calls } = fakeDeps({ items: 1000 });
    const refusal = await precheckPlanCapacity({ resource: 'items', sqlCompanyId: 7, requested: 5 }, deps);
    assert.ok(isPlanRefusal(refusal));
    assert.equal(calls.locks.length, 0);
  });
});

test('buildRefusal: nunca devuelve "caben" negativos', () => {
  const r = buildRefusal({ resource: 'items', plan: 'free', limit: 1000, current: 1200, requested: 3 });
  assert.equal(r.fits, 0);
});
