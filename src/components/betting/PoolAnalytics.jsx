import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Minus } from 'lucide-react';
import { useParimutuelStore, driverStats } from '@/state/parimutuelStore.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { formatCurrency, formatPercent, formatOdds, formatRelativeTime } from '@/utils/betting.js';
import {
  isSupabaseConfigured,
  supabaseSelect,
  subscribeToTable,
  isTableMissingError,
} from '@/lib/supabaseClient.js';

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
const REMOTE_BET_LIMIT = MAX_RECENT_BETS * 2;

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

const StakeDeltaTicker = ({ delta }) => {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) {
    return (
      <span
        className="trend-ticker trend-ticker--flat mt-1 w-8 justify-center"
        role="status"
        aria-label="Diamonds staked unchanged since open"
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
      aria-label={`Diamonds staked ${isPositive ? 'up' : 'down'} ${amount} since open`}
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

const resolveOutcomeLabel = (market, outcomeId, fallback = 'Outcome') => {
  if (!market?.outcomes) {
    return fallback;
  }
  const match = market.outcomes.find((candidate) => String(candidate.id) === String(outcomeId));
  return match?.label ?? fallback;
};

const normaliseWagerRow = (row, { market } = {}) => {
  if (!row) {
    return null;
  }
  const outcomeId = row.outcome_id ?? row.outcomeId ?? null;
  const timestamp = row.placed_at ?? row.created_at ?? row.timestamp ?? new Date().toISOString();
  return {
    id: row.id ?? `local-${outcomeId ?? timestamp}`,
    marketId: row.market_id ?? row.marketId ?? market?.id ?? null,
    outcomeId,
    label: row.outcomes?.label ?? row.label ?? resolveOutcomeLabel(market, outcomeId),
    stake: Number(row.stake ?? 0),
    timestamp,
    status: row.status ?? 'pending',
  };
};

export default function PoolAnalytics({ marketId = null, className = '', isManagement = false }) {
  const {
    state: { events, selectedMarketId, pools, placement, poolHistory, historyWindow, realtime },
    actions: { loadMarketHistory, setHistoryWindow },
  } = useParimutuelStore();
  const { profile, user } = useAuth();

  const [activeTab, setActiveTab] = useState('overview');
  const [recentBets, setRecentBets] = useState([]);
  const [isLoadingBets, setIsLoadingBets] = useState(false);
  const [betsError, setBetsError] = useState(null);
  const [supportsBetHistory, setSupportsBetHistory] = useState(isSupabaseConfigured);

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
    if (!user?.id) {
      setRecentBets([]);
      setBetsError(null);
    }
  }, [user?.id]);

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
    const nextEntry = normaliseWagerRow(
      {
        id: placement.lastWager.id ?? `local-${placement.lastWager.outcomeId}`,
        market_id: market.id,
        outcome_id: placement.lastWager.outcomeId,
        stake: placement.lastWager.stake,
        placed_at: new Date().toISOString(),
        status: placement.lastWager.status ?? 'pending',
      },
      { market },
    );
    if (!nextEntry) {
      return;
    }
    setRecentBets((entries) => {
      const filtered = entries.filter((entry) => entry.id !== nextEntry.id && entry.marketId === market.id);
      return [nextEntry, ...filtered].slice(0, MAX_RECENT_BETS);
    });
  }, [placement?.lastWager, market]);

  const loadUserBets = useCallback(async () => {
    if (!market?.id || !user?.id) {
      return;
    }
    if (!isSupabaseConfigured) {
      setSupportsBetHistory(false);
      return;
    }
    if (!supportsBetHistory) {
      return;
    }
    setIsLoadingBets(true);
    try {
      const rows = await supabaseSelect('wagers', {
        select: 'id,stake,placed_at,status,outcome_id,market_id,outcomes(label)',
        filters: {
          market_id: `eq.${market.id}`,
          user_id: `eq.${user.id}`,
          limit: String(REMOTE_BET_LIMIT),
        },
        order: { column: 'placed_at', ascending: false },
      });
      const normalized = Array.isArray(rows)
        ? rows
            .map((row) => normaliseWagerRow(row, { market }))
            .filter(Boolean)
            .slice(0, MAX_RECENT_BETS)
        : [];
      setRecentBets(normalized);
      setBetsError(null);
      setSupportsBetHistory(true);
    } catch (error) {
      if (isTableMissingError(error, 'wagers')) {
        setSupportsBetHistory(false);
        setRecentBets([]);
        setBetsError('Wager history is unavailable in this environment.');
      } else {
        console.error('Failed to load user wagers', error);
        setBetsError(error.message ?? 'Unable to load your wagers.');
      }
    } finally {
      setIsLoadingBets(false);
    }
  }, [market?.id, user?.id, supportsBetHistory]);

  useEffect(() => {
    if (!market?.id || !user?.id || !isSupabaseConfigured) {
      return;
    }
    void loadUserBets();
  }, [loadUserBets, market?.id, user?.id]);

  useEffect(() => {
    if (!market?.id || !user?.id || !isSupabaseConfigured || !supportsBetHistory) {
      return undefined;
    }
    const unsubscribe = subscribeToTable(
      { schema: 'public', table: 'wagers', event: '*', filter: `user_id=eq.${user.id}` },
      (payload) => {
        const nextEntry = normaliseWagerRow(payload?.new, { market });
        if (!nextEntry || nextEntry.marketId !== market.id) {
          return;
        }
        setRecentBets((entries) => {
          const filtered = entries.filter((entry) => entry.id !== nextEntry.id);
          return [nextEntry, ...filtered].slice(0, MAX_RECENT_BETS);
        });
      },
      { maxRetries: 3 },
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [market?.id, user?.id, supportsBetHistory]);

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
                      Share {formatPercent(card.currentShare, { maximumFractionDigits: 1 })} · Diamonds staked{' '}
                      {formatCurrency(card.currentPool, { compact: false, maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <DeltaChip delta={card.deltaShare} />
                </div>
                <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Diamonds Δ</span>
                    {showAdminMetrics ? (
                      <StakeDeltaTicker delta={card.handleDelta} />
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
          {!user?.id ? (
            <p className="rounded-xl border border-dashed border-accent-emerald/15 bg-shell-800/40 px-4 py-3 text-sm text-slate-400">
              Sign in to see wagers you have placed on this market.
            </p>
          ) : (!isSupabaseConfigured || !supportsBetHistory) && betsForDisplay.length === 0 ? (
            <p className="rounded-xl border border-dashed border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Wager history isn&apos;t available in this environment. New bets will still appear while you stay on this page.
            </p>
          ) : betsError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              Unable to load your wagers: {betsError}
            </p>
          ) : isLoadingBets && betsForDisplay.length === 0 ? (
            <p className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
              Loading your wagers…
            </p>
          ) : betsForDisplay.length === 0 ? (
            <p className="rounded-xl border border-dashed border-accent-emerald/15 bg-shell-800/40 px-4 py-3 text-sm text-slate-400">
              You have not placed any wagers on this market yet.
            </p>
          ) : (
            betsForDisplay.map((bet) => {
              const statusLabel = (bet.status ?? 'pending').replace(/_/g, ' ');
              return (
                <article
                  key={bet.id}
                  className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 p-4"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{bet.label}</h3>
                      <p className="text-xs text-slate-400">
                        {formatRelativeTime(bet.timestamp)} · {statusLabel}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-3 text-sm text-white md:justify-end">
                      <div className="flex flex-col text-left">
                        <span className="font-semibold text-white">
                          {formatCurrency(bet.stake, { compact: false, maximumFractionDigits: 0 })}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-slate-500">Diamonds staked</span>
                      </div>
                      <div className="flex flex-col items-end text-xs text-slate-400">
                        <span>{formatPercent(bet.share, { maximumFractionDigits: 1 })} share</span>
                        <span>{formatOdds(bet.odds)}</span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
