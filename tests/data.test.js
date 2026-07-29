import test from 'node:test';
import assert from 'node:assert/strict';
import { clearActivityData, createEmptyData, loadAppData, resetAppData, saveAppData } from '../src/lib/app-data.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear()
  };
}

test('app storage starts empty and resets to first setup', () => {
  globalThis.localStorage = memoryStorage();
  assert.deepEqual(loadAppData().users, []);
  const reset = resetAppData();
  assert.deepEqual(reset.users, []);
  assert.deepEqual(loadAppData().sessions, []);
});

test('clearing activity preserves registered users', () => {
  globalThis.localStorage = memoryStorage();
  const data = createEmptyData();
  data.users.push({
    id: '11111111-1111-4111-8111-111111111111',
    display_name: 'Owner',
    login_name: 'owner',
    email: 'owner@example.com',
    account_status: 'active',
    is_admin: true,
    password_salt: 'salt',
    password_hash: 'hash',
    password_format: 'password',
    must_change_password: false,
    approved_at: new Date().toISOString(),
    approved_by: 'system',
    rejected_at: null,
    rejected_by: null,
    last_login_at: null,
    created_at: new Date().toISOString()
  });
  data.sessions.push({ id: 's-one', session_code: 'PKR-ABCD', name: 'Game', host_user_id: '11111111-1111-4111-8111-111111111111', status: 'lobby', created_at: new Date().toISOString() });
  saveAppData(data);
  const cleared = clearActivityData(loadAppData());
  assert.equal(cleared.users.length, 1);
  assert.equal(cleared.users[0].id, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(cleared.sessions, []);
});
