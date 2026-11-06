'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { planChange, parseLimit, parseDemo } = require('../scripts/set-company-plan');
const { classifyUsage, summarize } = require('../scripts/plan-usage-report');

describe('scripts/set-company-plan.js', () => {
  test('Enterprise con topes a medida', () => {
    const { set, from, to } = planChange(null, { plan: 'enterprise', staff: 50, items: 20000 });
    assert.equal(set.plan, 'enterprise');
    assert.equal(set.status, 'active');
    assert.equal(set.interval, null);
    assert.deepEqual(set.limit_overrides, { staff: 50, items: 20000 });
    assert.equal(from.plan, 'free');
    assert.equal(to.plan, 'enterprise');
  });

  test('"none" quita un override; ausente lo conserva', () => {
    const { set } = planChange(
      { plan: 'enterprise', limit_overrides: { staff: 50, items: 20000 } },
      { staff: null }
    );
    assert.deepEqual(set.limit_overrides, { items: 20000 });
    assert.equal(set.plan, undefined);
  });

  test('no cambia el plan de una compañía con suscripción de Stripe', () => {
    assert.throws(
      () => planChange({ plan: 'pro', stripe_subscription_id: 'sub_1' }, { plan: 'enterprise' }),
      /cancel it in Stripe first/
    );
    // los overrides sí
    assert.doesNotThrow(() => planChange({ plan: 'pro', stripe_subscription_id: 'sub_1' }, { items: 5000 }));
  });

  test('--demo on: sigue en Free y sin tocar el plan; --demo off lo quita', () => {
    const on = planChange(null, { demo: true });
    assert.equal(on.set.demo, true);
    assert.equal(on.set.plan, undefined);
    assert.deepEqual(on.to, { plan: 'free', demo: true, limit_overrides: null });
    const off = planChange({ plan: 'free', demo: true }, { demo: false });
    assert.equal(off.set.demo, false);
    assert.equal(parseDemo('on'), true);
    assert.equal(parseDemo('off'), false);
    assert.equal(parseDemo(undefined), undefined);
    assert.throws(() => parseDemo('yes'), /on" or "off/);
  });

  test('plan desconocido o tope inválido: error', () => {
    assert.throws(() => planChange(null, { plan: 'gold' }), /plan must be one of/);
    assert.throws(() => parseLimit('-1', '--staff'), /whole number/);
    assert.throws(() => parseLimit('2.5', '--staff'), /whole number/);
    assert.equal(parseLimit('none'), null);
    assert.equal(parseLimit(undefined), undefined);
    assert.equal(parseLimit('0'), 0);
  });
});

describe('scripts/plan-usage-report.js', () => {
  test('marca quién supera Free y quién supera su propio plan', () => {
    const rows = classifyUsage(
      [
        { company_id: 1, company_name: 'Small' },
        { company_id: 2, company_name: 'BigFree' },
        { company_id: 3, company_name: 'BigPro' },
        { company_id: 4, company_name: 'Ent' },
        { company_id: 5, company_name: 'Demo' },
      ],
      new Map([[1, 2], [2, 5], [3, 5], [4, 80], [5, 30]]),
      new Map([[1, 100], [2, 1500], [3, 1500], [4, 90000], [5, 9000]]),
      new Map([
        [3, { plan: 'pro', status: 'active' }],
        [4, { plan: 'enterprise', status: 'active' }],
        [5, { plan: 'free', status: 'active', demo: true }],
      ])
    );
    const byName = Object.fromEntries(rows.map((r) => [r.company_name, r]));
    assert.equal(byName.Small.over_free_staff || byName.Small.over_free_items, false);
    assert.equal(byName.BigFree.over_staff, true);
    assert.equal(byName.BigFree.over_items, true);
    assert.equal(byName.BigPro.over_staff, false);
    assert.equal(byName.BigPro.over_items, false);
    assert.equal(byName.BigPro.over_free_items, true);
    assert.equal(byName.Ent.over_staff, false);
    assert.equal(byName.Demo.demo, true);
    assert.equal(byName.Demo.over_staff, false);
    assert.equal(byName.Demo.over_items, false);

    assert.deepEqual(summarize(rows), {
      companies: 5,
      demo: 1,
      over_own_plan: 1,
      over_free_staff: 3,
      over_free_items: 3,
      over_free_any: 3,
    });
  });
});
