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
  assert.equal(performance.bestResult, 300);
  assert.equal(performance.biggestLoss, -200);
  assert.deepEqual(performance.currentStreak, { outcome: 'even', count: 1 });
  assert.equal(performance.longestWinStreak, 1);
  assert.deepEqual(performance.points.map(point => point.cumulativeNet), [300, 100, 100]);
  assert.deepEqual(performance.points.map(point => point.outcome), ['win', 'loss', 'even']);
});

test('realtime banner and removed requests route are wired into the interface', async () => {
  const { readFile } = await import('node:fs/promises');
  const { appShell } = await import('../src/components/templates.js');
  const shell = appShell({
    profile: { display_name: 'Player' },
    isAdmin: false,
    route: '#/home',
    content: '',
    connectionStatus: 'disconnected'
  });
  assert.match(shell, /Connection lost/);
  assert.match(shell, /data-refresh-realtime/);

  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const templates = await readFile(new URL('../src/components/templates.js', import.meta.url), 'utf8');
  assert.match(main, /data-performance-range/);
  assert.match(main, /data-history-filter/);
  assert.match(main, /data-mark-notification-read/);
  assert.doesNotMatch(main, /case 'requests'/);
  assert.doesNotMatch(templates, /export function requestsView/);
});

test('admin can permanently delete only finished tables through a protected RPC', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/table-system.sql', import.meta.url), 'utf8');
  assert.match(sql, /admin_delete_poker_table/);
  assert.match(sql, /table_row\.status not in \('closed', 'cancelled'\)/);
  assert.match(sql, /expected_confirmation := 'DELETE ' \|\| table_row\.session_code/);
  assert.match(sql, /grant execute on function public\.admin_delete_poker_table\(uuid, text\) to authenticated/);
  assert.match(sql, /truncate table[\s\S]*public\.poker_tables/);
  assert.match(sql, /drop table if exists public\.session_reports cascade/);
  assert.match(sql, /drop table if exists public\.audit_logs cascade/);
  assert.doesNotMatch(sql, /'reports'\s*,\s*coalesce|'auditLogs'\s*,\s*coalesce/);
});

test('admin edge function repairs clear activity and hard reset', async () => {
  const { readFile } = await import('node:fs/promises');
  const edge = await readFile(new URL('../supabase/functions/admin-account/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /action === 'clear_activity'/);
  assert.match(edge, /admin\.rpc\('admin_clear_activity'\)/);
  assert.match(edge, /confirmation !== 'RESET POKERAT'/);
  assert.match(edge, /admin\.auth\.admin\.deleteUser/);
});

test('realtime money requests reopen the host approval popup and the themed notification icon renders', async () => {
  const { readFile } = await import('node:fs/promises');
  const { appShell } = await import('../src/components/templates.js');
  const shell = appShell({
    profile: { id: 'host', display_name: 'Host Player', account_status: 'active' },
    isAdmin: false,
    route: '#/home',
    content: '',
    notificationCount: 2
  });

  assert.match(shell, /system-notification-icon/);
  assert.doesNotMatch(shell, /🔔/);

  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles/main.css', import.meta.url), 'utf8');
  assert.match(main, /table === 'money_requests' && payload\?\.eventType === 'INSERT'/);
  assert.match(main, /syncHostMoneyApprovalQueue\(currentUser\(\)\)/);
  assert.match(css, /TEXT-SAFETY \+ THEMED NOTIFICATION ICON/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test('realtime money requests reopen the host approval popup and the themed notification icon renders', async () => {
  const { readFile } = await import('node:fs/promises');
  const { appShell } = await import('../src/components/templates.js');
  const shell = appShell({
    profile: { id: 'host', display_name: 'Host Player', account_status: 'active' },
    isAdmin: false,
    route: '#/home',
    content: '',
    notificationCount: 2
  });

  assert.match(shell, /system-notification-icon/);
  assert.doesNotMatch(shell, /🔔/);

  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles/main.css', import.meta.url), 'utf8');
  assert.match(main, /table === 'money_requests' && payload\?\.eventType === 'INSERT'/);
  assert.match(main, /syncHostMoneyApprovalQueue\(currentUser\(\)\)/);
  assert.match(css, /TEXT-SAFETY \+ THEMED NOTIFICATION ICON/);
  assert.match(css, /overflow-wrap: anywhere/);
});
