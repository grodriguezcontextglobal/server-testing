'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { chunkArray } = require('../helpers/chunkArray');

describe('chunkArray', () => {
  it('splits an array into chunks of the given size, last chunk may be smaller', () => {
    const result = chunkArray([1, 2, 3, 4, 5], 2);
    assert.deepEqual(result, [[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size >= length', () => {
    assert.deepEqual(chunkArray([1, 2], 10), [[1, 2]]);
  });

  it('returns an empty array for an empty input', () => {
    assert.deepEqual(chunkArray([], 100), []);
  });

  it('throws on a non-positive or non-integer size', () => {
    assert.throws(() => chunkArray([1], 0));
    assert.throws(() => chunkArray([1], -5));
    assert.throws(() => chunkArray([1], 1.5));
  });
});
