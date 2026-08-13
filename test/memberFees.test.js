'use strict';

// Fees for lost / damaged member devices — B1.1 (persist on lease close) and
// B1.3 (settle after the card is charged).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/members.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');

const LEASE_COLUMNS = [
  'member_id',
  'staff_member_id',
  'device_id',
  'company_id',
  'expected_return_date',
  'returned',
  'location',
  'assigned_date',
  'return_status',
  'condition_note',
  'returned_date',
].map((Field) => ({ Field }));

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// Scripted pool: each handler is [regex, rows-or-fn]. Anything unmatched throws,
// so a test fails loudly if the controller issues a query it did not expect.
function createPool(handlers = []) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, values });
      for (const [pattern, result] of handlers) {
        if (pattern.test(flat)) {
          return typeof result === 'function' ? result(values) : result;
        }
      }
      throw new Error(`Unexpected query: ${flat}`);
    },
  };
}

function loadController({ pool }) {
  const originals = new Map(
    [controllerPath, dbPath].map((modulePath) => [modulePath, require.cache[modulePath]])
  );
  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  const controller = require(controllerPath);
  return {
    controller,
    restore() {
      for (const [modulePath, cached] of originals) {
        if (cached) require.cache[modulePath] = cached;
        else delete require.cache[modulePath];
      }
    },
  };
}

const showColumns = [/SHOW COLUMNS FROM member_assigned_device_lease/, [LEASE_COLUMNS]];
const feesTablePresent = [/SHOW TABLES LIKE 'member_fees'/, [[{ Tables_in_db: 'member_fees' }]]];
const feesTableMissing = [/SHOW TABLES LIKE 'member_fees'/, [[]]];
const leaseUpdateOk = [/^UPDATE member_assigned_device_lease/, [{ affectedRows: 1 }]];

const feeUpdateBody = (update) => ({
  company_id: 62,
  where: { company_id: 62, member_id: 158, device_id: 900 },
  update,
});

// --------------------------------------------------------------------------
// normalizeFeeAmount — dollars in, dollars out
// --------------------------------------------------------------------------

test('normalizeFeeAmount: absent stays absent, blank clears', () => {
  const loaded = loadController({ pool: createPool() });
  try {
    const { normalizeFeeAmount } = loaded.controller;
    assert.deepEqual(normalizeFeeAmount(undefined), { ok: true, value: undefined });
    assert.deepEqual(normalizeFeeAmount(null), { ok: true, value: null });
    assert.deepEqual(normalizeFeeAmount(''), { ok: true, value: null });
  } finally {
    loaded.restore();
  }
});

test('normalizeFeeAmount: dollars are never multiplied, cents are rounded to 2dp', () => {
  const loaded = loadController({ pool: createPool() });
  try {
    const { normalizeFeeAmount } = loaded.controller;
    assert.equal(normalizeFeeAmount(250).value, 250);
    assert.equal(normalizeFeeAmount(75.5).value, 75.5);
    assert.equal(normalizeFeeAmount('250.00').value, 250);
    assert.equal(normalizeFeeAmount(250.567).value, 250.57);
  } finally {
    loaded.restore();
  }
});

test('normalizeFeeAmount: rejects <= 0 and non-numbers', () => {
  const loaded = loadController({ pool: createPool() });
  try {
    const { normalizeFeeAmount } = loaded.controller;
    assert.equal(normalizeFeeAmount(0).ok, false);
    assert.equal(normalizeFeeAmount(-5).ok, false);
    assert.equal(normalizeFeeAmount('abc').ok, false);
    assert.equal(normalizeFeeAmount(true).ok, false);
    assert.equal(normalizeFeeAmount({}).ok, false);
  } finally {
    loaded.restore();
  }
});

test('extractFeePayload: neither field present means "no fee mentioned"', () => {
  const loaded = loadController({ pool: createPool() });
  try {
    const { extractFeePayload } = loaded.controller;
    assert.equal(extractFeePayload({ returned: 1, return_status: 'returned' }).present, false);
    assert.equal(extractFeePayload({ fee_reason: 'Lost' }).present, true);
    assert.equal(extractFeePayload({ fee_reason: '   ' }).fee_reason, null);
  } finally {
    loaded.restore();
  }
});

// --------------------------------------------------------------------------
// B1.1 — persisting the fee when the lease is closed
// --------------------------------------------------------------------------

test('B1.1: a lost declaration with a fee closes the lease AND records the fee', async () => {
  const pool = createPool([
    showColumns,
    feesTablePresent,
    leaseUpdateOk,
    [/^SELECT fee_id FROM member_fees/, [[]]],
    [/^INSERT INTO member_fees/, [{ insertId: 7 }]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      {
        body: feeUpdateBody({
          returned: 1,
          return_status: 'lost',
          condition_note: 'Reported lost by student on 6/2',
          returned_date: '2026-06-02 14:30:00',
          fee_amount: 250.0,
          fee_reason: 'Device not recovered',
        }),
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.fee, { fee_id: 7, created: true });

    // the fee columns must not leak into the lease UPDATE
    const leaseUpdate = pool.calls.find((c) => c.sql.startsWith('UPDATE member_assigned_device_lease'));
    assert.ok(leaseUpdate);
    assert.ok(!/fee_amount|fee_reason/.test(leaseUpdate.sql));

    const insert = pool.calls.find((c) => c.sql.startsWith('INSERT INTO member_fees'));
    // company, member, device, amount (dollars), reason, return_status
    assert.deepEqual(insert.values, [62, 158, 900, 250, 'Device not recovered', 'lost']);
  } finally {
    loaded.restore();
  }
});

test('B1.1: editing only expected_return_date never touches member_fees', async () => {
  const pool = createPool([showColumns, leaseUpdateOk]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      { body: feeUpdateBody({ expected_return_date: '2026-09-01' }) },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.fee, null);
    assert.ok(!pool.calls.some((c) => /member_fees/.test(c.sql)));
  } finally {
    loaded.restore();
  }
});

test('B1.1: a re-submitted declaration corrects the open fee instead of stacking a second debt', async () => {
  const pool = createPool([
    showColumns,
    feesTablePresent,
    leaseUpdateOk,
    [/^SELECT fee_id FROM member_fees/, [[{ fee_id: 7 }]]],
    [/^UPDATE member_fees/, [{ affectedRows: 1 }]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      {
        body: feeUpdateBody({
          returned: 1,
          return_status: 'damaged',
          fee_amount: 90,
          fee_reason: 'Cracked screen',
        }),
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.fee, { fee_id: 7, created: false });
    assert.ok(!pool.calls.some((c) => c.sql.startsWith('INSERT INTO member_fees')));
    const update = pool.calls.find((c) => c.sql.startsWith('UPDATE member_fees'));
    assert.deepEqual(update.values, [90, 'Cracked screen', 'damaged', 7]);
  } finally {
    loaded.restore();
  }
});

test('B1.1: a fee on a clean return is rejected and nothing is written', async () => {
  const pool = createPool([showColumns]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      { body: feeUpdateBody({ returned: 1, return_status: 'returned', fee_amount: 250 }) },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /lost.*damaged/);
    assert.ok(!pool.calls.some((c) => /^UPDATE|^INSERT/.test(c.sql)));
  } finally {
    loaded.restore();
  }
});

test('B1.1: fee_amount 0 is rejected before the lease is touched', async () => {
  const pool = createPool([showColumns]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      { body: feeUpdateBody({ returned: 1, return_status: 'lost', fee_amount: 0 }) },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.msg, /greater than 0/);
    assert.ok(!pool.calls.some((c) => /^UPDATE|^INSERT/.test(c.sql)));
  } finally {
    loaded.restore();
  }
});

test('B1.1: a fee added later reads return_status from the lease row', async () => {
  const pool = createPool([
    showColumns,
    feesTablePresent,
    [/^SELECT return_status FROM member_assigned_device_lease/, [[{ return_status: 'lost' }]]],
    [/^SELECT fee_id FROM member_fees/, [[]]],
    [/^INSERT INTO member_fees/, [{ insertId: 11 }]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    // fee only — the lease was already closed, so there is no lease UPDATE
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      { body: feeUpdateBody({ fee_amount: 120, fee_reason: 'Lost charger' }) },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.fee, { fee_id: 11, created: true });
    assert.equal(res.body.affectedRows, 0);
    assert.ok(!pool.calls.some((c) => c.sql.startsWith('UPDATE member_assigned_device_lease')));
  } finally {
    loaded.restore();
  }
});

test('B1.1: without the migration the lease still closes and the skip is reported', async () => {
  const pool = createPool([showColumns, feesTableMissing, leaseUpdateOk]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.updateMemberAssignedDeviceLeaseRow(
      { body: feeUpdateBody({ returned: 1, return_status: 'lost', fee_amount: 250 }) },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.affectedRows, 1);
    assert.match(res.body.fee_skipped, /add_member_fees\.sql/);
  } finally {
    loaded.restore();
  }
});

// --------------------------------------------------------------------------
// B1.3 — settling the fee once the money has moved
// --------------------------------------------------------------------------

const settleBody = (overrides = {}) => ({
  company_id: 62,
  member_id: 158,
  device_id: 900,
  paid_amount: 250.0,
  payment_intent: 'pi_3AbCdEfGhIjKlMnO',
  payment_method: 'credit_card',
  status: 'paid',
  ...overrides,
});

test('B1.3: settles the outstanding fee, taking the staff id from the JWT', async () => {
  const pool = createPool([
    feesTablePresent,
    [/^SELECT fee_id FROM member_fees WHERE payment_intent/, [[]]],
    [/^SELECT fee_id FROM member_fees WHERE company_id/, [[{ fee_id: 7 }]]],
    [/^UPDATE member_fees/, [{ affectedRows: 1 }]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.settleMemberFee(
      { body: settleBody(), sqlStaffId: 42 },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, fee_id: 7, created: false });

    const update = pool.calls.find((c) => c.sql.startsWith('UPDATE member_fees'));
    assert.equal(update.values[0], 'paid');
    assert.equal(update.values[1], 250); // dollars, not cents
    assert.equal(update.values[2], 'pi_3AbCdEfGhIjKlMnO');
    assert.equal(update.values[5], 42); // collected_by_staff_id from the token
    assert.equal(update.values[6], 7);
  } finally {
    loaded.restore();
  }
});

test('B1.3: a retry with the same payment_intent does not settle twice', async () => {
  const pool = createPool([
    feesTablePresent,
    [/^SELECT fee_id FROM member_fees WHERE payment_intent/, [[{ fee_id: 7 }]]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.settleMemberFee({ body: settleBody(), sqlStaffId: 42 }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, fee_id: 7, idempotent: true });
    assert.ok(!pool.calls.some((c) => /^UPDATE|^INSERT/.test(c.sql)));
  } finally {
    loaded.restore();
  }
});

test('B1.3: a charge for a device closed before fees existed creates the row', async () => {
  const pool = createPool([
    feesTablePresent,
    [/^SELECT fee_id FROM member_fees WHERE payment_intent/, [[]]],
    [/^SELECT fee_id FROM member_fees WHERE company_id/, [[]]],
    [/^INSERT INTO member_fees/, [{ insertId: 21 }]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.settleMemberFee(
      { body: settleBody({ fee_reason: 'Lost — not recovered', return_status: 'lost' }), sqlStaffId: 42 },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, fee_id: 21, created: true });
    const insert = pool.calls.find((c) => c.sql.startsWith('INSERT INTO member_fees'));
    // fee_amount falls back to the amount actually paid
    assert.equal(insert.values[3], 250);
    assert.equal(insert.values[6], 'paid');
  } finally {
    loaded.restore();
  }
});

test('B1.3: a fee_id belonging to another company is not settleable', async () => {
  const pool = createPool([
    feesTablePresent,
    [/^SELECT fee_id FROM member_fees WHERE payment_intent/, [[]]],
    [/^SELECT fee_id FROM member_fees WHERE fee_id/, [[]]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.settleMemberFee(
      { body: settleBody({ fee_id: 999, member_id: undefined, device_id: undefined }) },
      res
    );
    assert.equal(res.statusCode, 404);
  } finally {
    loaded.restore();
  }
});

test('B1.3: rejects incomplete or inconsistent settlements', async () => {
  const cases = [
    [{ company_id: undefined }, /company_id/],
    [{ member_id: undefined, device_id: undefined }, /fee_id/],
    [{ status: 'refunded' }, /paid.*waived/],
    [{ payment_method: 'bitcoin' }, /credit_card/],
    [{ payment_intent: undefined }, /payment_intent is required/],
    [{ paid_amount: undefined }, /paid_amount is required/],
    [{ paid_amount: 0 }, /greater than 0/],
  ];
  for (const [overrides, expected] of cases) {
    const pool = createPool([feesTablePresent]);
    const loaded = loadController({ pool });
    try {
      const res = createResponse();
      await loaded.controller.settleMemberFee({ body: settleBody(overrides) }, res);
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(overrides)}`);
      assert.match(res.body.msg, expected);
      assert.ok(!pool.calls.some((c) => /^UPDATE|^INSERT/.test(c.sql)));
    } finally {
      loaded.restore();
    }
  }
});

test('B1.3: without the migration the caller is told, not silently ignored', async () => {
  const pool = createPool([feesTableMissing]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.settleMemberFee({ body: settleBody() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.msg, /add_member_fees\.sql/);
  } finally {
    loaded.restore();
  }
});

// --------------------------------------------------------------------------
// B1.2 — reading fees
// --------------------------------------------------------------------------

const FEE_ROW = {
  fee_id: 1,
  member_id: 158,
  member_first_name: 'Blaise',
  member_last_name: 'Pascal',
  device_id: 900,
  serial_number: 'SN-1',
  device_category_name: 'Laptop',
  fee_amount: '250.00', // DECIMAL arrives from the driver as a string
  fee_reason: 'Device not recovered',
  status: 'outstanding',
  return_status: 'lost',
  payment_intent: null,
  paid_amount: null,
  payment_method: null,
  paid_at: null,
  collected_by_staff_id: null,
  created_at: '2026-06-02 14:30:00',
};

test('B1.2: the company-wide report carries the student name, so it needs no join', async () => {
  const pool = createPool([
    feesTablePresent,
    [/^SELECT mf\.fee_id FROM member_fees|^SELECT mf\.fee_id,/, [[FEE_ROW]]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.retrieveMemberFees({ body: { company_id: 62 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 1);
    const row = res.body.rows[0];
    assert.equal(row.member_first_name, 'Blaise');
    assert.equal(row.serial_number, 'SN-1');
    assert.equal(row.device_category_name, 'Laptop');
    // amounts are JSON numbers, and an uncollected fee stays null (not 0)
    assert.equal(row.fee_amount, 250);
    assert.equal(typeof row.fee_amount, 'number');
    assert.equal(row.paid_amount, null);
  } finally {
    loaded.restore();
  }
});

test('B1.2: member_id and status narrow the query', async () => {
  const pool = createPool([feesTablePresent, [/^SELECT mf\.fee_id,/, [[]]]]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.retrieveMemberFees(
      { body: { company_id: 62, member_id: 158, status: 'outstanding' } },
      res
    );
    assert.equal(res.statusCode, 200);
    const select = pool.calls.find((c) => c.sql.startsWith('SELECT mf.fee_id,'));
    assert.deepEqual(select.values, [62, 158, 'outstanding']);
    assert.match(select.sql, /mf\.member_id = \?/);
    assert.match(select.sql, /mf\.status = \?/);
  } finally {
    loaded.restore();
  }
});

test('B1.2: a debt survives a deleted roster row (LEFT JOIN, not INNER)', async () => {
  const pool = createPool([feesTablePresent, [/^SELECT mf\.fee_id,/, [[]]]]);
  const loaded = loadController({ pool });
  try {
    await loaded.controller.retrieveMemberFees({ body: { company_id: 62 } }, createResponse());
    const select = pool.calls.find((c) => c.sql.startsWith('SELECT mf.fee_id,'));
    assert.match(select.sql, /LEFT JOIN members_info/);
    assert.match(select.sql, /LEFT JOIN item_inv/);
    assert.doesNotMatch(select.sql, /(?<!LEFT )JOIN members_info/);
  } finally {
    loaded.restore();
  }
});

test('B1.2: rejects a missing company and an unknown status', async () => {
  for (const [body, expected] of [
    [{}, /company_id/],
    [{ company_id: 62, status: 'pending' }, /outstanding/],
  ]) {
    const pool = createPool([feesTablePresent]);
    const loaded = loadController({ pool });
    try {
      const res = createResponse();
      await loaded.controller.retrieveMemberFees({ body }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.msg, expected);
    } finally {
      loaded.restore();
    }
  }
});

test('B1.2: without the table it says so instead of reporting "no fees"', async () => {
  const pool = createPool([feesTableMissing]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.retrieveMemberFees({ body: { company_id: 62 } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.msg, /add_member_fees\.sql/);
  } finally {
    loaded.restore();
  }
});

test('B1.3: a waived fee needs no card and no amount', async () => {
  const pool = createPool([
    feesTablePresent,
    [/^SELECT fee_id FROM member_fees WHERE company_id/, [[{ fee_id: 7 }]]],
    [/^UPDATE member_fees/, [{ affectedRows: 1 }]],
  ]);
  const loaded = loadController({ pool });
  try {
    const res = createResponse();
    await loaded.controller.settleMemberFee(
      {
        body: {
          company_id: 62,
          member_id: 158,
          device_id: 900,
          status: 'waived',
          payment_method: 'waived',
        },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.fee_id, 7);
    const update = pool.calls.find((c) => c.sql.startsWith('UPDATE member_fees'));
    assert.equal(update.values[0], 'waived');
    assert.equal(update.values[1], null);
  } finally {
    loaded.restore();
  }
});
