const REMEMBER_KEY = 'pokerat-auth-remembered-user';
const SESSION_KEY = 'pokerat-auth-session-user';
const ATTEMPT_KEY = 'pokerat-auth-login-attempts';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 30_000;

export function normalizeUsername(value = '') {
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
}

export const normalizeLoginName = normalizeUsername;

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function normalizeLoginIdentifier(value = '') {
  const raw = String(value).trim();
  return raw.includes('@') ? normalizeEmail(raw) : normalizeUsername(raw);
}

export function validateUsername(value = '') {
  const raw = String(value).trim();
  const username = normalizeUsername(raw);
  if (raw.length < 3 || username.length < 3) return 'Username must contain at least 3 characters.';
  if (raw.length > 20 || username.length > 20) return 'Username must contain no more than 20 characters.';
  if (!/^[A-Za-z0-9_]+$/.test(raw)) return 'Use only letters, numbers or underscores.';
  return '';
}

export function validateEmail(value = '') {
  const email = normalizeEmail(value);
  if (!email) return 'Email is required.';
  if (email.length > 254) return 'Email is too long.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address.';
  return '';
}

export function validateDisplayName(value = '') {
  const name = String(value).trim().replace(/\s+/g, ' ');
  if (name.length < 3) return 'Display name must contain at least 3 characters.';
  if (name.length > 24) return 'Display name must contain no more than 24 characters.';
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return 'Use only letters, numbers, spaces, hyphens or underscores.';
  return '';
}

export function validatePassword(password = '') {
  const value = String(password);
  if (value.length < 8) return 'Password must contain at least 8 characters.';
  if (value.length > 64) return 'Password must contain no more than 64 characters.';
  return '';
}

export function createPasswordSalt() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

async function hashRawCredential(value, salt) {
  if (!salt) throw new Error('Password salt is missing.');
  if (!globalThis.crypto?.subtle) throw new Error('Secure password hashing requires a modern browser opened through Live Server.');
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  const validationError = validatePassword(password);
  if (validationError) throw new Error(validationError);
  return hashRawCredential(String(password), salt);
}

export async function verifyPassword(password, user) {
  if (!user?.password_salt || !user?.password_hash) return false;
  const isLegacyPin = user.password_format === 'legacy_pin';
  if (isLegacyPin ? !/^\d{6}$/.test(String(password)) : Boolean(validatePassword(password))) return false;
  const candidate = await hashRawCredential(String(password), user.password_salt);
  return timingSafeEqual(candidate, user.password_hash);
}

function timingSafeEqual(left = '', right = '') {
  const a = String(left); const b = String(right); let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  return mismatch === 0;
}

export function setAuthSession(userId, remember = false) {
  clearAuthSession();
  const storage = remember ? globalThis.localStorage : globalThis.sessionStorage;
  storage?.setItem(remember ? REMEMBER_KEY : SESSION_KEY, String(userId));
}
export function getAuthSessionUserId() { return globalThis.sessionStorage?.getItem(SESSION_KEY) || globalThis.localStorage?.getItem(REMEMBER_KEY) || null; }
export function clearAuthSession() { globalThis.sessionStorage?.removeItem(SESSION_KEY); globalThis.localStorage?.removeItem(REMEMBER_KEY); }
function readAttempts() { try { const parsed = JSON.parse(globalThis.localStorage?.getItem(ATTEMPT_KEY) || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
function writeAttempts(attempts) { globalThis.localStorage?.setItem(ATTEMPT_KEY, JSON.stringify(attempts)); }
export function getLoginLock(identifier) { const key = normalizeLoginIdentifier(identifier); if (!key) return { locked: false, secondsRemaining: 0 }; const attempts = readAttempts(); const entry = attempts[key]; if (!entry?.lockedUntil) return { locked: false, secondsRemaining: 0 }; const remaining = Number(entry.lockedUntil) - Date.now(); if (remaining <= 0) { delete attempts[key]; writeAttempts(attempts); return { locked: false, secondsRemaining: 0 }; } return { locked: true, secondsRemaining: Math.ceil(remaining / 1000) }; }
export function recordFailedLogin(identifier) { const key = normalizeLoginIdentifier(identifier); if (!key) return getLoginLock(key); const attempts = readAttempts(); const current = attempts[key] || { count: 0, lockedUntil: 0 }; current.count += 1; if (current.count >= MAX_ATTEMPTS) { current.count = 0; current.lockedUntil = Date.now() + LOCK_MS; } attempts[key] = current; writeAttempts(attempts); return getLoginLock(key); }
export function clearLoginAttempts(identifier) { const key = normalizeLoginIdentifier(identifier); if (!key) return; const attempts = readAttempts(); delete attempts[key]; writeAttempts(attempts); }
