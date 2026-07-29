import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/lib/app-data.js';
import { hashPassword, normalizeEmail, normalizeLoginIdentifier, normalizeUsername, validateEmail, validatePassword, validateUsername, verifyPassword } from '../src/utils/auth.js';

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

test('password hashes verify without storing the password', async () => {
  const user = {
    password_salt: 'test-salt',
    password_hash: await hashPassword('password123', 'test-salt'),
    password_format: 'password'
  };
  assert.equal(await verifyPassword('password123', user), true);
  assert.equal(await verifyPassword('wrongpass', user), false);
  assert.equal(user.password_hash.length, 64);
});

test('account screens and administrator controls render', async () => {
  const { accountAccessView, adminView, forcePasswordChangeView, initialAdminSetupView } = await import('../src/components/templates.js');
  assert.match(initialAdminSetupView(), /name="email"/);
  assert.match(accountAccessView({ mode: 'login' }), /Username or email/);
  assert.match(accountAccessView({ mode: 'login' }), /Remember me/);
  assert.match(accountAccessView({ mode: 'register' }), /name="email"/);
  assert.doesNotMatch(accountAccessView({ mode: 'login' }), /Admin login/);
  assert.match(forcePasswordChangeView({ display_name: 'Mark', email: '' }), /forced-password-change-form/);
  const pending = { id: 'u-new', display_name: 'Mark', login_name: 'mark', email: 'mark@example.com', account_status: 'pending', is_admin: false, created_at: new Date().toISOString() };
  assert.match(adminView([pending], [], [], 'u-admin'), /mark@example.com/);
  assert.match(adminView([pending], [], [], 'u-admin'), /data-admin-registration-approve="u-new"/);
});
