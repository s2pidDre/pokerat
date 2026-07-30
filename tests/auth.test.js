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
