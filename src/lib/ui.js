const HAPTIC_PATTERNS = Object.freeze({
  request: [180, 90, 180],
  approved: [65, 45, 105],
  rejected: [180, 70, 180, 70, 230],
  final: [85, 55, 85, 55, 150],
  warning: [110, 55, 110]
});

let lastHapticAt = 0;

export function triggerHapticFeedback(type = 'info', { force = false } = {}) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;

  const pattern = HAPTIC_PATTERNS[type];
  if (!pattern) return false;

  const now = Date.now();
  if (!force && now - lastHapticAt < 500) return false;
  lastHapticAt = now;

  try {
    return Boolean(navigator.vibrate(pattern));
  } catch {
    return false;
  }
}

export function showToast(message, type = 'success', duration = 3400) {
  const region = document.getElementById('toast-region');
  if (!region) return;

  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.textContent = message;
  region.appendChild(item);

  requestAnimationFrame(() => item.classList.add('is-visible'));
  window.setTimeout(() => {
    item.classList.remove('is-visible');
    window.setTimeout(() => item.remove(), 480);
  }, duration);
}

export function setButtonBusy(button, busy, busyText = 'Processing…') {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function appendTextElement(parent, tagName, text, className = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

export function confirmDialog({ title, message, confirmText = 'Confirm', destructive = false }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';

    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'modal__card';

    const header = document.createElement('div');
    header.className = 'modal__header';

    const headingGroup = document.createElement('div');
    appendTextElement(headingGroup, 'h2', title);

    const closeButton = document.createElement('button');
    closeButton.className = 'icon-button';
    closeButton.value = 'cancel';
    closeButton.type = 'submit';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.textContent = '×';

    header.append(headingGroup, closeButton);
    form.appendChild(header);
    appendTextElement(form, 'p', message, 'muted');

    const actions = document.createElement('div');
    actions.className = 'modal__actions';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'button button--ghost';
    cancelButton.value = 'cancel';
    cancelButton.type = 'submit';
    cancelButton.textContent = 'Cancel';

    const confirmButton = document.createElement('button');
    confirmButton.className = `button ${destructive ? 'button--danger' : 'button--primary'}`;
    confirmButton.value = 'confirm';
    confirmButton.type = 'submit';
    confirmButton.textContent = confirmText;

    actions.append(cancelButton, confirmButton);
    form.appendChild(actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close('cancel');
    });

    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    }, { once: true });

    dialog.showModal();
    confirmButton.focus();
  });
}


export function showHostMoneyApprovalDialog({
  requestId,
  requestKind = 'buyin',
  playerName,
  sessionName,
  amountText,
  note = '',
  queuePosition = 1,
  queueTotal = 1
}) {
  const kind = requestKind === 'cashout' ? 'cashout' : 'buyin';
  const existing = document.getElementById('host-money-queue-modal');
  if (
    existing?.dataset.requestId === requestId &&
    existing?.dataset.requestKind === kind &&
    existing.open
  ) return existing;
  if (existing) {
    if (existing.open) existing.close();
    existing.remove();
  }

  const isCashOut = kind === 'cashout';
  const actionName = isCashOut ? 'Cash-out' : 'Cash-in';
  const dialog = document.createElement('dialog');
  dialog.id = 'host-money-queue-modal';
  dialog.className = 'modal host-buyin-queue';
  dialog.dataset.requestId = requestId;
  dialog.dataset.requestKind = kind;
  dialog.setAttribute('aria-labelledby', 'host-money-queue-title');
  dialog.setAttribute('aria-describedby', 'host-money-queue-message');

  const card = document.createElement('section');
  card.className = 'host-buyin-queue__card system-window';

  const progress = appendTextElement(
    card,
    'p',
    `REQUEST ${queuePosition} OF ${queueTotal}`,
    'host-buyin-queue__progress'
  );
  progress.setAttribute('aria-label', `Request ${queuePosition} of ${queueTotal}`);

  const icon = appendTextElement(card, 'span', isCashOut ? '−' : '+', 'host-buyin-queue__icon');
  icon.setAttribute('aria-hidden', 'true');

  const title = appendTextElement(card, 'h2', `${actionName} request`);
  title.id = 'host-money-queue-title';

  const message = appendTextElement(
    card,
    'p',
    `${playerName} wants to ${isCashOut ? 'cash out' : 'cash in'}`,
    'host-buyin-queue__message'
  );
  message.id = 'host-money-queue-message';

  appendTextElement(card, 'strong', amountText, 'host-buyin-queue__amount');
  appendTextElement(card, 'p', sessionName, 'host-buyin-queue__table');

  if (note) {
    const noteBox = document.createElement('div');
    noteBox.className = 'host-buyin-queue__note';
    appendTextElement(noteBox, 'span', 'Player note');
    appendTextElement(noteBox, 'p', note);
    card.appendChild(noteBox);
  }

  appendTextElement(
    card,
    'p',
    isCashOut
      ? 'Approving subtracts this exact amount from table money automatically.'
      : 'Approve only after you receive the money. The exact amount is added to table money automatically.',
    'host-buyin-queue__instruction'
  );

  const reasonLabel = document.createElement('label');
  reasonLabel.className = 'host-buyin-queue__reason';
  reasonLabel.textContent = 'Reject reason ';
  const optional = document.createElement('span');
  optional.className = 'optional';
  optional.textContent = 'optional';
  reasonLabel.appendChild(optional);
  const reasonInput = document.createElement('input');
  reasonInput.name = 'hostQueueRejectReason';
  reasonInput.maxLength = 160;
  reasonInput.placeholder = isCashOut ? 'Example: Amount is incorrect' : 'Example: Payment not received';
  reasonLabel.appendChild(reasonInput);
  card.appendChild(reasonLabel);

  const error = appendTextElement(card, 'p', '', 'form-error host-buyin-queue__error');
  error.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'host-buyin-queue__actions';

  const rejectButton = document.createElement('button');
  rejectButton.type = 'button';
  rejectButton.className = 'button button--danger';
  rejectButton.dataset.hostMoneyReject = requestId;
  rejectButton.dataset.requestKind = kind;
  rejectButton.textContent = 'Reject';
  rejectButton.addEventListener('click', () => triggerHapticFeedback('rejected', { force: true }));

  const approveButton = document.createElement('button');
  approveButton.type = 'button';
  approveButton.className = 'button button--primary';
  approveButton.dataset.hostMoneyApprove = requestId;
  approveButton.dataset.requestKind = kind;
  approveButton.textContent = isCashOut ? 'Approve and subtract' : 'Approve and add to table';
  approveButton.addEventListener('click', () => triggerHapticFeedback('approved', { force: true }));

  actions.append(rejectButton, approveButton);
  card.appendChild(actions);
  dialog.appendChild(card);
  document.body.appendChild(dialog);

  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      card.classList.remove('needs-action');
      requestAnimationFrame(() => card.classList.add('needs-action'));
      triggerHapticFeedback('warning', { force: true });
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });

  dialog.showModal();
  triggerHapticFeedback('request', { force: true });
  approveButton.focus();
  return dialog;
}

export function closeHostMoneyApprovalDialog(requestId = '') {
  const dialog = document.getElementById('host-money-queue-modal');
  if (!dialog || (requestId && dialog.dataset.requestId !== requestId)) return;
  if (dialog.open) dialog.close();
  else dialog.remove();
}

export function showFinalResultDialog({
  notificationId,
  sessionName,
  cashInText,
  cashOutText,
  netText,
  netValue = 0,
  durationText,
  onDone
}) {
  const existing = document.getElementById('final-result-modal');
  if (existing?.dataset.notificationId === notificationId && existing.open) return existing;
  if (existing) {
    if (existing.open) existing.close();
    existing.remove();
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'final-result-modal';
  dialog.className = 'modal final-result-modal';
  dialog.dataset.notificationId = notificationId;
  dialog.setAttribute('aria-labelledby', 'final-result-title');

  const card = document.createElement('section');
  card.className = 'final-result-card system-window';
  appendTextElement(card, 'span', 'TABLE FINISHED', 'final-result-card__tag');
  const title = appendTextElement(card, 'h2', 'Your result');
  title.id = 'final-result-title';
  appendTextElement(card, 'p', sessionName, 'final-result-card__table');

  const rows = document.createElement('div');
  rows.className = 'final-result-card__rows';
  [['Cash in', cashInText], ['Cash out', cashOutText], ['Time played', durationText]].forEach(([label, value]) => {
    const row = document.createElement('div');
    appendTextElement(row, 'span', label);
    appendTextElement(row, 'strong', value);
    rows.appendChild(row);
  });
  card.appendChild(rows);

  const net = document.createElement('div');
  net.className = `final-result-card__net ${netValue > 0 ? 'is-win' : netValue < 0 ? 'is-loss' : 'is-even'}`;
  appendTextElement(net, 'span', netValue > 0 ? 'You won' : netValue < 0 ? 'You lost' : 'You finished even');
  appendTextElement(net, 'strong', netText);
  card.appendChild(net);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button button--primary';
  done.textContent = 'Done';
  card.appendChild(done);
  dialog.appendChild(card);
  document.body.appendChild(dialog);

  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    if (dialog.open) dialog.close();
    else dialog.remove();
    onDone?.();
  };
  done.addEventListener('click', finish);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) finish();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });

  dialog.showModal();
  triggerHapticFeedback('final', { force: true });
  done.focus();
  return dialog;
}

export function showNotificationPopup({ title, message, type = 'info', actionLabel = '', actionHash = '', duration = 8000 }) {
  let region = document.getElementById('notification-popup-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'notification-popup-region';
    region.className = 'notification-popup-region';
    region.setAttribute('aria-live', 'assertive');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
  }

  const popup = document.createElement('article');
  popup.className = `notification-popup notification-popup--${type}`;
  popup.setAttribute('role', type === 'rejected' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'notification-popup__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = type === 'approved' ? '✓' : type === 'rejected' ? '×' : type === 'request' ? '!' : 'i';

  const copy = document.createElement('div');
  copy.className = 'notification-popup__copy';
  appendTextElement(copy, 'strong', title || 'Notification');
  appendTextElement(copy, 'p', message || 'You have a new update.');

  const controls = document.createElement('div');
  controls.className = 'notification-popup__controls';

  let timer;
  const remove = () => {
    window.clearTimeout(timer);
    popup.classList.remove('is-visible');
    window.setTimeout(() => popup.remove(), 480);
  };

  if (actionLabel && actionHash) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'notification-popup__action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      location.hash = actionHash;
      remove();
    });
    controls.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notification-popup__close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  close.addEventListener('click', remove);
  controls.appendChild(close);

  popup.append(icon, copy, controls);
  region.appendChild(popup);
  triggerHapticFeedback(type);
  requestAnimationFrame(() => popup.classList.add('is-visible'));
  timer = window.setTimeout(remove, duration);
}

export function showAdminRegistrationApprovalDialog({
  userId,
  playerName,
  loginName,
  requestedText,
  queuePosition = 1,
  queueTotal = 1
}) {
  const existing = document.getElementById('admin-registration-queue-modal');
  if (existing?.dataset.userId === userId && existing.open) return existing;
  if (existing) {
    if (existing.open) existing.close();
    existing.remove();
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'admin-registration-queue-modal';
  dialog.className = 'modal admin-registration-queue';
  dialog.dataset.userId = userId;
  dialog.setAttribute('aria-labelledby', 'admin-registration-title');

  const card = document.createElement('section');
  card.className = 'admin-registration-queue__card system-window';
  appendTextElement(card, 'p', `ACCOUNT ${queuePosition} OF ${queueTotal}`, 'host-buyin-queue__progress');
  appendTextElement(card, 'span', '●', 'admin-registration-queue__icon').setAttribute('aria-hidden', 'true');
  const title = appendTextElement(card, 'h2', 'New account request');
  title.id = 'admin-registration-title';
  appendTextElement(card, 'strong', playerName, 'admin-registration-queue__name');
  appendTextElement(card, 'p', `@${loginName}`, 'admin-registration-queue__username');
  appendTextElement(card, 'p', requestedText, 'admin-registration-queue__time');
  appendTextElement(card, 'p', 'Approve this friend so they can log in.', 'host-buyin-queue__instruction');

  const reasonLabel = document.createElement('label');
  reasonLabel.className = 'host-buyin-queue__reason';
  reasonLabel.textContent = 'Reject reason ';
  const optional = document.createElement('span');
  optional.className = 'optional';
  optional.textContent = 'optional';
  reasonLabel.appendChild(optional);
  const reasonInput = document.createElement('input');
  reasonInput.name = 'adminRegistrationRejectReason';
  reasonInput.maxLength = 160;
  reasonInput.placeholder = 'Example: Unknown player';
  reasonLabel.appendChild(reasonInput);
  card.appendChild(reasonLabel);

  const error = appendTextElement(card, 'p', '', 'form-error admin-registration-queue__error');
  error.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'host-buyin-queue__actions';

  const rejectButton = document.createElement('button');
  rejectButton.type = 'button';
  rejectButton.className = 'button button--danger';
  rejectButton.dataset.adminRegistrationReject = userId;
  rejectButton.textContent = 'Reject';

  const approveButton = document.createElement('button');
  approveButton.type = 'button';
  approveButton.className = 'button button--primary';
  approveButton.dataset.adminRegistrationApprove = userId;
  approveButton.textContent = 'Approve account';

  actions.append(rejectButton, approveButton);
  card.appendChild(actions);
  dialog.appendChild(card);
  document.body.appendChild(dialog);

  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      card.classList.remove('needs-action');
      requestAnimationFrame(() => card.classList.add('needs-action'));
      triggerHapticFeedback('warning', { force: true });
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });

  dialog.showModal();
  triggerHapticFeedback('request', { force: true });
  approveButton.focus();
  return dialog;
}

export function closeAdminRegistrationApprovalDialog(userId = '') {
  const dialog = document.getElementById('admin-registration-queue-modal');
  if (!dialog || (userId && dialog.dataset.userId !== userId)) return;
  if (dialog.open) dialog.close();
  else dialog.remove();
}
