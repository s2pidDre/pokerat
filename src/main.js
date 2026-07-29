import { getState, setState, subscribe } from './lib/store.js';
import { initRouter, navigate, parseRoute } from './lib/router.js';
import { closeAdminRegistrationApprovalDialog, closeHostMoneyApprovalDialog, confirmDialog, setButtonBusy, showAdminRegistrationApprovalDialog, showFinalResultDialog, showHostMoneyApprovalDialog, showNotificationPopup, showToast, triggerHapticFeedback } from './lib/ui.js';
import { clearActivityData, loadAppData, makeId, resetAppData, saveAppData } from './lib/app-data.js';
import {
  adminView,
  appShell,
  forcePasswordChangeView,
  historyView,
  initialAdminSetupView,
  leaderboardView,
  homeView,
  modalTemplate,
  profileView,
  accountAccessView,
  requestsView,
  sessionView,
  sessionsView,
  suspendedView
} from './components/templates.js';
import { availableTableFunds, playerSummary, toCents } from './utils/accounting.js';
import { durationSecondsBetween, escapeHtml, formatCurrency, formatDuration, formatDurationSeconds } from './utils/format.js';
import { buildClosedTableLeaderboard } from './utils/leaderboard.js';
import { validAmount } from './utils/validation.js';
import { clearLoginAttempts, getLoginLock, normalizeLoginIdentifier, recordFailedLogin, validateDisplayName, validateEmail, validatePassword } from './utils/auth.js';
import { changeOwnPassword, completeForcedPasswordChange, createFirstAdministrator, getCurrentProfile, getSession, getVisibleProfiles, hasActiveAdministrator, loginAccount, logoutAccount, onAuthStateChange, registerAccount, runAdminAccountAction, subscribeToProfiles, unsubscribeFromProfiles, updateOwnProfile } from './lib/account-service.js';

const app = document.getElementById('app');
let renderQueued = false;
let sessionTimerInterval = null;
const surfacedNotificationIds = new Set();

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}


function stopSessionTimerUpdates() {
  if (sessionTimerInterval) window.clearInterval(sessionTimerInterval);
  sessionTimerInterval = null;
}

function updateVisibleSessionTimers() {
  document.querySelectorAll('[data-session-timer]').forEach(element => {
    const fixedSeconds = Number(element.dataset.durationSeconds);
    if (element.dataset.durationSeconds !== '' && Number.isFinite(fixedSeconds)) {
      element.textContent = formatDurationSeconds(fixedSeconds);
      return;
    }
    const startedAt = element.dataset.startedAt;
    const endedAt = element.dataset.endedAt;
    element.textContent = formatDuration(startedAt, endedAt || Date.now());
  });
}

function syncSessionTimerUpdates() {
  stopSessionTimerUpdates();
  updateVisibleSessionTimers();
  const hasLiveTimer = [...document.querySelectorAll('[data-session-timer]')]
    .some(element => !element.dataset.endedAt && element.dataset.durationSeconds === '');
  if (hasLiveTimer) sessionTimerInterval = window.setInterval(updateVisibleSessionTimers, 1000);
}

subscribe(queueRender);

function persistState() {
  const state = getState();
  saveAppData({
    meta: state.meta,
    currentUserId: null,
    users: state.users,
    sessions: state.sessions,
    members: state.members,
    transactions: state.transactions,
    requests: state.requests,
    notifications: state.notifications,
    reports: state.reports,
    auditLogs: state.auditLogs
  });
}

function commit(patch) {
  setState(patch);
  persistState();
}

function currentUser() {
  const state = getState();
  return state.users.find(user => user.id === state.currentUserId) || null;
}

function userById(id) {
  return getState().users.find(user => user.id === id) || null;
}

function sessionById(id) {
  return getState().sessions.find(session => session.id === id) || null;
}

function isMember(sessionId, userId) {
  const session = sessionById(sessionId);
  return Boolean(
    session &&
    (session.host_user_id === userId || getState().members.some(member => member.session_id === sessionId && member.user_id === userId))
  );
}

function enrichSession(session) {
  if (!session) return null;
  return {
    ...session,
    host: userById(session.host_user_id),
    session_members: getState().members.filter(member => member.session_id === session.id)
  };
}

function sessionsForUser(userId) {
  return getState().sessions
    .filter(session => isMember(session.id, userId))
    .map(enrichSession)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function preferredOpenSessionForUser(userId) {
  return sessionsForUser(userId)
    .filter(session => ['active', 'lobby'].includes(session.status))
    .sort((a, b) => {
      const statusDifference = (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1);
      if (statusDifference) return statusDifference;
      const aTime = new Date(a.started_at || a.created_at).getTime();
      const bTime = new Date(b.started_at || b.created_at).getTime();
      return bTime - aTime;
    })[0] || null;
}

function defaultRouteForUser(user) {
  if (!user) return 'home';
  const openSession = preferredOpenSessionForUser(user.id);
  if (openSession) return `session/${openSession.id}`;
  return user.is_admin ? 'admin' : 'home';
}

function membersForSession(sessionId) {
  return getState().members
    .filter(member => member.session_id === sessionId)
    .map(member => ({ ...member, profile: userById(member.user_id) }))
    .sort((a, b) => (a.member_role === 'host' ? -1 : b.member_role === 'host' ? 1 : new Date(a.joined_at) - new Date(b.joined_at)));
}

function transactionsForSession(sessionId) {
  const sessionTransactions = getState().transactions.filter(transaction => transaction.session_id === sessionId);
  const reversedIds = new Set(
    sessionTransactions
      .filter(transaction => transaction.transaction_type === 'reversal' && transaction.reverses_transaction_id)
      .map(transaction => transaction.reverses_transaction_id)
  );

  return sessionTransactions
    .map(transaction => ({
      ...transaction,
      is_reversed: Boolean(transaction.is_reversed || reversedIds.has(transaction.id)),
      player: userById(transaction.player_id)
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function enrichRequest(request) {
  return {
    ...request,
    requester: userById(request.requester_id || request.user_id),
    session: enrichSession(sessionById(request.session_id))
  };
}

function requestsForUser(userId) {
  const visible = request => {
    const requesterId = request.requester_id || request.user_id;
    return requesterId === userId || sessionById(request.session_id)?.host_user_id === userId;
  };
  const requests = getState().requests;
  return {
    join: requests.join.filter(visible).map(enrichRequest),
    buyin: requests.buyin.filter(visible).map(enrichRequest),
    cashout: requests.cashout.filter(visible).map(enrichRequest)
  };
}

function unreadNotifications(userId) {
  return getState().notifications
    .filter(notification => notification.user_id === userId && !notification.read_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function adminLogs() {
  return getState().auditLogs
    .map(log => ({
      ...log,
      actor: userById(log.actor_id),
      targetUser: userById(log.details?.user_id || log.details?.player_id || log.target_id),
      session: enrichSession(sessionById(log.session_id))
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function addNotification(userId, title, message, options = {}) {
  if (!userId) return null;
  const notification = {
    id: makeId('n'),
    user_id: userId,
    title,
    message,
    type: options.type || 'info',
    session_id: options.sessionId || null,
    action_hash: options.actionHash || (options.sessionId ? `#/session/${options.sessionId}` : ''),
    request_id: options.requestId || null,
    request_kind: options.requestKind || '',
    delivery: options.delivery || '',
    result_summary: options.resultSummary && typeof options.resultSummary === 'object' ? options.resultSummary : null,
    created_at: new Date().toISOString(),
    read_at: null
  };
  getState().notifications.unshift(notification);
  return notification;
}

function surfaceNewNotifications(userId, notifications) {
  if (document.getElementById('admin-registration-queue-modal')?.open || document.getElementById('host-money-queue-modal')?.open || document.getElementById('final-result-modal')?.open) return;
  const unseen = notifications
    .filter(notification =>
      notification.user_id === userId &&
      !['host_buyin_queue', 'host_money_queue', 'final_result', 'admin_registration_queue'].includes(notification.delivery) &&
      !surfacedNotificationIds.has(notification.id)
    )
    .slice(0, 3)
    .reverse();

  unseen.forEach((notification, index) => {
    surfacedNotificationIds.add(notification.id);
    window.setTimeout(() => {
      showNotificationPopup({
        title: notification.title,
        message: notification.message,
        type: notification.type || inferNotificationType(notification.title),
        actionHash: notification.action_hash || '',
        actionLabel: notification.action_hash ? 'Open table' : ''
      });
    }, index * 180);
  });
}

function inferNotificationType(title = '') {
  const normalized = String(title).toLowerCase();
  if (normalized.includes('reject') || normalized.includes('removed') || normalized.includes('cancel')) return 'rejected';
  if (normalized.includes('approved') || normalized.includes('joined') || normalized.includes('started')) return 'approved';
  if (normalized.includes('request') || normalized.includes('review') || normalized.includes('verification')) return 'request';
  return 'info';
}


function pendingMoneyRequestsForHost(userId) {
  const state = getState();
  return [
    ...state.requests.buyin.map(request => ({ ...request, kind: 'buyin' })),
    ...state.requests.cashout.map(request => ({ ...request, kind: 'cashout' }))
  ]
    .filter(request =>
      request.status?.startsWith('pending') &&
      sessionById(request.session_id)?.status === 'active' &&
      sessionById(request.session_id)?.host_user_id === userId
    )
    .map(request => ({ ...enrichRequest(request), kind: request.kind }))
    .sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at));
}

function pendingRegistrationUsers() {
  return getState().users
    .filter(user => !user.is_admin && user.account_status === 'pending')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function syncAdminRegistrationApprovalQueue(user) {
  if (!user?.is_admin || user.account_status !== 'active') {
    closeAdminRegistrationApprovalDialog();
    return;
  }

  const pending = pendingRegistrationUsers();
  if (!pending.length) {
    closeAdminRegistrationApprovalDialog();
    return;
  }

  const currentDialog = document.getElementById('admin-registration-queue-modal');
  if (currentDialog?.open && currentDialog.dataset.userId === pending[0].id) return;

  closeActiveModal();
  closeHostMoneyApprovalDialog();
  const applicant = pending[0];
  showAdminRegistrationApprovalDialog({
    userId: applicant.id,
    playerName: applicant.display_name,
    loginName: applicant.login_name,
    email: applicant.email,
    requestedText: new Date(applicant.created_at).toLocaleString(),
    queuePosition: 1,
    queueTotal: pending.length
  });
}

function syncHostMoneyApprovalQueue(user) {
  if (document.getElementById('admin-registration-queue-modal')?.open) {
    closeHostMoneyApprovalDialog();
    return;
  }
  if (!user || user.account_status !== 'active') {
    closeHostMoneyApprovalDialog();
    return;
  }

  const pending = pendingMoneyRequestsForHost(user.id);
  if (!pending.length) {
    closeHostMoneyApprovalDialog();
    return;
  }

  const currentDialog = document.getElementById('host-money-queue-modal');
  if (
    currentDialog?.open &&
    currentDialog.dataset.requestId === pending[0].id &&
    currentDialog.dataset.requestKind === pending[0].kind
  ) return;

  closeActiveModal();
  const request = pending[0];
  showHostMoneyApprovalDialog({
    requestId: request.id,
    requestKind: request.kind,
    playerName: request.requester?.display_name || 'Player',
    sessionName: request.session?.name || 'Table',
    amountText: formatCurrency(request.requested_amount),
    note: request.note || '',
    queuePosition: 1,
    queueTotal: pending.length
  });
}

function syncFinalResultPopup(user, notifications) {
  if (!user || user.account_status !== 'active') return;
  if (document.getElementById('admin-registration-queue-modal')?.open || document.getElementById('host-money-queue-modal')?.open || document.getElementById('active-modal')?.open) return;

  const pendingResults = notifications
    .filter(notification => notification.user_id === user.id && notification.delivery === 'final_result' && !notification.read_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const notification = pendingResults[0];
  if (!notification) return;

  const existing = document.getElementById('final-result-modal');
  if (existing?.open && existing.dataset.notificationId === notification.id) return;
  const result = notification.result_summary || {};
  showFinalResultDialog({
    notificationId: notification.id,
    sessionName: result.session_name || sessionById(notification.session_id)?.name || 'Finished table',
    cashInText: formatCurrency(result.cash_in || 0),
    cashOutText: formatCurrency(result.cash_out || 0),
    netText: formatCurrency(result.net || 0, { signed: true }),
    netValue: Number(result.net) || 0,
    durationText: formatDurationSeconds(result.duration_seconds || 0),
    onDone: () => {
      const item = getState().notifications.find(entry => entry.id === notification.id);
      if (item && !item.read_at) {
        item.read_at = new Date().toISOString();
        commit({ notifications: [...getState().notifications] });
      }
      requestAnimationFrame(() => syncFinalResultPopup(currentUser(), unreadNotifications(currentUser()?.id)));
    }
  });
}

function markRequestNotificationRead(requestId, hostId) {
  const now = new Date().toISOString();
  getState().notifications.forEach(notification => {
    if (
      notification.user_id === hostId &&
      notification.request_id === requestId &&
      !notification.read_at
    ) {
      notification.read_at = now;
    }
  });
}

function addAudit(action, sessionId = null, actorId = currentUser()?.id || null, options = {}) {
  getState().auditLogs.unshift({
    id: makeId('a'),
    action,
    actor_id: actorId,
    session_id: sessionId,
    target_type: options.targetType || '',
    target_id: options.targetId || '',
    details: options.details && typeof options.details === 'object' ? options.details : {},
    created_at: new Date().toISOString()
  });
}

function addTransaction(sessionId, playerId, type, amount, reason = '', options = {}) {
  const transaction = {
    id: makeId('t'),
    session_id: sessionId,
    player_id: playerId,
    transaction_type: type,
    amount: Number(amount),
    is_reversed: false,
    correction_reason: reason,
    reverses_transaction_id: options.reversesTransactionId || null,
    request_id: options.requestId || null,
    metadata: options.metadata || {},
    created_at: new Date().toISOString()
  };
  getState().transactions.push(transaction);
  return transaction;
}

function cloneRequests() {
  const requests = getState().requests;
  return { join: [...requests.join], buyin: [...requests.buyin], cashout: [...requests.cashout] };
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < 4; index += 1) value += chars[Math.floor(Math.random() * chars.length)];
  return `PKR-${value}`;
}

async function signOut(message = '') {
  await logoutAccount();
  unsubscribeFromProfiles();
  closeActiveModal();
  closeAdminRegistrationApprovalDialog();
  closeHostMoneyApprovalDialog();
  surfacedNotificationIds.clear();
  setState({ currentUserId: null });
  persistState();
  navigate('login');
  if (message) requestAnimationFrame(() => showToast(message));
}

function mergeRemoteProfiles(remoteProfiles, currentProfile = null) {
  const localUsers = getState().users || [];
  const byId = new Map(localUsers.map(user => [user.id, user]));
  for (const profile of remoteProfiles || []) {
    byId.set(profile.id, { ...(byId.get(profile.id) || {}), ...profile });
  }
  if (currentProfile) byId.set(currentProfile.id, { ...(byId.get(currentProfile.id) || {}), ...currentProfile });
  return [...byId.values()];
}

async function refreshRemoteProfiles({ routeAfterApproval = true } = {}) {
  const profile = await getCurrentProfile();
  if (!profile) {
    unsubscribeFromProfiles();
    setState({ currentUserId: null });
    persistState();
    return null;
  }
  const previous = currentUser();
  const visibleProfiles = await getVisibleProfiles(profile);
  const users = profile.is_admin ? visibleProfiles : mergeRemoteProfiles(visibleProfiles, profile);
  setState({ users, currentUserId: profile.id });
  persistState();

  if (routeAfterApproval && previous?.account_status === 'pending' && profile.account_status === 'active') {
    navigate(defaultRouteForUser(profile));
    triggerHapticFeedback('approved', { force: true });
    showToast('Your account was approved.');
  }
  return profile;
}

function startProfileRealtime() {
  subscribeToProfiles(() => {
    window.setTimeout(() => refreshRemoteProfiles().catch(error => console.error('Profile refresh failed:', error)), 0);
  });
}

function render() {
  stopSessionTimerUpdates();
  const state = getState();
  if (state.loading) {
    app.innerHTML = '<main class="loading-screen"><div class="system-loader"><span></span><span></span><span></span></div><p>Loading Pokerat…</p></main>';
    return;
  }

  const hasAdministrator = Boolean(state.meta?.hasActiveAdministrator || state.users.some(user => user.is_admin && user.account_status === 'active'));
  if (!hasAdministrator) {
    app.innerHTML = initialAdminSetupView();
    return;
  }

  const user = currentUser();
  if (!user) {
    const authRoute = parseRoute(state.route).page;
    const mode = ['register', 'pending'].includes(authRoute) ? authRoute : 'login';
    app.innerHTML = accountAccessView({ mode });
    return;
  }

  if (user.account_status === 'pending') {
    app.innerHTML = accountAccessView({ mode: 'pending', profile: user });
    return;
  }

  if (user.account_status === 'rejected') {
    app.innerHTML = accountAccessView({ mode: 'rejected', profile: user });
    return;
  }

  if (user.account_status === 'suspended') {
    app.innerHTML = suspendedView(user);
    return;
  }

  if (user.must_change_password) {
    app.innerHTML = forcePasswordChangeView(user);
    return;
  }

  const route = parseRoute(state.route);
  const sessions = sessionsForUser(user.id);
  const requests = requestsForUser(user.id);
  const effectiveRoute = route;
  let content;

  switch (effectiveRoute.page) {
    case 'home':
      content = homeView({ sessions, requests, profile: user });
      break;
    case 'sessions':
      content = sessionsView(sessions, user.id);
      break;
    case 'requests':
      content = requestsView({ requests, userId: user.id });
      break;
    case 'leaderboard': {
      const leaderboard = buildClosedTableLeaderboard({
        sessions: state.sessions,
        transactions: state.transactions,
        users: state.users
      });
      content = leaderboardView({
        leaderboard,
        profileId: user.id,
        closedTableCount: state.sessions.filter(session => session.status === 'closed').length
      });
      break;
    }
    case 'history':
      content = historyView({ sessions, profileId: user.id });
      break;
    case 'profile':
      content = profileView(user, user, sessions);
      break;
    case 'admin':
      content = user.is_admin
        ? adminView(state.users, adminLogs(), state.reports, user.id)
        : '<section class="simple-panel"><h1>Admin only</h1><p>This account does not have administrator access.</p></section>';
      break;
    case 'session': {
      const session = enrichSession(sessionById(effectiveRoute.id));
      content = session && isMember(session.id, user.id)
        ? sessionView({
            session,
            members: membersForSession(session.id),
            transactions: transactionsForSession(session.id),
            requests,
            userId: user.id
          })
        : '<section class="simple-panel"><h1>Cannot open this table</h1><p>Join it first or log in with the correct account.</p><a class="button button--primary" href="#/sessions">Back to tables</a></section>';
      break;
    }
    default:
      content = homeView({ sessions, requests, profile: user });
  }

  const pending = [...requests.join, ...requests.buyin, ...requests.cashout]
    .filter(request => request.status?.startsWith('pending')).length;
  const notifications = unreadNotifications(user.id);
  app.innerHTML = appShell({
    profile: user,
    isAdmin: Boolean(user.is_admin),
    route: effectiveRoute.page === 'session' ? `#/session/${effectiveRoute.id}` : `#/${effectiveRoute.page}`,
    content,
    unreadCount: pending,
    notificationCount: notifications.length
  });
  requestAnimationFrame(() => {
    syncSessionTimerUpdates();
    syncAdminRegistrationApprovalQueue(user);
    syncHostMoneyApprovalQueue(user);
    syncFinalResultPopup(user, notifications);
    surfaceNewNotifications(user.id, notifications);
  });
}

async function bootstrap() {
  document.documentElement.dataset.theme = localStorage.getItem('pokerat-theme') || 'dark';
  const data = loadAppData();
  data.notifications.forEach(notification => surfacedNotificationIds.add(notification.id));
  setState({ ...data, loading: true });

  try {
    const [hasAdministrator, session] = await Promise.all([
      hasActiveAdministrator(),
      getSession()
    ]);
    data.meta = { ...(data.meta || {}), hasActiveAdministrator: hasAdministrator };

    let authenticatedProfile = null;
    let users = data.users || [];
    if (session) {
      authenticatedProfile = await getCurrentProfile();
      if (authenticatedProfile) {
        const visibleProfiles = await getVisibleProfiles(authenticatedProfile);
        users = authenticatedProfile.is_admin ? visibleProfiles : mergeRemoteProfiles(visibleProfiles, authenticatedProfile);
      }
    }

    data.users = users;
    data.currentUserId = authenticatedProfile?.id || null;
    setState({ ...data, loading: false });

    if (!hasAdministrator) {
      history.replaceState(null, '', '#/setup');
    } else if (authenticatedProfile) {
      startProfileRealtime();
      const preferredRoute = authenticatedProfile.account_status === 'active'
        ? defaultRouteForUser(authenticatedProfile)
        : authenticatedProfile.account_status;
      if (authenticatedProfile.account_status === 'active') {
        if (preferredRoute.startsWith('session/') || !location.hash || ['login', 'register', 'pending', 'rejected', 'setup'].includes(parseRoute(location.hash).page)) {
          history.replaceState(null, '', `#/${preferredRoute}`);
        }
      } else {
        history.replaceState(null, '', `#/${preferredRoute}`);
      }
    } else if (!['login', 'register'].includes(parseRoute(location.hash).page)) {
      history.replaceState(null, '', '#/login');
    }
  } catch (error) {
    console.error('Supabase startup failed:', error);
    data.meta = { ...(data.meta || {}), storage_notice: 'Could not connect to Supabase. Check the SQL setup and internet connection.' };
    data.currentUserId = null;
    setState({ ...data, loading: false });
    history.replaceState(null, '', '#/login');
  }

  initRouter(queueRender);
  bindEvents();
  onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      unsubscribeFromProfiles();
      setState({ currentUserId: null });
      persistState();
      queueRender();
      return;
    }
    if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
      window.setTimeout(() => {
        refreshRemoteProfiles({ routeAfterApproval: false })
          .then(() => startProfileRealtime())
          .catch(error => console.error('Auth refresh failed:', error));
      }, 0);
    }
  });

  if (data.meta?.storage_notice) {
    requestAnimationFrame(() => showToast(data.meta.storage_notice, 'error', 6500));
    data.meta.storage_notice = '';
    persistState();
  }
}

function bindEvents() {
  document.addEventListener('click', async event => {
    const menuTrigger = event.target.closest('[data-member-menu-trigger]');
    if (menuTrigger) {
      event.preventDefault();
      toggleMemberMenu(menuTrigger);
      return;
    }

    if (!event.target.closest('[data-member-menu]')) closeMemberMenus();

    if (event.target.closest('[data-logout]')) {
      signOut('Logged out.');
      return;
    }

    if (event.target.closest('[data-admin-clear-activity]')) {
      const user = currentUser();
      if (!user?.is_admin) throw new Error('Admin only.');
      const accepted = await confirmDialog({
        title: 'Clear all activity?',
        message: 'Tables, money records, requests, notifications, reports and audit logs will be deleted. Registered users will stay.',
        confirmText: 'Clear activity',
        destructive: true
      });
      if (!accepted) return;

      closeActiveModal();
      closeHostMoneyApprovalDialog();
      surfacedNotificationIds.clear();
      const cleared = clearActivityData(getState());
      setState({ ...cleared, loading: false, error: '' });
      persistState();
      navigate('admin');
      showToast('All activity cleared. Registered users were kept.');
      return;
    }

    if (event.target.closest('[data-admin-hard-reset]')) {
      const user = currentUser();
      if (!user?.is_admin) throw new Error('Admin only.');
      const accepted = await confirmDialog({
        title: 'Hard reset everything?',
        message: 'All registered users and all activity will be deleted. The app will return to first-time administrator setup.',
        confirmText: 'Hard reset',
        destructive: true
      });
      if (!accepted) return;

      closeActiveModal();
      closeAdminRegistrationApprovalDialog();
      closeHostMoneyApprovalDialog();
      surfacedNotificationIds.clear();
      await runAdminAccountAction('hard_reset');
      await logoutAccount().catch(() => {});
      unsubscribeFromProfiles();
      const fresh = resetAppData();
      fresh.currentUserId = null;
      fresh.meta = { ...(fresh.meta || {}), hasActiveAdministrator: false };
      setState({ ...fresh, loading: false, error: '' });
      persistState();
      navigate('setup');
      showToast('Hard reset complete. Create the first administrator.');
      return;
    }

    if (event.target.closest('#theme-toggle')) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('pokerat-theme', next);
      return;
    }

    if (event.target.closest('#notification-button')) {
      openModal('notifications', { notifications: unreadNotifications(currentUser().id) });
      return;
    }

    const opener = event.target.closest('[data-open]');
    if (opener) {
      const type = opener.dataset.open;
      if (type === 'close-session') {
        const session = currentRouteSession(['active']);
        requireHost(session, currentUser().id);
        const pending = pendingForSession(session.id);
        if (pending.length) {
          openModal('pending-close', { pendingCount: pending.length });
          return;
        }
        openModal(type, buildCloseSessionReview(session.id));
      } else {
        openModal(type);
      }
      return;
    }

    if (event.target.closest('[data-close-modal]')) {
      closeActiveModal();
      return;
    }

    const quick = event.target.closest('[data-quick-amount]');
    if (quick) {
      const input = quick.closest('dialog')?.querySelector('input[name="amount"]');
      if (input) input.value = quick.dataset.quickAmount;
      return;
    }

    if (event.target.closest('[data-review-pending-close]')) {
      closeActiveModal();
      requestAnimationFrame(() => {
        syncHostMoneyApprovalQueue(currentUser());
        document.getElementById('pending-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }

    if (event.target.closest('[data-mark-notifications-read]')) {
      const now = new Date().toISOString();
      const notifications = getState().notifications.map(item =>
        item.user_id === currentUser().id && !item.read_at ? { ...item, read_at: now } : item
      );
      commit({ notifications });
      closeActiveModal();
      showToast('Notifications cleared.');
      return;
    }

    await handleAction(event);
  });

  document.addEventListener('submit', handleSubmit);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMemberMenus();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateVisibleSessionTimers();
  });
    window.addEventListener('resize', closeMemberMenus);
  window.addEventListener('scroll', closeMemberMenus, true);
}

async function handleSubmit(event) {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.method === 'dialog') return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    setButtonBusy(button, true);

    if (form.id === 'initial-admin-form') {
      const administrator = await createFirstAdministrator({
        username: String(data.username || ''),
        email: String(data.email || ''),
        password: String(data.password || ''),
        confirmPassword: String(data.confirmPassword || '')
      });
      const users = mergeRemoteProfiles([administrator], administrator);
      setState({
        users,
        currentUserId: administrator.id,
        meta: { ...getState().meta, hasActiveAdministrator: true }
      });
      persistState();
      startProfileRealtime();
      navigate('admin');
      triggerHapticFeedback('approved', { force: true });
      showToast('Administrator created.');
      return;
    }

    if (form.id === 'login-form') {
      const identifier = normalizeLoginIdentifier(data.identifier);
      const password = String(data.password || '');
      const lock = getLoginLock(identifier);
      if (lock.locked) throw new Error(`Too many attempts. Try again in ${lock.secondsRemaining} seconds.`);
      if (!identifier || !password) throw new Error('Username/email or password is incorrect.');

      let loginUser;
      try {
        loginUser = await loginAccount(identifier, password, data.remember === 'on');
      } catch (error) {
        const nextLock = recordFailedLogin(identifier);
        if (nextLock.locked) throw new Error(`Too many attempts. Try again in ${nextLock.secondsRemaining} seconds.`);
        throw new Error(error?.message?.includes('Email not confirmed')
          ? 'Confirm your email first.'
          : 'Username/email or password is incorrect.');
      }

      clearLoginAttempts(identifier);
      const visibleProfiles = await getVisibleProfiles(loginUser);
      const users = loginUser.is_admin ? visibleProfiles : mergeRemoteProfiles(visibleProfiles, loginUser);
      setState({ users, currentUserId: loginUser.id });
      persistState();
      startProfileRealtime();

      if (loginUser.account_status === 'active') {
        navigate(defaultRouteForUser(loginUser));
        triggerHapticFeedback('approved', { force: true });
        showToast(`Welcome, ${loginUser.display_name}.`);
      } else {
        navigate(loginUser.account_status);
      }
      return;
    }

    if (form.id === 'register-form') {
      const result = await registerAccount({
        username: String(data.username || ''),
        email: String(data.email || ''),
        password: String(data.password || ''),
        confirmPassword: String(data.confirmPassword || '')
      });
      if (result.needsEmailConfirmation) {
        navigate('pending');
        showToast('Check your email, then return to log in.');
        return;
      }
      const applicant = result.profile;
      const users = mergeRemoteProfiles([applicant], applicant);
      setState({ users, currentUserId: applicant.id });
      persistState();
      startProfileRealtime();
      triggerHapticFeedback('approved', { force: true });
      navigate('pending');
      return;
    }

    const user = currentUser();
    if (!user) throw new Error('Log in first.');

    if (form.id === 'forced-password-change-form') {
      const updated = await completeForcedPasswordChange({
        password: String(data.password || ''),
        confirmPassword: String(data.confirmPassword || '')
      });
      const users = mergeRemoteProfiles([updated], updated);
      setState({ users, currentUserId: updated.id });
      persistState();
      navigate(defaultRouteForUser(updated));
      triggerHapticFeedback('approved', { force: true });
      showToast('New password saved.');
      return;
    }

    if (form.id === 'change-password-form') {
      await changeOwnPassword({
        currentPassword: String(data.currentPassword || ''),
        password: String(data.password || ''),
        confirmPassword: String(data.confirmPassword || '')
      });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      closeActiveModal();
      showToast('Password changed.');
      return;
    }

    if (form.id === 'admin-reset-password-form') {
      if (!user.is_admin) throw new Error('Admin only.');
      const targetUser = userById(String(data.userId || ''));
      if (!targetUser) throw new Error('Account not found.');
      const password = String(data.password || '');
      const confirmPassword = String(data.confirmPassword || '');
      const passwordError = validatePassword(password);
      if (passwordError) throw new Error(passwordError);
      if (password !== confirmPassword) throw new Error('The passwords do not match.');
      await runAdminAccountAction('reset_password', { userId: targetUser.id, password });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      closeActiveModal();
      showToast('Temporary password saved.');
      return;
    }

    if (form.id === 'create-session-form') {
      const name = String(data.name || '').trim();
      if (!name) throw new Error('Session name is required.');

      const id = makeId('s');
      const code = generateCode();
      getState().sessions.push({
        id,
        session_code: code,
        name,
        location: '',
        host_user_id: user.id,
        status: 'lobby',
        join_requires_approval: false,
        default_buy_in: null,
        minimum_buy_in: null,
        maximum_buy_in: null,
        created_at: new Date().toISOString(),
        started_at: null,
        closed_at: null,
        cancelled_at: null,
        expected_funds: null,
        counted_funds: null,
        discrepancy: null,
        duration_seconds: null
      });
      getState().members.push({
        id: makeId('m'),
        session_id: id,
        user_id: user.id,
        member_role: 'host',
        joined_at: new Date().toISOString()
      });
      addAudit('session_created', id, user.id, {
        targetType: 'session',
        targetId: id,
        details: { session_code: code }
      });
      commit({
        sessions: [...getState().sessions],
        members: [...getState().members],
        auditLogs: [...getState().auditLogs]
      });
      closeActiveModal();
      navigate(`session/${id}`);
      showToast(`Table ${code} created.`);
    } else if (form.id === 'join-session-form') {
      const code = String(data.code || '').trim().toUpperCase();
      const session = getState().sessions.find(item =>
        item.session_code.toUpperCase() === code && ['lobby', 'active'].includes(item.status)
      );
      if (!session) throw new Error('No joinable session matches that code. Try OPEN-2468 or PKR-7F2K.');
      if (user.account_status !== 'active') throw new Error('Suspended profiles cannot join sessions.');

      if (isMember(session.id, user.id)) {
        closeActiveModal();
        navigate(`session/${session.id}`);
        showToast('You already joined this table.');
        return;
      }

      getState().members.push({
        id: makeId('m'),
        session_id: session.id,
        user_id: user.id,
        member_role: 'player',
        joined_at: new Date().toISOString()
      });
      addNotification(session.host_user_id, 'Player joined', `${user.display_name} joined ${session.name}.`, { type: 'approved', sessionId: session.id });
      addAudit('player_joined', session.id, user.id, {
        targetType: 'user',
        targetId: user.id,
        details: { user_id: user.id }
      });
      commit({
        members: [...getState().members],
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeActiveModal();
      navigate(`session/${session.id}`);
      showToast('You joined the table.');
    } else if (form.id === 'request-buyin-form') {
      const session = currentRouteSession(['active']);
      requireMembership(session, user.id);
      validateMoney(data.amount);
      validateBuyIn(session, Number(data.amount));
      preventDuplicatePending('buyin', session.id, user.id);

      const request = {
        id: makeId('br'),
        session_id: session.id,
        requester_id: user.id,
        requested_amount: Number(data.amount),
        approved_amount: null,
        note: String(data.note || '').trim(),
        status: 'pending_payment_confirmation',
        requested_at: new Date().toISOString(),
        rejection_reason: '',
        cancellation_reason: ''
      };
      getState().requests.buyin.unshift(request);
      addNotification(session.host_user_id, 'Cash-in request', `${user.display_name} wants to cash in ${formatCurrency(data.amount)} at ${session.name}.`, {
        type: 'request',
        sessionId: session.id,
        requestId: request.id,
        requestKind: 'buyin',
        delivery: 'host_money_queue'
      });
      addAudit('buy_in_requested', session.id, user.id, {
        targetType: 'request',
        targetId: request.id,
        details: { player_id: user.id, amount: Number(data.amount) }
      });
      commit({
        requests: cloneRequests(),
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeActiveModal();
      showToast('Cash-in request sent.');
    } else if (form.id === 'request-cashout-form') {
      const session = currentRouteSession(['active']);
      requireMembership(session, user.id);
      validateMoney(data.amount);
      ensureFunds(session.id, Number(data.amount));
      preventDuplicatePending('cashout', session.id, user.id);

      const request = {
        id: makeId('cr'),
        session_id: session.id,
        requester_id: user.id,
        requested_amount: Number(data.amount),
        approved_amount: null,
        note: '',
        status: 'pending_review',
        requested_at: new Date().toISOString(),
        rejection_reason: '',
        cancellation_reason: ''
      };
      getState().requests.cashout.unshift(request);
      addNotification(session.host_user_id, 'Cash-out request', `${user.display_name} wants to cash out ${formatCurrency(data.amount)} at ${session.name}.`, {
        type: 'request',
        sessionId: session.id,
        requestId: request.id,
        requestKind: 'cashout',
        delivery: 'host_money_queue'
      });
      addAudit('cash_out_requested', session.id, user.id, {
        targetType: 'request',
        targetId: request.id,
        details: { player_id: user.id, amount: Number(data.amount) }
      });
      commit({
        requests: cloneRequests(),
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeActiveModal();
      showToast('Cash-out request sent.');
    } else if (form.id === 'host-cashin-form') {
      const session = currentRouteSession(['active']);
      requireHost(session, user.id);
      validateBuyIn(session, Number(data.amount));

      const transaction = addTransaction(session.id, user.id, 'buy_in', data.amount, '', {
        metadata: { confirmation: 'host_self_recorded' }
      });
      addAudit('host_cash_in_confirmed', session.id, user.id, {
        targetType: 'transaction',
        targetId: transaction.id,
        details: { player_id: user.id, amount: Number(data.amount) }
      });
      commit({ transactions: [...getState().transactions], auditLogs: [...getState().auditLogs] });
      closeActiveModal();
      showToast(`Cash-in added. Table money: ${formatCurrency(availableTableFunds(transactionsForSession(session.id)))}`);
    } else if (form.id === 'host-cashout-form') {
      const session = currentRouteSession(['active']);
      requireHost(session, user.id);
      validateMoney(data.amount);
      ensureFunds(session.id, Number(data.amount));

      const transaction = addTransaction(session.id, user.id, 'cash_out', data.amount, '', {
        metadata: { confirmation: 'host_self_recorded' }
      });
      addAudit('host_cash_out_confirmed', session.id, user.id, {
        targetType: 'transaction',
        targetId: transaction.id,
        details: { player_id: user.id, amount: Number(data.amount) }
      });
      commit({ transactions: [...getState().transactions], auditLogs: [...getState().auditLogs] });
      closeActiveModal();
      showToast('Cash-out saved.');
    } else if (form.id === 'report-session-form') {
      const session = currentRouteSession(['lobby', 'active', 'closed', 'cancelled']);
      requireMembership(session, user.id);
      const details = String(data.details || '').trim();
      if (details.length < 10) throw new Error('Add at least 10 characters of detail.');

      const report = {
        id: makeId('rep'),
        session_id: session.id,
        session_name: session.name,
        session_code: session.session_code,
        reporter_id: user.id,
        reporter_name: user.display_name,
        reason: data.reason,
        details,
        status: 'open',
        resolution_note: '',
        created_at: new Date().toISOString()
      };
      getState().reports.unshift(report);
      getState().users.filter(item => item.is_admin).forEach(admin =>
        addNotification(admin.id, 'New session report', `${user.display_name} reported ${session.name}.`)
      );
      addAudit('session_reported', session.id, user.id, {
        targetType: 'report',
        targetId: report.id,
        details: { reason: data.reason, session_status: session.status }
      });
      commit({
        reports: [...getState().reports],
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeActiveModal();
      showToast('Report sent.');
    } else if (form.id === 'close-session-form') {
      const session = currentRouteSession(['active']);
      requireHost(session, user.id);

      const pending = pendingForSession(session.id);
      if (pending.length) throw new Error(`Resolve ${pending.length} pending request${pending.length === 1 ? '' : 's'} before closing.`);

      const sessionTransactions = transactionsForSession(session.id);
      const missingPlayers = missingCashoutPlayers(session.id);
      const expected = availableTableFunds(sessionTransactions);
      const counted = expected;
      const closedAt = new Date().toISOString();
      const durationSeconds = durationSecondsBetween(session.started_at, closedAt);
      Object.assign(session, {
        status: 'closed',
        closed_at: closedAt,
        duration_seconds: durationSeconds,
        expected_funds: expected,
        counted_funds: counted,
        discrepancy: 0
      });

      const resultRecipients = [...new Set(membersForSession(session.id).map(member => member.user_id))];
      resultRecipients.forEach(playerId => {
        const summary = playerSummary(sessionTransactions, playerId);
        const resultMessage = summary.net > 0
          ? `You won ${formatCurrency(summary.net)}.`
          : summary.net < 0
            ? `You lost ${formatCurrency(Math.abs(summary.net))}.`
            : 'You finished even.';
        addNotification(
          playerId,
          'Table finished',
          `${session.name}: ${resultMessage}`,
          {
            type: summary.net > 0 ? 'approved' : summary.net < 0 ? 'rejected' : 'info',
            sessionId: session.id,
            delivery: 'final_result',
            resultSummary: {
              session_name: session.name,
              cash_in: summary.buyIn,
              cash_out: summary.cashOut,
              net: summary.net,
              duration_seconds: durationSeconds
            }
          }
        );
      });

      addAudit('session_closed', session.id, user.id, {
        targetType: 'session',
        targetId: session.id,
        details: {
          expected_funds: expected,
          counted_funds: counted,
          discrepancy: session.discrepancy,
          duration_seconds: durationSeconds,
          missing_cashout_user_ids: missingPlayers.map(player => player.id)
        }
      });
      commit({
        sessions: [...getState().sessions],
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeActiveModal();
      navigate('history');
      showToast('Table ended.');
    } else if (form.id === 'correct-transaction-form') {
      const transactionSession = sessionByTransactionId(data.transactionId);
      const transaction = transactionSession
        ? transactionsForSession(transactionSession.id).find(item => item.id === data.transactionId)
        : null;
      if (!transaction || transaction.is_reversed || !['buy_in', 'cash_out'].includes(transaction.transaction_type)) {
        throw new Error('This transaction is no longer available for correction.');
      }

      const session = sessionById(transaction.session_id);
      requireHost(session, user.id);
      requireSessionStatus(session, ['active'], 'Transactions can be corrected only while the session is active.');

      const reason = String(data.reason || '').trim();
      if (!reason) throw new Error('A correction reason is required.');

      const correctedAmount = numberOrNull(data.correctedAmount);
      if (correctedAmount !== null) {
        validateMoney(correctedAmount);
        if (transaction.transaction_type === 'buy_in') validateBuyIn(session, correctedAmount);
        if (transaction.transaction_type === 'cash_out') ensureCorrectionFunds(session.id, transaction, correctedAmount);
      }

      const reversal = addTransaction(session.id, transaction.player_id, 'reversal', transaction.amount, reason, {
        reversesTransactionId: transaction.id,
        metadata: { original_type: transaction.transaction_type }
      });
      let replacement = null;
      if (correctedAmount !== null) {
        replacement = addTransaction(
          session.id,
          transaction.player_id,
          transaction.transaction_type,
          correctedAmount,
          `Corrected entry: ${reason}`,
          { metadata: { correction_group_id: reversal.id, replaces_transaction_id: transaction.id } }
        );
      }

      addAudit('transaction_corrected', session.id, user.id, {
        targetType: 'transaction',
        targetId: transaction.id,
        details: {
          original_amount: transaction.amount,
          corrected_amount: correctedAmount,
          transaction_type: transaction.transaction_type,
          reversal_transaction_id: reversal.id,
          replacement_transaction_id: replacement?.id || null,
          reason
        }
      });
      commit({ transactions: [...getState().transactions], auditLogs: [...getState().auditLogs] });
      closeActiveModal();
      showToast('Money record fixed.');
    } else if (form.id === 'profile-form') {
      const displayName = String(data.displayName || '').trim().replace(/\s+/g, ' ');
      const nameError = validateDisplayName(displayName);
      if (nameError) throw new Error(nameError);
      const emailError = validateEmail(String(data.email || ''));
      if (emailError) throw new Error(emailError);
      const updated = await updateOwnProfile({ displayName, email: String(data.email || '') });
      const users = mergeRemoteProfiles([updated], updated);
      setState({ users, currentUserId: updated.id });
      persistState();
      showToast('Profile saved.');
    }
  } catch (error) {
    console.error(error);
    const errorElement = form.querySelector('.form-error');
    if (errorElement) {
      errorElement.hidden = false;
      errorElement.textContent = error.message;
    } else {
      showToast(error.message || 'Something went wrong.', 'error', 5000);
    }
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleAction(event) {
  const target = event.target.closest('button');
  if (!target || !currentUser()) return;
  const user = currentUser();
  const registrationDialog = target.closest('#admin-registration-queue-modal');
  if (registrationDialog) registrationDialog.querySelectorAll('button').forEach(button => { button.disabled = true; });

  try {
    if (target.dataset.hostMoneyApprove) {
      const requestId = target.dataset.hostMoneyApprove;
      const requestKind = target.dataset.requestKind === 'cashout' ? 'cashout' : 'buyin';
      const requestList = requestKind === 'buyin' ? getState().requests.buyin : getState().requests.cashout;
      const request = requestList.find(item => item.id === requestId);
      if (!request) throw new Error(`This ${requestKind === 'buyin' ? 'cash-in' : 'cash-out'} request no longer exists.`);
      setHostQueueBusy(target.closest('#host-money-queue-modal'), true);
      approveMoneyRequest(requestKind, requestId, Number(request.requested_amount));
      closeHostMoneyApprovalDialog(requestId);
      showToast(`${requestKind === 'buyin' ? 'Cash-in' : 'Cash-out'} approved. Table money: ${formatCurrency(availableTableFunds(transactionsForSession(request.session_id)))}`);
      requestAnimationFrame(() => syncHostMoneyApprovalQueue(currentUser()));
    } else if (target.dataset.hostMoneyReject) {
      const requestId = target.dataset.hostMoneyReject;
      const requestKind = target.dataset.requestKind === 'cashout' ? 'cashout' : 'buyin';
      const dialog = target.closest('#host-money-queue-modal');
      const reason = String(dialog?.querySelector('[name="hostQueueRejectReason"]')?.value || '').trim() || 'Rejected by host';
      setHostQueueBusy(dialog, true);
      rejectRequest(requestKind, requestId, reason);
      closeHostMoneyApprovalDialog(requestId);
      showToast(`${requestKind === 'buyin' ? 'Cash-in' : 'Cash-out'} rejected.`);
      requestAnimationFrame(() => syncHostMoneyApprovalQueue(currentUser()));
    } else if (target.dataset.correctTransaction) {
      openModal('correct-transaction', {
        transactionId: target.dataset.correctTransaction,
        amount: target.dataset.amount,
        type: target.dataset.type
      });
    } else if (target.dataset.removeMember) {
      const session = currentRouteSession(['lobby', 'active']);
      requireHost(session, user.id);
      const playerId = target.dataset.removeMember;
      const player = userById(playerId);
      if (!player || !isMember(session.id, playerId)) throw new Error('Player is no longer in this table.');
      const accepted = await confirmDialog({
        title: `Remove ${player.display_name}?`,
        message: 'Their recorded money stays visible. Their waiting requests will be cancelled.',
        confirmText: 'Remove player',
        destructive: true
      });
      if (!accepted) return;

      const cancelled = cancelPendingForMember(session.id, playerId, 'Removed by host', user.id);
      addNotification(playerId, 'Removed from table', `You were removed from ${session.name}. Pending requests were cancelled.`);
      addAudit('player_removed', session.id, user.id, {
        targetType: 'user',
        targetId: playerId,
        details: { user_id: playerId, cancelled_request_ids: cancelled }
      });
      commit({
        members: getState().members.filter(member => !(member.session_id === session.id && member.user_id === playerId)),
        requests: cloneRequests(),
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeMemberMenus();
      showToast('Player removed.');
    } else if (target.dataset.transferHost) {
      const session = currentRouteSession(['lobby', 'active']);
      requireHost(session, user.id);
      const nextHostId = target.dataset.transferHost;
      const nextHost = userById(nextHostId);
      if (!nextHost || nextHost.account_status !== 'active' || !isMember(session.id, nextHostId)) {
        throw new Error('The selected player is not eligible to become host.');
      }
      const accepted = await confirmDialog({
        title: `Make ${nextHost.display_name} the host?`,
        message: 'They will become the new host.',
        confirmText: 'Make host'
      });
      if (!accepted) return;

      const previousHostId = session.host_user_id;
      session.host_user_id = nextHostId;
      const members = getState().members.map(member =>
        member.session_id !== session.id
          ? member
          : member.user_id === previousHostId
            ? { ...member, member_role: 'player' }
            : member.user_id === nextHostId
              ? { ...member, member_role: 'host' }
              : member
      );
      addNotification(nextHostId, 'You are now the host', `${user.display_name} transferred ${session.name} to you.`, { type: 'approved', sessionId: session.id });
      addAudit('host_transferred', session.id, user.id, {
        targetType: 'user',
        targetId: nextHostId,
        details: { previous_host_id: previousHostId, new_host_id: nextHostId }
      });
      commit({
        sessions: [...getState().sessions],
        members,
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      closeMemberMenus();
      showToast('New host saved.');
    } else if (target.dataset.adminRegistrationApprove) {
      if (!user.is_admin) throw new Error('Admin only.');
      const applicantId = target.dataset.adminRegistrationApprove;
      const applicant = userById(applicantId);
      if (!applicant || !['pending', 'rejected'].includes(applicant.account_status)) throw new Error('This account request is no longer waiting.');
      await runAdminAccountAction('set_status', { userId: applicantId, status: 'active' });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      closeAdminRegistrationApprovalDialog(applicantId);
      triggerHapticFeedback('approved', { force: true });
      showToast(`${applicant.display_name} can now log in.`);
      requestAnimationFrame(() => syncAdminRegistrationApprovalQueue(currentUser()));
    } else if (target.dataset.adminRegistrationReject) {
      if (!user.is_admin) throw new Error('Admin only.');
      const applicantId = target.dataset.adminRegistrationReject;
      const applicant = userById(applicantId);
      if (!applicant || applicant.account_status !== 'pending') throw new Error('This account request is no longer waiting.');
      const queueDialog = target.closest('#admin-registration-queue-modal');
      const typedReason = queueDialog?.querySelector('[name="adminRegistrationRejectReason"]')?.value?.trim();
      const reason = typedReason || 'Registration not approved by admin.';
      await runAdminAccountAction('set_status', { userId: applicantId, status: 'rejected', reason });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      closeAdminRegistrationApprovalDialog(applicantId);
      triggerHapticFeedback('rejected', { force: true });
      showToast('Registration rejected.', 'error');
      requestAnimationFrame(() => syncAdminRegistrationApprovalQueue(currentUser()));
    } else if (target.dataset.adminResetPassword) {
      if (!user.is_admin) throw new Error('Admin only.');
      const targetUser = userById(target.dataset.adminResetPassword);
      if (!targetUser) throw new Error('Account not found.');
      openModal('reset-password', { userId: targetUser.id, userName: targetUser.display_name });
    } else if (target.dataset.adminDeleteUser) {
      if (!user.is_admin) throw new Error('Admin only.');
      const targetUserId = target.dataset.adminDeleteUser;
      if (targetUserId === user.id) throw new Error('You cannot delete the account you are using.');
      const targetUser = userById(targetUserId);
      if (!targetUser) throw new Error('Account not found.');
      const hasTableHistory = getState().sessions.some(session => session.host_user_id === targetUserId) ||
        getState().members.some(member => member.user_id === targetUserId) ||
        getState().transactions.some(transaction => transaction.player_id === targetUserId);
      if (hasTableHistory) throw new Error('This user has table history. Suspend the account instead so old results stay correct.');
      const accepted = await confirmDialog({
        title: `Delete ${targetUser.display_name}?`,
        message: 'This removes the account permanently. This cannot be undone.',
        confirmText: 'Delete account',
        destructive: true
      });
      if (!accepted) return;
      await runAdminAccountAction('delete_user', { userId: targetUserId });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      commit({ notifications: getState().notifications.filter(item => item.user_id !== targetUserId && item.request_id !== targetUserId) });
      showToast('Account deleted.');
    } else if (target.dataset.reviewReport) {
      if (!user.is_admin) throw new Error('Admin only.');
      const report = getState().reports.find(item => item.id === target.dataset.reviewReport);
      if (!report) throw new Error('Report not found.');
      const status = target.dataset.reportStatus;
      const note = (prompt(status === 'reviewing' ? 'Optional review note:' : 'Resolution note:') || '').trim();
      if (status !== 'reviewing' && !note) return;

      report.status = status;
      report.resolution_note = note || 'Under review';
      addNotification(report.reporter_id, 'Report updated', `${report.session_name}: ${report.resolution_note}`);
      addAudit(`report_${status}`, report.session_id, user.id, {
        targetType: 'report',
        targetId: report.id,
        details: { status, resolution_note: report.resolution_note }
      });
      commit({
        reports: [...getState().reports],
        notifications: [...getState().notifications],
        auditLogs: [...getState().auditLogs]
      });
      showToast('Report status updated.');
    } else if (target.dataset.adminStatus) {
      if (!user.is_admin) throw new Error('Admin only.');
      const targetUserId = target.dataset.userId;
      if (targetUserId === user.id) throw new Error('You cannot suspend the account you are using.');

      if (target.dataset.adminStatus === 'suspended') {
        const openHosted = getState().sessions.filter(session =>
          session.host_user_id === targetUserId && ['lobby', 'active'].includes(session.status)
        );
        if (openHosted.length) {
          throw new Error(`Transfer or close this user’s open session${openHosted.length === 1 ? '' : 's'} first: ${openHosted.map(session => session.name).join(', ')}.`);
        }
      }

      const reason = (prompt(`Reason for changing this account to ${target.dataset.adminStatus}:`) || '').trim();
      if (!reason) return;
      await runAdminAccountAction('set_status', {
        userId: targetUserId,
        status: target.dataset.adminStatus,
        reason
      });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      showToast('Account status updated.');
    }
  } catch (error) {
    console.error(error);
    const queueDialog = target?.closest?.('#host-money-queue-modal');
    if (queueDialog) {
      setHostQueueBusy(queueDialog, false);
      const errorElement = queueDialog.querySelector('.host-buyin-queue__error');
      if (errorElement) {
        errorElement.hidden = false;
        errorElement.textContent = error.message || 'Something went wrong.';
      }
      return;
    }
    const registrationDialog = target?.closest?.('#admin-registration-queue-modal');
    if (registrationDialog) {
      registrationDialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
      const errorElement = registrationDialog.querySelector('.admin-registration-queue__error');
      if (errorElement) {
        errorElement.hidden = false;
        errorElement.textContent = error.message || 'Something went wrong.';
      }
      return;
    }
    showToast(error.message || 'Something went wrong.', 'error', 5000);
  }
}

function reviewJoin(requestId, approve, reason = '') {
  const request = getState().requests.join.find(item => item.id === requestId);
  if (!request || !request.status?.startsWith('pending')) throw new Error('This join request is no longer pending.');
  const session = sessionById(request.session_id);
  requireHost(session, currentUser().id);
  requireSessionStatus(session, ['lobby', 'active'], 'This session no longer accepts join approvals.');

  const requester = userById(request.user_id);
  if (approve && (!requester || requester.account_status !== 'active')) throw new Error('This player is not eligible to join.');

  request.status = approve ? 'approved' : 'rejected';
  request.rejection_reason = reason;
  if (approve && !isMember(session.id, request.user_id)) {
    getState().members.push({
      id: makeId('m'),
      session_id: session.id,
      user_id: request.user_id,
      member_role: 'player',
      joined_at: new Date().toISOString()
    });
  }

  addNotification(
    request.user_id,
    approve ? 'Join approved' : 'Join rejected',
    approve ? `You can now open ${session.name}.` : `${session.name}: ${reason}`,
    { type: approve ? 'approved' : 'rejected', sessionId: session.id }
  );
  addAudit(approve ? 'join_approved' : 'join_rejected', session.id, currentUser().id, {
    targetType: 'request',
    targetId: request.id,
    details: { user_id: request.user_id, reason }
  });
  commit({
    requests: cloneRequests(),
    members: [...getState().members],
    notifications: [...getState().notifications],
    auditLogs: [...getState().auditLogs]
  });
}

function approveMoneyRequest(kind, id, amount) {
  const list = kind === 'buyin' ? getState().requests.buyin : getState().requests.cashout;
  const request = list.find(item => item.id === id);
  if (!request || !request.status?.startsWith('pending')) throw new Error('This request is no longer pending.');

  const session = sessionById(request.session_id);
  requireHost(session, currentUser().id);
  requireSessionStatus(session, ['active'], 'Money requests can be approved only during an active session.');
  if (!isMember(session.id, request.requester_id)) throw new Error('The requester is no longer a member. Reject or cancel this request instead.');

  if (kind === 'buyin') {
    validateBuyIn(session, amount);
  } else {
    if (toCents(amount) !== toCents(request.requested_amount)) throw new Error('Cash-out approval must use the requested amount.');
    ensureFunds(session.id, amount);
  }

  request.status = 'approved';
  request.approved_amount = amount;
  const transaction = addTransaction(
    session.id,
    request.requester_id,
    kind === 'buyin' ? 'buy_in' : 'cash_out',
    amount,
    '',
    {
      requestId: request.id,
      metadata: { requested_amount: request.requested_amount }
    }
  );

  markRequestNotificationRead(request.id, session.host_user_id);
  addNotification(
    request.requester_id,
    `${kind === 'buyin' ? 'Cash-in' : 'Cash-out'} approved`,
    `${formatCurrency(amount)} was approved for ${session.name}.`,
    { type: 'approved', sessionId: session.id }
  );
  addAudit(`${kind}_approved`, session.id, currentUser().id, {
    targetType: 'transaction',
    targetId: transaction.id,
    details: {
      request_id: request.id,
      player_id: request.requester_id,
      requested_amount: request.requested_amount,
      approved_amount: amount
    }
  });
  commit({
    requests: cloneRequests(),
    transactions: [...getState().transactions],
    notifications: [...getState().notifications],
    auditLogs: [...getState().auditLogs]
  });
}

function rejectRequest(kind, id, reason) {
  const list = kind === 'buyin' ? getState().requests.buyin : getState().requests.cashout;
  const request = list.find(item => item.id === id);
  if (!request || !request.status?.startsWith('pending')) throw new Error('This request is no longer pending.');
  const session = sessionById(request.session_id);
  requireHost(session, currentUser().id);

  request.status = 'rejected';
  request.rejection_reason = reason;
  markRequestNotificationRead(request.id, session.host_user_id);
  addNotification(
    request.requester_id,
    `${kind === 'buyin' ? 'Cash-in' : 'Cash-out'} rejected`,
    `${session.name}: ${reason}`,
    { type: 'rejected', sessionId: session.id }
  );
  addAudit(`${kind}_rejected`, session.id, currentUser().id, {
    targetType: 'request',
    targetId: request.id,
    details: { player_id: request.requester_id, reason }
  });
  commit({
    requests: cloneRequests(),
    notifications: [...getState().notifications],
    auditLogs: [...getState().auditLogs]
  });
}

function cancelRequest(kind, id) {
  const key = kind === 'join' ? 'join' : kind === 'buyin' ? 'buyin' : 'cashout';
  const request = getState().requests[key].find(item => item.id === id);
  if (!request || !request.status?.startsWith('pending')) throw new Error('This request is no longer pending.');
  if ((request.requester_id || request.user_id) !== currentUser().id) throw new Error('You can cancel only your own request.');

  request.status = 'cancelled';
  request.cancellation_reason = 'Cancelled by requester';
  request.cancelled_at = new Date().toISOString();
  addAudit(`${key}_cancelled`, request.session_id, currentUser().id, {
    targetType: 'request',
    targetId: request.id,
    details: { reason: request.cancellation_reason }
  });
  commit({ requests: cloneRequests(), auditLogs: [...getState().auditLogs] });
}

function cancelPendingForMember(sessionId, userId, reason, actorId) {
  const cancelledIds = [];
  const groups = [
    ['join', getState().requests.join],
    ['buyin', getState().requests.buyin],
    ['cashout', getState().requests.cashout]
  ];

  for (const [kind, list] of groups) {
    for (const request of list) {
      const requesterId = request.requester_id || request.user_id;
      if (request.session_id !== sessionId || requesterId !== userId || !request.status?.startsWith('pending')) continue;
      request.status = 'cancelled';
      request.cancellation_reason = reason;
      request.cancelled_at = new Date().toISOString();
      cancelledIds.push(request.id);
      addAudit(`${kind}_auto_cancelled`, sessionId, actorId, {
        targetType: 'request',
        targetId: request.id,
        details: { user_id: userId, reason }
      });
    }
  }

  if (cancelledIds.length && actorId !== userId) {
    addNotification(userId, 'Pending requests cancelled', `${cancelledIds.length} pending request${cancelledIds.length === 1 ? '' : 's'} were cancelled: ${reason}.`);
  }
  return cancelledIds;
}

function cancelAllPendingForSession(sessionId, reason, actorId) {
  const requests = getState().requests;
  for (const [kind, list] of Object.entries(requests)) {
    list.forEach(request => {
      if (request.session_id !== sessionId || !request.status?.startsWith('pending')) return;
      request.status = 'cancelled';
      request.cancellation_reason = reason;
      request.cancelled_at = new Date().toISOString();
      addNotification(request.requester_id || request.user_id, 'Request cancelled', reason);
      addAudit(`${kind}_auto_cancelled`, sessionId, actorId, {
        targetType: 'request',
        targetId: request.id,
        details: { reason }
      });
    });
  }
}

function setHostQueueBusy(dialog, busy) {
  if (!dialog) return;
  dialog.querySelectorAll('button').forEach(button => {
    button.disabled = busy;
  });
  dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (!busy) dialog.removeAttribute('aria-busy');
}

function currentRouteSession(allowedStatuses = null) {
  const route = parseRoute(getState().route);
  const session = route.page === 'session' ? sessionById(route.id) : null;
  if (!session) throw new Error('Open a table first.');
  if (allowedStatuses) requireSessionStatus(session, allowedStatuses);
  return session;
}

function requireSessionStatus(session, allowedStatuses, customMessage = '') {
  if (!session || !allowedStatuses.includes(session.status)) {
    throw new Error(customMessage || `This action is unavailable while the session is ${session?.status || 'unavailable'}.`);
  }
}

function requireHost(session, userId) {
  if (!session || session.host_user_id !== userId) throw new Error('Only the host can do that.');
}

function requireMembership(session, userId) {
  if (!session || !isMember(session.id, userId)) throw new Error('You are no longer in this table.');
}

function buildCloseSessionReview(sessionId) {
  const session = sessionById(sessionId);
  const transactions = transactionsForSession(sessionId);
  const rows = membersForSession(sessionId).map(member => {
    const summary = playerSummary(transactions, member.user_id);
    return {
      userId: member.user_id,
      name: member.profile?.display_name || 'Player',
      isHost: member.user_id === session?.host_user_id,
      buyIn: summary.buyIn,
      cashOut: summary.cashOut,
      net: summary.net
    };
  });

  return {
    rows,
    tableFunds: availableTableFunds(transactions)
  };
}

function pendingForSession(sessionId) {
  const requests = getState().requests;
  return [...requests.join, ...requests.buyin, ...requests.cashout]
    .filter(request => request.session_id === sessionId && request.status?.startsWith('pending'));
}

function preventDuplicatePending(kind, sessionId, userId) {
  const list = kind === 'buyin' ? getState().requests.buyin : getState().requests.cashout;
  if (list.some(request =>
    request.session_id === sessionId && request.requester_id === userId && request.status?.startsWith('pending')
  )) throw new Error(`Resolve or cancel your existing ${kind === 'buyin' ? 'cash-in' : 'cash-out'} request first.`);
}

function missingCashoutPlayers(sessionId) {
  const transactions = transactionsForSession(sessionId);
  return membersForSession(sessionId)
    .map(member => ({ ...member.profile, summary: playerSummary(transactions, member.user_id) }))
    .filter(player => player.id && player.summary.buyIn > 0 && player.summary.cashOut === 0);
}

function validateMoney(value) {
  const error = validAmount(value, { min: 0.01, label: 'Amount' });
  if (error) throw new Error(error);
  if (toCents(value) <= 0) throw new Error('Amount must be greater than zero.');
}

function validateBuyIn(_session, amount) {
  validateMoney(amount);
}

function ensureFunds(sessionId, amount) {
  const funds = availableTableFunds(transactionsForSession(sessionId));
  if (toCents(amount) > toCents(funds)) {
    throw new Error(`Cash-out cannot exceed the ${formatCurrency(funds)} currently available.`);
  }
}

function ensureCorrectionFunds(sessionId, originalTransaction, correctedAmount) {
  const currentFunds = availableTableFunds(transactionsForSession(sessionId));
  const projectedAvailable = currentFunds + Number(originalTransaction.amount);
  if (toCents(correctedAmount) > toCents(projectedAvailable)) {
    throw new Error(`Corrected cash-out cannot exceed the projected ${formatCurrency(projectedAvailable)} available after reversing the original entry.`);
  }
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Enter a valid number.');
  return number;
}

function sessionByTransactionId(transactionId) {
  const transaction = getState().transactions.find(item => item.id === transactionId);
  return transaction ? sessionById(transaction.session_id) : null;
}

function openModal(type, context = {}) {
  document.getElementById('active-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', modalTemplate(type, context));
  const dialog = document.getElementById('active-modal');
  if (!dialog) return;

  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeActiveModal();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  dialog.querySelector('input:not([type="hidden"]), button, textarea, select')?.focus();
}

function closeActiveModal() {
  const dialog = document.getElementById('active-modal');
  if (!dialog) return;
  if (dialog.open) dialog.close();
  else dialog.remove();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function csvSafeCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(session, transactions) {
  const rows = [[
    'Timestamp',
    'Session Code',
    'Session',
    'Player',
    'Type',
    'Amount PHP',
    'Reversed',
    'Request ID',
    'Correction Reason',
    'Metadata'
  ]];

  for (const item of transactions) {
    rows.push([
      item.created_at,
      session.session_code,
      session.name,
      item.player?.display_name || 'Player',
      item.transaction_type,
      item.amount,
      item.is_reversed ? 'Yes' : 'No',
      item.request_id || '',
      item.correction_reason || '',
      JSON.stringify(item.metadata || {})
    ]);
  }

  const csv = rows.map(row => row.map(csvSafeCell).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Pokerat_${session.session_code}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function toggleMemberMenu(trigger) {
  const menuId = trigger.getAttribute('aria-controls');
  const menu = menuId ? document.getElementById(menuId) : null;
  if (!menu) return;

  const willOpen = menu.hidden;
  closeMemberMenus();
  if (!willOpen) return;

  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  menu.dataset.memberMenu = 'open';
  positionMemberMenu(trigger, menu);
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function positionMemberMenu(trigger, menu) {
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const menuWidth = Math.max(menu.offsetWidth, 150);
  const menuHeight = menu.offsetHeight;
  let left = rect.right - menuWidth;
  let top = rect.bottom + margin;

  if (left < margin) left = margin;
  if (left + menuWidth > window.innerWidth - margin) left = window.innerWidth - menuWidth - margin;
  if (top + menuHeight > window.innerHeight - margin) top = Math.max(margin, rect.top - menuHeight - margin);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function closeMemberMenus() {
  document.querySelectorAll('[data-member-menu]').forEach(menu => {
    menu.hidden = true;
    menu.removeAttribute('data-member-menu');
    menu.style.left = '';
    menu.style.top = '';
  });
  document.querySelectorAll('[data-member-menu-trigger][aria-expanded="true"]').forEach(trigger => {
    trigger.setAttribute('aria-expanded', 'false');
  });
}

bootstrap();
