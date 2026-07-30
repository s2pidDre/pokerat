import { getState, setState, subscribe } from './lib/store.js';
import { initRouter, navigate, parseRoute } from './lib/router.js';
import { closeHostMoneyApprovalDialog, confirmDialog, setButtonBusy, showFinalResultDialog, showHostMoneyApprovalDialog, showNotificationPopup, showToast, triggerHapticFeedback } from './lib/ui.js';
import { loadAppData, resetAppData, saveAppData } from './lib/app-data.js';
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
  playerProfileView,
  accountAccessView,
  requestsView,
  sessionView,
  suspendedView
} from './components/templates.js';
import { availableTableFunds, playerSummary, toCents } from './utils/accounting.js';
import { escapeHtml, formatCurrency, formatDuration, formatDurationSeconds } from './utils/format.js';
import { buildClosedTableLeaderboard, buildPlayerPerformance } from './utils/leaderboard.js';
import { validAmount } from './utils/validation.js';
import { clearLoginAttempts, getLoginLock, normalizeLoginIdentifier, recordFailedLogin, validateDisplayName, validatePassword } from './utils/auth.js';
import { changeOwnPassword, completeForcedPasswordChange, createFirstAdministrator, getCurrentProfile, getSession, getVisibleProfiles, hasActiveAdministrator, loginAccount, logoutAccount, onAuthStateChange, registerAccount, runAdminAccountAction, subscribeToProfiles, unsubscribeFromProfiles, updateOwnProfile } from './lib/account-service.js';
import { cancelMoneyRequest, cancelPokerTable, clearRemoteActivity, closePokerTable, correctPokerTransaction, createPokerTable, joinPokerTable, loadPokeratActivity, markAllNotificationsRead, markNotificationRead, recordHostMoney, removeTableMember, reviewMoneyRequest, reviewSessionReport, startPokerTable, submitMoneyRequest, submitSessionReport, subscribeToPokeratActivity, transferTableHost, unsubscribeFromPokeratActivity } from './lib/table-service.js';

const app = document.getElementById('app');
let renderQueued = false;
let sessionTimerInterval = null;
const surfacedNotificationIds = new Set();
let activityRefreshTimer = null;
let activityRefreshPromise = null;
let notificationBaselineReady = false;
const pendingNotificationPopups = new Map();
let notificationPopupTimer = null;

function resetNotificationBaseline() {
  surfacedNotificationIds.clear();
  pendingNotificationPopups.clear();
  if (notificationPopupTimer) window.clearTimeout(notificationPopupTimer);
  notificationPopupTimer = null;
  notificationBaselineReady = false;
}

function seedNotificationBaseline(notifications = []) {
  surfacedNotificationIds.clear();
  notifications.forEach(notification => surfacedNotificationIds.add(notification.id));
  notificationBaselineReady = true;
}

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
    sessions: [],
    members: [],
    transactions: [],
    requests: { join: [], buyin: [], cashout: [] },
    notifications: [],
    reports: [],
    auditLogs: [],
    sessionResults: []
  });
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

function visibleSessionsForUser(userId) {
  return getState().sessions
    .filter(session => ['lobby', 'active'].includes(session.status) || isMember(session.id, userId))
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

function notificationsForUser(userId, limit = 20) {
  return getState().notifications
    .filter(notification => notification.user_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

function unreadNotifications(userId) {
  return notificationsForUser(userId, Number.MAX_SAFE_INTEGER)
    .filter(notification => !notification.read_at);
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

function surfaceNewNotifications(userId, notifications) {
  if (!notificationBaselineReady) return;
  if (document.getElementById('host-money-queue-modal')?.open || document.getElementById('final-result-modal')?.open) return;

  const unseen = notifications.filter(notification =>
    notification.user_id === userId &&
    !['host_buyin_queue', 'host_money_queue', 'final_result', 'admin_registration_queue'].includes(notification.delivery) &&
    !surfacedNotificationIds.has(notification.id)
  );
  if (!unseen.length) return;

  unseen.forEach(notification => {
    surfacedNotificationIds.add(notification.id);
    pendingNotificationPopups.set(notification.id, notification);
  });

  if (notificationPopupTimer) window.clearTimeout(notificationPopupTimer);
  notificationPopupTimer = window.setTimeout(() => {
    notificationPopupTimer = null;
    const queued = [...pendingNotificationPopups.values()]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    pendingNotificationPopups.clear();
    if (!queued.length) return;

    if (queued.length === 1) {
      const notification = queued[0];
      showNotificationPopup({
        title: notification.title,
        message: notification.message,
        type: notification.type || inferNotificationType(notification.title),
        actionHash: notification.action_hash || '',
        actionLabel: notification.action_hash ? 'Open table' : ''
      });
      return;
    }

    const newest = queued[0];
    showNotificationPopup({
      title: `${queued.length} new notifications`,
      message: `${newest.title}${queued.length > 1 ? ` and ${queued.length - 1} more update${queued.length - 1 === 1 ? '' : 's'}` : ''}.`,
      type: 'info'
    });
  }, 350);
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

function syncHostMoneyApprovalQueue(user) {
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

function showNotificationResult(notification) {
  const result = notification?.result_summary || {};
  showFinalResultDialog({
    notificationId: notification.id,
    sessionName: result.session_name || sessionById(notification.session_id)?.name || 'Finished table',
    cashInText: formatCurrency(result.cash_in || 0),
    cashOutText: formatCurrency(result.cash_out || 0),
    netText: formatCurrency(result.net || 0, { signed: true }),
    netValue: Number(result.net) || 0,
    durationText: formatDurationSeconds(result.duration_seconds || 0),
    onDone: () => {
      markNotificationRead(notification.id)
        .then(() => refreshRemoteActivity({ quiet: true }))
        .catch(error => showToast(error.message || 'Could not mark the result as read.', 'error'));
    }
  });
}

async function signOut(message = '') {
  await logoutAccount();
  unsubscribeFromProfiles();
  unsubscribeFromPokeratActivity();
  closeActiveModal();
  closeHostMoneyApprovalDialog();
  resetNotificationBaseline();
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
    unsubscribeFromPokeratActivity();
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
    await refreshRemoteActivity({ quiet: true, seedNotifications: true });
    startActivityRealtime();
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

function mergeActivityUsers(activityUsers, profile = currentUser()) {
  return mergeRemoteProfiles(activityUsers || [], profile || null);
}

async function refreshRemoteActivity({ quiet = false, seedNotifications = false } = {}) {
  if (activityRefreshPromise) {
    const activity = await activityRefreshPromise;
    if (seedNotifications) seedNotificationBaseline(activity.notifications || []);
    return activity;
  }
  activityRefreshPromise = (async () => {
    try {
      const activity = await loadPokeratActivity();
      if (seedNotifications) seedNotificationBaseline(activity.notifications || []);
      const profile = currentUser();
      setState({
        ...activity,
        users: mergeActivityUsers(activity.users, profile),
        currentUserId: profile?.id || getState().currentUserId,
        error: ''
      });
      persistState();
      return activity;
    } catch (error) {
      if (!quiet) showToast(error.message || 'Could not refresh table data.', 'error', 5000);
      throw error;
    } finally {
      activityRefreshPromise = null;
    }
  })();
  return activityRefreshPromise;
}

function queueActivityRefresh(delay = 80) {
  if (activityRefreshTimer) window.clearTimeout(activityRefreshTimer);
  activityRefreshTimer = window.setTimeout(() => {
    activityRefreshTimer = null;
    refreshRemoteActivity({ quiet: true }).catch(error => console.error('Realtime activity refresh failed:', error));
  }, delay);
}

function startActivityRealtime() {
  subscribeToPokeratActivity(
    () => queueActivityRefresh(),
    (status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Pokerat realtime channel error:', error || status);
      }
    }
  );
}

async function refreshAllRemoteData({ routeAfterApproval = false } = {}) {
  const profile = await refreshRemoteProfiles({ routeAfterApproval });
  if (profile?.account_status === 'active') await refreshRemoteActivity({ quiet: true });
  return profile;
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
  const memberSessions = sessionsForUser(user.id);
  const sessions = visibleSessionsForUser(user.id);
  const requests = requestsForUser(user.id);
  const effectiveRoute = route.page === 'sessions' ? { page: 'home', id: '' } : route;
  let content;

  switch (effectiveRoute.page) {
    case 'home':
      content = homeView({ sessions, requests, profile: user });
      break;
    case 'requests':
      content = requestsView({ requests, userId: user.id });
      break;
    case 'leaderboard': {
      const leaderboard = buildClosedTableLeaderboard({
        sessions: state.sessions,
        transactions: state.transactions,
        users: state.users,
        sessionResults: state.sessionResults
      });
      content = leaderboardView({
        leaderboard,
        profileId: user.id,
        closedTableCount: new Set((state.sessionResults || []).map(result => result.session_id)).size
      });
      break;
    }
    case 'history':
      content = historyView({ sessions: memberSessions, profileId: user.id });
      break;
    case 'profile':
      content = profileView(user);
      break;
    case 'player': {
      const player = userById(effectiveRoute.id);
      content = player
        ? playerProfileView({
            player,
            performance: buildPlayerPerformance({
              userId: player.id,
              sessions: state.sessions,
              sessionResults: state.sessionResults
            }),
            isCurrentUser: player.id === user.id
          })
        : '<section class="simple-panel"><h1>Player not found</h1><p>This profile is unavailable.</p><a class="button button--primary" href="#/leaderboard">Back to leaderboard</a></section>';
      break;
    }
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
        : '<section class="simple-panel"><h1>Cannot open this table</h1><p>Join it first or log in with the correct account.</p><a class="button button--primary" href="#/home">Back home</a></section>';
      break;
    }
    default:
      content = homeView({ sessions, requests, profile: user });
  }

  const notifications = unreadNotifications(user.id);
  app.innerHTML = appShell({
    profile: user,
    isAdmin: Boolean(user.is_admin),
    route: effectiveRoute.page === 'session' ? `#/session/${effectiveRoute.id}` : effectiveRoute.page === 'player' ? '#/leaderboard' : `#/${effectiveRoute.page}`,
    content,
    notificationCount: notifications.length
  });
  requestAnimationFrame(() => {
    syncSessionTimerUpdates();
    surfaceNewNotifications(user.id, notifications);
  });
}

async function bootstrap() {
  document.documentElement.dataset.theme = localStorage.getItem('pokerat-theme') || 'dark';
  const data = loadAppData();
  seedNotificationBaseline(data.notifications);
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
    if (authenticatedProfile?.account_status === 'active') {
      const activity = await loadPokeratActivity();
      Object.assign(data, activity);
      seedNotificationBaseline(data.notifications || []);
      data.users = mergeRemoteProfiles(activity.users || [], authenticatedProfile);
    } else {
      data.sessions = [];
      data.members = [];
      data.transactions = [];
      data.requests = { join: [], buyin: [], cashout: [] };
      data.notifications = [];
      data.reports = [];
      data.auditLogs = [];
      data.sessionResults = [];
    }
    setState({ ...data, loading: false });

    if (!hasAdministrator) {
      history.replaceState(null, '', '#/setup');
    } else if (authenticatedProfile) {
      startProfileRealtime();
      if (authenticatedProfile.account_status === 'active') startActivityRealtime();
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
      resetNotificationBaseline();
      unsubscribeFromProfiles();
      unsubscribeFromPokeratActivity();
      setState({
        currentUserId: null,
        sessions: [], members: [], transactions: [],
        requests: { join: [], buyin: [], cashout: [] },
        notifications: [], reports: [], auditLogs: [], sessionResults: []
      });
      persistState();
      queueRender();
      return;
    }
    if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
      window.setTimeout(() => {
        refreshAllRemoteData({ routeAfterApproval: false })
          .then(profile => {
            startProfileRealtime();
            if (profile?.account_status === 'active') startActivityRealtime();
          })
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
      await clearRemoteActivity();
      await refreshRemoteActivity({ quiet: true });
      navigate('admin');
      showToast('All activity cleared. Registered users were kept.');
      return;
    }


    if (event.target.closest('#theme-toggle')) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('pokerat-theme', next);
      return;
    }

    if (event.target.closest('#notification-button')) {
      openModal('notifications', { notifications: notificationsForUser(currentUser().id) });
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

    const notificationAction = event.target.closest('[data-open-notification]');
    if (notificationAction) {
      const notification = getState().notifications.find(item => item.id === notificationAction.dataset.openNotification);
      if (!notification) throw new Error('Notification not found.');
      closeActiveModal();
      if (notification.delivery === 'final_result' && notification.result_summary) {
        showNotificationResult(notification);
      } else {
        await markNotificationRead(notification.id);
        await refreshRemoteActivity({ quiet: true });
        if (notification.action_hash) navigate(notification.action_hash.replace(/^#\//, ''));
      }
      return;
    }

    if (event.target.closest('[data-review-money-requests]')) {
      syncHostMoneyApprovalQueue(currentUser());
      return;
    }

    if (event.target.closest('[data-mark-notifications-read]')) {
      await markAllNotificationsRead();
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Notifications marked as read.');
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
      await refreshRemoteActivity({ quiet: true, seedNotifications: true });
      startProfileRealtime();
      startActivityRealtime();
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

      resetNotificationBaseline();
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
        await refreshRemoteActivity({ quiet: true, seedNotifications: true });
        startActivityRealtime();
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

    if (form.id === 'review-report-form') {
      if (!user.is_admin) throw new Error('Admin only.');
      const report = getState().reports.find(item => item.id === String(data.reportId || ''));
      if (!report) throw new Error('Report not found.');
      const status = String(data.status || '');
      if (!['reviewing', 'resolved', 'dismissed'].includes(status)) throw new Error('Invalid report status.');
      const note = String(data.note || '').trim();
      if (status !== 'reviewing' && !note) throw new Error('A resolution note is required.');
      await reviewSessionReport(report.id, status, note || 'Under review');
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Report status updated.');
      return;
    }

    if (form.id === 'admin-account-status-form') {
      if (!user.is_admin) throw new Error('Admin only.');
      const targetUserId = String(data.userId || '');
      const status = String(data.status || '');
      const reason = String(data.reason || '').trim();
      if (!['active', 'suspended'].includes(status)) throw new Error('Invalid account status.');
      if (targetUserId === user.id) throw new Error('You cannot change the account you are using.');
      const targetUser = userById(targetUserId);
      if (!targetUser) throw new Error('Account not found.');
      if (status === 'suspended') {
        if (!reason) throw new Error('A suspension reason is required.');
        const openHosted = getState().sessions.filter(session =>
          session.host_user_id === targetUserId && ['lobby', 'active'].includes(session.status)
        );
        if (openHosted.length) {
          throw new Error(`Transfer or close this user’s open table${openHosted.length === 1 ? '' : 's'} first: ${openHosted.map(session => session.name).join(', ')}.`);
        }
      }
      await runAdminAccountAction('set_status', { userId: targetUserId, status, reason });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      closeActiveModal();
      showToast(status === 'suspended' ? 'Account suspended.' : 'Account restored.');
      return;
    }

    if (form.id === 'hard-reset-form') {
      if (!user.is_admin) throw new Error('Admin only.');
      if (String(data.confirmation || '').trim() !== 'RESET POKERAT') {
        throw new Error('Type RESET POKERAT exactly to continue.');
      }
      closeHostMoneyApprovalDialog();
      resetNotificationBaseline();
      await runAdminAccountAction('hard_reset');
      await logoutAccount().catch(() => {});
      unsubscribeFromProfiles();
      unsubscribeFromPokeratActivity();
      const fresh = resetAppData();
      fresh.currentUserId = null;
      fresh.meta = { ...(fresh.meta || {}), hasActiveAdministrator: false };
      setState({ ...fresh, loading: false, error: '' });
      persistState();
      closeActiveModal();
      navigate('setup');
      showToast('Hard reset complete. Create the first administrator.');
      return;
    }

    if (form.id === 'create-session-form') {
      const name = String(data.name || '').trim();
      if (!name) throw new Error('Table name is required.');
      const result = await createPokerTable(name);
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      navigate(`session/${result.table_id}`);
      showToast(`Table ${result.session_code} created.`);
    } else if (form.id === 'join-session-form') {
      const result = await joinPokerTable(String(data.code || ''));
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      navigate(`session/${result.table_id}`);
      showToast(result.already_member ? 'You already joined this table.' : 'You joined the table.');
    } else if (form.id === 'request-buyin-form') {
      const session = currentRouteSession(['active']);
      requireMembership(session, user.id);
      validateMoney(data.amount);
      await submitMoneyRequest(session.id, 'buyin', Number(data.amount), String(data.note || ''));
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Cash-in request sent.');
    } else if (form.id === 'request-cashout-form') {
      const session = currentRouteSession(['active']);
      requireMembership(session, user.id);
      validateMoney(data.amount);
      await submitMoneyRequest(session.id, 'cashout', Number(data.amount));
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Cash-out request sent.');
    } else if (form.id === 'host-cashin-form') {
      const session = currentRouteSession(['active']);
      requireHost(session, user.id);
      validateMoney(data.amount);
      const result = await recordHostMoney(session.id, 'buyin', Number(data.amount));
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast(`Cash-in added. Table money: ${formatCurrency(Number(result.table_funds_cents || 0) / 100)}`);
    } else if (form.id === 'host-cashout-form') {
      const session = currentRouteSession(['active']);
      requireHost(session, user.id);
      validateMoney(data.amount);
      await recordHostMoney(session.id, 'cashout', Number(data.amount));
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Cash-out saved.');
    } else if (form.id === 'report-session-form') {
      const session = currentRouteSession(['lobby', 'active', 'closed', 'cancelled']);
      requireMembership(session, user.id);
      await submitSessionReport(session.id, String(data.reason || 'other'), String(data.details || ''));
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Report sent.');
    } else if (form.id === 'close-session-form') {
      const session = currentRouteSession(['active']);
      requireHost(session, user.id);
      await closePokerTable(session.id);
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      navigate('history');
      showToast('Table ended.');
    } else if (form.id === 'correct-transaction-form') {
      const transaction = getState().transactions.find(item => item.id === data.transactionId);
      if (!transaction || transaction.is_reversed || !['buy_in', 'cash_out'].includes(transaction.transaction_type)) {
        throw new Error('This transaction is no longer available for correction.');
      }
      const session = sessionById(transaction.session_id);
      requireHost(session, user.id);
      const reason = String(data.reason || '').trim();
      if (!reason) throw new Error('A correction reason is required.');
      const correctedAmount = numberOrNull(data.correctedAmount);
      if (correctedAmount !== null) validateMoney(correctedAmount);
      await correctPokerTransaction(transaction.id, correctedAmount, reason);
      await refreshRemoteActivity({ quiet: true });
      closeActiveModal();
      showToast('Money record fixed.');
    } else if (form.id === 'profile-form') {
      const displayName = String(data.displayName || '').trim().replace(/\s+/g, ' ');
      const nameError = validateDisplayName(displayName);
      if (nameError) throw new Error(nameError);
      if (displayName === user.display_name) {
        showToast('Your display name is unchanged.');
        return;
      }
      const updated = await updateOwnProfile({ displayName });
      const users = mergeRemoteProfiles([updated], updated);
      setState({ users, currentUserId: updated.id });
      persistState();
      showToast('Display name saved. You can change it again in 90 days.');
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
  try {
    if (target.dataset.joinOpenTable) {
      setButtonBusy(target, true, 'Joining…');
      const result = await joinPokerTable(target.dataset.joinOpenTable);
      await refreshRemoteActivity({ quiet: true });
      navigate(`session/${result.table_id}`);
      showToast(result.already_member ? 'You already joined this table.' : 'You joined the table.');
    } else if (target.hasAttribute('data-start-session')) {
      const session = currentRouteSession(['lobby']);
      requireHost(session, user.id);
      await startPokerTable(session.id);
      await refreshRemoteActivity({ quiet: true });
      showToast('Table started.');
    } else if (target.hasAttribute('data-cancel-session')) {
      const session = currentRouteSession(['lobby', 'active']);
      requireHost(session, user.id);
      const accepted = await confirmDialog({
        title: 'Cancel this table?',
        message: 'The table will be marked Cancelled and all waiting requests will be cancelled.',
        confirmText: 'Cancel table',
        destructive: true
      });
      if (!accepted) return;
      await cancelPokerTable(session.id);
      await refreshRemoteActivity({ quiet: true });
      navigate('home');
      showToast('Table cancelled.');
    } else if (target.dataset.copyCode) {
      await copyText(target.dataset.copyCode);
      showToast('Table code copied.');
    } else if (target.hasAttribute('data-export-session')) {
      const session = currentRouteSession(['lobby', 'active', 'closed', 'cancelled']);
      requireHost(session, user.id);
      exportCsv(session, transactionsForSession(session.id));
      showToast('CSV exported.');
    } else if (target.dataset.cancelBuyin || target.dataset.cancelCashout) {
      const requestId = target.dataset.cancelBuyin || target.dataset.cancelCashout;
      await cancelMoneyRequest(requestId);
      await refreshRemoteActivity({ quiet: true });
      showToast('Request cancelled.');
    } else if (target.dataset.hostMoneyApprove) {
      const requestId = target.dataset.hostMoneyApprove;
      const requestKind = target.dataset.requestKind === 'cashout' ? 'cashout' : 'buyin';
      const dialog = target.closest('#host-money-queue-modal');
      setHostQueueBusy(dialog, true);
      const result = await reviewMoneyRequest(requestId, true);
      await refreshRemoteActivity({ quiet: true });
      closeHostMoneyApprovalDialog(requestId);
      showToast(`${requestKind === 'buyin' ? 'Cash-in' : 'Cash-out'} approved. Table money: ${formatCurrency(Number(result.table_funds_cents || 0) / 100)}`);
      requestAnimationFrame(() => syncHostMoneyApprovalQueue(currentUser()));
    } else if (target.dataset.hostMoneyReject) {
      const requestId = target.dataset.hostMoneyReject;
      const requestKind = target.dataset.requestKind === 'cashout' ? 'cashout' : 'buyin';
      const dialog = target.closest('#host-money-queue-modal');
      const reason = String(dialog?.querySelector('[name="hostQueueRejectReason"]')?.value || '').trim() || 'Rejected by host';
      setHostQueueBusy(dialog, true);
      await reviewMoneyRequest(requestId, false, reason);
      await refreshRemoteActivity({ quiet: true });
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

      await removeTableMember(session.id, playerId);
      await refreshRemoteActivity({ quiet: true });
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

      await transferTableHost(session.id, nextHostId);
      await refreshRemoteActivity({ quiet: true });
      closeMemberMenus();
      showToast('New host saved.');
    } else if (target.dataset.adminRegistrationApprove) {
      if (!user.is_admin) throw new Error('Admin only.');
      const applicantId = target.dataset.adminRegistrationApprove;
      const applicant = userById(applicantId);
      if (!applicant || !['pending', 'rejected'].includes(applicant.account_status)) throw new Error('This account request is no longer waiting.');
      await runAdminAccountAction('set_status', { userId: applicantId, status: 'active' });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      triggerHapticFeedback('approved', { force: true });
      showToast(`${applicant.display_name} can now log in.`);
    } else if (target.dataset.adminRegistrationReject) {
      if (!user.is_admin) throw new Error('Admin only.');
      const applicantId = target.dataset.adminRegistrationReject;
      const applicant = userById(applicantId);
      if (!applicant || applicant.account_status !== 'pending') throw new Error('This account request is no longer waiting.');
      const reason = 'Registration not approved by admin.';
      await runAdminAccountAction('set_status', { userId: applicantId, status: 'rejected', reason });
      await refreshRemoteProfiles({ routeAfterApproval: false });
      triggerHapticFeedback('rejected', { force: true });
      showToast('Registration rejected.', 'error');
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
        getState().transactions.some(transaction => transaction.player_id === targetUserId) ||
        getState().reports.some(report => report.reporter_id === targetUserId) ||
        (getState().sessionResults || []).some(result => result.user_id === targetUserId);
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
      await refreshRemoteActivity({ quiet: true });
      showToast('Account deleted.');
    } else if (target.dataset.reviewReport) {
      if (!user.is_admin) throw new Error('Admin only.');
      const report = getState().reports.find(item => item.id === target.dataset.reviewReport);
      if (!report) throw new Error('Report not found.');
      openModal('review-report', {
        reportId: report.id,
        status: target.dataset.reportStatus,
        sessionName: report.session_name,
        reporterName: report.reporter_name
      });
    } else if (target.dataset.adminStatus) {
      if (!user.is_admin) throw new Error('Admin only.');
      const targetUserId = target.dataset.userId;
      if (targetUserId === user.id) throw new Error('You cannot change the account you are using.');
      const targetUser = userById(targetUserId);
      if (!targetUser) throw new Error('Account not found.');
      if (target.dataset.adminStatus === 'suspended') {
        const openHosted = getState().sessions.filter(session =>
          session.host_user_id === targetUserId && ['lobby', 'active'].includes(session.status)
        );
        if (openHosted.length) {
          throw new Error(`Transfer or close this user’s open table${openHosted.length === 1 ? '' : 's'} first: ${openHosted.map(session => session.name).join(', ')}.`);
        }
      }
      openModal('admin-account-status', {
        userId: targetUserId,
        userName: targetUser.display_name,
        status: target.dataset.adminStatus
      });
    }
  } catch (error) {
    console.error(error);
    if (target?.dataset?.joinOpenTable) setButtonBusy(target, false);
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
    showToast(error.message || 'Something went wrong.', 'error', 5000);
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
    throw new Error(customMessage || `This action is unavailable while the table is ${session?.status || 'unavailable'}.`);
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

function validateMoney(value) {
  const error = validAmount(value, { min: 0.01, label: 'Amount' });
  if (error) throw new Error(error);
  if (toCents(value) <= 0) throw new Error('Amount must be greater than zero.');
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Enter a valid number.');
  return number;
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
