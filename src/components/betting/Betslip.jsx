import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, TrendingUp, X } from 'lucide-react';
import { useWallet } from '@/context/WalletContext.jsx';
import {
  useParimutuelStore,
  driverStats,
  validateWager,
} from '@/state/parimutuelStore.js';
import { formatCurrency, formatPercent, formatCountdown } from '@/utils/betting.js';
import LiveBetsTicker from '@/components/betting/LiveBetsTicker.jsx';

const QUICK_STAKES = [
  { label: '10K', value: 10000 },
  { label: '25K', value: 25000 },
  { label: '50K', value: 50000 },
  { label: '100K', value: 100000 },
  { label: '250K', value: 250000 },
  { label: '1M', value: 1000000 },
];

const findMarket = (events, marketId) => {
  for (const event of events) {
    if (!Array.isArray(event?.markets)) continue;
    const market = event.markets.find((item) => String(item.id) === String(marketId));
    if (market) {
      return market;
    }
  }
  return null;
};

const findOutcome = (market, outcomeId) =>
  market?.outcomes?.find((candidate) => String(candidate.id) === String(outcomeId)) ?? null;

const normaliseStatus = (status) => {
  if (!status) return 'Scheduled';
  return String(status).replaceAll('_', ' ');
};

const computeEstimatedReturn = (stake, market, pool, outcome) => {
  if (!stake || !market || !outcome) {
    return 0;
  }
  const poolTotals = pool ?? {};
  const totalPool = Number(poolTotals.total ?? market.pool_total ?? 0);
  if (!Number.isFinite(totalPool) || totalPool <= 0) {
    return 0;
  }
  const rakeBps = Number.isFinite(Number(poolTotals.rakeBps ?? market.rake_bps))
    ? Number(poolTotals.rakeBps ?? market.rake_bps)
    : 0;
  const rakeMultiplier = Math.max(0, 1 - rakeBps / 10000);
  const netPool = totalPool * rakeMultiplier;
  const outcomeContribution = Number(
    poolTotals.outcomes?.[outcome.id]?.total ?? outcome.pool_total ?? 0,
  );
  if (!Number.isFinite(outcomeContribution) || outcomeContribution <= 0) {
    return 0;
  }
  return (stake / outcomeContribution) * netPool;
};

export default function Betslip({ marketId, outcomeId, onClose, onSuccess }) {
  const { balance, refresh } = useWallet();
  const {
    state: { events, selectedMarketId, pools, placement, toast },
    actions,
  } = useParimutuelStore();

  const activeMarketId = marketId ?? selectedMarketId;
  const market = useMemo(() => findMarket(events, activeMarketId), [events, activeMarketId]);

  const marketOptions = useMemo(
    () =>
      events.flatMap((event) =>
        Array.isArray(event?.markets)
          ? event.markets.map((candidate) => ({
              eventId: event.id,
              marketId: candidate.id,
              value: String(candidate.id),
              label: `${event.title ?? 'Event'} · ${candidate.name ?? 'Market'}`,
            }))
          : [],
      ),
    [events],
  );

  const activeMarketOption = marketOptions.find((option) => option.marketId === market?.id) ?? null;

  const pool = market ? pools[market.id] : null;
  const stats = useMemo(() => driverStats(market, pool), [market, pool]);

  const defaultOutcome = useMemo(() => {
    if (!market) {
      return null;
    }
    if (outcomeId) {
      return findOutcome(market, outcomeId) ?? market.outcomes?.[0] ?? null;
    }
    const placing = placement?.marketId === market.id ? findOutcome(market, placement?.outcomeId) : null;
    return placing ?? market.outcomes?.[0] ?? null;
  }, [market, outcomeId, placement?.marketId, placement?.outcomeId]);

  const [selectedOutcomeId, setSelectedOutcomeId] = useState(defaultOutcome?.id ?? null);
  const outcome = useMemo(
    () => (market ? findOutcome(market, selectedOutcomeId) ?? defaultOutcome ?? null : null),
    [market, selectedOutcomeId, defaultOutcome],
  );

  const [stake, setStake] = useState(0);
  const [customStake, setCustomStake] = useState('');
  const [localError, setLocalError] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [countdown, setCountdown] = useState(() => formatCountdown(market?.closes_at));

  const isPlacing =
    placement.isPlacing && placement.marketId === market?.id && placement.outcomeId === outcome?.id;

  useEffect(() => {
    setCountdown(formatCountdown(market?.closes_at));
    if (!market?.closes_at) {
      return undefined;
    }
    const timer = setInterval(() => {
      setCountdown(formatCountdown(market?.closes_at));
    }, 1000);
    return () => clearInterval(timer);
  }, [market?.closes_at]);

  useEffect(() => {
    setSelectedOutcomeId(defaultOutcome?.id ?? null);
  }, [defaultOutcome?.id]);

  useEffect(() => {
    setStake(0);
    setCustomStake('');
    setLocalError(null);
    setShowSuccess(false);
  }, [market?.id, outcome?.id]);

  const estimatedReturn = useMemo(
    () => computeEstimatedReturn(Number(stake) || 0, market, pool, outcome),
    [stake, market, pool, outcome],
  );

  const impliedOdds = stake > 0 && estimatedReturn > 0 ? estimatedReturn / stake : 0;
  const outcomeStats = useMemo(
    () => (outcome ? stats.find((entry) => entry.outcomeId === outcome.id) ?? null : null),
    [stats, outcome],
  );

  const totalWagers = useMemo(
    () => stats.reduce((sum, entry) => sum + (entry.wagerCount ?? 0), 0),
    [stats],
  );

  const handleQuickStake = (value) => {
    setStake(value);
    setCustomStake(String(value));
    setLocalError(null);
  };

  const handleCustomStakeChange = (event) => {
    const nextValue = event.target.value.replace(/[^0-9]/g, '');
    setCustomStake(nextValue);
    setStake(nextValue ? Number(nextValue) : 0);
    setLocalError(null);
  };

  const handleSelectOutcome = (value) => {
    setSelectedOutcomeId(value);
    setLocalError(null);
  };

  const handleSelectMarket = (value) => {
    const matched = marketOptions.find((option) => option.value === value);
    if (!matched) {
      return;
    }
    actions.selectEvent(matched.eventId);
    actions.selectMarket(matched.marketId);
    setSelectedOutcomeId(null);
    setLocalError(null);
  };

  const handlePlaceWager = async () => {
    if (!market || !outcome) {
      setLocalError('Select a market and outcome.');
      return;
    }

    if (!stake || stake <= 0) {
      setLocalError('Please choose a stake amount.');
      return;
    }

    if (stake > balance) {
      setLocalError(`Insufficient funds. Your balance: ${formatCurrency(balance)}`);
      return;
    }

    const { valid, issues } = validateWager({ stake, balance, market, outcome });
    if (!valid) {
      setLocalError(issues[0]);
      return;
    }

    const result = await actions.placeWager({
      marketId: market.id,
      outcomeId: outcome.id,
      stake,
      balance,
    });

    if (result.success) {
      setShowSuccess(true);
      if (typeof refresh === 'function') {
        await refresh();
      }
      if (typeof onSuccess === 'function') {
        onSuccess(result);
      }
      setTimeout(() => {
        if (typeof onClose === 'function') {
          onClose();
        }
      }, 2000);
    } else if (Array.isArray(result.issues) && result.issues.length > 0) {
      setLocalError(result.issues[0]);
    } else if (result.error) {
      setLocalError(result.error.message ?? 'Failed to place wager.');
    }
  };

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => actions.clearToast(), 3200);
    return () => clearTimeout(timer);
  }, [toast, actions]);

  if (!market || !outcome) {
    return (
      <div className="flex flex-col gap-4 bg-transparent p-6 text-center text-sm text-slate-300">
        <p>Select a market outcome to start building your betslip.</p>
        {typeof onClose === 'function' ? (
          <button
            type="button"
            onClick={onClose}
            className="interactive-cta self-center rounded-xl border border-accent-emerald/30 px-4 py-2 text-xs uppercase tracking-[0.35em] text-slate-200 hover:border-accent-emerald/50 hover:text-white"
          >
            Close
          </button>
        ) : null}
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <CheckCircle2 className="h-16 w-16 text-accent-emerald" />
        <div className="flex flex-col gap-2">
          <h3 className="text-2xl font-semibold text-white">Wager placed!</h3>
          <p className="text-sm text-accent-emerald/80">
            {formatCurrency(stake, { compact: false, maximumFractionDigits: 0 })} on{' '}
            <span className="font-semibold">{outcome.label}</span>
          </p>
          <p className="text-xs text-slate-400">Odds lock in when the market closes.</p>
        </div>
      </div>
    );
  }

  const isMarketActive = String(market?.status ?? '').toLowerCase() === 'open';
  const poolTotal = pool?.total ?? market.pool_total ?? 0;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto rounded-none bg-shell-900/95 px-6 py-8 text-white sm:rounded-none">
      <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Betslip</span>
          <h3 className="truncate text-lg font-semibold" title={market.name}>
            {market.name}
          </h3>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            {normaliseStatus(market.status)} · {stats.length} outcomes · {totalWagers} bets
          </p>
        </div>
        {typeof onClose === 'function' ? (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-full p-2 text-slate-400 transition-colors duration-200 ease-out-back hover:bg-shell-800/70 hover:text-white"
            aria-label="Close betslip"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-accent-emerald/15 bg-shell-800/60 p-4">
        <div className="flex flex-col gap-3">
          <label htmlFor="betslip-market" className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Market
          </label>
          <div className="relative">
            <select
              id="betslip-market"
              value={activeMarketOption?.value ?? ''}
              onChange={(event) => handleSelectMarket(event.target.value)}
              disabled={isPlacing || marketOptions.length === 0}
              className="focus-ring w-full appearance-none rounded-xl border border-accent-emerald/20 bg-shell-900/90 py-3 pl-4 pr-10 text-sm text-white transition-colors duration-200 ease-out-back hover:border-accent-emerald/40 disabled:opacity-50"
            >
              {marketOptions.map((option) => (
                <option key={option.marketId} value={option.value} className="bg-shell-900 text-white">
                  {option.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">⌄</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Outcomes</span>
          <div className="flex flex-wrap justify-center gap-2">
            {Array.isArray(market?.outcomes) && market.outcomes.length > 0 ? (
              market.outcomes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectOutcome(item.id)}
                  disabled={isPlacing}
                  aria-pressed={String(selectedOutcomeId) === String(item.id)}
                  title={item.label}
                  className={`focus-ring max-w-[48%] flex-1 truncate rounded-full border px-4 py-2 text-sm transition-colors duration-200 ease-out-back motion-safe:hover:scale-102 ${
                    String(selectedOutcomeId) === String(item.id)
                      ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald'
                      : 'border-accent-emerald/20 bg-shell-800/60 text-white hover:border-accent-emerald/40 hover:text-accent-emerald'
                  } disabled:opacity-50`}
                >
                  {item.label}
                </button>
              ))
            ) : (
              <span className="text-xs text-slate-500">No outcomes available.</span>
            )}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-accent-emerald/15 bg-shell-900/80 p-3 text-sm text-slate-300">
          <div className="flex items-center justify-between">
            <span>Pool size</span>
            <span>{formatCurrency(poolTotal, { compact: false, maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Countdown</span>
            <span>{countdown.label}</span>
          </div>
          {outcomeStats ? (
            <div className="flex items-center justify-between">
              <span className="truncate pr-3" title={outcome.label}>
                {outcome.label}
              </span>
              <span>{formatPercent(outcomeStats.share)}</span>
            </div>
          ) : (
            <span className="text-xs text-slate-500">No wagers yet on this outcome.</span>
          )}
        </div>

        {estimatedReturn > 0 ? (
          <div className="flex flex-col gap-1 rounded-xl border border-accent-emerald/40 bg-accent-emerald/15 px-4 py-3 text-xs text-accent-emerald">
            <div className="flex items-center justify-between">
              <span>Estimated return</span>
              <span>{formatCurrency(estimatedReturn, { compact: false, maximumFractionDigits: 1 })}</span>
            </div>
            {impliedOdds > 0 ? (
              <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.3em] text-accent-emerald/80">
                <span>Implied odds</span>
                <span>{impliedOdds.toFixed(2)}x</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Quick stake</label>
        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_STAKES.map((qs) => {
            const isActive = stake === qs.value;
            return (
              <button
                key={qs.value}
                type="button"
                onClick={() => handleQuickStake(qs.value)}
                disabled={isPlacing}
                aria-pressed={isActive}
                className={`focus-ring flex min-w-[80px] flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors duration-200 ease-out-back motion-safe:hover:scale-102 ${
                  isActive
                    ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald'
                    : 'border-accent-emerald/20 bg-shell-800/60 text-white hover:border-accent-emerald/40 hover:text-accent-emerald'
                } disabled:opacity-50`}
              >
                <span className="text-base leading-none">💎</span>
                <span className="tabular-nums">
                  {formatCurrency(qs.value, { symbol: '', maximumFractionDigits: 0 })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label htmlFor="custom-stake" className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Custom amount
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">💎</span>
          <input
            id="custom-stake"
            type="text"
            inputMode="numeric"
            value={customStake}
            onChange={handleCustomStakeChange}
            disabled={isPlacing}
            placeholder="Enter amount..."
            className="focus-ring w-full rounded-xl border border-accent-emerald/20 bg-shell-800/60 py-3 pl-10 pr-4 text-white placeholder:text-slate-500 hover:border-accent-emerald/40 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm">
        <span className="text-slate-400">Stake</span>
        <span className="font-semibold text-white">
          {stake ? formatCurrency(stake, { compact: false, maximumFractionDigits: 0 }) : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm">
        <span className="text-slate-400">Your balance</span>
        <span className="font-semibold text-white">{formatCurrency(balance)}</span>
      </div>

      {localError ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <AlertCircle className="h-4 w-4" />
          <span>{localError}</span>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${
            toast.type === 'success'
              ? 'border-accent-emerald/40 bg-accent-emerald/15 text-accent-emerald'
              : 'border-red-500/40 bg-red-950/30 text-red-200'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handlePlaceWager}
        disabled={isPlacing || !stake || stake > balance || !isMarketActive}
        className="interactive-cta flex items-center justify-center gap-2 rounded-full border border-accent-emerald/60 bg-accent-emerald/15 px-6 py-4 font-semibold uppercase tracking-[0.3em] text-accent-emerald hover:border-accent-emerald/80 hover:bg-accent-emerald/20 hover:text-white disabled:cursor-not-allowed disabled:border-slate-600/40 disabled:bg-slate-800/60 disabled:text-slate-500"
      >
        {isPlacing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Placing wager...
          </>
        ) : (
          <>
            <TrendingUp className="h-5 w-5" /> Place wager
          </>
        )}
      </button>

      {!isMarketActive ? (
        <p className="text-center text-xs text-slate-500">Market is not accepting wagers right now.</p>
      ) : null}

      {stake > 0 && stake <= balance ? (
        <p className="text-center text-xs text-slate-500">Estimated payout varies based on final pool size.</p>
      ) : null}
      </div>
      <LiveBetsTicker marketId={market.id} />
    </div>
  );
}
