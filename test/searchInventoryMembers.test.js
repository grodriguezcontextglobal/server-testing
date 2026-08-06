const test = require('node:test');
const { describe, it, beforeEach, afterEach } = test;
const assert = require('node:assert/strict');
const path = require('node:path');

// Coverage for the MySQL-backed sections added on top of /search/searching_:
// inventory (item_inv), members (members_info) and open lease assignments
// (member_assigned_device_lease) -- none of this had any test before. Follows
// the same mocking convention as test/search.test.js (require.cache override
// of the modules search.js imports, testing through the exported `searching`
// handler rather than unexported internals like `searchingInventory`).

const cachePath = path.resolve(__dirname, '../database/cacheMemoryConfig.js');
const sqlConfigPath = path.resolve(__dirname, '../mysql/database/config.js');
const searchControllerPath = path.resolve(__dirname, '../controller/search.js');

const DEFAULT_ITEM_INV_COLUMNS = [
  'item_id', 'serial_number', 'item_group', 'category_name', 'brand',
  'descript_item', 'location', 'sub_location', 'current_location',
  'warehouse', 'ownership', 'status', 'extra_serial_number', 'cost',
  'image_url', 'return_date', 'company_id',
];
const DEFAULT_MEMBERS_INFO_COLUMNS = [
  'member_id', 'first_name', 'last_name', 'email', 'phone_number',
  'address', 'address_street', 'address_city', 'address_state',
  'address_zip', 'image_url', 'company_id',
];
const DEFAULT_LOCATIONS_COLUMNS = ['location_id', 'location_name', 'company_id'];

// Sniffs the SQL text to decide which canned response to hand back -- the
// controller composes a lot of ad-hoc SQL (subqueries, UNIONs, joins), so
// asserting on exact query strings would be brittle; asserting on which
// *table/shape* was queried, and with what result, is what actually matters.
function makeMockConnection({ columns = {}, rows = {}, throwOn = null } = {}) {
  const calls = [];
  const cols = {
    item_inv: DEFAULT_ITEM_INV_COLUMNS,
    members_info: DEFAULT_MEMBERS_INFO_COLUMNS,
    locations: DEFAULT_LOCATIONS_COLUMNS,
    ...columns,
  };

  const respond = (sql) => {
    calls.push(sql);
    if (throwOn && throwOn.test(sql)) {
      throw new Error('simulated MySQL failure');
    }

    const showColumns = sql.match(/^SHOW COLUMNS FROM `(\w+)`/);
    if (showColumns) {
      return [(cols[showColumns[1]] || []).map((Field) => ({ Field })), []];
    }
    if (/FROM company_info/.test(sql)) {
      return [rows.companyInfo ?? [], []];
    }
    if (/COUNT\(\*\) AS total FROM item_inv WHERE.*NOT IN/s.test(sql)) {
      return [[{ total: rows.inventoryShownTotal ?? 0 }], []];
    }
    if (/COUNT\(\*\) AS total FROM item_inv WHERE/.test(sql)) {
      return [[{ total: rows.inventoryMatchedTotal ?? 0 }], []];
    }
    if (/FROM item_inv WHERE/.test(sql) && /LIMIT 121/.test(sql)) {
      return [rows.inventoryItems ?? [], []];
    }
    if (/FROM item_inv ii/.test(sql) && /GROUP BY/.test(sql)) {
      return [rows.inventoryGroups ?? [], []];
    }
    if (/COUNT\(\*\) AS total FROM members_info/.test(sql)) {
      return [[{ total: rows.membersTotal ?? 0 }], []];
    }
    if (/FROM members_info WHERE/.test(sql) && /LIMIT 61/.test(sql)) {
      return [rows.members ?? [], []];
    }
    if (/madl\.expected_return_date/.test(sql) && /COUNT\(\*\) AS total/.test(sql)) {
      return [[{ total: rows.assignmentsTotal ?? 0, overdue: rows.assignmentsOverdue ?? 0 }], []];
    }
    if (/FROM member_assigned_device_lease madl/.test(sql) && /LIMIT 61/.test(sql)) {
      return [rows.assignments ?? [], []];
    }
    if (/UNION/.test(sql) && /AS units/.test(sql)) {
      return [[{ units: rows.unitTotal ?? 0 }], []];
    }
    if (/COUNT\(DISTINCT serial_number\) AS known/.test(sql)) {
      return [[{ known: rows.knownSerials ?? 0 }], []];
    }
    if (/FROM locations l/.test(sql)) {
      return [rows.locations ?? [], []];
    }
    return [[], []];
  };

  return {
    calls,
    query: async (sql, params) => respond(sql, params),
    execute: async (sql, params) => respond(sql, params),
  };
}

describe('searching() -- inventory/members/assignments (MySQL sections)', () => {
  let User, Receivers, ReceiversPool, Event, AdminUser, Transaction, Company;
  let mysqlCalls;
  let originals;
  let mockConnection;

  function installMysqlMock(opts) {
    mockConnection = makeMockConnection(opts);
    mysqlCalls = mockConnection.calls;
    delete require.cache[sqlConfigPath];
    require.cache[sqlConfigPath] = {
      id: sqlConfigPath,
      filename: sqlConfigPath,
      loaded: true,
      exports: () => mockConnection,
    };
  }

  beforeEach(() => {
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

    installMysqlMock();

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
    User.find = () => chainable([]);
    Receivers.find = () => chainable([]);
    ReceiversPool.find = () => chainable([]);
    Event.find = () => chainable([]);
    AdminUser.find = async () => [];
    Transaction.find = async () => [];
    Company.findById = () => ({
      lean: async () => ({ company_name: 'Acme', employees: [] }),
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
    delete require.cache[sqlConfigPath];
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
    delete require.cache[searchControllerPath];
    return require('../controller/search.js').searching;
  }

  const sqlOf = (label) => mysqlCalls.some((sql) => sql.includes(label));

  // ─── Category gating (extends the existing consumers/staff/device/event coverage) ───

  it('category=inventory: only the item_inv section runs (members/assignments untouched)', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'chrome', company: 'C1', category: 'inventory', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(sqlOf('item_inv'), 'expected an item_inv query to run');
    // Note: item_inv's own query legitimately LEFT JOINs members_info (to name
    // whoever a lease is subtracting) -- so "no members_info SQL at all" is the
    // wrong assertion. What must NOT happen is the *standalone* members/
    // assignments sections running, which the response contract already
    // captures via their established empty shapes.
    assert.deepEqual(res.payload.member, { members: [], total: 0, hasMore: false });
    assert.deepEqual(res.payload.memberAssignment, { assignments: [], total: 0, overdue: 0, hasMore: false });
  });

  it('category=members: only the members_info section runs (inventory untouched)', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'jane', company: 'C1', category: 'members', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(sqlOf('members_info'), 'expected a members_info query to run');
    assert.ok(!sqlOf('SHOW COLUMNS FROM `item_inv`'), 'item_inv must NOT be queried for category=members');
  });

  it('category=device: now also runs the member-assignments section (documented scope change)', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'device', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(sqlOf('member_assigned_device_lease'), 'category=device must also query open lease assignments');
    // the assignments query itself LEFT JOINs members_info for the holder's
    // name/email -- what must stay scoped is the *standalone* members section
    assert.deepEqual(res.payload.member, { members: [], total: 0, hasMore: false });
  });

  it('category=all: runs inventory, members and assignments together', async () => {
    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(sqlOf('item_inv'));
    assert.ok(sqlOf('members_info'));
    assert.ok(sqlOf('member_assigned_device_lease'));
  });

  // ─── Graceful degradation: a real DB failure must not 500 the whole search ───

  it('inventory query throwing does not break the overall search response', async () => {
    installMysqlMock({ throwOn: /item_inv/ });
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'inventory', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200, 'a failing inventory query must not turn into a 500 for the whole endpoint');
    assert.equal(res.payload.ok, true);
    assert.deepEqual(res.payload.inventory.items, []);
    assert.equal(res.payload.inventory.total, 0);
    assert.ok(res.payload.inventory.error, 'the error should be surfaced on the section, not swallowed silently');
  });

  it('members query throwing does not break the overall search response', async () => {
    installMysqlMock({ throwOn: /members_info/ });
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'members', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.deepEqual(res.payload.member.members, []);
  });

  it('assignments query throwing does not break the overall search response', async () => {
    installMysqlMock({ throwOn: /member_assigned_device_lease/ });
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'device', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.deepEqual(res.payload.memberAssignment.assignments, []);
  });

  // ─── Column-drift resilience (the stated design intent) ───

  it('a missing (dropped) inventory column is skipped instead of crashing the query', async () => {
    installMysqlMock({
      columns: { item_inv: DEFAULT_ITEM_INV_COLUMNS.filter((c) => c !== 'warehouse' && c !== 'sub_location') },
      rows: { inventoryItems: [{ item_id: 1, serial_number: 'SN1' }] },
    });
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'inventory', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.deepEqual(res.payload.inventory.items, [{ item_id: 1, serial_number: 'SN1' }]);
  });

  it('no searchable inventory columns at all -> empty result, not a thrown error', async () => {
    installMysqlMock({ columns: { item_inv: ['item_id', 'company_id'] } }); // none of the LIKE-searchable columns
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'inventory', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.inventory, { items: [], groups: [], total: 0, matchedTotal: 0, elsewhereTotal: 0, hasMore: false });
  });

  // ─── company_sql_id resolution ───

  it('a numeric company_sql_id in the query string is used as-is, no company_info lookup', async () => {
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'inventory', company_sql_id: '133' } }, res);

    assert.equal(res.payload.company_sql_id, 133);
    assert.ok(!sqlOf('company_info'), 'should not look up company_info when an id was already provided');
  });

  it('without company_sql_id, falls back to a company_info lookup by name', async () => {
    installMysqlMock({ rows: { companyInfo: [{ company_id: 77 }] } });
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'inventory' } }, res);

    assert.equal(res.payload.company_sql_id, 77);
    assert.ok(sqlOf('company_info'));
  });

  it('company_sql_id unresolvable -> inventory/members degrade to empty instead of erroring', async () => {
    installMysqlMock({ rows: { companyInfo: [] } }); // lookup finds nothing
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', category: 'inventory' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.company_sql_id, null);
    assert.deepEqual(res.payload.inventory.items, []);
  });

  // ─── The header totals math (the most bug-prone part of this diff) ───

  it('totals.units and unitsByBucket reflect the mocked inventory/assignment counts', async () => {
    installMysqlMock({
      rows: {
        inventoryShownTotal: 5,
        inventoryMatchedTotal: 8,
        assignmentsTotal: 3,
        unitTotal: 8, // union of inventory ∪ leases ∪ checkouts, deduped
      },
    });
    const searching = loadSearching();
    const res = mockRes();

    await searching({ query: { variable: 'a', company: 'C1', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.totals.units, 8);
    assert.equal(res.payload.totals.unitsByBucket.inventory, 5);
    assert.equal(res.payload.totals.unitsByBucket.assigned, 3);
    assert.equal(res.payload.inventory.elsewhereTotal, 3); // matchedTotal(8) - total(5)
    assert.equal(
      res.payload.totals.all,
      res.payload.totals.units + res.payload.totals.consumers + res.payload.totals.staff + res.payload.totals.members + res.payload.totals.events,
    );
  });

  // ─── Concurrency: members/assignments/locations must not wait on deviceTransaction ───
  // Regression guard for the perf fix -- before it, `deviceTransactionFound` was
  // `await`ed BEFORE the Promise.all even started, so every other section
  // (including these, which don't need its result) was serialized behind it.

  it('the members_info query starts before a slow deviceTransaction resolves, not after', async () => {
    let deviceTransactionResolved = false;
    let membersQueryStartedBeforeDeviceTransactionResolved = false;

    Receivers.find = () => ({
      sort: () => ({
        limit: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          deviceTransactionResolved = true;
          return [];
        },
      }),
    });

    installMysqlMock({ rows: { members: [{ member_id: 1 }] } });
    const originalExecute = mockConnection.execute.bind(mockConnection);
    mockConnection.execute = async (sql, params) => {
      if (/FROM members_info WHERE/.test(sql) && /LIMIT 61/.test(sql) && !deviceTransactionResolved) {
        membersQueryStartedBeforeDeviceTransactionResolved = true;
      }
      return originalExecute(sql, params);
    };

    const searching = loadSearching();
    const res = mockRes();
    await searching({ query: { variable: 'a', company: 'C1', category: 'all', company_sql_id: '133' } }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(
      membersQueryStartedBeforeDeviceTransactionResolved,
      'members_info must not be serialized behind deviceTransaction -- it does not depend on its result'
    );
  });

  // ─── Reliability: a hung (not failing) query must not hang/break the whole search ───

  it('a hung MySQL query is bounded by the section timeout instead of hanging the whole search', async () => {
    process.env.SEARCH_SECTION_TIMEOUT_MS = '20';
    try {
      installMysqlMock();
      // A query that never settles -- simulates a real hung connection/query,
      // as opposed to the already-covered "throws an error" case.
      mockConnection.execute = () => new Promise(() => {});
      mockConnection.query = () => new Promise(() => {});

      const searching = loadSearching(); // fresh require picks up the env var
      const res = mockRes();

      const start = Date.now();
      await searching({ query: { variable: 'a', company: 'C1', category: 'members', company_sql_id: '133' } }, res);
      const elapsed = Date.now() - start;

      assert.equal(res.statusCode, 200);
      assert.ok(elapsed < 2000, `expected the ~20ms section timeout to bound the response, took ${elapsed}ms`);
      assert.deepEqual(res.payload.member.members, []);
      assert.ok(res.payload.member.error?.includes('timeout'), 'the timeout should be surfaced on the section, like the thrown-error case');
    } finally {
      delete process.env.SEARCH_SECTION_TIMEOUT_MS;
    }
  });
});
