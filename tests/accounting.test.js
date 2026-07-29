import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTableFunds, playerSummary, sessionDiscrepancy, toAmount } from '../src/utils/accounting.js';
const transactions = [
  { player_id: 'a', transaction_type: 'buy_in', amount: 1000, is_reversed: false },
  { player_id: 'b', transaction_type: 'buy_in', amount: 1500, is_reversed: false },
  { player_id: 'a', transaction_type: 'cash_out', amount: 1800, is_reversed: false },
  { player_id: 'b', transaction_type: 'cash_out', amount: 600, is_reversed: false }
];
test('calculates available funds', () => assert.equal(availableTableFunds(transactions), 100));
test('calculates player summaries', () => assert.deepEqual(playerSummary(transactions, 'a'), { buyIn: 1000, cashOut: 1800, net: 800 }));
test('ignores reversed entries', () => assert.equal(availableTableFunds([...transactions, { transaction_type: 'buy_in', amount: 5000, is_reversed: true }]), 100));
test('calculates discrepancy', () => assert.equal(sessionDiscrepancy(transactions, 80), -20));
test('rounds amounts', () => assert.equal(toAmount('10.239'), 10.24));
