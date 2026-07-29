import test from 'node:test';
import assert from 'node:assert/strict';
import { validAmount } from '../src/utils/validation.js';

test('validates amount range', () => {
  assert.equal(validAmount(500, { min: 100, max: 1000 }), '');
  assert.match(validAmount(50, { min: 100 }), /at least/i);
});
