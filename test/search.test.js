const test = require('node:test');
const { describe, it, beforeEach, afterEach } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
// Assuming search.js is in the controller directory, and this test is in the test directory
const { buildDateRangeQuery, resolveSearchCategory } = require('../controller/search.js');

test('buildDateRangeQuery constructs correct query structure', () => {
  const startDate = new Date('2025-10-01T00:00:00.000Z');
  const endDate = new Date('2025-10-31T23:59:59.999Z');

  const result = buildDateRangeQuery(startDate, endDate);

  // Check top-level keys
  assert.deepStrictEqual(Object.keys(result), ['$expr']);
  assert.deepStrictEqual(Object.keys(result.$expr), ['$and']);
  assert.strictEqual(result.$expr.$and.length, 2);

  // Check the first condition (LTE)
  const lteCondition = result.$expr.$and[0];
  assert.deepStrictEqual(Object.keys(lteCondition), ['$lte']);
  assert.strictEqual(lteCondition.$lte.length, 2);
  assert.deepStrictEqual(lteCondition.$lte[1], endDate); // Check if endDate is correctly placed

  const dateSubtractPart = lteCondition.$lte[0];
  assert.deepStrictEqual(Object.keys(dateSubtractPart), ['$dateSubtract']);
  assert.strictEqual(dateSubtractPart.$dateSubtract.unit, 'day');

  // Check the second condition (GTE)
  const gteCondition = result.$expr.$and[1];
  assert.deepStrictEqual(Object.keys(gteCondition), ['$gte']);
  assert.strictEqual(gteCondition.$gte.length, 2);
  assert.deepStrictEqual(gteCondition.$gte[1], startDate); // Check if startDate is correctly placed

  const dateAddPart = gteCondition.$gte[0];
  assert.deepStrictEqual(Object.keys(dateAddPart), ['$dateAdd']);
  assert.strictEqual(dateAddPart.$dateAdd.unit, 'day');
  
  console.log('buildDateRangeQuery test passed: Query structure is valid.');
});

// ─── resolveSearchCategory (pure) ─────────────────────────────────────────────
// Contract: FRONTEND_search_backend_segmentation_plan.md § 2 and § 5.

describe('resolveSearchCategory', () => {
  it('passes through each of the 4 known values', () => {
    assert.equal(resolveSearchCategory('consumers'), 'consumers');
    assert.equal(resolveSearchCategory('staff'), 'staff');
    assert.equal(resolveSearchCategory('device'), 'device');
    assert.equal(resolveSearchCategory('event'), 'event');
  });

  it('falls back to "all" when the param is omitted', () => {
    assert.equal(resolveSearchCategory(undefined), 'all');
  });

  it('falls back to "all" for an unknown/garbage value instead of throwing', () => {
    assert.equal(resolveSearchCategory('foo'), 'all');
    assert.equal(resolveSearchCategory('Devices'), 'all'); // wrong case/plural
    assert.equal(resolveSearchCategory('events'), 'all'); // plural, not the agreed singular
    assert.equal(resolveSearchCategory(''), 'all');
  });

  it('takes the first value and falls back safely for a malformed repeated ?category=a&category=b', () => {
    assert.equal(resolveSearchCategory(['consumers', 'staff']), 'consumers');
    assert.equal(resolveSearchCategory(['bogus', 'staff']), 'all');
  });
});

// ─── searching() branch-skipping per category ─────────────────────────────────
// Verifies the actual perf requirement from § 4.2: an unrelated branch's DB
// query must not even run when a category narrows the search, not just be
// trimmed from the response. Monkey-patches the Mongoose model singletons
// search.js requires (same object reference, since Node caches modules by
// resolved path) and stubs the Redis-backed company-info cache so no real
// network call happens during the test.

describe('searching (category branch-skipping)', () => {
  const cachePath = path.resolve(__dirname, '../database/cacheMemoryConfig.js');
  let User, Receivers, ReceiversPool, Event, AdminUser, Transaction, Company;
  let calls;
  let originals;

  beforeEach(() => {
    calls = { consumer: 0, deviceTransaction: 0, devicePool: 0, event: 0, staff: 0, transaction: 0 };

    delete require.cache[cachePath];
    require.cache[cachePath] = {
      id: cachePath,
      filename: cachePath,
      loaded: true,
      exports: {
        clientRedis: async () => ({
          get: async () => null,
          set: async () => {},
          expire: async () => {},
        }),
      },
    };

    User = require('../models/User');
    Receivers = require('../models/Receivers');
    ReceiversPool = require('../models/ReceiversPool');
    Event = require('../models/Event');
    AdminUser = require('../models/AdminUser');
    Transaction = require('../models/Transaction');
    Company = require('../models/Company');

    originals = {
      userFind: User.find,
      receiversFind: Receivers.find,
      receiversPoolFind: ReceiversPool.find,
      eventFind: Event.find,
      adminUserFind: AdminUser.find,
      transactionFind: Transaction.find,
      companyFindById: Company.findById,
    };

    const chainable = (results) => ({ sort: () => ({ limit: async () => results }) });

    User.find = (...args) => { calls.consumer++; return chainable([]); };
    Receivers.find = (...args) => { calls.deviceTransaction++; return chainable([]); };
    ReceiversPool.find = (...args) => { calls.devicePool++; return chainable([]); };
    Event.find = (...args) => { calls.event++; return chainable([]); };
    AdminUser.find = async (...args) => { calls.staff++; return [{ email: 'someone@acme.com' }]; };
    Transaction.find = async (...args) => { calls.transaction++; return []; };
    // searchingStaff only calls AdminUser.find for employees whose stringified
    // JSON matches `variable` -- give it one that matches the 'a' used below.
    Company.findById = () => ({
      lean: async () => ({ company_name: 'Acme', employees: [{ user: 'someone@acme.com' }] }),
    });
  });

  afterEach(() => {
    User.find = originals.userFind;
    Receivers.find = originals.receiversFind;
    ReceiversPool.find = originals.receiversPoolFind;
    Event.find = originals.eventFind;
    AdminUser.find = originals.adminUserFind;
    Transaction.find = originals.transactionFind;
    Company.findById = originals.companyFindById;
    delete require.cache[cachePath];
  });

  function mockRes() {
    return {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
    };
  }

  function loadSearching() {
    delete require.cache[path.resolve(__dirname, '../controller/search.js')];
    return require('../controller/search.js').searching;
  }

  it('category omitted ("all"): runs every branch, identical to pre-change behavior', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1' } }, res);

    assert.equal(calls.consumer, 1);
    assert.equal(calls.deviceTransaction, 1);
    assert.equal(calls.devicePool, 1);
    assert.equal(calls.event, 1);
    assert.equal(calls.staff, 1);
    assert.equal(calls.transaction, 1); // always runs -- no dedicated category
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
  });

  it('category=consumers: only the consumer branch runs (staff/device/event skipped)', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'consumers' } }, res);

    assert.equal(calls.consumer, 1);
    assert.equal(calls.staff, 0);
    assert.equal(calls.deviceTransaction, 0);
    assert.equal(calls.devicePool, 0);
    assert.equal(calls.event, 0);
    assert.deepEqual(res.payload.staff, []);
    assert.deepEqual(res.payload.consumer, { consumers: [], hasMore: false }); // ran for real (calls.consumer===1 above), just found nothing
  });

  it('category=staff: only the staff branch runs', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'staff' } }, res);

    assert.equal(calls.staff, 1);
    assert.equal(calls.consumer, 0);
    assert.equal(calls.deviceTransaction, 0);
    assert.equal(calls.devicePool, 0);
    assert.equal(calls.event, 0);
  });

  it('category=device: BOTH deviceTransaction and devicePool run (no separate pool-only category)', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'device' } }, res);

    assert.equal(calls.deviceTransaction, 1);
    assert.equal(calls.devicePool, 1);
    assert.equal(calls.consumer, 0);
    assert.equal(calls.staff, 0);
    assert.equal(calls.event, 0);
  });

  it('category=event: only the event branch runs', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'event' } }, res);

    assert.equal(calls.event, 1);
    assert.equal(calls.consumer, 0);
    assert.equal(calls.staff, 0);
    assert.equal(calls.deviceTransaction, 0);
    assert.equal(calls.devicePool, 0);
  });

  it('unknown category value falls back to "all" instead of erroring', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'Devices' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.consumer, 1);
    assert.equal(calls.staff, 1);
    assert.equal(calls.deviceTransaction, 1);
    assert.equal(calls.devicePool, 1);
    assert.equal(calls.event, 1);
  });

  it('skipped branches still return the established empty shape, not undefined/omitted', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'staff' } }, res);

    assert.deepEqual(res.payload.deviceTransaction, { deviceTransaction: [], hasMore: false });
    assert.deepEqual(res.payload.devicePool, { devicePool: [], hasMore: false });
    assert.deepEqual(res.payload.event, { hasMore: false, results: [] });
  });
});
