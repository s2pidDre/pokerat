import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClosedTableLeaderboard } from '../src/utils/leaderboard.js';

const users = [
  { id: 'a', display_name: 'Alex', is_admin: false },
  { id: 'b', display_name: 'Ben', is_admin: false },
  { id: 'admin', display_name: 'Admin', is_admin: true }
];

test('global leaderboard totals Supabase session results from closed tables', () => {
  const leaderboard = buildClosedTableLeaderboard({
    users,
    sessionResults: [
      { session_id: 'one', user_id: 'a', cash_in: 500, cash_out: 800, net: 300 },
      { session_id: 'two', user_id: 'a', cash_in: 700, cash_out: 400, net: -300 },
      { session_id: 'one', user_id: 'b', cash_in: 500, cash_out: 200, net: -300 },
      { session_id: 'two', user_id: 'b', cash_in: 300, cash_out: 900, net: 600 },
      { session_id: 'one', user_id: 'admin', cash_in: 1, cash_out: 1000, net: 999 },
      { session_id: 'three', user_id: 'b', cash_in: 0, cash_out: 0, net: 0 }
    ]
  });

  assert.equal(leaderboard.length, 3);
  assert.equal(leaderboard[0].userId, 'admin');
  assert.equal(leaderboard[0].net, 999);
  assert.equal(leaderboard[0].tableCount, 1);
  assert.equal(leaderboard[1].userId, 'b');
  assert.equal(leaderboard[1].net, 300);
  assert.equal(leaderboard[1].tableCount, 2);
  assert.equal(leaderboard[2].userId, 'a');
  assert.equal(leaderboard[2].net, 0);
  assert.equal(leaderboard[2].wins, 1);
  assert.equal(leaderboard[2].losses, 1);
});


test('database schema enforces one globally open table and exposes it for discovery', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/table-system.sql', import.meta.url), 'utf8');
  assert.match(sql, /poker_tables_single_open_idx/);
  assert.match(sql, /status in \('lobby', 'active'\)/);
  assert.match(sql, /A table is already open\. Join it or wait until it is finished\./);
});


test('profile schema enforces the 90-day display-name cooldown', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /display_name_changed_at timestamptz/);
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /if current_profile\.display_name = p_display_name then return/);
});

test('player performance builds a closed-table win and loss trend', async () => {
  const { buildPlayerPerformance } = await import('../src/utils/leaderboard.js');
  const performance = buildPlayerPerformance({
    userId: 'a',
    sessions: [
      { id: 'one', name: 'Friday Game', session_code: 'PKR-ONE' },
      { id: 'two', name: 'Sunday Game', session_code: 'PKR-TWO' },
      { id: 'three', name: 'Even Game', session_code: 'PKR-THR' }
    ],
    sessionResults: [
      { session_id: 'two', user_id: 'a', cash_in: 500, cash_out: 300, net: -200, created_at: '2026-07-02T10:00:00Z' },
      { session_id: 'one', user_id: 'a', cash_in: 500, cash_out: 800, net: 300, created_at: '2026-07-01T10:00:00Z' },
      { session_id: 'three', user_id: 'a', cash_in: 200, cash_out: 200, net: 0, created_at: '2026-07-03T10:00:00Z' }
    ]
  });

  assert.equal(performance.tableCount, 3);
  assert.equal(performance.wins, 1);
  assert.equal(performance.losses, 1);
  assert.equal(performance.even, 1);
  assert.equal(performance.winRate, 33);
  assert.equal(performance.net, 100);
  assert.deepEqual(performance.points.map(point => point.cumulativeNet), [300, 100, 100]);
  assert.deepEqual(performance.points.map(point => point.outcome), ['win', 'loss', 'even']);
});
