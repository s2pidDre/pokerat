import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/lib/app-data.js';
import { normalizeEmail, normalizeLoginIdentifier, normalizeUsername, validateEmail, validatePassword, validateUsername } from '../src/utils/auth.js';

test('new app data starts empty', () => {
  const data = createEmptyData();
  assert.deepEqual(data.users, []);
  assert.deepEqual(data.sessions, []);
  assert.deepEqual(data.requests, { join: [], buyin: [], cashout: [] });
});

test('username, email and password rules are simple', () => {
  assert.equal(normalizeUsername('  Mark_23 '), 'mark_23');
  assert.equal(normalizeEmail(' Mark@Example.COM '), 'mark@example.com');
  assert.equal(normalizeLoginIdentifier('Mark_23'), 'mark_23');
  assert.equal(normalizeLoginIdentifier('Mark@Example.COM'), 'mark@example.com');
  assert.equal(validateUsername('Mark_23'), '');
  assert.match(validateUsername('A'), /at least 3/);
  assert.equal(validateEmail('mark@example.com'), '');
  assert.match(validateEmail('mark'), /valid email/);
  assert.equal(validatePassword('password123'), '');
  assert.match(validatePassword('short'), /at least 8/);
});

test('password rules match the Supabase form', () => {
  assert.equal(validatePassword('password123'), '');
  assert.match(validatePassword('1234567'), /at least 8/);
  assert.match(validatePassword('x'.repeat(65)), /no more than 64/);
});

test('account screens and administrator controls render', async () => {
  const { accountAccessView, adminView, forcePasswordChangeView, initialAdminSetupView, profileView } = await import('../src/components/templates.js');
  assert.match(initialAdminSetupView(), /name="email"/);
  assert.match(accountAccessView({ mode: 'login' }), /Username or email/);
  assert.match(accountAccessView({ mode: 'login' }), /Remember me/);
  assert.match(accountAccessView({ mode: 'register' }), /name="email"/);
  assert.doesNotMatch(accountAccessView({ mode: 'login' }), /Admin login/);
  assert.match(forcePasswordChangeView({ display_name: 'Mark', email: '' }), /forced-password-change-form/);
  const pending = { id: 'u-new', display_name: 'Mark', login_name: 'mark', email: 'mark@example.com', account_status: 'pending', is_admin: false, created_at: new Date().toISOString() };
  assert.match(adminView([pending], [], [], 'u-admin'), /mark@example.com/);
  assert.match(adminView([pending], [], [], 'u-admin'), /data-admin-registration-approve="u-new"/);
  const profile = { ...pending, account_status: 'active', display_name_changed_at: null };
  const profileHtml = profileView(profile);
  assert.doesNotMatch(profileHtml, /name="email"/);
  assert.match(profileHtml, /cannot be changed here/);
  assert.match(profileHtml, /90 days/);
});

test('small UI cleanup and player performance views render', async () => {
  const { appShell, modalTemplate, playerProfileView, profileView } = await import('../src/components/templates.js');
  const player = {
    id: 'player-one',
    display_name: 'Ferry Player',
    login_name: 'ferry',
    email: 'ferry@example.com',
    is_admin: false,
    display_name_changed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  };
  const shell = appShell({ profile: player, isAdmin: false, route: '#/home', content: '', notificationCount: 120 });
  assert.doesNotMatch(shell, />Tables</);
  assert.match(shell, />99\+</);

  const lockedProfile = profileView(player);
  assert.match(lockedProfile, /profile-name-locked/);
  assert.doesNotMatch(lockedProfile, /name="displayName"/);
  assert.match(lockedProfile, /View performance/);

  const performance = {
    tableCount: 2,
    wins: 1,
    losses: 1,
    even: 0,
    winRate: 50,
    cashIn: 1000,
    cashOut: 1100,
    net: 100,
    points: [
      { sessionId: 'one', sessionName: 'First table', sessionCode: 'PKR-ONE', playedAt: '2026-07-01T10:00:00Z', net: 300, cumulativeNet: 300, outcome: 'win' },
      { sessionId: 'two', sessionName: 'Second table', sessionCode: 'PKR-TWO', playedAt: '2026-07-02T10:00:00Z', net: -200, cumulativeNet: 100, outcome: 'loss' }
    ]
  };
  const playerHtml = playerProfileView({ player, performance, isCurrentUser: true });
  assert.match(playerHtml, /Performance trend/);
  assert.match(playerHtml, /performance-point--win/);
  assert.match(playerHtml, /performance-point--loss/);

  assert.match(modalTemplate('hard-reset'), /RESET POKERAT/);
  assert.match(modalTemplate('admin-account-status', { status: 'suspended', userId: 'x', userName: 'X' }), /admin-account-status-form/);
  assert.match(modalTemplate('review-report', { status: 'resolved', reportId: 'r' }), /review-report-form/);
});

test('admin actions no longer use browser prompts', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /\bprompt\s*\(/);
  assert.match(main, /review-report-form/);
  assert.match(main, /admin-account-status-form/);
});

test('performance ranges, history filters and admin tools render', async () => {
  const { adminView, historyView, notificationList, playerProfileView } = await import('../src/components/templates.js');
  const player = { id: 'p1', display_name: 'Player One', login_name: 'player1', is_admin: false };
  const performance = {
    tableCount: 2,
    wins: 1,
    losses: 1,
    even: 0,
    winRate: 50,
    cashIn: 1000,
    cashOut: 1100,
    net: 100,
    points: [
      { sessionId: 's1', sessionName: 'First table', sessionCode: 'ONE', playedAt: '2026-07-01T10:00:00Z', cashIn: 500, cashOut: 800, net: 300, cumulativeNet: 300, outcome: 'win' },
      { sessionId: 's2', sessionName: 'Second table', sessionCode: 'TWO', playedAt: '2026-07-02T10:00:00Z', cashIn: 500, cashOut: 300, net: -200, cumulativeNet: 100, outcome: 'loss' }
    ]
  };
  const profileHtml = playerProfileView({ player, performance, graphRange: '10', backRoute: 'admin', backLabel: 'Back to Admin' });
  assert.match(profileHtml, /data-performance-range="10"/);
  assert.match(profileHtml, /data-performance-point/);
  assert.match(profileHtml, /data-point-cash-in/);
  assert.match(profileHtml, /Back to Admin/);

  const historyHtml = historyView({
    sessions: [
      { id: 's1', name: 'Finished', status: 'closed', session_code: 'ONE', host_user_id: 'p1', host: player, session_members: [], duration_seconds: 600, created_at: '2026-07-01T10:00:00Z' },
      { id: 's2', name: 'Cancelled', status: 'cancelled', session_code: 'TWO', host_user_id: 'p1', host: player, session_members: [], created_at: '2026-07-02T10:00:00Z' }
    ],
    profileId: 'p1',
    results: [{ session_id: 's1', user_id: 'p1', net: 300 }],
    filter: 'all'
  });
  assert.match(historyHtml, /data-history-filter="finished"/);
  assert.match(historyHtml, /Your result/);
  assert.match(historyHtml, /No performance result recorded/);

  const adminHtml = adminView([
    { ...player, account_status: 'active', email: 'one@example.com' },
    { id: 'p2', display_name: 'Suspended Player', login_name: 'p2', email: 'two@example.com', account_status: 'suspended', is_admin: false }
  ], [], [
    { id: 'r1', session_name: 'Open report', reporter_name: 'Player One', details: 'Details', status: 'open', created_at: '2026-07-01T10:00:00Z' },
    { id: 'r2', session_name: 'Past report', reporter_name: 'Player One', details: 'Done', status: 'resolved', created_at: '2026-07-01T10:00:00Z' }
  ], 'admin', { search: '', filter: 'all' });
  assert.match(adminHtml, /data-admin-user-search/);
  assert.match(adminHtml, /data-admin-user-filter="suspended"/);
  assert.match(adminHtml, /Past reports/);

  const notificationHtml = notificationList([{ id: 'n1', title: 'Update', message: 'Done', created_at: new Date().toISOString(), read_at: null }]);
  assert.match(notificationHtml, /data-mark-notification-read="n1"/);
});

test('admin history deletion and compact audit views render', async () => {
  const { adminView, auditLogView, historyView, modalTemplate } = await import('../src/components/templates.js');
  const admin = { id: 'admin', display_name: 'Admin User', login_name: 'admin', email: 'admin@example.com', account_status: 'active', is_admin: true };
  const table = { id: 's1', name: 'Finished Table', status: 'closed', session_code: 'PKR-ABCD', host_user_id: 'admin', host: admin, session_members: [], duration_seconds: 900, created_at: '2026-07-01T10:00:00Z' };

  const adminHistory = historyView({ sessions: [table], profileId: 'admin', results: [], filter: 'all', isAdmin: true });
  assert.match(adminHistory, /data-delete-history-table="s1"/);
  const playerHistory = historyView({ sessions: [table], profileId: 'player', results: [], filter: 'all', isAdmin: false });
  assert.doesNotMatch(playerHistory, /data-delete-history-table/);

  const adminHtml = adminView([admin], [], [], 'admin');
  assert.match(adminHtml, /section-heading__badge--text">Admin only/);
  assert.match(adminHtml, /View full audit log/);

  const logs = Array.from({ length: 30 }, (_, index) => ({
    id: `a${index}`,
    action: 'session_closed',
    actor: admin,
    details: {},
    created_at: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T10:00:00Z`
  }));
  const auditHtml = auditLogView({ logs, totalCount: 30, controls: { category: 'all', range: 'all', visibleCount: 25 } });
  assert.match(auditHtml, /data-audit-search/);
  assert.match(auditHtml, /data-audit-category="money"/);
  assert.match(auditHtml, /data-audit-load-more/);
  assert.match(auditHtml, /Export CSV/);

  const deleteModal = modalTemplate('delete-history-table', { tableId: 's1', tableName: 'Finished Table', tableCode: 'PKR-ABCD' });
  assert.match(deleteModal, /delete-history-table-form/);
  assert.match(deleteModal, /DELETE PKR-ABCD/);
});

test('realtime registration dialog supports review later', async () => {
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
  const accountService = await readFile(new URL('../src/lib/account-service.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(ui, /dataset\.adminRegistrationReviewLater/);
  assert.match(ui, /Review later/);
  assert.match(accountService, /payload => onChange\(payload\)/);
  assert.match(main, /payload\?\.eventType === 'INSERT'/);
  assert.match(main, /routeAdminToPendingRequestsOnce/);
});

test('mobile auth and notification layouts use compact non-overlapping structures', async () => {
  const { accountAccessView, modalTemplate } = await import('../src/components/templates.js');
  const { readFile } = await import('node:fs/promises');
  const login = accountAccessView({ mode: 'login' });
  const register = accountAccessView({ mode: 'register' });
  const notifications = modalTemplate('notifications', {
    notifications: [{ id: 'n1', title: 'Table finished', message: 'You finished even.', created_at: new Date().toISOString(), read_at: null, delivery: 'final_result' }]
  });

  assert.match(login, /access-screen--login/);
  assert.match(login, /Log in to continue\./);
  assert.doesNotMatch(login, /Do not use this on a shared device/);
  assert.match(register, /access-screen--register/);
  assert.match(register, /Admin approval is required\./);
  assert.match(notifications, /modal__card--notifications/);

  const css = await readFile(new URL('../src/styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /RESPONSIVE STABILITY \+ MOBILE LAYOUT/);
  assert.match(css, /grid-template-columns: 36px minmax\(0, 1fr\)/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /min-height: calc\(100dvh - 84px\)/);
  assert.match(css, /leaderboard-player strong,[\s\S]*white-space: normal/);
  assert.match(css, /access-screen--login \.access-card::before/);
});

test('installed app icons are opaque maskable PNGs', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  const pngIcons = manifest.icons.filter(icon => icon.type === 'image/png');
  assert.equal(pngIcons.length, 2);
  assert.ok(pngIcons.every(icon => icon.purpose.includes('maskable')));

  for (const file of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    const bytes = await readFile(new URL(`../icons/${file}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(bytes[25], 2, `${file} should use opaque RGB color type`);
  }
});
