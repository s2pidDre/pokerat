import { fromCents, playerSummary, reversedTransactionIds, toCents } from './accounting.js';

export function buildClosedTableLeaderboard({ sessions = [], transactions = [], users = [], sessionResults = [] } = {}) {
  const userMap = new Map(users.map(user => [user.id, user]));
  const totals = new Map();

  if (sessionResults.length) {
    for (const result of sessionResults) {
      if (toCents(result.cash_in) === 0 && toCents(result.cash_out) === 0) continue;
      const user = userMap.get(result.user_id);
      if (!user) continue;
      const sessionNetCents = toCents(result.net);
      const current = totals.get(result.user_id) || {
        userId: result.user_id,
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
      current.cashInCents += toCents(result.cash_in);
      current.cashOutCents += toCents(result.cash_out);
      current.netCents += sessionNetCents;
      if (sessionNetCents > 0) current.wins += 1;
      else if (sessionNetCents < 0) current.losses += 1;
      else current.even += 1;
      totals.set(result.user_id, current);
    }
  } else {
    const closedSessionIds = new Set(
      sessions.filter(session => session?.status === 'closed').map(session => session.id)
    );
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
        if (!user) continue;
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

export function buildPlayerPerformance({ userId, sessions = [], sessionResults = [] } = {}) {
  const sessionMap = new Map(sessions.map(session => [session.id, session]));
  const results = sessionResults
    .filter(result => result?.user_id === userId)
    .filter(result => toCents(result.cash_in) !== 0 || toCents(result.cash_out) !== 0)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let cumulativeCents = 0;
  let wins = 0;
  let losses = 0;
  let even = 0;
  let cashInCents = 0;
  let cashOutCents = 0;

  const points = results.map((result, index) => {
    const netCents = toCents(result.net);
    cumulativeCents += netCents;
    cashInCents += toCents(result.cash_in);
    cashOutCents += toCents(result.cash_out);
    if (netCents > 0) wins += 1;
    else if (netCents < 0) losses += 1;
    else even += 1;

    const session = sessionMap.get(result.session_id);
    return {
      index: index + 1,
      sessionId: result.session_id,
      sessionName: session?.name || `Table ${index + 1}`,
      sessionCode: session?.session_code || '',
      playedAt: result.created_at,
      cashIn: fromCents(toCents(result.cash_in)),
      cashOut: fromCents(toCents(result.cash_out)),
      net: fromCents(netCents),
      cumulativeNet: fromCents(cumulativeCents),
      outcome: netCents > 0 ? 'win' : netCents < 0 ? 'loss' : 'even'
    };
  });

  let bestResultCents = 0;
  let biggestLossCents = 0;
  let longestWinStreak = 0;
  let runningWinStreak = 0;
  let currentStreakOutcome = '';
  let currentStreakCount = 0;

  for (const point of points) {
    const netCents = toCents(point.net);
    bestResultCents = Math.max(bestResultCents, netCents);
    biggestLossCents = Math.min(biggestLossCents, netCents);
    if (point.outcome === 'win') {
      runningWinStreak += 1;
      longestWinStreak = Math.max(longestWinStreak, runningWinStreak);
    } else {
      runningWinStreak = 0;
    }
    if (point.outcome === currentStreakOutcome) currentStreakCount += 1;
    else {
      currentStreakOutcome = point.outcome;
      currentStreakCount = 1;
    }
  }

  return {
    tableCount: points.length,
    wins,
    losses,
    even,
    winRate: points.length ? Math.round((wins / points.length) * 100) : 0,
    cashIn: fromCents(cashInCents),
    cashOut: fromCents(cashOutCents),
    net: fromCents(cumulativeCents),
    bestResult: fromCents(bestResultCents),
    biggestLoss: fromCents(biggestLossCents),
    currentStreak: points.length ? { outcome: currentStreakOutcome, count: currentStreakCount } : { outcome: '', count: 0 },
    longestWinStreak,
    points
  };
}

