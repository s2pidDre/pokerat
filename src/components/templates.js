import { escapeHtml, formatCurrency, formatDateTime, formatDuration, formatDurationSeconds, formatRelative, initials } from '../utils/format.js';
import { availableTableFunds, playerSummary } from '../utils/accounting.js';

const formError = () => '<p class="form-error" hidden></p>';
const leaderboardIcon = () => `
  <svg class="system-rank-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="system-rank-icon__frame" d="M12 2.5 19 7v8l-7 6.5L5 15V7z" />
    <path class="system-rank-icon__mark" d="m8.2 10.1 3.8-3 3.8 3M8.8 14.1 12 16.7l3.2-2.6" />
    <path class="system-rank-icon__core" d="M12 10.4 13.6 12 12 13.6 10.4 12z" />
  </svg>`;
const notificationIcon = () => `
  <svg class="system-notification-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="system-notification-icon__frame" d="M12 3.1c-3.1 0-5.2 2.3-5.2 5.5v2.7c0 1.5-.5 2.9-1.5 4l-.8.9h15l-.8-.9c-1-1.1-1.5-2.5-1.5-4V8.6c0-3.2-2.1-5.5-5.2-5.5Z" />
    <path class="system-notification-icon__arc" d="M9.6 18.2c.4 1.1 1.3 1.7 2.4 1.7s2-.6 2.4-1.7" />
    <path class="system-notification-icon__rune" d="m12 5.2 1.2 1.5-1.2 1.5-1.2-1.5Z" />
  </svg>`;
const brandMark = () => `<span class="brand-mark" aria-hidden="true"><img class="brand-mark__img" src="./icons/logo-mark.svg" alt=""></span>`;
const systemIcon = (name, className = '') => {
  const paths = {
    home: '<path d="M3.5 10.2 12 3l8.5 7.2v9.3H14v-5h-4v5H3.5z"/>',
    history: '<path d="M4 7.2V3.8m0 0h3.4M4 3.8A9 9 0 1 1 3 14"/><path d="M12 7v5l3.2 1.8"/>',
    profile: '<circle cx="12" cy="8" r="3.4"/><path d="M5.2 20c.6-4 3-6.1 6.8-6.1S18.2 16 18.8 20"/>',
    admin: '<path d="m12 2.8 7.2 3v5.5c0 4.6-2.8 8-7.2 9.9-4.4-1.9-7.2-5.3-7.2-9.9V5.8z"/><path d="m9.2 12 1.8 1.8 3.9-4"/>',
    create: '<path d="M12 5v14M5 12h14"/><path d="M4 4h16v16H4z"/>',
    join: '<path d="M4 12h11m-4-4 4 4-4 4"/><path d="M15 5h5v14h-5"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    cashin: '<path d="M12 4v16M7 9l5-5 5 5"/><path d="M5 20h14"/>',
    cashout: '<path d="M12 4v16m-5-5 5 5 5-5"/><path d="M5 4h14"/>',
    correction: '<path d="M5 7h9a5 5 0 1 1-4.7 6.7"/><path d="m5 7 3-3M5 7l3 3"/>',
    check: '<path d="m5 12.5 4.1 4.1L19 6.8"/>',
    alert: '<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4.5M12 17h.01"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a4 4 0 0 0 4 4m8-5h4v1a4 4 0 0 1-4 4M12 13v4m-4 3h8"/>',
    lightning: '<path d="m13.3 2-7 11h5l-.6 9 7-12h-5z"/>'
  };
  const body = paths[name] || paths.alert;
  return `<svg class="system-icon ${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
};
const statusLabel = value => ({
  lobby: 'Waiting to start',
  active: 'Playing',
  closed: 'Finished',
  cancelled: 'Cancelled',
  pending_review: 'Waiting',
  pending_payment_confirmation: 'Waiting',
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  open: 'Open',
  reviewing: 'Reviewing',
  resolved: 'Resolved',
  dismissed: 'Dismissed'
}[value] || String(value || '').replaceAll('_', ' '));
const accountStatusLabel = value => ({ pending: 'Waiting', active: 'Approved', rejected: 'Rejected', suspended: 'Suspended' }[value] || 'Unknown');

function allRequests(requests) {
  return [
    ...requests.join.map(request => ({ ...request, kind: 'join' })),
    ...requests.buyin.map(request => ({ ...request, kind: 'buyin' })),
    ...requests.cashout.map(request => ({ ...request, kind: 'cashout' }))
  ];
}

function pendingRequests(requests) {
  return allRequests(requests).filter(request => request.status?.startsWith('pending'));
}


function sessionTimerMarkup(session, compact = false) {
  if (!session?.started_at) return '';
  const isLive = session.status === 'active' && !session.closed_at;
  const endedAt = isLive ? '' : (session.closed_at || session.cancelled_at || '');
  const initialValue = !isLive && Number.isFinite(Number(session.duration_seconds))
    ? formatDurationSeconds(session.duration_seconds)
    : formatDuration(session.started_at, endedAt || Date.now());
  const className = compact ? 'session-card__timer' : 'session-timer-panel system-window';
  return `<div class="${className}${isLive ? ' is-live' : ''}"><span>${isLive ? 'Session time' : 'Duration'}</span><strong data-session-timer data-started-at="${escapeHtml(session.started_at)}" data-ended-at="${escapeHtml(endedAt)}" data-duration-seconds="${!isLive && Number.isFinite(Number(session.duration_seconds)) ? Number(session.duration_seconds) : ''}">${initialValue}</strong>${isLive ? '<small>LIVE</small>' : ''}</div>`;
}

export function initialAdminSetupView() {
  return `
    <main class="access-screen">
      <section class="access-card auth-card system-window">
        <div class="simple-brand">${brandMark()}<div><strong>POKERAT</strong><small>FIRST SETUP</small></div></div>
        <div class="access-copy"><span class="system-tag">OWNER SETUP</span><h1>Create administrator</h1><p>This is the first account. It can approve new players and manage the app.</p></div>
        <form id="initial-admin-form" class="stack auth-form">
          <label>Username<input name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required autocomplete="username" placeholder="pokerboss" autofocus></label>
          <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email" placeholder="you@example.com"></label>
          <label>Create password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters"></label>
          <label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>
          ${formError()}
          <button class="button button--primary" type="submit">Create administrator</button>
        </form>
      </section>
    </main>`;
}

export function accountAccessView({ mode = 'login', profile = null } = {}) {
  const brand = `<div class="simple-brand">${brandMark()}<div><strong>POKERAT</strong><small>PRIVATE TABLES</small></div></div>`;

  if (mode === 'register') {
    return `
      <main class="access-screen access-screen--register">
        <section class="access-card auth-card system-window">
          ${brand}
          <div class="access-copy"><span class="system-tag">NEW PLAYER</span><h1>Create account</h1><p>Admin approval is required.</p></div>
          <form id="register-form" class="stack auth-form">
            <label>Username<input name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required autocomplete="username" placeholder="mark_23" autofocus></label>
            <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email" placeholder="mark@example.com"></label>
            <label>Create password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters"></label>
            <label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>
            ${formError()}
            <button class="button button--primary" type="submit">Submit for approval</button>
          </form>
          <p class="auth-links">Already have an account? <a href="#/login">Log in</a></p>
        </section>
      </main>`;
  }

  if (mode === 'pending') {
    return `
      <main class="access-screen">
        <section class="access-card auth-card system-window auth-status-card">
          ${brand}
          <span class="auth-status-icon">${systemIcon('history')}</span>
          <span class="system-tag">WAITING</span>
          <h1>Waiting for approval</h1>
          <p>${profile ? `Your account <strong>@${escapeHtml(profile.login_name || '')}</strong> is waiting for an admin.` : 'An admin must approve your account before you can enter.'}</p>
          <p class="muted">This screen updates automatically after the admin decides.</p>
          ${profile ? '<button class="button button--ghost" data-logout type="button">Log out</button>' : '<a class="button button--primary" href="#/login">Back to login</a>'}
        </section>
      </main>`;
  }

  if (mode === 'rejected') {
    return `
      <main class="access-screen">
        <section class="access-card auth-card system-window auth-status-card">
          ${brand}
          <span class="auth-status-icon">${systemIcon('close')}</span>
          <span class="system-tag">NOT APPROVED</span>
          <h1>Registration rejected</h1>
          <p>${profile?.status_note ? escapeHtml(profile.status_note) : 'Ask an admin if you believe this was a mistake.'}</p>
          <button class="button button--ghost" data-logout type="button">Log out</button>
        </section>
      </main>`;
  }

  return `
    <main class="access-screen access-screen--login">
      <section class="access-card auth-card system-window">
        ${brand}
        <div class="access-copy"><span class="system-tag">SYSTEM ONLINE</span><h1>Welcome back</h1><p>Log in to continue.</p></div>
        <form id="login-form" class="stack auth-form">
          <label>Username or email<input name="identifier" maxlength="254" required autocomplete="username" placeholder="Username or email" autofocus></label>
          <label>Password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="current-password" placeholder="Your password"></label>
          <label class="remember-row"><input name="remember" type="checkbox"><span><strong>Remember me</strong></span></label>
          ${formError()}
          <button class="button button--primary" type="submit">Log in</button>
        </form>
        <p class="forgot-pin-copy">Forgot password? Ask the admin.</p>
        <div class="auth-link-row">
          <a href="#/register">Create account</a>
        </div>
      </section>
    </main>`;
}

export function forcePasswordChangeView(profile) {
  return `
    <main class="access-screen">
      <section class="access-card auth-card system-window">
        <div class="simple-brand">${brandMark()}<div><strong>POKERAT</strong><small>PASSWORD RESET</small></div></div>
        <div class="access-copy"><span class="system-tag">ONE LAST STEP</span><h1>Choose a new password</h1><p>${escapeHtml(profile?.display_name || 'Player')}, replace the temporary password before continuing.</p></div>
        <form id="forced-password-change-form" class="stack auth-form">
          <label>New password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters" autofocus></label>
          <label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>
          ${formError()}
          <button class="button button--primary" type="submit">Save new password</button>
          <button class="button button--ghost" data-logout type="button">Log out</button>
        </form>
      </section>
    </main>`;
}

export function loadingSkeletonView() {
  return `<div class="loading-shell" aria-label="Loading Pokerat" aria-busy="true">
    <aside class="loading-shell__sidebar"><div class="skeleton skeleton--logo"></div>${Array.from({ length: 5 }, () => '<div class="skeleton skeleton--nav"></div>').join('')}</aside>
    <main class="loading-shell__main"><div class="loading-shell__top"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--icon"></div></div><div class="loading-shell__content"><div class="skeleton skeleton--hero"></div><div class="loading-shell__grid">${Array.from({ length: 4 }, () => '<div class="skeleton skeleton--card"></div>').join('')}</div></div></main>
  </div>`;
}

export function appShell({ profile, isAdmin, route, content, notificationCount = 0, connectionStatus = 'connected' }) {
  const page = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  const nav = [
    ['home', systemIcon('home'), 'Home'],
    ['leaderboard', leaderboardIcon(), 'Leaderboard'],
    ['history', systemIcon('history'), 'History'],
    ['profile', systemIcon('profile'), 'Profile']
  ];
  if (isAdmin) nav.push(['admin', systemIcon('admin'), 'Admin']);

  const navItems = items => items.map(([id, icon, label]) => `
    <a href="#/${id}" class="nav-item ${page === id ? 'is-active' : ''}" aria-current="${page === id ? 'page' : 'false'}">
      <span class="nav-icon">${icon}</span><span>${label}</span>
    </a>`).join('');
  const desktopNavHtml = navItems(nav);
  const mobileNavHtml = navItems(nav);
  const connectionLabel = connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'disconnected' ? 'Connection lost' : 'Reconnecting…';
  const connectionBanner = connectionStatus === 'connected' ? '' : `
    <div class="connection-banner connection-banner--${connectionStatus}" role="status" aria-live="polite">
      <span class="connection-banner__dot" aria-hidden="true"></span>
      <div><strong>${connectionLabel}</strong><span>${connectionStatus === 'disconnected' ? 'Live updates are paused until Pokerat reconnects.' : 'Live updates may be delayed for a moment.'}</span></div>
      <button class="button button--ghost button--small" type="button" data-refresh-realtime>Refresh data</button>
    </div>`;

  return `
    <div class="app-layout" data-page="${page}">
      <aside class="sidebar">
        <div class="sidebar-brand simple-brand">${brandMark()}<div><strong>POKERAT</strong><small>SYSTEM</small></div></div>
        <nav class="main-nav" aria-label="Main navigation">${desktopNavHtml}</nav>
        <div class="sidebar-footer">
          <div class="sidebar-connection sidebar-connection--${connectionStatus}"><span class="sidebar-connection__dot" aria-hidden="true"></span><strong>${connectionLabel}</strong></div>
          <div class="sidebar-user">
            <span class="avatar">${initials(profile?.display_name)}</span>
            <div><strong>${escapeHtml(profile?.display_name || 'User')}</strong><small>${isAdmin ? 'Admin' : 'User'}</small></div>
          </div>
        </div>
      </aside>
      <div class="app-main">
        <header class="topbar">
          <div class="mobile-brand">${brandMark()}<strong>POKERAT</strong></div>
          <div class="topbar-shadow-mark" aria-hidden="true"></div>
          <div class="topbar-actions">
            <button id="notification-button" class="icon-button notification-button" aria-label="Notifications">${notificationIcon()}${notificationCount ? `<b>${notificationCount > 99 ? '99+' : notificationCount}</b>` : ''}</button>
            <div class="topbar-profile" aria-label="Current account"><span class="avatar">${initials(profile?.display_name)}</span><span><strong>${escapeHtml(profile?.display_name || 'User')}</strong><small>${isAdmin ? 'Admin' : 'User'}</small></span></div>
            <button data-logout class="button button--ghost button--small">Log out</button>
          </div>
        </header>
        ${connectionBanner}
        <main class="page-container page-container--${page}">${content}</main>
        <nav class="bottom-nav" aria-label="Mobile navigation">${mobileNavHtml}</nav>
      </div>
    </div>`;
}

export function pageHeader(title, description = '', actions = '') {
  return `<header class="page-header"><div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

export function homeView({ sessions, requests, profile }) {
  const openSession = sessions.find(session => !['closed', 'cancelled'].includes(session.status)) || null;
  const pending = pendingRequests(requests);
  const hostPending = pending.filter(request => request.session?.host_user_id === profile.id);
  const firstName = escapeHtml(profile.display_name.split(' ')[0]);

  const startActions = !openSession ? `
    <section class="big-actions">
      <button class="big-action big-action--primary" data-open="create-session"><span>${systemIcon('create')}</span><strong>Create table</strong></button>
      <button class="big-action" data-open="join-session"><span>${systemIcon('join')}</span><strong>Join by code</strong></button>
    </section>` : '';

  return `
    ${pageHeader(`Hi, ${firstName}`, openSession ? 'The current table is ready below.' : 'Start a table or join with an invite code.')}
    ${startActions}
    ${hostPending.length ? `<section class="simple-panel alert-panel"><div><strong>${hostPending.length} request${hostPending.length === 1 ? '' : 's'} waiting</strong><span>Open the table to review them.</span></div><a class="button button--primary" href="#/session/${hostPending[0].session_id}">Review</a></section>` : ''}
    ${openSession ? `<section class="section-block"><div class="section-heading"><h2>Open table</h2></div><div class="card-grid home-open-table-grid">${sessionCard(openSession, profile.id)}</div></section>` : ''}`;
}

export function sessionCard(session, profileId) {
  const own = session.host_user_id === profileId;
  const joined = own || session.session_members?.some(member => member.user_id === profileId);
  const content = `
      <div class="session-card__top"><span class="status status--${session.status}">${statusLabel(session.status)}</span><span class="code">${escapeHtml(session.session_code)}</span></div>
      <h3>${escapeHtml(session.name)}</h3>
      <p>${own ? 'Created by you' : `Created by ${escapeHtml(session.host?.display_name || 'User')}`}</p>
      ${sessionTimerMarkup(session, true)}`;

  const shadowDecoration = '<span class="session-card__shadow" aria-hidden="true"></span><span class="session-card__rune" aria-hidden="true"></span>';
  if (joined) {
    return `<a class="session-card system-window" href="#/session/${session.id}">${shadowDecoration}<div class="session-card__content">${content}<span class="open-label">Open table →</span></div></a>`;
  }

  return `<article class="session-card system-window">${shadowDecoration}<div class="session-card__content">${content}<button class="button button--primary session-card__join" data-join-open-table="${escapeHtml(session.session_code)}">Join table</button></div></article>`;
}

function activeSessionTimerMarkup(session) {
  const initialValue = formatDuration(session.started_at, Date.now());
  return `<div class="playing-header__timer is-live"><span>Time</span><strong data-session-timer data-started-at="${escapeHtml(session.started_at)}" data-ended-at="" data-duration-seconds="">${initialValue}</strong><small>LIVE</small></div>`;
}

function compactPendingRequest(request) {
  const label = request.kind === 'buyin' ? 'Cash-in' : request.kind === 'cashout' ? 'Cash-out' : 'Request';
  const amount = request.requested_amount ? ` · ${formatCurrency(request.requested_amount)}` : '';
  return `<div class="playing-waiting-item"><span>${label}${amount}</span><strong>Waiting for approval</strong></div>`;
}

export function sessionView({ session, members, transactions, requests, userId }) {
  const isHost = session.host_user_id === userId;
  const funds = availableTableFunds(transactions);
  const mine = playerSummary(transactions, userId);
  const sessionRequests = allRequests(requests).filter(request => request.session_id === session.id);
  const waitingForHost = sessionRequests.filter(request => request.status?.startsWith('pending') && session.host_user_id === userId);
  const visibleHostRequests = waitingForHost.filter(request => !['buyin', 'cashout'].includes(request.kind));
  const mineRequests = sessionRequests.filter(request => (request.requester_id === userId || request.user_id === userId) && request.status?.startsWith('pending'));
  const waitingCashIn = mineRequests.some(request => request.kind === 'buyin');
  const waitingCashOut = mineRequests.some(request => request.kind === 'cashout');

  let mainActions = '';
  if (session.status === 'lobby' && isHost) {
    mainActions = '<button class="button button--primary" data-start-session>Start table</button><button class="button button--danger" data-cancel-session>Cancel table</button>';
  } else if (session.status === 'active' && isHost) {
    mainActions = '<button class="button button--secondary" data-open="host-cashin">Cash in</button><button class="button button--primary" data-open="host-cashout">Cash out</button><button class="button button--danger" data-open="close-session">End table</button>';
  } else if (session.status === 'active') {
    mainActions = `${waitingCashIn
      ? '<button class="button button--secondary" type="button" disabled>Cash in — waiting</button>'
      : '<button class="button button--secondary" data-open="request-buyin">Cash in</button>'}${waitingCashOut
      ? '<button class="button button--primary" type="button" disabled>Cash out — waiting</button>'
      : '<button class="button button--primary" data-open="request-cashout">Cash out</button>'}`;
  }

  if (session.status === 'active') {
    const activeTransactionCount = transactions.filter(transaction => !transaction.is_reversed && transaction.transaction_type !== 'reversal').length;
    return `
      <header class="playing-header">
        <div class="playing-header__copy">
          <div class="playing-header__meta"><span class="status status--active">Playing</span><span>${members.length} player${members.length === 1 ? '' : 's'}</span></div>
          <h1>${escapeHtml(session.name)}</h1>
        </div>
        ${activeSessionTimerMarkup(session)}
      </header>

      <section class="playing-money-panel system-window">
        <div class="playing-money-panel__table"><span>Table money</span><strong>${formatCurrency(funds)}</strong></div>
        <div class="playing-money-panel__mine">
          <div><span>Your cash-in</span><strong>${formatCurrency(mine.buyIn)}</strong></div>
          <div><span>Your cash-out</span><strong>${formatCurrency(mine.cashOut)}</strong></div>
        </div>
      </section>

      ${mainActions ? `<section class="main-actions playing-actions">${mainActions}</section>` : ''}

      ${isHost && waitingForHost.length ? `<div class="playing-request-alert"><div><strong>${waitingForHost.length} request${waitingForHost.length === 1 ? '' : 's'} waiting</strong><span>Review them when you are ready.</span></div><button class="button button--secondary button--small" type="button" data-review-money-requests>Review</button></div>` : ''}
      ${!isHost && mineRequests.length ? `<section class="playing-waiting-list">${mineRequests.map(compactPendingRequest).join('')}</section>` : ''}

      <details class="simple-details playing-details">
        <summary>View details</summary>
        <div class="details-body playing-details__body">
          <section class="playing-detail-section playing-code-row">
            <div><span>Table code</span><strong>${escapeHtml(session.session_code)}</strong></div>
            <button class="button button--ghost button--small" data-copy-code="${escapeHtml(session.session_code)}">Copy code</button>
          </section>
          <section class="playing-detail-section">
            <div class="section-heading"><h2>Players</h2><span>${members.length}</span></div>
            ${memberList(members, isHost, userId, session)}
          </section>
          <section class="playing-detail-section">
            <div class="section-heading"><h2>Recent money</h2><span>${activeTransactionCount}</span></div>
            ${transactionList(transactions.slice(0, 8), isHost)}
          </section>
          <section class="playing-detail-section playing-detail-actions">
            <p><strong>Table owner:</strong> ${escapeHtml(session.host?.display_name || 'User')}</p>
            <div class="detail-buttons">${isHost ? '<button class="button button--ghost button--small" data-export-session>Export CSV</button>' : ''}</div>
          </section>
        </div>
      </details>`;
  }

  return `
    ${pageHeader(escapeHtml(session.name))}

    ${session.status === 'lobby' ? `<section class="table-code-panel system-window"><span>TABLE CODE</span><strong>${escapeHtml(session.session_code)}</strong><button class="button button--primary" data-copy-code="${escapeHtml(session.session_code)}">Copy code</button></section>` : ''}

    <section class="money-panel system-window">
      <span>Table money</span>
      <strong>${formatCurrency(funds)}</strong>
    </section>

    <section class="session-status-row${session.started_at ? '' : ' session-status-row--single'}">
      <div class="session-state-panel system-window"><span>Status</span><strong class="status status--${session.status}">${statusLabel(session.status)}</strong></div>
      ${sessionTimerMarkup(session)}
    </section>

    ${mainActions ? `<section class="main-actions">${mainActions}</section>` : ''}

    ${session.status === 'lobby' ? `<div class="simple-notice">${isHost ? 'Press “Start table” when everyone is ready.' : 'Waiting for the host to start.'}</div>` : ''}
    ${session.status === 'cancelled' ? '<div class="simple-notice">This table was cancelled.</div>' : ''}
    ${session.status === 'closed' ? closedSummary(session, transactions) : ''}

    ${isHost && visibleHostRequests.length ? `<section class="section-block" id="pending-requests"><div class="section-heading"><h2>Requests waiting</h2><span>${visibleHostRequests.length}</span></div><div class="request-list">${visibleHostRequests.map(request => requestCard(request, true)).join('')}</div></section>` : ''}
    ${!isHost && mineRequests.length ? `<section class="section-block"><div class="section-heading"><h2>Your request</h2></div><div class="request-list">${mineRequests.map(request => requestCard(request, false)).join('')}</div></section>` : ''}

    <section class="table-collapsed-sections">
      <details class="simple-details table-collapse">
        <summary><span>Players</span><b>${members.length}</b></summary>
        <div class="details-body">${memberList(members, isHost, userId, session)}</div>
      </details>
      <details class="simple-details table-collapse">
        <summary><span>Recent money</span><b>${transactions.filter(transaction => !transaction.is_reversed && transaction.transaction_type !== 'reversal').length}</b></summary>
        <div class="details-body">${transactionList(transactions.slice(0, 8), false)}</div>
      </details>
    </section>

    <details class="simple-details more-details">
      <summary>More details</summary>
      <div class="details-body details-actions">
        <p><strong>Table owner:</strong> ${escapeHtml(session.host?.display_name || 'User')}</p>
        <div class="detail-buttons">${isHost ? '<button class="button button--ghost button--small" data-export-session>Export CSV</button>' : ''}</div>
      </div>
    </details>`;

}

export function transactionList(transactions, isHost = false) {
  if (!transactions.length) return '<p class="empty-copy">No money recorded yet.</p>';
  return `<div class="activity-list">${transactions.map(transaction => {
    const isBuyIn = transaction.transaction_type === 'buy_in';
    const isCashOut = transaction.transaction_type === 'cash_out';
    const isReversal = transaction.transaction_type === 'reversal';
    const reversed = transaction.is_reversed && !isReversal;
    const label = isBuyIn ? 'Cash-in' : isCashOut ? 'Cash-out' : isReversal ? 'Correction' : 'Adjustment';
    return `<article class="activity-item ${reversed ? 'is-reversed' : ''}"><span class="activity-icon">${isBuyIn ? systemIcon('cashin') : isCashOut ? systemIcon('cashout') : systemIcon('correction')}</span><div class="activity-copy"><strong>${escapeHtml(transaction.player?.display_name || 'System')}</strong><small>${label} · ${formatRelative(transaction.created_at)}</small>${transaction.correction_reason ? `<em>${escapeHtml(transaction.correction_reason)}</em>` : ''}</div><div class="activity-amount"><strong>${formatCurrency(transaction.amount)}</strong>${isHost && !reversed && !isReversal && (isBuyIn || isCashOut) ? `<button class="text-button" data-correct-transaction="${transaction.id}" data-amount="${transaction.amount}" data-type="${transaction.transaction_type}">Fix</button>` : ''}</div></article>`;
  }).join('')}</div>`;
}

export function memberList(members, isHost, userId, session) {
  return `<div class="member-list">${members.map(member => {
    const menuId = `member-menu-${member.id}`;
    return `<article class="member-item"><a class="player-mini-profile" href="#/player/${member.user_id}" data-player-origin="session/${session.id}" aria-label="View ${escapeHtml(member.profile?.display_name || 'player')} profile"><span class="avatar">${initials(member.profile?.display_name)}</span><span><strong>${escapeHtml(member.profile?.display_name || 'Player')}${member.user_id === userId ? ' (You)' : ''}</strong><small>${member.member_role === 'host' ? 'Host' : 'Player'}</small></span></a>${isHost && member.user_id !== userId && ['lobby', 'active'].includes(session.status) ? `<button class="member-menu__trigger" data-member-menu-trigger aria-expanded="false" aria-controls="${menuId}" aria-label="Player actions">${systemIcon('more')}</button><div class="member-menu-popover" id="${menuId}" data-member-menu hidden><button data-transfer-host="${member.user_id}">Make host</button><button class="danger-text" data-remove-member="${member.user_id}">Remove</button></div>` : ''}</article>`;
  }).join('')}</div>`;
}

export function requestCard(request, hostView) {
  const person = request.requester?.display_name || 'Player';
  const sessionName = request.session?.name || 'Table';
  const amount = request.requested_amount ? formatCurrency(request.requested_amount) : '';
  const isWaiting = request.status?.startsWith('pending');
  const title = request.kind === 'join'
    ? `${escapeHtml(person)} wants to join`
    : request.kind === 'buyin'
      ? `${escapeHtml(person)} wants to cash in`
      : `${escapeHtml(person)} wants to cash out`;

  return `<article class="request-card system-window"><div class="request-card__header"><div><h3>${title}</h3><p>${escapeHtml(sessionName)}${amount ? ` · <strong>${amount}</strong>` : ''}</p></div><span class="status status--${request.status}">${statusLabel(request.status)}</span></div>${request.note ? `<p class="request-note">${escapeHtml(request.note)}</p>` : ''}${request.rejection_reason ? `<p class="error-copy">${escapeHtml(request.rejection_reason)}</p>` : ''}${request.cancellation_reason ? `<p class="error-copy">${escapeHtml(request.cancellation_reason)}</p>` : ''}${hostView && isWaiting ? requestActions(request) : !hostView && isWaiting ? `<button class="button button--ghost button--small" data-cancel-${request.kind}="${request.id}">Cancel</button>` : ''}${hostView && request.session_id ? `<a class="small-link" href="#/session/${request.session_id}">Open table</a>` : ''}</article>`;
}

function requestActions(request) {
  if (request.kind === 'join') {
    return `<div class="request-actions"><button class="button button--danger" data-review-join="${request.id}" data-approve="false">Reject</button><button class="button button--primary" data-review-join="${request.id}" data-approve="true">Approve</button></div>`;
  }
  if (['buyin', 'cashout'].includes(request.kind)) return '';
  return '';
}

export function leaderboardView({ leaderboard = [], profileId, closedTableCount = 0 }) {
  const leaderboardRows = leaderboard.map(entry => {
    const recordParts = [`${entry.wins} win${entry.wins === 1 ? '' : 's'}`, `${entry.losses} loss${entry.losses === 1 ? '' : 'es'}`];
    if (entry.even) recordParts.push(`${entry.even} even`);
    recordParts.push(`${entry.tableCount} table${entry.tableCount === 1 ? '' : 's'}`);
    const netClass = entry.net > 0 ? 'positive' : entry.net < 0 ? 'negative' : '';
    return `<a class="leaderboard-row ${entry.userId === profileId ? 'is-you' : ''}" href="#/player/${entry.userId}" data-player-origin="leaderboard" aria-label="View ${escapeHtml(entry.displayName)} performance"><span class="leaderboard-rank">#${entry.rank}</span><span class="avatar leaderboard-avatar">${initials(entry.displayName)}</span><div class="leaderboard-player"><strong>${escapeHtml(entry.displayName)}${entry.userId === profileId ? ' <em>You</em>' : ''}</strong><small>${recordParts.join(' · ')}</small></div><strong class="leaderboard-net ${netClass}">${formatCurrency(entry.net, { signed: true })}</strong></a>`;
  }).join('');

  return `
    ${pageHeader('Leaderboard', 'Only closed tables count. Nothing changes while a table is active.')}
    <section class="leaderboard-panel system-window">
      <div class="leaderboard-heading"><div><h2>All-time results</h2><p>Total cash-outs minus total cash-ins.</p></div><span>${closedTableCount} closed table${closedTableCount === 1 ? '' : 's'}</span></div>
      <div class="leaderboard-list">${leaderboardRows || '<p class="empty-copy leaderboard-empty">Finish a table to start the leaderboard.</p>'}</div>
    </section>`;
}


function performanceChart(points = [], baselineNet = 0) {
  if (!points.length) {
    return `<div class="performance-chart-empty"><span>${systemIcon('lightning')}</span><strong>No performance data yet</strong><p>Closed tables will build this player’s trend.</p></div>`;
  }

  const width = 760;
  const height = 300;
  const padding = { top: 28, right: 28, bottom: 42, left: 62 };
  const values = [baselineNet, ...points.map(point => Number(point.cumulativeNet) || 0)];
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const spread = Math.max(1, rawMax - rawMin);
  const margin = Math.max(spread * 0.16, Math.max(Math.abs(rawMax), Math.abs(rawMin), 100) * 0.08);
  const min = rawMin - margin;
  const max = rawMax + margin;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = index => padding.left + (chartWidth * index / Math.max(1, points.length));
  const y = value => padding.top + ((max - value) / Math.max(1, max - min)) * chartHeight;
  const coordinates = [{ x: x(0), y: y(baselineNet), value: baselineNet }, ...points.map((point, index) => ({ x: x(index + 1), y: y(point.cumulativeNet), value: point.cumulativeNet, point }))];
  const line = coordinates.map((coordinate, index) => `${index ? 'L' : 'M'} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`).join(' ');
  const zeroY = y(0);
  const ticks = [max, (max + min) / 2, min];

  return `<div class="performance-chart-wrap">
    <svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative performance across ${points.length} displayed closed table${points.length === 1 ? '' : 's'}">
      ${ticks.map(value => `<g class="performance-grid"><line x1="${padding.left}" y1="${y(value).toFixed(2)}" x2="${width - padding.right}" y2="${y(value).toFixed(2)}"></line><text x="${padding.left - 10}" y="${(y(value) + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatCurrency(value, { signed: true }))}</text></g>`).join('')}
      <line class="performance-zero" x1="${padding.left}" y1="${zeroY.toFixed(2)}" x2="${width - padding.right}" y2="${zeroY.toFixed(2)}"></line>
      <path class="performance-line" d="${line}"></path>
      ${coordinates.slice(1).map(({ x: cx, y: cy, point }) => `<circle class="performance-point performance-point--${point.outcome}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="7" role="button" tabindex="0" data-performance-point data-session-name="${escapeHtml(point.sessionName)}" data-played-at="${escapeHtml(formatDateTime(point.playedAt))}" data-cash-in="${escapeHtml(formatCurrency(point.cashIn))}" data-cash-out="${escapeHtml(formatCurrency(point.cashOut))}" data-net="${escapeHtml(formatCurrency(point.net, { signed: true }))}" data-running-total="${escapeHtml(formatCurrency(point.cumulativeNet, { signed: true }))}" data-outcome="${escapeHtml(point.outcome)}" aria-label="Open ${escapeHtml(point.sessionName)} result details: ${formatCurrency(point.net, { signed: true })}"><title>${escapeHtml(point.sessionName)}: ${formatCurrency(point.net, { signed: true })}; running total ${formatCurrency(point.cumulativeNet, { signed: true })}</title></circle>`).join('')}
      <text class="performance-axis-label" x="${padding.left}" y="${height - 12}">${baselineNet === 0 ? 'Start' : 'Before range'}</text>
      <text class="performance-axis-label" x="${width - padding.right}" y="${height - 12}" text-anchor="end">${points.length} shown</text>
    </svg>
  </div>`;
}

function performanceRangeButtons(activeRange, total) {
  const options = [
    ['10', 'Last 10'],
    ['25', 'Last 25'],
    ['all', 'All time']
  ];
  return `<div class="performance-range" role="group" aria-label="Performance graph range">${options.map(([value, label]) => `<button type="button" data-performance-range="${value}" class="${activeRange === value ? 'is-active' : ''}" aria-pressed="${activeRange === value}" ${value !== 'all' && total <= Number(value) ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
}

export function playerProfileView({ player, performance, isCurrentUser = false, graphRange = 'all', backRoute = 'leaderboard', backLabel = 'Back to leaderboard' }) {
  const netClass = performance.net > 0 ? 'positive' : performance.net < 0 ? 'negative' : '';
  const bestResult = Number(performance.bestResult) || 0;
  const biggestLoss = Number(performance.biggestLoss) || 0;
  const currentStreak = performance.currentStreak || { outcome: '', count: 0 };
  const longestWinStreak = Number(performance.longestWinStreak) || 0;
  const recent = [...performance.points].reverse().slice(0, 8);
  const rangeCount = graphRange === 'all' ? performance.points.length : Math.min(Number(graphRange) || performance.points.length, performance.points.length);
  const startIndex = Math.max(0, performance.points.length - rangeCount);
  const visiblePoints = performance.points.slice(startIndex);
  const baselineNet = startIndex > 0 ? Number(performance.points[startIndex - 1]?.cumulativeNet) || 0 : 0;
  return `
    ${pageHeader('Player performance', 'Closed tables only.', `<a class="button button--ghost" href="#/${escapeHtml(backRoute)}">${escapeHtml(backLabel)}</a>`)}
    <section class="player-profile-hero system-window">
      <span class="avatar avatar--large">${initials(player.display_name)}</span>
      <div><span class="system-tag">${player.is_admin ? 'ADMIN PLAYER' : 'PLAYER'}</span><h2>${escapeHtml(player.display_name)}${isCurrentUser ? ' <small>You</small>' : ''}</h2><p>@${escapeHtml(player.login_name || '')}</p></div>
      ${isCurrentUser ? '<a class="button button--secondary" href="#/profile">Edit profile</a>' : ''}
    </section>
    <section class="performance-stats">
      <article><span>Win rate</span><strong>${performance.winRate}%</strong><small>${performance.wins}W · ${performance.losses}L${performance.even ? ` · ${performance.even}E` : ''}</small></article>
      <article><span>Tables</span><strong>${performance.tableCount}</strong><small>Closed results</small></article>
      <article><span>Total net</span><strong class="${netClass}">${formatCurrency(performance.net, { signed: true })}</strong><small>Cash out − cash in</small></article>
      <article><span>Total cash out</span><strong>${formatCurrency(performance.cashOut)}</strong><small>Across all results</small></article>
    </section>
    <section class="performance-highlights" aria-label="Performance highlights">
      <article><span>${systemIcon('trophy')}</span><div><small>Best result</small><strong class="${bestResult > 0 ? 'positive' : ''}">${formatCurrency(bestResult, { signed: true })}</strong></div></article>
      <article><span>${systemIcon('cashout')}</span><div><small>Biggest loss</small><strong class="${biggestLoss < 0 ? 'negative' : ''}">${formatCurrency(biggestLoss, { signed: true })}</strong></div></article>
      <article><span>${systemIcon('lightning')}</span><div><small>Current streak</small><strong>${currentStreak.count ? `${currentStreak.count} ${currentStreak.outcome}${currentStreak.count === 1 ? '' : 's'}` : 'None'}</strong></div></article>
      <article><span>${systemIcon('trophy')}</span><div><small>Longest win streak</small><strong>${longestWinStreak} win${longestWinStreak === 1 ? '' : 's'}</strong></div></article>
    </section>
    <section class="performance-panel system-window" data-performance-panel>
      <div class="leaderboard-heading performance-heading"><div><h2>Performance trend</h2><p>Running net after every closed table. Select a point for details.</p></div><span>${performance.tableCount} result${performance.tableCount === 1 ? '' : 's'}</span></div>
      ${performanceRangeButtons(graphRange, performance.tableCount)}
      ${performanceChart(visiblePoints, baselineNet)}
      <div class="performance-point-detail" data-performance-point-detail hidden aria-live="polite">
        <div><span class="performance-point-detail__outcome" data-point-outcome></span><div><strong data-point-title></strong><small data-point-date></small></div></div>
        <dl><div><dt>Cash-in</dt><dd data-point-cash-in></dd></div><div><dt>Cash-out</dt><dd data-point-cash-out></dd></div><div><dt>Net result</dt><dd data-point-net></dd></div><div><dt>Running total</dt><dd data-point-running-total></dd></div></dl>
      </div>
    </section>
    <section class="section-block">
      <div class="section-heading"><h2>Recent results</h2></div>
      <div class="performance-results">${recent.length ? recent.map(point => `<article class="performance-result"><span class="performance-result__outcome performance-result__outcome--${point.outcome}">${point.outcome === 'win' ? 'W' : point.outcome === 'loss' ? 'L' : 'E'}</span><div><strong>${escapeHtml(point.sessionName)}</strong><small>${formatDateTime(point.playedAt)}${point.sessionCode ? ` · ${escapeHtml(point.sessionCode)}` : ''}</small></div><strong class="${point.net > 0 ? 'positive' : point.net < 0 ? 'negative' : ''}">${formatCurrency(point.net, { signed: true })}</strong></article>`).join('') : '<p class="empty-copy">No closed-table results yet.</p>'}</div>
    </section>`;
}

function historyCard(session, profileId, result = null, isAdmin = false) {
  const own = session.host_user_id === profileId;
  const resultValue = session.status === 'closed' && result ? Number(result.net) : null;
  const resultClass = resultValue > 0 ? 'positive' : resultValue < 0 ? 'negative' : '';
  const compactResult = resultValue !== null
    ? `<div class="history-card__compact-result"><span>Your result</span><strong class="${resultClass}">${formatCurrency(resultValue, { signed: true })}</strong></div>`
    : session.status === 'cancelled'
      ? '<div class="history-card__compact-result"><span>Result</span><strong>Cancelled</strong></div>'
      : '';
  const resultPreview = session.status === 'closed' && result
    ? `<div class="history-result-preview"><span>Your result</span><strong class="${resultClass}">${formatCurrency(resultValue, { signed: true })}</strong><small>${session.duration_seconds ? formatDurationSeconds(session.duration_seconds) : 'Duration unavailable'}</small></div>`
    : session.status === 'cancelled'
      ? '<div class="history-result-preview is-cancelled"><span>Cancelled</span><small>No performance result recorded.</small></div>'
      : '';
  const deleteAction = isAdmin
    ? `<button class="button button--danger history-delete-button" type="button" data-delete-history-table="${session.id}" aria-label="Delete ${escapeHtml(session.name)} permanently">Delete table</button>`
    : '';
  return `<details class="history-card system-window">
    <summary class="history-card__summary">
      <div class="history-card__summary-top"><span class="status status--${session.status}">${statusLabel(session.status)}</span><span class="code">${escapeHtml(session.session_code)}</span></div>
      <div class="history-card__summary-copy"><h3>${escapeHtml(session.name)}</h3><p>${own ? 'Created by you' : `Created by ${escapeHtml(session.host?.display_name || 'User')}`}</p></div>
      ${compactResult}
      <span class="history-card__chevron" aria-hidden="true">${systemIcon('chevron')}</span>
    </summary>
    <div class="history-card__body">
      <div class="history-card__details-grid">${sessionTimerMarkup(session, true)}${resultPreview}</div>
      <div class="history-card__actions"><a class="button button--secondary" href="#/session/${session.id}">Open table</a>${deleteAction}</div>
    </div>
  </details>`;
}

export function historyView({ sessions, profileId, results = [], filter = 'all', isAdmin = false }) {
  const finished = sessions.filter(session => ['closed', 'cancelled'].includes(session.status));
  const filtered = filter === 'finished'
    ? finished.filter(session => session.status === 'closed')
    : filter === 'cancelled'
      ? finished.filter(session => session.status === 'cancelled')
      : finished;
  const resultMap = new Map(results.filter(result => result.user_id === profileId).map(result => [result.session_id, result]));
  const description = finished.length
    ? `${finished.length} finished or cancelled table${finished.length === 1 ? '' : 's'}.`
    : 'Closed and cancelled tables will appear here.';
  const filters = [['all', 'All'], ['finished', 'Finished'], ['cancelled', 'Cancelled']];
  return `
    ${pageHeader('History', description)}
    <div class="history-filters" role="group" aria-label="Filter table history">${filters.map(([value, label]) => `<button type="button" data-history-filter="${value}" class="${filter === value ? 'is-active' : ''}" aria-pressed="${filter === value}">${label}</button>`).join('')}</div>
    <div class="card-grid">${filtered.length ? filtered.map(session => historyCard(session, profileId, resultMap.get(session.id), isAdmin)).join('') : emptyState('Nothing in this filter', filter === 'all' ? 'Finish or cancel a table to add it to your history.' : `No ${filter} tables yet.`)}</div>`;
}

function nameChangeAvailability(profile) {
  const changedAt = Date.parse(profile.display_name_changed_at || '');
  if (!Number.isFinite(changedAt)) {
    return { locked: false, message: 'After saving, you can change your name again in 90 days.' };
  }
  const nextChangeAt = changedAt + (90 * 24 * 60 * 60 * 1000);
  if (nextChangeAt <= Date.now()) {
    return { locked: false, message: 'Changing your name starts a new 90-day cooldown.' };
  }
  const nextDate = new Intl.DateTimeFormat('en-PH', {
    month: 'long', day: 'numeric', year: 'numeric'
  }).format(new Date(nextChangeAt));
  return { locked: true, message: `You can change your name again on ${nextDate}.` };
}

export function profileView(profile) {
  const nameChange = nameChangeAvailability(profile);
  const nameControl = nameChange.locked
    ? `<div class="profile-name-locked"><span>Display name</span><strong>${escapeHtml(profile.display_name)}</strong><small id="name-change-note">${escapeHtml(nameChange.message)}</small></div>`
    : `<form id="profile-form" class="stack profile-form"><label>Display name<input name="displayName" value="${escapeHtml(profile.display_name)}" maxlength="24" required aria-describedby="name-change-note"></label><p class="profile-cooldown" id="name-change-note">${escapeHtml(nameChange.message)}</p>${formError()}<button class="button button--primary" type="submit">Save name</button></form>`;
  return `${pageHeader('Profile')}<section class="profile-grid"><article class="simple-panel profile-summary"><span class="avatar avatar--large">${initials(profile.display_name)}</span><h2>${escapeHtml(profile.display_name)}</h2><p>${profile.is_admin ? 'Admin' : 'User'}</p><small>@${escapeHtml(profile.login_name || '')}</small><a class="button button--ghost button--small" href="#/player/${profile.id}" data-player-origin="profile">View performance</a></article><article class="simple-panel profile-settings"><div class="stack">${nameControl}<div class="profile-account-info"><span>Email</span><strong>${escapeHtml(profile.email || 'No email')}</strong><small>Email is used for login and cannot be changed here.</small></div><button class="button button--secondary" type="button" data-open="change-password">Change password</button></div></article></section>`;
}

function adminUserMenu(user, activeAdminId) {
  const menuId = `admin-user-menu-${user.id}`;
  const self = user.id === activeAdminId;
  const statusAction = self ? '' : user.account_status === 'suspended'
    ? `<button type="button" data-admin-status="active" data-user-id="${user.id}">Restore account</button>`
    : user.account_status === 'active'
      ? `<button type="button" data-admin-status="suspended" data-user-id="${user.id}" class="is-danger">Suspend account</button>`
      : user.account_status === 'rejected'
        ? `<button type="button" data-admin-registration-approve="${user.id}">Approve account</button>`
        : '';
  const deleteAction = self ? '' : `<button type="button" data-admin-delete-user="${user.id}" class="is-danger">Delete account</button>`;
  return `<div class="admin-user-menu-wrap"><button class="admin-user-menu__trigger" type="button" data-admin-user-menu-trigger aria-expanded="false" aria-controls="${menuId}" aria-label="Manage ${escapeHtml(user.display_name)}">${systemIcon('more')}</button><div class="admin-user-menu-popover" id="${menuId}" hidden><a href="#/player/${user.id}" data-player-origin="admin">View performance</a><button type="button" data-admin-reset-password="${user.id}">Reset password</button>${statusAction}${deleteAction}</div></div>`;
}

export function adminView(users = [], activeAdminId = '', userControls = {}) {
  const pendingUsers = users.filter(user => user.account_status === 'pending' && !user.is_admin).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const registeredUsers = users.filter(user => user.account_status !== 'pending');
  const activeFilter = userControls.filter || 'all';
  const search = String(userControls.search || '').trim().toLowerCase();
  const matchesUser = user => {
    const filterMatch = activeFilter === 'all' || (activeFilter === 'admins' ? user.is_admin : user.account_status === activeFilter);
    const searchText = `${user.display_name || ''} ${user.login_name || ''} ${user.email || ''}`.toLowerCase();
    return filterMatch && (!search || searchText.includes(search));
  };
  const visibleCount = registeredUsers.filter(matchesUser).length;
  const counts = {
    active: registeredUsers.filter(user => user.account_status === 'active').length,
    suspended: registeredUsers.filter(user => user.account_status === 'suspended').length,
    rejected: registeredUsers.filter(user => user.account_status === 'rejected').length
  };
  const userFilters = [['all', 'All'], ['active', 'Active'], ['suspended', 'Suspended'], ['rejected', 'Rejected'], ['admins', 'Admins']];
  return `
    ${pageHeader('Admin', 'Approve accounts and manage registered users.')}
    <section class="admin-summary-grid" aria-label="Account summary"><article><span>Registered</span><strong>${registeredUsers.length}</strong></article><article><span>Active</span><strong>${counts.active}</strong></article><article><span>Suspended</span><strong>${counts.suspended}</strong></article><article><span>Waiting</span><strong>${pendingUsers.length}</strong></article></section>
    <section class="section-block" id="account-requests">
      <div class="section-heading"><h2>Account requests</h2><span>${pendingUsers.length}</span></div>
      <div class="request-list">${pendingUsers.length ? pendingUsers.map(user => `<article class="request-card system-window"><div class="request-card__header"><div><h3>${escapeHtml(user.display_name)}</h3><p>@${escapeHtml(user.login_name)} · ${escapeHtml(user.email || 'No email')} · ${formatRelative(user.created_at)}</p></div><span class="status status--pending">Waiting</span></div><div class="request-actions"><button class="button button--danger" data-admin-registration-reject="${user.id}">Reject</button><button class="button button--primary" data-admin-registration-approve="${user.id}">Approve</button></div></article>`).join('') : '<p class="empty-copy">No accounts waiting.</p>'}</div>
    </section>
    <section class="section-block admin-users-section">
      <div class="section-heading"><h2>Registered users</h2><span data-admin-user-count>${visibleCount} of ${registeredUsers.length}</span></div>
      <div class="admin-user-tools"><label class="admin-user-search"><span class="sr-only">Search registered users</span><input type="search" data-admin-user-search value="${escapeHtml(userControls.search || '')}" placeholder="Search name, username or email"></label><div class="admin-user-filters" role="group" aria-label="Filter registered users">${userFilters.map(([value, label]) => `<button type="button" data-admin-user-filter="${value}" class="${activeFilter === value ? 'is-active' : ''}" aria-pressed="${activeFilter === value}">${label}</button>`).join('')}</div></div>
      <div class="user-list" data-admin-user-list>${registeredUsers.map(user => { const visible = matchesUser(user); const searchText = `${user.display_name || ''} ${user.login_name || ''} ${user.email || ''}`.toLowerCase(); return `<article class="user-row admin-user-row" data-admin-user-row data-search="${escapeHtml(searchText)}" data-status="${escapeHtml(user.account_status)}" data-is-admin="${user.is_admin ? 'true' : 'false'}" ${visible ? '' : 'hidden'}><a class="player-mini-profile" href="#/player/${user.id}" data-player-origin="admin"><span class="avatar">${initials(user.display_name)}</span><span><strong>${escapeHtml(user.display_name)}${user.id === activeAdminId ? ' <em>You</em>' : ''}</strong><small>@${escapeHtml(user.login_name || '')}</small><small>${escapeHtml(user.email || 'No email')}</small></span></a><div class="admin-user-row__status"><span class="status status--${user.account_status}">${accountStatusLabel(user.account_status)}</span>${user.is_admin ? '<span class="admin-role-chip">Admin</span>' : ''}${user.must_change_password ? '<span class="temporary-chip">Temporary password</span>' : ''}</div>${adminUserMenu(user, activeAdminId)}</article>`; }).join('')}<p class="empty-copy admin-user-empty" data-admin-user-empty ${visibleCount ? 'hidden' : ''}>No users match this search and filter.</p></div>
    </section>
    <section class="section-block">
      <div class="section-heading"><h2>Data</h2><span class="section-heading__badge section-heading__badge--text">Admin only</span></div>
      <div class="card-grid admin-data-grid"><article class="simple-panel admin-data-card"><div><h3>Clear activity</h3><p>Delete all tables, money records, requests and notifications. Registered users stay.</p></div><button class="button button--danger" data-admin-clear-activity>Clear activity</button></article></div>
    </section>
    <details class="danger-zone"><summary>Danger zone</summary><div class="danger-zone__body"><div><h3>Hard reset Pokerat</h3><p>Delete every registered user and all activity. The app returns to first-time administrator setup.</p></div><button class="button button--danger" data-open="hard-reset">Hard reset everything</button></div></details>`;
}

export function modalTemplate(type, context = {}) {
  const closeRows = Array.isArray(context.rows) ? context.rows : [];
  const pendingCount = Number(context.pendingCount) || 0;
  const forms = {
    'create-session': {
      title: 'Create table',
      body: `<form id="create-session-form" class="stack"><label>Table name<input name="name" maxlength="60" required placeholder="Game night" autofocus></label>${formError()}<button class="button button--primary" type="submit">Create table</button></form>`
    },
    'join-session': {
      title: 'Join table',
      body: `<form id="join-session-form" class="stack"><label>Table code<input name="code" maxlength="12" required autocomplete="off" autocapitalize="characters" placeholder="PKR-ABCD"></label>${formError()}<button class="button button--primary" type="submit">Join</button></form>`
    },
    'request-buyin': { title: 'Cash in', body: moneyForm('request-buyin-form', 'How much?', 'Send request') },
    'request-cashout': { title: 'Cash out', body: moneyForm('request-cashout-form', 'How much?', 'Send request') },
    'host-cashin': { title: 'Cash in', body: moneyForm('host-cashin-form', 'Cash-in amount', 'Add cash-in') },
    'host-cashout': { title: 'Cash out', body: moneyForm('host-cashout-form', 'Cash-out amount', 'Save cash-out') },
    'change-password': {
      title: 'Change password',
      body: `<form id="change-password-form" class="stack"><label>Current password<input name="currentPassword" type="password" minlength="8" maxlength="64" required autocomplete="current-password" placeholder="Current password"></label><label>New password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters"></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>${formError()}<button class="button button--primary" type="submit">Save new password</button></form>`
    },
    'reset-password': {
      title: `Reset ${escapeHtml(context.userName || 'player')} password`,
      body: `<form id="admin-reset-password-form" class="stack"><input type="hidden" name="userId" value="${escapeHtml(context.userId || '')}"><p class="muted">Set a temporary password and tell it to the player. They must replace it after logging in.</p><label>Temporary password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters"></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>${formError()}<button class="button button--primary" type="submit">Reset password</button></form>`
    },
    'pending-close': {
      title: 'Requests still waiting',
      body: `<div class="stack"><div class="simple-notice warning"><strong>${pendingCount} request${pendingCount === 1 ? '' : 's'} still need${pendingCount === 1 ? 's' : ''} a decision.</strong><span>Approve or reject every request before ending the table.</span></div><button class="button button--primary" type="button" data-review-pending-close>Review requests</button></div>`
    },
    'close-session': {
      title: 'Final check',
      body: `<form id="close-session-form" class="stack"><p class="close-review-copy">Check each player before finishing. The leaderboard will use these final results.</p><div class="close-review-list">${closeRows.map(row => `<div class="close-review-row"><div><strong>${escapeHtml(row.name || 'Player')}${row.isHost ? ' <small>Host</small>' : ''}</strong><span>Cash in ${formatCurrency(row.buyIn || 0)} · Cash out ${formatCurrency(row.cashOut || 0)}</span></div><strong class="${Number(row.net) > 0 ? 'positive' : Number(row.net) < 0 ? 'negative' : ''}">${formatCurrency(row.net || 0, { signed: true })}</strong></div>`).join('') || '<p class="empty-copy">No players found.</p>'}</div><div class="close-review-total"><span>Table money remaining</span><strong>${formatCurrency(context.tableFunds || 0)}</strong></div>${Number(context.tableFunds) !== 0 ? '<div class="simple-notice warning">This amount will remain recorded as money left on the table.</div>' : '<div class="simple-notice success">Table money is balanced at zero.</div>'}${formError()}<div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Go back</button><button class="button button--danger" type="submit">Finish table</button></div></form>`
    },
    'correct-transaction': {
      title: 'Fix money record',
      body: `<form id="correct-transaction-form" class="stack"><input type="hidden" name="transactionId" value="${escapeHtml(context.transactionId || '')}"><label>Correct amount <span class="optional">leave blank to remove</span><input name="correctedAmount" type="number" min="0.01" step="0.01" value="${escapeHtml(context.amount || '')}"></label><label>Why?<textarea name="reason" required maxlength="240"></textarea></label>${formError()}<button class="button button--danger" type="submit">Save fix</button></form>`
    },
    'admin-account-status': {
      title: context.status === 'suspended' ? `Suspend ${escapeHtml(context.userName || 'account')}` : `Restore ${escapeHtml(context.userName || 'account')}`,
      body: `<form id="admin-account-status-form" class="stack"><input type="hidden" name="userId" value="${escapeHtml(context.userId || '')}"><input type="hidden" name="status" value="${escapeHtml(context.status || '')}">${context.status === 'suspended' ? '<p class="muted">This player will be unable to log in until restored.</p><label>Reason<textarea name="reason" maxlength="300" required placeholder="Explain why the account is being suspended"></textarea></label>' : '<div class="simple-notice success"><strong>Restore account access?</strong><span>The player will be able to log in again.</span></div>'}${formError()}<button class="button ${context.status === 'suspended' ? 'button--danger' : 'button--primary'}" type="submit">${context.status === 'suspended' ? 'Suspend account' : 'Restore account'}</button></form>`
    },
    'hard-reset': {
      title: 'Hard reset Pokerat',
      body: `<form id="hard-reset-form" class="stack"><div class="simple-notice warning"><strong>This deletes everything.</strong><span>All accounts, tables and activity will be permanently removed.</span></div><label>Type RESET POKERAT to continue<input name="confirmation" autocomplete="off" required placeholder="RESET POKERAT"></label>${formError()}<button class="button button--danger" type="submit">Delete everything</button></form>`
    },
    'delete-history-table': {
      title: 'Delete table permanently',
      body: `<form id="delete-history-table-form" class="stack"><input type="hidden" name="tableId" value="${escapeHtml(context.tableId || '')}"><div class="simple-notice warning"><strong>${escapeHtml(context.tableName || 'Finished table')}</strong><span>This removes the table, members, money records, results and related notifications. Leaderboard and performance totals will change.</span></div><label>Type DELETE ${escapeHtml(context.tableCode || '')}<input name="confirmation" autocomplete="off" required placeholder="DELETE ${escapeHtml(context.tableCode || '')}"></label>${formError()}<div class="modal__actions"><button class="button button--ghost" type="button" data-close-modal>Cancel</button><button class="button button--danger" type="submit">Delete table</button></div></form>`
    },
    notifications: { title: 'Notifications', body: `<div data-notification-panel>${notificationList(context.notifications || [])}</div>` }
  };

  const form = forms[type];
  if (!form) return '';
  return `<dialog class="modal modal--${type}" id="active-modal"><div class="modal__card system-window${type === 'notifications' ? ' modal__card--notifications' : ''}"><div class="modal__header"><h2>${form.title}</h2><button class="icon-button" data-close-modal aria-label="Close">${systemIcon('close')}</button></div>${form.body}</div></dialog>`;
}

function moneyForm(id, label, button, confirmation = '') {
  return `<form id="${id}" class="stack"><label>${label}<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="500"></label><div class="quick-amounts">${[100, 200, 500, 1000].map(amount => `<button type="button" data-quick-amount="${amount}">${formatCurrency(amount)}</button>`).join('')}</div>${confirmation ? `<label class="check-row"><input name="confirmed" type="checkbox" required> ${confirmation}</label>` : ''}${formError()}<button class="button button--primary" type="submit">${button}</button></form>`;
}

function closedSummary(session, transactions) {
  const totals = new Map();
  for (const transaction of transactions) {
    if (transaction.is_reversed || transaction.transaction_type === 'reversal' || !['buy_in', 'cash_out'].includes(transaction.transaction_type)) continue;
    const current = totals.get(transaction.player_id) || { name: transaction.player?.display_name || 'Player', buyIn: 0, cashOut: 0 };
    if (transaction.transaction_type === 'buy_in') current.buyIn += Number(transaction.amount);
    if (transaction.transaction_type === 'cash_out') current.cashOut += Number(transaction.amount);
    totals.set(transaction.player_id, current);
  }
  const ranking = [...totals.values()].map(row => ({ ...row, net: row.cashOut - row.buyIn })).sort((a, b) => b.net - a.net);
  return `<section class="simple-panel"><div class="section-heading"><h2>Final result</h2><span class="status status--closed">Finished</span></div><div class="final-money"><div><span>Expected</span><strong>${formatCurrency(session.expected_funds)}</strong></div><div><span>Counted</span><strong>${formatCurrency(session.counted_funds)}</strong></div><div><span>Difference</span><strong class="${Number(session.discrepancy) === 0 ? 'positive' : 'negative'}">${formatCurrency(session.discrepancy, { signed: true })}</strong></div></div><div class="ranking-list">${ranking.map((row, index) => `<div><span>${index + 1}. ${escapeHtml(row.name)}</span><strong class="${row.net >= 0 ? 'positive' : 'negative'}">${formatCurrency(row.net, { signed: true })}</strong></div>`).join('') || '<p class="empty-copy">No results.</p>'}</div></section>`;
}

function notificationItem(item) {
  const unread = !item.read_at;
  const actionLabel = item.delivery === 'final_result' ? 'View result' : item.action_hash ? 'Open table' : unread ? 'Mark read' : '';
  const action = !actionLabel ? '' : unread && !item.action_hash && item.delivery !== 'final_result'
    ? `<button class="button button--ghost button--small" type="button" data-mark-notification-read="${item.id}">Mark read</button>`
    : `<button class="button button--ghost button--small" type="button" data-open-notification="${item.id}">${actionLabel}</button>`;
  return `<article class="activity-item notification-list-item ${unread ? 'is-unread' : 'is-read'}" data-notification-item="${item.id}"><span class="activity-icon">${unread ? systemIcon('alert') : systemIcon('check')}</span><div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)} · ${formatRelative(item.created_at)}</small></div>${action}</article>`;
}

export function notificationList(notifications) {
  if (!notifications.length) return '<p class="empty-copy">No notifications yet.</p>';
  const unread = notifications.filter(item => !item.read_at);
  const recent = notifications.filter(item => item.read_at).slice(0, 12);
  return `<div class="notification-sections">${unread.length ? `<section><div class="notification-section-heading"><h3>Unread</h3><span>${unread.length}</span></div><div class="activity-list">${unread.map(notificationItem).join('')}</div></section>` : '<div class="simple-notice success"><strong>You’re all caught up.</strong><span>No unread notifications.</span></div>'}${recent.length ? `<section><div class="notification-section-heading"><h3>Recent</h3><span>${recent.length}</span></div><div class="activity-list">${recent.map(notificationItem).join('')}</div></section>` : ''}</div>${unread.length ? '<button class="button button--secondary" data-mark-notifications-read>Mark all as read</button>' : ''}`;
}

export function suspendedView(profile) {
  return `<main class="access-screen"><section class="access-card auth-card system-window auth-status-card">${brandMark()}<span class="auth-status-icon">${systemIcon('alert')}</span><h1>Account suspended</h1><p>${profile?.status_note ? escapeHtml(profile.status_note) : `${escapeHtml(profile?.display_name || 'Player')}, ask an admin to restore your account.`}</p><button data-logout class="button button--primary">Log out</button></section></main>`;
}

export function emptyState(title, description, buttonLabel = '', openType = '') {
  return `<div class="empty-state"><h3>${title}</h3><p>${description}</p>${buttonLabel ? `<button class="button button--primary" data-open="${openType}">${buttonLabel}</button>` : ''}</div>`;
}
