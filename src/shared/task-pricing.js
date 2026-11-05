/** Exact decimal arithmetic for verified task-attempt usage. No built-in prices.
 * Callers must supply the actual provider route, complete non-overlapping token
 * buckets, and a versioned rate valid for the entire request interval.
 */
const KEYS = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'];
const RATE_KEYS = ['inputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion', 'outputPerMillion'];
function decimalRate(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
function count(value) { return Number.isSafeInteger(value) && value >= 0; }
function decimalMoney(units) {
  const whole = units / 1000000000000n;
  const fraction = String(units % 1000000000000n).padStart(12, '0').replace(/0+$/, '');
  return String(whole) + (fraction ? '.' + fraction : '');
}
export function validateRateCard(card) {
  return !!card && typeof card.id === 'string' && card.id.length > 0 && card.id.length <= 128 &&
    typeof card.provider === 'string' && card.provider.length > 0 &&
    typeof card.model === 'string' && card.model.length > 0 &&
    typeof card.sourceUrl === 'string' && /^https:\/\//.test(card.sourceUrl) &&
    /^[A-Z]{3}$/.test(card.currency || '') &&
    Number.isSafeInteger(card.effectiveFrom) && card.effectiveFrom >= 0 &&
    Number.isSafeInteger(card.effectiveTo) && card.effectiveTo > card.effectiveFrom &&
    RATE_KEYS.every(key => decimalRate(card[key]) !== null);
}
export function calculateAttemptCost(attempt, rateCards) {
  const unavailable = reason => ({ status: 'unavailable', reason });
  if (!attempt || attempt.complete !== true || !attempt.usage || !KEYS.every(key => count(attempt.usage[key]))) return unavailable('incomplete-usage');
  const total=KEYS.reduce((sum,key)=>sum+BigInt(attempt.usage[key]),0n);
  if (attempt.usage.totalTokens !== undefined && (!count(attempt.usage.totalTokens) || BigInt(attempt.usage.totalTokens)!==total)) return unavailable('contradictory-total');
  if (attempt.usage.reasoningTokens !== undefined && (!count(attempt.usage.reasoningTokens) || attempt.usage.reasoningTokens>attempt.usage.outputTokens)) return unavailable('invalid-reasoning-subset');
  if (typeof attempt.provider !== 'string' || !attempt.provider || typeof attempt.model !== 'string' || !attempt.model) return unavailable('unknown-route');
  if (!Number.isSafeInteger(attempt.startedAt) || !Number.isSafeInteger(attempt.endedAt) || attempt.startedAt < 0 || attempt.endedAt < attempt.startedAt) return unavailable('unknown-time');
  const cards = Array.isArray(rateCards) ? rateCards : [];
  const matches = cards.filter(card => validateRateCard(card) && card.provider === attempt.provider && card.model === attempt.model && attempt.startedAt >= card.effectiveFrom && attempt.endedAt < card.effectiveTo);
  if (matches.length !== 1) return unavailable(matches.length ? 'ambiguous-rate' : 'missing-or-crossed-rate');
  const card = matches[0];
  let units = 0n;
  for (let i = 0; i < KEYS.length; i++) units += BigInt(attempt.usage[KEYS[i]]) * decimalRate(card[RATE_KEYS[i]]);
  // A plain JSON snapshot prevents later edits from silently repricing a result.
  const snapshot = Object.fromEntries(['id','provider','model','sourceUrl','currency','effectiveFrom','effectiveTo',...RATE_KEYS].map(key => [key, card[key]]));
  return { status: 'calculated', amount: decimalMoney(units), currency: card.currency, rate: snapshot, basis: 'configured-token-rates', actualCharge: null };
}
