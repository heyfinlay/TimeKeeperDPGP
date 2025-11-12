const EPSILON = 1e-9;

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const coerceNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return fallback;
};

const normaliseTakeout = (value) => {
  const numeric = coerceNumber(value, 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return clamp(numeric, 0, 1);
};

export function computeToteQuote({ T = 0, W = 0, r = 0, s = 0 } = {}) {
  const totalPool = Math.max(coerceNumber(T, 0), 0);
  const runnerPool = Math.max(coerceNumber(W, 0), 0);
  const stake = Math.max(coerceNumber(s, 0), 0);
  const rawTakeout = normaliseTakeout(r);
  const takeout = Number.isFinite(rawTakeout) ? rawTakeout : 0;
  const netMultiplier = Math.max(0, 1 - takeout);

  const baselineDenominator = runnerPool > 0 ? runnerPool : stake > 0 ? Math.max(runnerPool, EPSILON) : null;
  const baselineMultiplier = baselineDenominator
    ? (netMultiplier * totalPool) / baselineDenominator
    : null;

  const totalAfterStake = totalPool + stake;
  const runnerAfterStake = runnerPool + stake;
  const hasEffective = totalAfterStake > 0 && runnerAfterStake > 0;
  const effectiveMultiplier = hasEffective ? (netMultiplier * totalAfterStake) / runnerAfterStake : null;

  const maxPossiblePayout = netMultiplier * totalAfterStake;
  const estPayout = effectiveMultiplier !== null ? Math.min(maxPossiblePayout, stake * effectiveMultiplier) : 0;
  const impliedProb = totalAfterStake > 0 ? runnerAfterStake / totalAfterStake : 0;
  const priceImpact = baselineMultiplier && effectiveMultiplier
    ? 1 - effectiveMultiplier / baselineMultiplier
    : 0;
  const shareAfterBet = impliedProb;

  return {
    baselineMultiplier,
    effectiveMultiplier,
    estPayout,
    impliedProb,
    priceImpact,
    maxPossiblePayout,
    shareAfterBet,
  };
}

export function computeBaselineOnly({ T = 0, W = 0, r = 0 } = {}) {
  return computeToteQuote({ T, W, r, s: 0 }).baselineMultiplier;
}

export const ToteMath = {
  EPSILON,
  computeToteQuote,
  computeBaselineOnly,
};

export default computeToteQuote;
