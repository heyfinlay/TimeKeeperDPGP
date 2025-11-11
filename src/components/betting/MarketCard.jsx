import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Clock, Minus } from 'lucide-react';
import { driverStats } from '@/state/parimutuelStore.js';
import { formatCurrency, formatPercent, formatCountdown } from '@/utils/betting.js';

const normaliseStatus = (status) => {
  if (!status) return 'Unknown';
  return String(status).replaceAll('_', ' ');
};

const FALLBACK_COLORS = ['#9FF7D3', '#7C6BFF', '#FF9F68', '#F6C2FF'];

const statusStyle = (status) => {
  const key = String(status ?? '').toLowerCase();
  switch (key) {
    case 'open':
    case 'live':
      return {
        text: 'text-emerald-300',
        border: 'border-emerald-400/30',
        bg: 'bg-emerald-400/10',
      };
    case 'settled':
      return {
        text: 'text-sky-300',
        border: 'border-sky-400/30',
        bg: 'bg-sky-400/10',
      };
    case 'closed':
    case 'suspended':
      return {
        text: 'text-amber-300',
        border: 'border-amber-400/30',
        bg: 'bg-amber-400/10',
      };
    case 'voided':
    case 'cancelled':
      return {
        text: 'text-rose-300',
        border: 'border-rose-400/30',
        bg: 'bg-rose-400/10',
      };
    default:
      return {
        text: 'text-neutral-200',
        border: 'border-white/20',
        bg: 'bg-white/10',
      };
  }
};

const resolveTrendMeta = (delta) => {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) {
    return {
      Icon: Minus,
      label: 'Stable',
      color: 'text-neutral-400',
      prefix: '',
    };
  }
  if (delta > 0) {
    return {
      Icon: ArrowUpRight,
      label: `${formatPercent(delta, { maximumFractionDigits: 1 })}`,
      color: 'text-emerald-300',
      prefix: '+',
    };
  }
  return {
    Icon: ArrowDownRight,
    label: `${formatPercent(Math.abs(delta), { maximumFractionDigits: 1 })}`,
    color: 'text-rose-300',
    prefix: '−',
  };
};

export default function MarketCard({ market, pool, stats, onSelect, ctaLabel = 'Open betslip' }) {
  const derivedStats = useMemo(() => {
    if (!market) {
      return [];
    }
    if (Array.isArray(stats) && stats.length > 0) {
      return stats;
    }
    return driverStats(market, pool);
  }, [market, pool, stats]);

  const [countdown, setCountdown] = useState(() => formatCountdown(market?.closes_at));
  const previousSnapshotRef = useRef(null);
  const [enhancedStats, setEnhancedStats] = useState([]);
  const [poolVelocity, setPoolVelocity] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCountdown(formatCountdown(market?.closes_at));
    const timer = setInterval(() => {
      setCountdown(formatCountdown(market?.closes_at));
    }, 1000);
    return () => clearInterval(timer);
  }, [market?.closes_at]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const poolTotal = useMemo(() => {
    if (pool?.total !== undefined) {
      return pool.total;
    }
    return derivedStats.reduce((sum, entry) => sum + (entry.total ?? 0), 0);
  }, [pool?.total, derivedStats]);

  const outcomeColorMap = useMemo(() => {
    if (!Array.isArray(market?.outcomes)) {
      return {};
    }
    return market.outcomes.reduce((acc, outcome, index) => {
      const fallbackColor = FALLBACK_COLORS[index % FALLBACK_COLORS.length];
      acc[outcome.id] = outcome.color ?? fallbackColor;
      return acc;
    }, {});
  }, [market?.outcomes]);

  const typeLabel = useMemo(() => {
    const rawType = market?.type;
    if (!rawType) {
      return null;
    }
    const readable = String(rawType).replaceAll('_', ' ').trim();
    if (!readable) {
      return null;
    }
    if (readable.toLowerCase() === 'parimutuel') {
      return 'Pool';
    }
    const lower = readable.toLowerCase();
    return lower.replace(/\b([a-z])/g, (char) => char.toUpperCase());
  }, [market?.type]);

  const fallbackStats = useMemo(
    () =>
      derivedStats.map((entry, index) => ({
        ...entry,
        color: entry.color ?? outcomeColorMap?.[entry.outcomeId] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        trendDelta: entry.trendDelta ?? 0,
      })),
    [derivedStats, outcomeColorMap],
  );

  useEffect(() => {
    const now = Date.now();
    const previousSnapshot = previousSnapshotRef.current;
    const nextStats = derivedStats.map((entry, index) => {
      const previousEntry = previousSnapshot?.stats?.find((stat) => stat.outcomeId === entry.outcomeId);
      const deltaShare =
        entry.trendDelta ?? (previousEntry ? (entry.share ?? 0) - (previousEntry.share ?? 0) : 0);
      return {
        ...entry,
        color: entry.color ?? outcomeColorMap?.[entry.outcomeId] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        trendDelta: deltaShare,
      };
    });

    if (previousSnapshot && now > previousSnapshot.timestamp) {
      const deltaTotal = poolTotal - (previousSnapshot.total ?? 0);
      const elapsedMinutes = (now - previousSnapshot.timestamp) / 60000;
      const computedVelocity = elapsedMinutes > 0 ? deltaTotal / elapsedMinutes : 0;
      setPoolVelocity(Number.isFinite(computedVelocity) ? computedVelocity : 0);
    }

    if (!previousSnapshot) {
      setPoolVelocity(null);
    }

    previousSnapshotRef.current = {
      stats: derivedStats,
      total: poolTotal,
      timestamp: now,
    };

    setEnhancedStats(nextStats);
  }, [derivedStats, outcomeColorMap, poolTotal]);

  const statsToDisplay = enhancedStats.length > 0 ? enhancedStats : fallbackStats;

  const statusStyles = useMemo(() => {
    const fallback = statusStyle(market?.status);
    if (!market?.statusStyles) {
      return fallback;
    }
    return {
      bg: market.statusStyles.bg ?? fallback.bg,
      border: market.statusStyles.border ?? fallback.border,
      text: market.statusStyles.text ?? fallback.text,
    };
  }, [market?.status, market?.statusStyles]);

  const rakeBps = Number(pool?.rakeBps ?? market?.rake_bps ?? 0);
  const rakeRatio = Number.isFinite(rakeBps) ? Math.max(0, rakeBps) / 10000 : 0;
  const rakeLabel = rakeRatio > 0 ? formatPercent(rakeRatio, { maximumFractionDigits: 1 }) : 'No rake';

  const resolvedPoolVelocity = useMemo(() => {
    if (typeof market?.poolVelocity === 'number') {
      return market.poolVelocity;
    }
    if (typeof pool?.velocity === 'number') {
      return pool.velocity;
    }
    return poolVelocity;
  }, [market?.poolVelocity, pool?.velocity, poolVelocity]);

  const poolVelocityLabel = useMemo(() => {
    if (resolvedPoolVelocity === null || resolvedPoolVelocity === undefined) {
      return 'Awaiting wagers';
    }
    if (!Number.isFinite(resolvedPoolVelocity) || Math.abs(resolvedPoolVelocity) < 0.1) {
      return 'Stable flow';
    }
    const amount = formatCurrency(Math.abs(resolvedPoolVelocity), { compact: true, maximumFractionDigits: 1 });
    const sign = resolvedPoolVelocity >= 0 ? '+' : '−';
    return `${sign}${amount}/min`;
  }, [resolvedPoolVelocity]);

  return (
    <div
      className="tk-glass-panel group flex h-full flex-col gap-6 rounded-xl border border-white/5 p-6 transition-transform duration-300 hover:scale-[1.01] focus-within:scale-[1.01] focus-within:border-[#9FF7D3]/50"
    >
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {typeLabel ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-3 py-1 text-[0.6rem] uppercase tracking-[0.28em] text-[#9FF7D3]">
              {typeLabel}
            </span>
          ) : null}
          <span
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-[0.6rem] uppercase tracking-[0.28em] ${statusStyles.bg} ${statusStyles.border} ${statusStyles.text}`}
          >
            <Clock className="h-4 w-4" />
            {normaliseStatus(market?.status)}
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[0.6rem] uppercase tracking-[0.28em] text-neutral-300">
            Rake {rakeLabel}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold text-white">{market?.name ?? 'Unknown market'}</h3>
          {market?.description ? (
            <p className="text-sm text-neutral-400">{market.description}</p>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 text-neutral-300 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Pool size</span>
          <div className="flex flex-wrap items-baseline gap-3 text-white">
            <span className="text-2xl font-semibold">{formatCurrency(poolTotal, { compact: false, maximumFractionDigits: 0 })}</span>
            <span className="text-xs text-neutral-400">{poolVelocityLabel}</span>
          </div>
        </div>
        <div className="text-left text-xs text-neutral-500 md:text-right">
          <p className="font-semibold text-neutral-300">{countdown.label}</p>
          <p>{countdown.detail}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {statsToDisplay.length === 0 ? (
          <p className="text-sm text-neutral-500">No wagers yet. Be the first to place a bet.</p>
        ) : (
          statsToDisplay.slice(0, 4).map((entry) => {
            const percentage = Math.min(100, Math.round((entry.share ?? 0) * 100));
            const trend = resolveTrendMeta(entry.trendDelta ?? 0);
            const TrendIcon = trend.Icon;
            return (
              <div key={entry.outcomeId} className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-200">
                    <span className="font-medium">{entry.label}</span>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span>{formatCurrency(entry.total)}</span>
                      <span aria-hidden="true" className="text-neutral-700">
                        •
                      </span>
                      <span>{formatPercent(entry.share)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.65rem] uppercase tracking-[0.25em] text-neutral-500">
                    <span>Wagers {entry.wagerCount ?? 0}</span>
                    <span className={`inline-flex items-center gap-1 font-medium ${trend.color}`}>
                      <TrendIcon className="h-3 w-3" />
                      <span>
                        {trend.prefix}
                        {trend.label}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="relative h-[1.5px] w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="absolute inset-y-0 left-0 origin-left transition-[width] duration-700 ease-out"
                    style={{
                      width: mounted ? `${percentage}%` : '0%',
                      backgroundColor: entry.color ?? '#9FF7D3',
                      opacity: 0.9,
                    }}
                  />
                </div>
              </div>
            );
          ))
        )}
      </div>

      <footer className="mt-auto flex flex-col gap-3 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-2 text-neutral-400">
          <BarChart3 className="h-4 w-4 text-[#7C6BFF]" />
          <span>Live pool distribution</span>
        </div>
        {typeof onSelect === 'function' ? (
          <button
            type="button"
            onClick={onSelect}
            className="inline-flex items-center gap-2 rounded-md border border-[#9FF7D3]/50 px-3 py-1 text-[0.65rem] uppercase tracking-[0.25em] text-[#9FF7D3] transition-transform duration-200 hover:border-[#9FF7D3]/70 hover:text-white hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9FF7D3]"
          >
            {ctaLabel} <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </footer>
    </div>
  );
}

