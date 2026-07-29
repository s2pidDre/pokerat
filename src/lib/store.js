const listeners = new Set();

const state = {
  meta: { schemaVersion: 11, storage_notice: '' },
  currentUserId: null,
  users: [],
  sessions: [],
  members: [],
  transactions: [],
  requests: { join: [], buyin: [], cashout: [] },
  notifications: [],
  reports: [],
  auditLogs: [],
  route: typeof location !== 'undefined' ? (location.hash || '#/home') : '#/home',
  loading: true,
  error: ''
};

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  listeners.forEach(listener => listener(state));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
