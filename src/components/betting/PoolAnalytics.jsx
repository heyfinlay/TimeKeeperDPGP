import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock, TrendingDown, TrendingUp } from 'lucide-react';
import { useParimutuelStore, driverStats } from '@/state/parimutuelStore.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { formatCurrency, formatPercent } from '@/utils/betting.js';

const TABS = [
  { id: 'overview', label: 'Pool Overview' },
  { id: 'bets', label: 'Your Bets' },
];

const SPARKLINE_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const MAX_RECENT_BETS = 8;

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

const formatOdds = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '—';
  }
  return `x${numeric.toFixed(numeric >= 10 ? 1 : 2)}`;
};

const formatRelativeTime = (timestamp) => {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  const value = date.getTime();
  if (Number.isNaN(value)) {
    return '—';
  }
  const diffMs = Date.now() - value;
  if (diffMs < 30000) {
    return 'Just now';
  }
  if (diffMs < 60000) {
    return '1m ago';
  }
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const buildSparkline = (history, outcomeId) => {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }
  const values = history
    .map((snapshot) => snapshot?.outcomes?.[outcomeId]?.share)
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
      <span className="flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-1 text-xs text-neutral-400">
        <Activity className="h-3 w-3" /> Stable
      </span>
    );
  }
  const isPositive = delta > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const percent = formatPercent(Math.abs(delta), { maximumFractionDigits: 1 });
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
        isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
      }`}
    >
      <Icon className="h-3 w-3" />
      {`${isPositive ? '+' : '-'}${percent}`}
    </span>
  );
};

export default function PoolAnalytics({ marketId = null, className = '', isManagement = false }) {
  const {
    state: { events, selectedMarketId, pools, placement, poolHistory },
  } = useParimutuelStore();
  const { profile } = useAuth();

  const [activeTab, setActiveTab] = useState('overview');
  const [baselineSnapshot, setBaselineSnapshot] = useState(null);
  const [recentBets, setRecentBets] = useState([]);

  const resolvedMarketId = marketId ?? selectedMarketId;
  const market = useMemo(
    () => findMarket(events, resolvedMarketId),
    [events, resolvedMarketId],
  );
  const pool = market ? pools?.[market.id] ?? null : null;
  const stats = useMemo(() => driverStats(market, pool), [market, pool]);
  const history = useMemo(
    () => (market ? poolHistory?.[market.id]?.snapshots ?? [] : []),
    [market?.id, poolHistory],
  );
  const latestSnapshot = useMemo(
    () => (history.length > 0 ? history[history.length - 1] : null),
    [history],
  );

  useEffect(() => {
    if (!market?.id) {
      setBaselineSnapshot(null);
      return;
    }
    setBaselineSnapshot((current) => {
      if (current?.marketId === market.id) {
        return current;
      }
      const baseline = latestSnapshot ? { ...latestSnapshot, marketId: market.id } : null;
      return baseline;
    });
  }, [market?.id, latestSnapshot]);

  useEffect(() => {
    if (!market?.id) {
      setRecentBets([]);
      return;
    }
    setRecentBets((entries) => entries.filter((entry) => entry.marketId === market.id));
  }, [market?.id]);

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

  const containerClasses = `tk-glass-panel flex flex-col gap-5 rounded-2xl p-5 md:p-6 ${className}`.trim();

  if (!market) {
    return (
      <section className={containerClasses}>
        <header className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Pool analytics</span>
          <h2 className="text-lg font-semibold text-white">Select a market to view analytics</h2>
        </header>
        <p className="text-sm text-neutral-400">
          Choose a market to explore live odds, pool distribution, and your recent wagers.
        </p>
      </section>
    );
  }

  return (
    <section className={containerClasses}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Pool analytics</span>
          <div className="flex flex-col gap-2 text-sm text-neutral-300 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold text-white">{market.name ?? 'Market'}</h2>
              <p className="text-xs text-neutral-400">
                {formatCurrency(pool?.total ?? market.pool_total ?? 0, {
                  compact: false,
                  maximumFractionDigits: 0,
                })}{' '}
                in pool · {totalBets} bets
              </p>
            </div>
            <div className="flex items-center gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-white text-neutral-900'
                      : 'border border-white/20 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Clock className="h-3.5 w-3.5" />
          Updated {formatRelativeTime(latestSnapshot?.timestamp)}
        </div>
      </header>

      {activeTab === 'overview' ? (
        <div className="flex flex-col gap-3">
          {stats.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-neutral-400">
              No outcomes available for this market yet.
            </p>
          ) : (
            stats.map((entry) => {
              const latest = latestSnapshot?.outcomes?.[entry.outcomeId] ?? null;
              const baseline = baselineSnapshot?.outcomes?.[entry.outcomeId] ?? null;
              const deltaShare = baseline ? (latest?.share ?? entry.share) - baseline.share : 0;
              const deltaHandle = baseline
                ? (latest?.total ?? entry.total ?? 0) - (baseline.total ?? 0)
                : 0;
              const sparkline = buildSparkline(history, entry.outcomeId);
              return (
                <article
                  key={entry.outcomeId}
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex flex-col">
                      <h3 className="text-sm font-semibold text-white">{entry.label}</h3>
                      <p className="text-xs text-neutral-400">Live odds {formatOdds(entry.odds)}</p>
                    </div>
                    <DeltaChip delta={deltaShare} />
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-neutral-300 md:grid-cols-3">
                    <div className="flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">Share</span>
                      <span className="font-semibold text-white">
                        {formatPercent(entry.share, { maximumFractionDigits: 1 })}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">Handle</span>
                      <span className="font-semibold text-white">
                        {formatCurrency(entry.total, { compact: false, maximumFractionDigits: 0 })}
                      </span>
                      {showAdminMetrics ? (
                        <span className="text-xs text-neutral-400">
                          {deltaHandle === 0
                            ? 'No change since open'
                            : `${deltaHandle > 0 ? '+' : '-'}${formatCurrency(Math.abs(deltaHandle), {
                                compact: false,
                                maximumFractionDigits: 0,
                              })} since open`}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">Trend</span>
                      <span className="font-mono text-base text-white">{sparkline ?? '—'}</span>
                      <span className="text-xs text-neutral-400">
                        {entry.wagerCount ?? 0} wagers
                      </span>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {betsForDisplay.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-neutral-400">
              You have not placed any wagers on this market yet.
            </p>
          ) : (
            betsForDisplay.map((bet) => (
              <article
                key={bet.id}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{bet.label}</h3>
                    <p className="text-xs text-neutral-400">Placed {formatRelativeTime(bet.timestamp)}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-white">
                    <span>{formatCurrency(bet.stake, { compact: false, maximumFractionDigits: 0 })}</span>
                    <span className="text-xs uppercase tracking-wide text-neutral-400">
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
