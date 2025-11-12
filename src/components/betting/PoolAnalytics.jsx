import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Minus } from 'lucide-react';
import { useParimutuelStore, driverStats } from '@/state/parimutuelStore.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { formatCurrency, formatPercent, formatOdds, formatRelativeTime } from '@/utils/betting.js';

const TABS = [
  { id: 'overview', label: 'Pool Overview' },
  { id: 'bets', label: 'Your Bets' },
];

const WINDOW_OPTIONS = [
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: 'since_open', label: 'Since Open' },
];

const SPARKLINE_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const MAX_RECENT_BETS = 8;

const clampNumber = (value, min, max) => {
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

const resolveTakeoutValue = (market, pool, windowData) => {
  const historyTakeout = Number(windowData?.takeout);
  if (Number.isFinite(historyTakeout)) {
    return clampNumber(historyTakeout, 0, 0.25);
  }
  const poolTakeout = Number(pool?.takeout);
  if (Number.isFinite(poolTakeout)) {
    return clampNumber(poolTakeout, 0, 0.25);
  }
  const marketTakeout = Number(market?.takeout);
  if (Number.isFinite(marketTakeout)) {
    return clampNumber(marketTakeout, 0, 0.25);
  }
  const rakeBps = Number(market?.rake_bps);
  if (Number.isFinite(rakeBps)) {
    return clampNumber(rakeBps / 10000, 0, 0.25);
  }
  return 0.1;
};

const findMarket = (events, marketId) => {
  if (!marketId) {
    return null;
  }
  for (const event of events) {
    if (!Array.isArray(event?.markets)) {
      continue;
    }
    const match = event.markets.find((market) => String(market.id) === String(marketId));
    if (match) {
      return match;
    }
  }
  return null;
};

const findOutcome = (market, outcomeId) =>
  market?.outcomes?.find((candidate) => String(candidate.id) === String(outcomeId)) ?? null;

const buildSparkline = (samples) => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return null;
  }
  const values = samples
    .map((point) => {
      if (point == null) return null;
      if (typeof point === 'number') return point;
      if (typeof point === 'object') {
        const share = point.share ?? point.value ?? null;
        return typeof share === 'number' ? share : null;
      }
      return null;
    })
    .filter((value) => typeof value === 'number' && !Number.isNaN(value));
  if (values.length <= 1) {
    return null;
  }
  const recent = values.slice(-10);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  if (min === max) {
    return '▁'.repeat(recent.length);
  }
  const span = max - min;
  return recent
    .map((value) => {
      const ratio = span === 0 ? 0 : (value - min) / span;
      const index = Math.min(
        SPARKLINE_BARS.length - 1,
        Math.round(ratio * (SPARKLINE_BARS.length - 1)),
      );
      return SPARKLINE_BARS[index];
    })
    .join('');
};

const DeltaChip = ({ delta }) => {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) {
    return (
      <span
        className="trend-ticker trend-ticker--flat"
        role="status"
        aria-label="Share unchanged since open"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  const isPositive = delta > 0;
  const pp = Math.abs(delta * 100).toFixed(1);
  return (
    <span
      className={`trend-ticker ${isPositive ? 'trend-ticker--up' : 'trend-ticker--down'}`}
      role="status"
      aria-label={`Share ${isPositive ? 'up' : 'down'} ${pp} percentage points`}
    >
      {isPositive ? (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{`${isPositive ? '+' : '-'}${pp}pp`}</span>
    </span>
  );
};

const HandleDeltaTicker = ({ delta }) => {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) {
    return (
      <span
        className="trend-ticker trend-ticker--flat mt-1 w-8 justify-center"
        role="status"
        aria-label="Handle unchanged since open"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }

  const isPositive = delta > 0;
  const amount = formatCurrency(Math.abs(delta), {
    compact: false,
    maximumFractionDigits: 0,
  });

  return (
    <span
      className={`trend-ticker ${isPositive ? 'trend-ticker--up' : 'trend-ticker--down'} mt-1 w-max`}
      role="status"
      aria-label={`Handle ${isPositive ? 'up' : 'down'} ${amount} since open`}
    >
      {isPositive ? (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{`${isPositive ? '+' : '-'}${amount}`}</span>
    </span>
  );
};

export default function PoolAnalytics({ marketId = null, className = '', isManagement = false }) {
  const {
    state: { events, selectedMarketId, pools, placement, poolHistory, historyWindow, realtime },
    actions: { loadMarketHistory, setHistoryWindow },
  } = useParimutuelStore();
  const { profile } = useAuth();

  const [activeTab, setActiveTab] = useState('overview');
  const [recentBets, setRecentBets] = useState([]);

  const resolvedMarketId = marketId ?? selectedMarketId;
  const market = useMemo(
    () => findMarket(events, resolvedMarketId),
    [events, resolvedMarketId],
  );
  const pool = market ? pools?.[market.id] ?? null : null;
  const stats = useMemo(() => driverStats(market, pool), [market, pool]);
  const historyState = useMemo(
    () => (market ? poolHistory?.[market.id] ?? null : null),
    [market?.id, poolHistory],
  );
  const windowData = historyState?.windows?.[historyWindow] ?? null;
  const historyLoading = Boolean(historyState?.isLoading?.[historyWindow]);
  const historyError = historyState?.errors?.[historyWindow] ?? null;
  const updatedAt = windowData?.updatedAt ?? realtime?.lastUpdate ?? null;
  const takeoutValue = resolveTakeoutValue(market, pool, windowData);
  const takeoutDisplay = formatPercent(takeoutValue, { maximumFractionDigits: 1 });
  useEffect(() => {
    if (!market?.id) {
      setRecentBets([]);
      return;
    }
    setRecentBets((entries) => entries.filter((entry) => entry.marketId === market.id));
  }, [market?.id]);

  useEffect(() => {
    if (!market?.id) {
      return;
    }
    loadMarketHistory({ marketId: market.id, window: historyWindow });
  }, [market?.id, historyWindow, loadMarketHistory]);

  useEffect(() => {
    if (!placement?.lastWager || !market?.id) {
      return;
    }
    if (placement.lastWager.marketId !== market.id) {
      return;
    }
    const outcome = findOutcome(market, placement.lastWager.outcomeId);
    setRecentBets((entries) => {
      const wagerId = placement.lastWager.id ?? `local-${placement.lastWager.outcomeId}`;
      const nextEntry = {
        id: wagerId,
        marketId: market.id,
        outcomeId: placement.lastWager.outcomeId,
        label: outcome?.label ?? 'Outcome',
        stake: Number(placement.lastWager.stake ?? 0),
        timestamp: new Date().toISOString(),
      };
      const existingIndex = entries.findIndex((entry) => entry.id === wagerId);
      const filtered = entries.filter((entry) => entry.marketId === market.id);
      if (existingIndex >= 0) {
        const next = [...filtered];
        next[existingIndex] = nextEntry;
        return next;
      }
      return [nextEntry, ...filtered].slice(0, MAX_RECENT_BETS);
    });
  }, [placement?.lastWager, market?.id, market?.outcomes]);

  useEffect(() => {
    setActiveTab('overview');
  }, [market?.id]);

  const showAdminMetrics = isManagement || profile?.role === 'admin';
  const totalBets = useMemo(
    () => stats.reduce((sum, entry) => sum + (entry.wagerCount ?? 0), 0),
    [stats],
  );
  const betsForDisplay = useMemo(
    () =>
      recentBets.map((bet) => {
        const stat = stats.find((entry) => entry.outcomeId === bet.outcomeId) ?? null;
        return {
          ...bet,
          share: stat?.share ?? 0,
          odds: stat?.odds ?? 0,
        };
      }),
    [recentBets, stats],
  );

  const runnerCards = useMemo(() => {
    if (windowData && Array.isArray(windowData.runners)) {
      return windowData.runners.map((runner) => {
        const currentShare = Number(runner.current?.share ?? 0);
        const deltaShare = Number(runner.delta?.share ?? 0);
        const currentPoolAmount = Number(runner.current?.pool ?? 0);
        const handleDelta = Number(runner.delta?.handle ?? 0);
        const oddsCurrent = Number(runner.current?.odds ?? 0);
        const oddsDelta = Number(runner.delta?.odds ?? 0);
        const sparkline = buildSparkline(runner.sparkline ?? []);
        const trend = runner.delta?.trend ?? (deltaShare > 0 ? 'up' : deltaShare < 0 ? 'down' : 'flat');
        const wagerCount = Number(runner.current?.wagerCount ?? runner.current?.wagers ?? 0);
        return {
          outcomeId: runner.runnerId ?? runner.outcomeId ?? runner.id,
          label: runner.label ?? 'Outcome',
          currentShare,
          deltaShare,
          currentPool: currentPoolAmount,
          handleDelta,
          odds: oddsCurrent,
          oddsDelta,
          sparkline,
          trend,
          wagerCount,
        };
      });
    }
    return stats.map((entry) => ({
      outcomeId: entry.outcomeId,
      label: entry.label,
      currentShare: entry.share,
      deltaShare: 0,
      currentPool: entry.total,
      handleDelta: 0,
      odds: entry.odds,
      oddsDelta: 0,
      sparkline: null,
      trend: 'flat',
      wagerCount: entry.wagerCount ?? 0,
    }));
  }, [windowData, stats]);

  const totalPoolDisplay = formatCurrency(
    windowData?.totalPool ?? pool?.total ?? market?.pool_total ?? 0,
    { compact: false, maximumFractionDigits: 0 },
  );
  const updatedLabel = updatedAt ? formatRelativeTime(updatedAt) : '—';

  const containerClasses = `tk-glass-panel interactive-card flex flex-col gap-6 rounded-2xl p-6 ${className}`.trim();

  if (!market) {
    return (
      <section className={containerClasses}>
        <header className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Pool analytics</span>
          <h2 className="text-lg font-semibold text-white">Select a market to view analytics</h2>
        </header>
        <p className="text-sm text-slate-400">
          Choose a market to explore live odds, pool distribution, and your recent wagers.
        </p>
      </section>
    );
  }

  return (
    <section className={containerClasses}>
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Pool analytics</span>
          <div className="flex flex-col gap-2 text-sm text-slate-300 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold text-white">{market.name ?? 'Market'}</h2>
            <p className="text-xs text-slate-400">
                {totalPoolDisplay} in pool · {totalBets} bets
            </p>
          </div>
            <div className="flex items-center gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`interactive-cta rounded-full px-3 py-1 text-xs font-semibold ${
                    activeTab === tab.id
                      ? 'border-accent-emerald/60 bg-accent-emerald/20 text-neutral-900'
                      : 'border border-accent-emerald/20 bg-shell-800/60 text-slate-300 hover:border-accent-emerald/40 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Updated {updatedLabel}
          </span>
          <span>Takeout {takeoutDisplay}</span>
        </div>
      </header>

      {activeTab === 'overview' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setHistoryWindow(option.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-200 ${
                  historyWindow === option.id
                    ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald'
                    : 'border-accent-emerald/20 bg-shell-800/60 text-slate-300 hover:border-accent-emerald/40 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {historyError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              Unable to load pool history: {historyError}
            </p>
          ) : null}
          {historyLoading && runnerCards.length === 0 ? (
            <p className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
              Loading pool trends…
            </p>
          ) : null}
          {runnerCards.length === 0 && !historyLoading ? (
            <p className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
              No outcomes available for this market yet.
            </p>
          ) : null}
          {runnerCards.map((card) => {
            const oddsDeltaLabel = Number.isFinite(card.oddsDelta)
              ? `${card.oddsDelta >= 0 ? '+' : ''}${Math.abs(card.oddsDelta) >= 1 ? card.oddsDelta.toFixed(1) : card.oddsDelta.toFixed(2)}`
              : '0.00';
            const trendTone =
              card.trend === 'up'
                ? 'text-accent-emerald'
                : card.trend === 'down'
                  ? 'text-red-300'
                  : 'text-slate-400';
            return (
              <article
                key={card.outcomeId}
                className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 p-4 transition-all duration-200 ease-out-back"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-semibold text-white">{card.label}</h3>
                    <p className="text-xs text-slate-400">
                      Share {formatPercent(card.currentShare, { maximumFractionDigits: 1 })} · Handle{' '}
                      {formatCurrency(card.currentPool, { compact: false, maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <DeltaChip delta={card.deltaShare} />
                </div>
                <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Handle Δ</span>
                    {showAdminMetrics ? (
                      <HandleDeltaTicker delta={card.handleDelta} />
                    ) : (
                      <span className="text-xs text-slate-500">Hidden</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Odds</span>
                    <span className="font-semibold text-white">{formatOdds(card.odds)}</span>
                    <span className={`text-xs ${trendTone}`}>Δ x{oddsDeltaLabel}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Trend</span>
                    <span className="font-mono text-base text-white">{card.sparkline ?? '—'}</span>
                    <span className="text-xs text-slate-400">{card.wagerCount} wagers</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {betsForDisplay.length === 0 ? (
            <p className="rounded-xl border border-dashed border-accent-emerald/15 bg-shell-800/40 px-4 py-3 text-sm text-slate-400">
              You have not placed any wagers on this market yet.
            </p>
          ) : (
            betsForDisplay.map((bet) => (
              <article
                key={bet.id}
                className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 p-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{bet.label}</h3>
                    <p className="text-xs text-slate-400">Placed {formatRelativeTime(bet.timestamp)}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-white">
                    <span>{formatCurrency(bet.stake, { compact: false, maximumFractionDigits: 0 })}</span>
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      {formatPercent(bet.share, { maximumFractionDigits: 1 })} share · {formatOdds(bet.odds)}
                    </span>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
