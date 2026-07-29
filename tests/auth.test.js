import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/lib/app-data.js';
import { hashPin, normalizeLoginName, validatePin, validatePlayerName, verifyPin } from '../src/utils/auth.js';

test('new app data starts empty', () => {
  const data = createEmptyData();
  assert.deepEqual(data.users, []);
  assert.deepEqual(data.sessions, []);
  assert.deepEqual(data.requests, { join: [], buyin: [], cashout: [] });
});

test('player names and PINs use simple rules', () => {
  assert.equal(normalizeLoginName('  Mark   Lee '), 'mark lee');
  assert.equal(validatePlayerName('Mark_23'), '');
  assert.match(validatePlayerName('A'), /at least 3/);
  assert.equal(validatePin('123456'), '');
  assert.match(validatePin('1234'), /exactly 6/);
});

test('PIN hashes verify without storing the PIN', async () => {
  const user = {
    pin_salt: 'test-salt',
    pin_hash: await hashPin('654321', 'test-salt')
  };
  assert.equal(await verifyPin('654321', user), true);
  assert.equal(await verifyPin('111111', user), false);
  assert.equal(user.pin_hash.length, 64);
});

test('account screens and administrator controls render', async () => {
  const { accountAccessView, adminView, forcePinChangeView, initialAdminSetupView } = await import('../src/components/templates.js');
  assert.match(initialAdminSetupView(), /id="initial-admin-form"/);
  assert.match(accountAccessView({ mode: 'login' }), /id="login-form"/);
  assert.match(accountAccessView({ mode: 'login' }), /Remember me/);
  assert.match(accountAccessView({ mode: 'register' }), /id="register-form"/);
  assert.doesNotMatch(accountAccessView({ mode: 'login' }), /Admin login/);
  assert.match(forcePinChangeView({ display_name: 'Mark' }), /forced-pin-change-form/);
  const pending = { id: 'u-new', display_name: 'Mark', login_name: 'mark', account_status: 'pending', is_admin: false, created_at: new Date().toISOString() };
  assert.match(adminView([pending], [], [], 'u-admin'), /data-admin-registration-approve="u-new"/);
  assert.doesNotMatch(adminView([pending], [], [], 'u-admin'), /data-admin-load/);
});
