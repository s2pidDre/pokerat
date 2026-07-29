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

export function getLoginLock(identifier) {
  const key = normalizeLoginIdentifier(identifier);
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

export function recordFailedLogin(identifier) {
  const key = normalizeLoginIdentifier(identifier);
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

export function clearLoginAttempts(identifier) {
  const key = normalizeLoginIdentifier(identifier);
  if (!key) return;
  const attempts = readAttempts();
  delete attempts[key];
  writeAttempts(attempts);
}
