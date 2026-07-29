import { supabase } from './supabase.js';
import { toCents } from '../utils/accounting.js';

let activityChannel = null;

function rpcError(error, fallback = 'The table action failed.') {
  const message = error?.message || fallback;
  if (/poker_tables_single_open|only one open table|already open/i.test(message)) {
    return new Error('A table is already open. Join it or wait until it is finished.');
  }
  if (/duplicate key|money_requests_one_pending_kind/i.test(message)) {
    return new Error('Resolve or cancel your existing request first.');
  }
  return new Error(message.replace(/^.*?:\s*/, '') || fallback);
}

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw rpcError(error);
  return data;
}

export async function loadPokeratActivity() {
  const data = await rpc('load_pokerat_state');
  return {
    users: Array.isArray(data?.users) ? data.users : [],
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
    members: Array.isArray(data?.members) ? data.members : [],
    transactions: Array.isArray(data?.transactions) ? data.transactions : [],
    requests: {
      join: Array.isArray(data?.requests?.join) ? data.requests.join : [],
      buyin: Array.isArray(data?.requests?.buyin) ? data.requests.buyin : [],
      cashout: Array.isArray(data?.requests?.cashout) ? data.requests.cashout : []
    },
    notifications: Array.isArray(data?.notifications) ? data.notifications : [],
    reports: Array.isArray(data?.reports) ? data.reports : [],
    auditLogs: Array.isArray(data?.auditLogs) ? data.auditLogs : [],
    sessionResults: Array.isArray(data?.sessionResults) ? data.sessionResults : []
  };
}

export function createPokerTable(name) {
  return rpc('create_poker_table', { p_name: String(name || '').trim() });
}

export function joinPokerTable(code) {
  return rpc('join_poker_table', { p_code: String(code || '').trim().toUpperCase() });
}

export function startPokerTable(tableId) {
  return rpc('start_poker_table', { p_table_id: tableId });
}

export function cancelPokerTable(tableId) {
  return rpc('cancel_poker_table', { p_table_id: tableId });
}

export function submitMoneyRequest(tableId, kind, amount, note = '') {
  return rpc('submit_money_request', {
    p_table_id: tableId,
    p_request_type: kind === 'buyin' ? 'cash_in' : 'cash_out',
    p_amount_cents: toCents(amount),
    p_note: String(note || '').trim()
  });
}

export function reviewMoneyRequest(requestId, approve, reason = '') {
  return rpc('review_money_request', {
    p_request_id: requestId,
    p_decision: approve ? 'approve' : 'reject',
    p_reason: String(reason || '').trim()
  });
}

export function cancelMoneyRequest(requestId) {
  return rpc('cancel_money_request', { p_request_id: requestId });
}

export function recordHostMoney(tableId, kind, amount) {
  return rpc('record_host_money', {
    p_table_id: tableId,
    p_transaction_type: kind === 'buyin' ? 'buy_in' : 'cash_out',
    p_amount_cents: toCents(amount)
  });
}

export function closePokerTable(tableId) {
  return rpc('close_poker_table', { p_table_id: tableId });
}

export function removeTableMember(tableId, userId) {
  return rpc('remove_table_member', { p_table_id: tableId, p_user_id: userId });
}

export function transferTableHost(tableId, userId) {
  return rpc('transfer_table_host', { p_table_id: tableId, p_next_host_id: userId });
}

export function correctPokerTransaction(transactionId, correctedAmount, reason) {
  return rpc('correct_poker_transaction', {
    p_transaction_id: transactionId,
    p_corrected_amount_cents: correctedAmount === null || correctedAmount === '' ? null : toCents(correctedAmount),
    p_reason: String(reason || '').trim()
  });
}

export function submitSessionReport(tableId, reason, details) {
  return rpc('submit_session_report', {
    p_table_id: tableId,
    p_reason: String(reason || 'other'),
    p_details: String(details || '').trim()
  });
}

export function reviewSessionReport(reportId, status, note = '') {
  return rpc('review_session_report', {
    p_report_id: reportId,
    p_status: status,
    p_note: String(note || '').trim()
  });
}

export function markAllNotificationsRead() {
  return rpc('mark_pokerat_notifications_read');
}

export function markNotificationRead(notificationId) {
  return rpc('mark_pokerat_notification_read', { p_notification_id: notificationId });
}

export function clearRemoteActivity() {
  return rpc('admin_clear_activity');
}

export function subscribeToPokeratActivity(onChange, onStatus = () => {}) {
  unsubscribeFromPokeratActivity();
  const tables = [
    'poker_tables',
    'table_members',
    'money_requests',
    'transactions',
    'notifications',
    'session_results',
    'session_reports',
    'audit_logs'
  ];

  let channel = supabase.channel(`pokerat-activity-${crypto.randomUUID()}`);
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      payload => onChange({ table, payload })
    );
  }
  activityChannel = channel.subscribe((status, error) => onStatus(status, error));
  return activityChannel;
}

export function unsubscribeFromPokeratActivity() {
  if (activityChannel) supabase.removeChannel(activityChannel);
  activityChannel = null;
}
