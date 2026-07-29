const REMEMBER_KEY = 'pokerat-auth-remembered-user';
const SESSION_KEY = 'pokerat-auth-session-user';
const ATTEMPT_KEY = 'pokerat-auth-login-attempts';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 30_000;

export function normalizeLoginName(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function validatePlayerName(value = '') {
  const name = String(value).trim().replace(/\s+/g, ' ');
  if (name.length < 3) return 'Player name must contain at least 3 characters.';
  if (name.length > 24) return 'Player name must contain no more than 24 characters.';
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return 'Use only letters, numbers, spaces, hyphens or underscores.';
  return '';
}

export function validatePin(pin = '') {
  return /^\d{6}$/.test(String(pin)) ? '' : 'PIN must contain exactly 6 numbers.';
}

export function createPinSalt() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export async function hashPin(pin, salt) {
  const validationError = validatePin(pin);
  if (validationError) throw new Error(validationError);
  if (!salt) throw new Error('PIN salt is missing.');
  if (!globalThis.crypto?.subtle) throw new Error('Secure PIN hashing requires a modern browser opened through Live Server.');

  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin, user) {
  if (!user?.pin_salt || !user?.pin_hash || validatePin(pin)) return false;
  const candidate = await hashPin(pin, user.pin_salt);
  return timingSafeEqual(candidate, user.pin_hash);
}

function timingSafeEqual(left = '', right = '') {
  const a = String(left);
  const b = String(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

export function setAuthSession(userId, remember = false) {
  clearAuthSession();
  const storage = remember ? globalThis.localStorage : globalThis.sessionStorage;
  storage?.setItem(remember ? REMEMBER_KEY : SESSION_KEY, String(userId));
}

export function getAuthSessionUserId() {
  return globalThis.sessionStorage?.getItem(SESSION_KEY) || globalThis.localStorage?.getItem(REMEMBER_KEY) || null;
}

export function clearAuthSession() {
  globalThis.sessionStorage?.removeItem(SESSION_KEY);
  globalThis.localStorage?.removeItem(REMEMBER_KEY);
}

function readAttempts() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(ATTEMPT_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAttempts(attempts) {
  globalThis.localStorage?.setItem(ATTEMPT_KEY, JSON.stringify(attempts));
}

export function getLoginLock(loginName) {
  const key = normalizeLoginName(loginName);
  if (!key) return { locked: false, secondsRemaining: 0 };
  const attempts = readAttempts();
  const entry = attempts[key];
  if (!entry?.lockedUntil) return { locked: false, secondsRemaining: 0 };
  const remaining = Number(entry.lockedUntil) - Date.now();
  if (remaining <= 0) {
    delete attempts[key];
    writeAttempts(attempts);
    return { locked: false, secondsRemaining: 0 };
  }
  return { locked: true, secondsRemaining: Math.ceil(remaining / 1000) };
}

export function recordFailedLogin(loginName) {
  const key = normalizeLoginName(loginName);
  if (!key) return getLoginLock(key);
  const attempts = readAttempts();
  const current = attempts[key] || { count: 0, lockedUntil: 0 };
  current.count += 1;
  if (current.count >= MAX_ATTEMPTS) {
    current.count = 0;
    current.lockedUntil = Date.now() + LOCK_MS;
  }
  attempts[key] = current;
  writeAttempts(attempts);
  return getLoginLock(key);
}

export function clearLoginAttempts(loginName) {
  const key = normalizeLoginName(loginName);
  if (!key) return;
  const attempts = readAttempts();
  delete attempts[key];
  writeAttempts(attempts);
}
