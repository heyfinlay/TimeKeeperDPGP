const DEFAULT_CURRENCY_SYMBOL = '💎';

const getNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const formatCurrency = (
  value,
  {
    symbol = DEFAULT_CURRENCY_SYMBOL,
    compact = true,
    maximumFractionDigits = 1,
    minimumFractionDigits = 0,
  } = {},
) => {
  const amount = getNumber(value);
  const formatter = new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits,
    minimumFractionDigits,
  });
  const formatted = formatter.format(amount);
  return `${symbol} ${formatted}`.trim();
};

export const formatPercent = (
  value,
  { inputFormat = 'ratio', maximumFractionDigits = 1, minimumFractionDigits = 0 } = {},
) => {
  const numeric = getNumber(value);
  const ratio = inputFormat === 'ratio' ? numeric : numeric / 100;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits,
    minimumFractionDigits,
  });
  return formatter.format(ratio);
};

export const formatCountdown = (target) => {
  if (!target) {
    return { label: 'No close', detail: 'This market does not have a close time set.' };
  }
  const closeDate = new Date(target);
  if (Number.isNaN(closeDate.getTime())) {
    return { label: 'Unknown', detail: 'Unable to determine close time.' };
  }
  const diffMs = closeDate.getTime() - Date.now();
  if (diffMs <= 0) {
    return { label: 'Closed', detail: 'This market is no longer accepting wagers.' };
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return {
    label: parts.join(' '),
    detail: 'Until wagering closes',
  };
};

