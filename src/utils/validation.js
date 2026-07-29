export function required(value, label = 'This field') {
  if (String(value ?? '').trim()) return '';
  return `${label} is required.`;
}

export function validAmount(value, { min = 1, max = Number.MAX_SAFE_INTEGER, label = 'Amount' } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${label} must be a number.`;
  if (amount < min) return `${label} must be at least ${min}.`;
  if (amount > max) return `${label} cannot exceed ${max}.`;
  return '';
}
