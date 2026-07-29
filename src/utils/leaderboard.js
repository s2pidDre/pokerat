import { fromCents, playerSummary, reversedTransactionIds, toCents } from './accounting.js';

export function buildClosedTableLeaderboard({ sessions = [], transactions = [], users = [] } = {}) {
  const closedSessionIds = new Set(
    sessions
      .filter(session => session?.status === 'closed')
      .map(session => session.id)
  );
  const userMap = new Map(users.map(user => [user.id, user]));
  const totals = new Map();

  for (const sessionId of closedSessionIds) {
    const sessionTransactions = transactions.filter(transaction => transaction.session_id === sessionId);
    const reversedIds = reversedTransactionIds(sessionTransactions);
    const playerIds = new Set(
      sessionTransactions
        .filter(transaction =>
          ['buy_in', 'cash_out'].includes(transaction.transaction_type) &&
          !transaction.is_reversed &&
          !reversedIds.has(transaction.id) &&
          transaction.player_id
        )
        .map(transaction => transaction.player_id)
    );

    for (const playerId of playerIds) {
      const user = userMap.get(playerId);
      if (!user || user.is_admin) continue;

      const summary = playerSummary(sessionTransactions, playerId);
      const sessionNetCents = toCents(summary.net);
      const current = totals.get(playerId) || {
        userId: playerId,
        displayName: user.display_name || 'Player',
        tableCount: 0,
        wins: 0,
        losses: 0,
        even: 0,
        cashInCents: 0,
        cashOutCents: 0,
        netCents: 0
      };

      current.tableCount += 1;
      current.cashInCents += toCents(summary.buyIn);
      current.cashOutCents += toCents(summary.cashOut);
      current.netCents += sessionNetCents;
      if (sessionNetCents > 0) current.wins += 1;
      else if (sessionNetCents < 0) current.losses += 1;
      else current.even += 1;
      totals.set(playerId, current);
    }
  }

  return [...totals.values()]
    .sort((a, b) =>
      b.netCents - a.netCents ||
      b.wins - a.wins ||
      b.cashOutCents - a.cashOutCents ||
      a.displayName.localeCompare(b.displayName)
    )
    .map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      displayName: entry.displayName,
      tableCount: entry.tableCount,
      wins: entry.wins,
      losses: entry.losses,
      even: entry.even,
      cashIn: fromCents(entry.cashInCents),
      cashOut: fromCents(entry.cashOutCents),
      net: fromCents(entry.netCents)
    }));
}
