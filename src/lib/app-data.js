const STORAGE_KEY = 'pokerat-app-v1';
const LEGACY_STORAGE_KEY = 'pokerat-local-prototype-v1';
const SCHEMA_VERSION = 17;

const LEGACY_SEED_USER_IDS = new Set(['u-host', 'u-player', 'u-carlo', 'u-dana', 'u-admin']);
const LEGACY_SEED_SESSION_IDS = new Set(['s-friday', 's-weekend', 's-sunday', 's-open', 's-closed']);

const arrayOrEmpty = value => Array.isArray(value) ? value : [];
const stringOrEmpty = value => typeof value === 'string' ? value : '';
const numberOrNull = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const normalizeLoginName = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
const normalizeEmail = value => String(value || '').trim().toLowerCase();

const notificationTypeFromTitle = title => {
  const value = String(title || '').toLowerCase();
  if (value.includes('reject') || value.includes('removed') || value.includes('cancel')) return 'rejected';
  if (value.includes('approved') || value.includes('joined') || value.includes('started')) return 'approved';
  if (value.includes('request') || value.includes('review') || value.includes('needs')) return 'request';
  return 'info';
};

export function createEmptyData() {
  return {
    meta: { schemaVersion: SCHEMA_VERSION, storage_notice: '', hasActiveAdministrator: false },
    currentUserId: null,
    users: [],
    sessions: [],
    members: [],
    transactions: [],
    requests: { join: [], buyin: [], cashout: [] },
    notifications: [],
    sessionResults: []
  };
}

function normalizeUser(user) {
  if (!user || !stringOrEmpty(user.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) return null;
  const displayName = stringOrEmpty(user.display_name) || 'Player';
  const loginName = normalizeLoginName(user.login_name || displayName);
  const status = ['pending', 'active', 'rejected', 'suspended'].includes(user.account_status)
    ? user.account_status
    : 'active';
  const legacyPinHash = stringOrEmpty(user.pin_hash);
  const passwordSalt = stringOrEmpty(user.password_salt) || stringOrEmpty(user.pin_salt);
  const passwordHash = stringOrEmpty(user.password_hash) || legacyPinHash;
  const passwordFormat = stringOrEmpty(user.password_format) || (legacyPinHash ? 'legacy_pin' : 'password');

  return {
    id: user.id,
    display_name: displayName,
    login_name: loginName,
    email: normalizeEmail(user.email),
    account_status: status,
    is_admin: Boolean(user.is_admin),
    password_salt: passwordSalt,
    password_hash: passwordHash,
    password_format: passwordFormat,
    status_note: stringOrEmpty(user.status_note),
    must_change_password: Boolean(user.must_change_password || (passwordFormat !== 'supabase' && (user.must_change_pin || passwordFormat === 'legacy_pin' || !normalizeEmail(user.email) || (!passwordHash && !user.is_admin)))),
    approved_at: stringOrEmpty(user.approved_at) || (status === 'active' ? stringOrEmpty(user.created_at) || new Date().toISOString() : null),
    approved_by: stringOrEmpty(user.approved_by) || null,
    rejected_at: stringOrEmpty(user.rejected_at) || null,
    rejected_by: stringOrEmpty(user.rejected_by) || null,
    last_login_at: stringOrEmpty(user.last_login_at) || null,
    display_name_changed_at: stringOrEmpty(user.display_name_changed_at) || null,
    created_at: stringOrEmpty(user.created_at) || new Date().toISOString()
  };
}

function normalizeSession(session) {
  if (!session || !stringOrEmpty(session.id) || !stringOrEmpty(session.host_user_id)) return null;
  const status = ['lobby', 'active', 'closing', 'closed', 'cancelled'].includes(session.status) ? session.status : 'lobby';
  const startedAt = stringOrEmpty(session.started_at) || null;
  const closedAt = stringOrEmpty(session.closed_at) || null;
  const cancelledAt = stringOrEmpty(session.cancelled_at) || null;
  const storedDuration = numberOrNull(session.duration_seconds);
  const endedAt = closedAt || (status === 'cancelled' ? cancelledAt : null);
  const derivedDuration = startedAt && endedAt
    ? Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : null;

  return {
    id: session.id,
    session_code: stringOrEmpty(session.session_code) || 'PKR-0000',
    name: stringOrEmpty(session.name) || 'Untitled table',
    location: '',
    host_user_id: session.host_user_id,
    status,
    join_requires_approval: false,
    default_buy_in: null,
    minimum_buy_in: null,
    maximum_buy_in: null,
    created_at: stringOrEmpty(session.created_at) || new Date().toISOString(),
    started_at: startedAt,
    closed_at: closedAt,
    cancelled_at: cancelledAt,
    expected_funds: numberOrNull(session.expected_funds),
    counted_funds: numberOrNull(session.counted_funds),
    discrepancy: numberOrNull(session.discrepancy),
    duration_seconds: storedDuration ?? derivedDuration
  };
}

function normalizeRequest(request, kind) {
  if (!request || !stringOrEmpty(request.id) || !stringOrEmpty(request.session_id)) return null;
  const normalized = {
    ...request,
    id: request.id,
    session_id: request.session_id,
    status: stringOrEmpty(request.status) || 'cancelled',
    requested_at: stringOrEmpty(request.requested_at) || new Date().toISOString(),
    rejection_reason: stringOrEmpty(request.rejection_reason),
    cancellation_reason: stringOrEmpty(request.cancellation_reason),
    cancelled_at: stringOrEmpty(request.cancelled_at) || null
  };

  if (kind === 'join') normalized.user_id = stringOrEmpty(request.user_id);
  else {
    normalized.requester_id = stringOrEmpty(request.requester_id);
    normalized.requested_amount = Number(request.requested_amount) || 0;
    normalized.approved_amount = numberOrNull(request.approved_amount);
    normalized.note = stringOrEmpty(request.note);
  }

  if (kind === 'cashout') {
    delete normalized.chip_count;
    delete normalized.chip_value;
    delete normalized.verified_chip_count;
    delete normalized.verified_chip_value;
    delete normalized.adjustment_reason;
  }

  return normalized;
}

function stripLegacySeedData(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const legacySessionIds = new Set(LEGACY_SEED_SESSION_IDS);
  arrayOrEmpty(raw.sessions).forEach(session => {
    if (LEGACY_SEED_USER_IDS.has(session?.host_user_id)) legacySessionIds.add(session.id);
  });

  const requestSource = raw.requests && typeof raw.requests === 'object' ? raw.requests : {};
  return {
    ...raw,
    currentUserId: LEGACY_SEED_USER_IDS.has(raw.currentUserId) ? null : raw.currentUserId,
    users: arrayOrEmpty(raw.users).filter(user => !LEGACY_SEED_USER_IDS.has(user?.id)),
    sessions: arrayOrEmpty(raw.sessions).filter(session => !legacySessionIds.has(session?.id)),
    members: arrayOrEmpty(raw.members).filter(member => !LEGACY_SEED_USER_IDS.has(member?.user_id) && !legacySessionIds.has(member?.session_id)),
    transactions: arrayOrEmpty(raw.transactions).filter(transaction => !LEGACY_SEED_USER_IDS.has(transaction?.player_id) && !legacySessionIds.has(transaction?.session_id)),
    requests: {
      join: arrayOrEmpty(requestSource.join).filter(request => !LEGACY_SEED_USER_IDS.has(request?.user_id) && !legacySessionIds.has(request?.session_id)),
      buyin: arrayOrEmpty(requestSource.buyin).filter(request => !LEGACY_SEED_USER_IDS.has(request?.requester_id) && !legacySessionIds.has(request?.session_id)),
      cashout: arrayOrEmpty(requestSource.cashout).filter(request => !LEGACY_SEED_USER_IDS.has(request?.requester_id) && !legacySessionIds.has(request?.session_id))
    },
    notifications: arrayOrEmpty(raw.notifications).filter(notification => !LEGACY_SEED_USER_IDS.has(notification?.user_id) && !legacySessionIds.has(notification?.session_id))
  };
}

function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const cleaned = stripLegacySeedData(raw);
  const users = arrayOrEmpty(cleaned.users).map(normalizeUser).filter(Boolean);
  const userIds = new Set(users.map(user => user.id));
  const sessions = arrayOrEmpty(cleaned.sessions)
    .map(normalizeSession)
    .filter(session => session && userIds.has(session.host_user_id));
  const sessionIds = new Set(sessions.map(session => session.id));

  const members = arrayOrEmpty(cleaned.members)
    .filter(member => member && stringOrEmpty(member.id) && sessionIds.has(member.session_id) && userIds.has(member.user_id))
    .map(member => ({
      id: member.id,
      session_id: member.session_id,
      user_id: member.user_id,
      member_role: member.member_role === 'host' ? 'host' : 'player',
      joined_at: stringOrEmpty(member.joined_at) || new Date().toISOString()
    }));

  const transactions = arrayOrEmpty(cleaned.transactions)
    .filter(transaction => transaction && stringOrEmpty(transaction.id) && sessionIds.has(transaction.session_id) && userIds.has(transaction.player_id))
    .map(transaction => ({
      id: transaction.id,
      session_id: transaction.session_id,
      player_id: stringOrEmpty(transaction.player_id),
      transaction_type: ['buy_in', 'cash_out', 'reversal', 'adjustment'].includes(transaction.transaction_type) ? transaction.transaction_type : 'adjustment',
      amount: Number(transaction.amount) || 0,
      is_reversed: Boolean(transaction.is_reversed),
      correction_reason: stringOrEmpty(transaction.correction_reason),
      reverses_transaction_id: stringOrEmpty(transaction.reverses_transaction_id) || null,
      request_id: stringOrEmpty(transaction.request_id) || null,
      metadata: transaction.metadata && typeof transaction.metadata === 'object' ? transaction.metadata : {},
      created_at: stringOrEmpty(transaction.created_at) || new Date().toISOString()
    }));

  const requestSource = cleaned.requests && typeof cleaned.requests === 'object' ? cleaned.requests : {};
  const requests = {
    join: [],
    buyin: arrayOrEmpty(requestSource.buyin).map(request => normalizeRequest(request, 'buyin')).filter(request => request && sessionIds.has(request.session_id) && userIds.has(request.requester_id)),
    cashout: arrayOrEmpty(requestSource.cashout).map(request => normalizeRequest(request, 'cashout')).filter(request => request && sessionIds.has(request.session_id) && userIds.has(request.requester_id))
  };

  const notifications = arrayOrEmpty(cleaned.notifications)
    .filter(notification => notification && stringOrEmpty(notification.id) && userIds.has(notification.user_id))
    .filter(notification => notification.request_kind !== 'join' && !/join request|wants to join|requested access/i.test(`${notification.title || ''} ${notification.message || ''}`))
    .map(notification => ({
      id: notification.id,
      user_id: notification.user_id,
      title: stringOrEmpty(notification.title),
      message: stringOrEmpty(notification.message),
      type: ['info', 'request', 'approved', 'rejected'].includes(notification.type)
        ? notification.type
        : notificationTypeFromTitle(notification.title),
      session_id: sessionIds.has(notification.session_id) ? notification.session_id : null,
      action_hash: stringOrEmpty(notification.action_hash),
      request_id: stringOrEmpty(notification.request_id) || null,
      request_kind: stringOrEmpty(notification.request_kind),
      delivery: stringOrEmpty(notification.delivery),
      result_summary: notification.result_summary && typeof notification.result_summary === 'object'
        ? {
            session_name: stringOrEmpty(notification.result_summary.session_name),
            cash_in: Number(notification.result_summary.cash_in) || 0,
            cash_out: Number(notification.result_summary.cash_out) || 0,
            net: Number(notification.result_summary.net) || 0,
            duration_seconds: Math.max(0, Math.floor(Number(notification.result_summary.duration_seconds) || 0))
          }
        : null,
      created_at: stringOrEmpty(notification.created_at) || new Date().toISOString(),
      read_at: stringOrEmpty(notification.read_at) || null
    }));

  const sessionResults = arrayOrEmpty(cleaned.sessionResults)
    .filter(result => result && stringOrEmpty(result.id) && stringOrEmpty(result.session_id) && userIds.has(result.user_id))
    .map(result => ({
      id: result.id,
      session_id: result.session_id,
      user_id: result.user_id,
      cash_in: Number(result.cash_in) || 0,
      cash_out: Number(result.cash_out) || 0,
      net: Number(result.net) || 0,
      duration_seconds: Math.max(0, Math.floor(Number(result.duration_seconds) || 0)),
      created_at: stringOrEmpty(result.created_at) || new Date().toISOString()
    }));

  const currentUserId = userIds.has(cleaned.currentUserId) ? cleaned.currentUserId : null;
  return {
    meta: { schemaVersion: SCHEMA_VERSION, storage_notice: '', hasActiveAdministrator: Boolean(cleaned.meta?.hasActiveAdministrator) },
    currentUserId,
    users,
    sessions,
    members,
    transactions,
    requests,
    notifications,
    sessionResults
  };
}

export function loadAppData() {
  try {
    const currentText = localStorage.getItem(STORAGE_KEY);
    const legacyText = currentText ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
    const savedText = currentText || legacyText;
    if (!savedText) return createEmptyData();

    const normalized = normalizeData(JSON.parse(savedText));
    if (!normalized) {
      const fresh = createEmptyData();
      fresh.meta.storage_notice = 'Saved app data was incompatible and has been cleared.';
      return fresh;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    if (legacyText) localStorage.removeItem(LEGACY_STORAGE_KEY);
    return normalized;
  } catch {
    const fresh = createEmptyData();
    fresh.meta.storage_notice = 'Saved app data could not be read and has been cleared.';
    return fresh;
  }
}

export function saveAppData(data) {
  const normalized = normalizeData(data);
  if (!normalized) throw new Error('App data could not be saved because its structure is invalid.');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function resetAppData() {
  const fresh = createEmptyData();
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

export function clearActivityData(existingData) {
  const normalized = normalizeData(existingData);
  if (!normalized) throw new Error('Registered users could not be preserved because the saved data is invalid.');

  const cleared = {
    meta: { schemaVersion: SCHEMA_VERSION, storage_notice: '', hasActiveAdministrator: Boolean(normalized.meta?.hasActiveAdministrator) },
    currentUserId: normalized.users.some(user => user.id === normalized.currentUserId) ? normalized.currentUserId : null,
    users: normalized.users.map(user => ({ ...user })),
    sessions: [],
    members: [],
    transactions: [],
    requests: { join: [], buyin: [], cashout: [] },
    notifications: [],
    sessionResults: []
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleared));
  return cleared;
}

export function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
