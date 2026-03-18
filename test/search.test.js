const test = require('node:test');
const assert = require('node:assert/strict');
// Assuming search.js is in the controller directory, and this test is in the test directory
const { buildDateRangeQuery } = require('../controller/search.js');

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
