import { escapeHtml, formatCurrency, formatDateTime, formatDuration, formatDurationSeconds, formatRelative, initials } from '../utils/format.js';
import { availableTableFunds, playerSummary } from '../utils/accounting.js';

const formError = () => '<p class="form-error" hidden></p>';
const leaderboardIcon = () => `
  <svg class="system-rank-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="system-rank-icon__frame" d="M12 2.5 19 7v8l-7 6.5L5 15V7z" />
    <path class="system-rank-icon__mark" d="m8.2 10.1 3.8-3 3.8 3M8.8 14.1 12 16.7l3.2-2.6" />
    <path class="system-rank-icon__core" d="M12 10.4 13.6 12 12 13.6 10.4 12z" />
  </svg>`;
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
        <div class="simple-brand"><span class="brand-mark">P</span><div><strong>POKERAT</strong><small>FIRST SETUP</small></div></div>
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

export function accountAccessView({ mode = 'login' } = {}) {
  const brand = `<div class="simple-brand"><span class="brand-mark">P</span><div><strong>POKERAT</strong><small>PRIVATE TABLES</small></div></div>`;

  if (mode === 'register') {
    return `
      <main class="access-screen">
        <section class="access-card auth-card system-window">
          ${brand}
          <div class="access-copy"><span class="system-tag">NEW PLAYER</span><h1>Create account</h1><p>An admin must approve it before you can log in.</p></div>
          <form id="register-form" class="stack auth-form">
            <label>Username<input name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required autocomplete="username" placeholder="mark_23" autofocus></label>
            <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email" placeholder="mark@example.com"></label>
            <label>Create password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters"></label>
            <label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>
            ${formError()}
            <button class="button button--primary" type="submit">Submit for approval</button>
          </form>
          <p class="auth-links">Already registered? <a href="#/login">Log in</a></p>
        </section>
      </main>`;
  }

  if (mode === 'pending') {
    return `
      <main class="access-screen">
        <section class="access-card auth-card system-window auth-status-card">
          ${brand}
          <span class="auth-status-icon">⌛</span>
          <span class="system-tag">REQUEST SENT</span>
          <h1>Waiting for approval</h1>
          <p>An admin must approve your account before you can log in.</p>
          <a class="button button--primary" href="#/login">Back to login</a>
        </section>
      </main>`;
  }

  return `
    <main class="access-screen">
      <section class="access-card auth-card system-window">
        ${brand}
        <div class="access-copy"><span class="system-tag">SYSTEM ONLINE</span><h1>Welcome back</h1><p>Enter your username or email and password.</p></div>
        <form id="login-form" class="stack auth-form">
          <label>Username or email<input name="identifier" maxlength="254" required autocomplete="username" placeholder="Username or email" autofocus></label>
          <label>Password<input name="password" type="password" minlength="6" maxlength="64" required autocomplete="current-password" placeholder="Your password"></label>
          <label class="remember-row"><input name="remember" type="checkbox"><span><strong>Remember me</strong><small>Do not use this on a shared device.</small></span></label>
          ${formError()}
          <button class="button button--primary" type="submit">Log in</button>
        </form>
        <p class="forgot-pin-copy">Forgot your password? Ask the admin.</p>
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
        <div class="simple-brand"><span class="brand-mark">P</span><div><strong>POKERAT</strong><small>PASSWORD RESET</small></div></div>
        <div class="access-copy"><span class="system-tag">ONE LAST STEP</span><h1>Update your account</h1><p>${escapeHtml(profile?.display_name || 'Player')}, confirm your email and choose a new password.</p></div>
        <form id="forced-password-change-form" class="stack auth-form">
          <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email" value="${escapeHtml(profile?.email || '')}" placeholder="you@example.com"></label>
          <label>New password<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="At least 8 characters" autofocus></label>
          <label>Confirm password<input name="confirmPassword" type="password" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="Repeat password"></label>
          ${formError()}
          <button class="button button--primary" type="submit">Save new password</button>
          <button class="button button--ghost" data-logout type="button">Log out</button>
        </form>
      </section>
    </main>`;
}

export function appShell({ profile, isAdmin, route, content, notificationCount = 0 }) {
  const page = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  const nav = [
    ['home', '⌂', 'Home'],
    ['sessions', '▣', 'Tables'],
    ['leaderboard', leaderboardIcon(), 'Leaderboard'],
    ['history', '↺', 'History'],
    ['profile', '●', 'Profile']
  ];
  if (isAdmin) nav.push(['admin', '⚙', 'Admin']);

  const navHtml = nav.map(([id, icon, label]) => `
    <a href="#/${id}" class="nav-item ${page === id ? 'is-active' : ''}" aria-current="${page === id ? 'page' : 'false'}">
      <span class="nav-icon">${icon}</span><span>${label}</span>
    </a>`).join('');

  return `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="simple-brand"><span class="brand-mark">P</span><div><strong>POKERAT</strong><small>SYSTEM</small></div></div>
        <nav class="main-nav" aria-label="Main navigation">${navHtml}</nav>
        <div class="sidebar-user">
          <span class="avatar">${initials(profile?.display_name)}</span>
          <div><strong>${escapeHtml(profile?.display_name || 'User')}</strong><small>${isAdmin ? 'Admin' : 'User'}</small></div>
        </div>
      </aside>
      <div class="app-main">
        <header class="topbar">
          <div class="mobile-brand"><span class="brand-mark">P</span><strong>POKERAT</strong></div>
          <div class="topbar-actions">
            <button id="notification-button" class="icon-button notification-button" aria-label="Notifications">🔔${notificationCount ? `<b>${notificationCount}</b>` : ''}</button>
            <button id="theme-toggle" class="icon-button" aria-label="Change theme">◐</button>
            <button data-logout class="button button--ghost button--small">Log out</button>
          </div>
        </header>
        <main class="page-container">${content}</main>
        <nav class="bottom-nav" aria-label="Mobile navigation">${navHtml}</nav>
      </div>
    </div>`;
}

export function pageHeader(_eyebrow, title, description = '', actions = '') {
  return `<header class="page-header"><div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

export function homeView({ sessions, requests, profile }) {
  const openSessions = sessions.filter(session => !['closed', 'cancelled'].includes(session.status));
  const pending = pendingRequests(requests);
  const hostPending = pending.filter(request => request.session?.host_user_id === profile.id);
  const firstName = escapeHtml(profile.display_name.split(' ')[0]);

  return `
    ${pageHeader('', `Hi, ${firstName}`, 'What do you want to do?')}
    <section class="big-actions">
      <button class="big-action big-action--primary" data-open="create-session"><span>＋</span><strong>Create table</strong></button>
      <button class="big-action" data-open="join-session"><span>→</span><strong>Join table</strong></button>
    </section>

    ${hostPending.length ? `<section class="simple-panel alert-panel"><div><strong>${hostPending.length} request${hostPending.length === 1 ? '' : 's'} waiting</strong><span>Open the table to approve or reject.</span></div><a class="button button--primary" href="#/session/${hostPending[0].session_id}">Review</a></section>` : ''}

    <section class="section-block">
      <div class="section-heading"><h2>${openSessions.length ? 'Your tables' : 'No table yet'}</h2>${openSessions.length > 2 ? '<a href="#/sessions">See all</a>' : ''}</div>
      <div class="card-grid">${openSessions.length ? openSessions.map(session => sessionCard(session, profile.id)).join('') : emptyState('No open table', 'Create a table or join one using its code.')}</div>
    </section>`;
}

export function sessionsView(sessions, profileId) {
  const open = sessions.filter(session => !['closed', 'cancelled'].includes(session.status));
  const finished = sessions.filter(session => ['closed', 'cancelled'].includes(session.status));
  return `
    ${pageHeader('', 'Tables', '', '<button class="button button--secondary" data-open="join-session">Join</button><button class="button button--primary" data-open="create-session">Create</button>')}
    <section class="section-block"><div class="section-heading"><h2>Open</h2><span>${open.length}</span></div><div class="card-grid">${open.length ? open.map(session => sessionCard(session, profileId)).join('') : '<p class="empty-copy">No open tables.</p>'}</div></section>
    <section class="section-block"><div class="section-heading"><h2>Finished</h2><span>${finished.length}</span></div><div class="card-grid">${finished.length ? finished.map(session => sessionCard(session, profileId)).join('') : '<p class="empty-copy">No finished tables.</p>'}</div></section>`;
}

export function sessionCard(session, profileId) {
  const own = session.host_user_id === profileId;
  return `
    <a class="session-card system-window" href="#/session/${session.id}">
      <div class="session-card__top"><span class="status status--${session.status}">${statusLabel(session.status)}</span><span class="code">${escapeHtml(session.session_code)}</span></div>
      <h3>${escapeHtml(session.name)}</h3>
      <p>${own ? 'Created by you' : `Created by ${escapeHtml(session.host?.display_name || 'User')}`}</p>
      ${sessionTimerMarkup(session, true)}
      <span class="open-label">Open table →</span>
    </a>`;
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

      ${isHost && waitingForHost.length ? `<div class="playing-request-alert"><strong>${waitingForHost.length} request${waitingForHost.length === 1 ? '' : 's'} waiting</strong><span>Requests appear one at a time.</span></div>` : ''}
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
            <div class="detail-buttons"><button class="button button--ghost button--small" data-open="report-session">Report</button>${isHost ? '<button class="button button--ghost button--small" data-export-session>Export CSV</button>' : ''}</div>
          </section>
        </div>
      </details>`;
  }

  return `
    ${pageHeader('', escapeHtml(session.name))}

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
        <div class="detail-buttons"><button class="button button--ghost button--small" data-open="report-session">Report</button>${isHost ? '<button class="button button--ghost button--small" data-export-session>Export CSV</button>' : ''}</div>
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
    return `<article class="activity-item ${reversed ? 'is-reversed' : ''}"><span class="activity-icon">${isBuyIn ? '＋' : isCashOut ? '−' : '↺'}</span><div class="activity-copy"><strong>${escapeHtml(transaction.player?.display_name || 'System')}</strong><small>${label} · ${formatRelative(transaction.created_at)}</small>${transaction.correction_reason ? `<em>${escapeHtml(transaction.correction_reason)}</em>` : ''}</div><div class="activity-amount"><strong>${formatCurrency(transaction.amount)}</strong>${isHost && !reversed && !isReversal && (isBuyIn || isCashOut) ? `<button class="text-button" data-correct-transaction="${transaction.id}" data-amount="${transaction.amount}" data-type="${transaction.transaction_type}">Fix</button>` : ''}</div></article>`;
  }).join('')}</div>`;
}

export function memberList(members, isHost, userId, session) {
  return `<div class="member-list">${members.map(member => {
    const menuId = `member-menu-${member.id}`;
    return `<article class="member-item"><span class="avatar">${initials(member.profile?.display_name)}</span><div><strong>${escapeHtml(member.profile?.display_name || 'Player')}${member.user_id === userId ? ' (You)' : ''}</strong><small>${member.member_role === 'host' ? 'Host' : 'Player'}</small></div>${isHost && member.user_id !== userId && ['lobby', 'active'].includes(session.status) ? `<button class="member-menu__trigger" data-member-menu-trigger aria-expanded="false" aria-controls="${menuId}" aria-label="Player actions">•••</button><div class="member-menu-popover" id="${menuId}" data-member-menu hidden><button data-transfer-host="${member.user_id}">Make host</button><button class="danger-text" data-remove-member="${member.user_id}">Remove</button></div>` : ''}</article>`;
  }).join('')}</div>`;
}

export function requestsView({ requests, userId }) {
  const all = allRequests(requests).sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
  const hostItems = all.filter(request => request.session?.host_user_id === userId && request.status?.startsWith('pending'));
  const myItems = all.filter(request => (request.requester_id === userId || request.user_id === userId) && request.session?.host_user_id !== userId);
  return `${pageHeader('', 'Requests', 'Open the related table to handle requests.')}<section class="section-block"><div class="request-list">${hostItems.length ? hostItems.map(request => requestCard(request, true)).join('') : '<p class="empty-copy">No requests waiting.</p>'}</div></section>${myItems.length ? `<section class="section-block"><div class="section-heading"><h2>Your requests</h2></div><div class="request-list">${myItems.map(request => requestCard(request, false)).join('')}</div></section>` : ''}`;
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
  const person = request.requester?.display_name || 'Player';
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
    return `<article class="leaderboard-row ${entry.userId === profileId ? 'is-you' : ''}"><span class="leaderboard-rank">#${entry.rank}</span><span class="avatar leaderboard-avatar">${initials(entry.displayName)}</span><div class="leaderboard-player"><strong>${escapeHtml(entry.displayName)}${entry.userId === profileId ? ' <em>You</em>' : ''}</strong><small>${recordParts.join(' · ')}</small></div><strong class="leaderboard-net ${netClass}">${formatCurrency(entry.net, { signed: true })}</strong></article>`;
  }).join('');

  return `
    ${pageHeader('', 'Leaderboard', 'Only closed tables count. Nothing changes while a table is active.')}
    <section class="leaderboard-panel system-window">
      <div class="leaderboard-heading"><div><h2>All-time results</h2><p>Total cash-outs minus total cash-ins.</p></div><span>${closedTableCount} closed table${closedTableCount === 1 ? '' : 's'}</span></div>
      <div class="leaderboard-list">${leaderboardRows || '<p class="empty-copy leaderboard-empty">Finish a table to start the leaderboard.</p>'}</div>
    </section>`;
}

export function historyView({ sessions, profileId }) {
  const finished = sessions.filter(session => ['closed', 'cancelled'].includes(session.status));
  return `
    ${pageHeader('', 'History', 'Finished tables and session durations.')}
    <section class="section-block"><div class="section-heading"><h2>Finished tables</h2><span>${finished.length}</span></div><div class="card-grid">${finished.length ? finished.map(session => sessionCard(session, profileId)).join('') : emptyState('Nothing here', 'Finished tables will appear here.')}</div></section>`;
}

export function profileView(profile, user, sessions = []) {
  return `${pageHeader('', 'Profile')}<section class="profile-grid"><article class="simple-panel profile-summary"><span class="avatar avatar--large">${initials(profile.display_name)}</span><h2>${escapeHtml(profile.display_name)}</h2><p>${profile.is_admin ? 'Admin' : 'User'}</p><small>@${escapeHtml(profile.login_name || '')}<br>${escapeHtml(profile.email || 'No email')}</small></article><article class="simple-panel"><form id="profile-form" class="stack"><label>Display name<input name="displayName" value="${escapeHtml(profile.display_name)}" maxlength="24" required></label><label>Email<input name="email" type="email" maxlength="254" value="${escapeHtml(profile.email || '')}" required autocomplete="email"></label>${formError()}<button class="button button--primary" type="submit">Save name</button><button class="button button--secondary" type="button" data-open="change-password">Change password</button><button class="button button--ghost" data-logout type="button">Log out</button></form></article></section>`;
}

function auditDetailText(log) {
  const details = log.details || {};
  const parts = [];
  if (details.amount !== undefined) parts.push(formatCurrency(details.amount));
  if (details.approved_amount !== undefined) parts.push(`Approved ${formatCurrency(details.approved_amount)}`);
  if (details.reason) parts.push(details.reason);
  if (details.new_status) parts.push(statusLabel(details.new_status));
  return parts.join(' · ');
}

function adminUserActions(user, activeAdminId) {
  if (user.id === activeAdminId) return '<span class="admin-you">You</span><button class="button button--ghost button--small" data-admin-reset-password="' + user.id + '">Reset password</button>';
  const statusButton = user.account_status === 'suspended'
    ? `<button class="button button--secondary button--small" data-admin-status="active" data-user-id="${user.id}">Restore</button>`
    : user.account_status === 'active'
      ? `<button class="button button--danger button--small" data-admin-status="suspended" data-user-id="${user.id}">Suspend</button>`
      : user.account_status === 'rejected'
        ? `<button class="button button--secondary button--small" data-admin-registration-approve="${user.id}">Approve</button>`
        : '';
  return `${statusButton}<button class="button button--ghost button--small" data-admin-reset-password="${user.id}">Reset password</button><button class="button button--danger button--small" data-admin-delete-user="${user.id}">Delete</button>`;
}

export function adminView(users = [], logs = [], reports = [], activeAdminId = '') {
  const openReports = reports.filter(report => ['open', 'reviewing'].includes(report.status));
  const pendingUsers = users.filter(user => user.account_status === 'pending' && !user.is_admin).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const registeredUsers = users.filter(user => user.account_status !== 'pending');
  return `
    ${pageHeader('', 'Admin', 'Approve accounts, review reports and manage app data.')}
    <section class="section-block" id="account-requests">
      <div class="section-heading"><h2>Account requests</h2><span>${pendingUsers.length}</span></div>
      <div class="request-list">${pendingUsers.length ? pendingUsers.map(user => `<article class="request-card system-window"><div class="request-card__header"><div><h3>${escapeHtml(user.display_name)}</h3><p>@${escapeHtml(user.login_name)} · ${escapeHtml(user.email || 'No email')} · ${formatRelative(user.created_at)}</p></div><span class="status status--pending">Waiting</span></div><div class="request-actions"><button class="button button--danger" data-admin-registration-reject="${user.id}">Reject</button><button class="button button--primary" data-admin-registration-approve="${user.id}">Approve</button></div></article>`).join('') : '<p class="empty-copy">No accounts waiting.</p>'}</div>
    </section>
    <section class="section-block">
      <div class="section-heading"><h2>Reports</h2><span>${openReports.length}</span></div>
      <div class="request-list">${reports.length ? reports.map(report => `<article class="request-card"><div class="request-card__header"><div><h3>${escapeHtml(report.session_name)}</h3><p>${escapeHtml(report.reporter_name)} · ${formatRelative(report.created_at)}</p></div><span class="status status--${report.status}">${statusLabel(report.status)}</span></div><p>${escapeHtml(report.details)}</p>${['open', 'reviewing'].includes(report.status) ? `<div class="request-actions"><button class="button button--ghost" data-review-report="${report.id}" data-report-status="dismissed">Dismiss</button><button class="button button--secondary" data-review-report="${report.id}" data-report-status="reviewing">Reviewing</button><button class="button button--primary" data-review-report="${report.id}" data-report-status="resolved">Resolve</button></div>` : ''}</article>`).join('') : '<p class="empty-copy">No reports.</p>'}</div>
    </section>
    <section class="section-block">
      <div class="section-heading"><h2>Registered users</h2><span>${registeredUsers.length}</span></div>
      <div class="user-list">${registeredUsers.map(user => `<article class="user-row"><span class="avatar">${initials(user.display_name)}</span><div><strong>${escapeHtml(user.display_name)}</strong><small>@${escapeHtml(user.login_name || '')} · ${escapeHtml(user.email || 'No email')} · ${accountStatusLabel(user.account_status)}${!user.password_hash ? ' · Password reset needed' : user.must_change_password ? ' · Temporary password' : ''}</small></div><div class="user-row__actions">${adminUserActions(user, activeAdminId)}</div></article>`).join('')}</div>
    </section>
    <section class="section-block">
      <div class="section-heading"><h2>Data</h2><span>Admin only</span></div>
      <div class="card-grid admin-data-grid">
        <article class="simple-panel admin-data-card"><div><h3>Clear activity</h3><p>Delete tables, money records, requests, notifications, reports and audit logs. Registered users stay.</p></div><button class="button button--danger" data-admin-clear-activity>Clear activity</button></article>
        <article class="simple-panel admin-data-card"><div><h3>Hard reset</h3><p>Delete every registered user and all activity. The app returns to first-time administrator setup.</p></div><button class="button button--danger" data-admin-hard-reset>Hard reset everything</button></article>
      </div>
    </section>
    <details class="simple-details"><summary>Audit log</summary><div class="details-body activity-list">${logs.length ? logs.map(log => `<article class="activity-item"><span class="activity-icon">↺</span><div class="activity-copy"><strong>${escapeHtml(log.action.replaceAll('_', ' '))}</strong><small>${escapeHtml(log.actor?.display_name || 'System')} · ${formatDateTime(log.created_at)}</small>${auditDetailText(log) ? `<em>${escapeHtml(auditDetailText(log))}</em>` : ''}</div></article>`).join('') : '<p class="empty-copy">No audit records.</p>'}</div></details>`;
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
    'report-session': {
      title: 'Report table',
      body: `<form id="report-session-form" class="stack"><label>Problem<select name="reason" required><option value="incorrect_record">Wrong money record</option><option value="host_conduct">Problem with host</option><option value="access_issue">Cannot access something</option><option value="other">Other</option></select></label><label>What happened?<textarea name="details" minlength="10" maxlength="1000" required></textarea></label>${formError()}<button class="button button--danger" type="submit">Send report</button></form>`
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
    notifications: { title: 'Notifications', body: notificationList(context.notifications || []) }
  };

  const form = forms[type];
  if (!form) return '';
  return `<dialog class="modal" id="active-modal"><div class="modal__card system-window"><div class="modal__header"><h2>${form.title}</h2><button class="icon-button" data-close-modal aria-label="Close">×</button></div>${form.body}</div></dialog>`;
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

function notificationList(notifications) {
  if (!notifications.length) return '<p class="empty-copy">No new notifications.</p>';
  return `<div class="activity-list">${notifications.map(item => `<article class="activity-item"><span class="activity-icon">!</span><div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)} · ${formatRelative(item.created_at)}</small></div></article>`).join('')}</div><button class="button button--secondary" data-mark-notifications-read>Clear all</button>`;
}

export function suspendedView(profile) {
  return `<main class="access-screen"><section class="access-card auth-card system-window auth-status-card"><span class="brand-mark">P</span><span class="auth-status-icon">!</span><h1>Account suspended</h1><p>${escapeHtml(profile?.display_name || 'Player')}, ask an admin to restore your account.</p><button data-logout class="button button--primary">Log out</button></section></main>`;
}

export function emptyState(title, description, buttonLabel = '', openType = '') {
  return `<div class="empty-state"><h3>${title}</h3><p>${description}</p>${buttonLabel ? `<button class="button button--primary" data-open="${openType}">${buttonLabel}</button>` : ''}</div>`;
}
