export function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function fromCents(value) {
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

export function toAmount(value) {
  return fromCents(toCents(value));
}

export function reversedTransactionIds(transactions = []) {
  return new Set(
    transactions
      .filter(transaction => transaction.transaction_type === 'reversal' && transaction.reverses_transaction_id)
      .map(transaction => transaction.reverses_transaction_id)
  );
}

export function isTransactionReversed(transaction, transactions = []) {
  if (!transaction) return false;
  return Boolean(transaction.is_reversed || reversedTransactionIds(transactions).has(transaction.id));
}

export function availableTableFunds(transactions = []) {
  const reversedIds = reversedTransactionIds(transactions);
  const totalCents = transactions.reduce((total, transaction) => {
    if (transaction.transaction_type === 'reversal') return total;
    if (transaction.is_reversed || reversedIds.has(transaction.id)) return total;

    const amount = toCents(transaction.amount);
    if (transaction.transaction_type === 'buy_in') return total + amount;
    if (transaction.transaction_type === 'cash_out') return total - amount;
    return total;
  }, 0);

  return fromCents(totalCents);
}

export function playerSummary(transactions = [], playerId) {
  const reversedIds = reversedTransactionIds(transactions);
  const summaryCents = transactions.reduce(
    (summary, transaction) => {
      if (transaction.transaction_type === 'reversal') return summary;
      if (transaction.is_reversed || reversedIds.has(transaction.id) || transaction.player_id !== playerId) return summary;

      if (transaction.transaction_type === 'buy_in') summary.buyIn += toCents(transaction.amount);
      if (transaction.transaction_type === 'cash_out') summary.cashOut += toCents(transaction.amount);
      return summary;
    },
    { buyIn: 0, cashOut: 0 }
  );

  return {
    buyIn: fromCents(summaryCents.buyIn),
    cashOut: fromCents(summaryCents.cashOut),
    net: fromCents(summaryCents.cashOut - summaryCents.buyIn)
  };
}

export function sessionDiscrepancy(transactions, countedFunds) {
  return fromCents(toCents(countedFunds) - toCents(availableTableFunds(transactions)));
}
