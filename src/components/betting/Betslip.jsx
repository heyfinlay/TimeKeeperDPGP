import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, TrendingUp, X } from 'lucide-react';
import { useWallet } from '@/context/WalletContext.jsx';
import {
  useParimutuelStore,
  driverStats,
  validateWager,
} from '@/state/parimutuelStore.js';
import { formatCurrency, formatPercent, formatCountdown } from '@/utils/betting.js';

const QUICK_STAKES = [
  { label: '1K', value: 1000 },
  { label: '10K', value: 10000 },
  { label: '100K', value: 100000 },
  { label: '1M', value: 1000000 },
];

const findMarket = (events, marketId) => {
  for (const event of events) {
    if (!Array.isArray(event?.markets)) continue;
    const market = event.markets.find((item) => item.id === marketId);
    if (market) {
      return market;
    }
  }
  return null;
};

const findOutcome = (market, outcomeId) =>
  market?.outcomes?.find((candidate) => candidate.id === outcomeId) ?? null;

export default function Betslip({ marketId, outcomeId, onClose, onSuccess }) {
  const { balance, refresh } = useWallet();
  const {
    state: { events, selectedMarketId, pools, placement, toast },
    actions,
  } = useParimutuelStore();

  const activeMarketId = marketId ?? selectedMarketId;
  const market = useMemo(() => findMarket(events, activeMarketId), [events, activeMarketId]);
  const outcome = useMemo(
    () => (market ? findOutcome(market, outcomeId) ?? market?.outcomes?.[0] ?? null : null),
    [market, outcomeId],
  );
  const pool = market ? pools[market.id] : null;
  const stats = useMemo(() => driverStats(market, pool), [market, pool]);
  const outcomeStats = useMemo(
    () => (outcome ? stats.find((entry) => entry.outcomeId === outcome.id) ?? null : null),
    [stats, outcome],
  );

  const [stake, setStake] = useState(0);
  const [customStake, setCustomStake] = useState('');
  const [localError, setLocalError] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [countdown, setCountdown] = useState(() => formatCountdown(market?.closes_at));

  const isPlacing = placement.isPlacing && placement.marketId === market?.id && placement.outcomeId === outcome?.id;
  const estimatedReturn = outcomeStats ? (Number(stake) || 0) * (Number(outcomeStats.odds) || 0) : 0;

  useEffect(() => {
    setCountdown(formatCountdown(market?.closes_at));
    const timer = setInterval(() => {
      setCountdown(formatCountdown(market?.closes_at));
    }, 1000);
    return () => clearInterval(timer);
  }, [market?.closes_at]);

  useEffect(() => {
    setStake(0);
    setCustomStake('');
    setLocalError(null);
    setShowSuccess(false);
  }, [market?.id, outcome?.id]);

  const handleQuickStake = (value) => {
    setStake(value);
    setCustomStake('');
    setLocalError(null);
  };

  const handleCustomStakeChange = (event) => {
    const nextValue = event.target.value.replace(/[^0-9]/g, '');
    setCustomStake(nextValue);
    setStake(nextValue ? Number(nextValue) : 0);
    setLocalError(null);
  };

  const handlePlaceWager = async () => {
    if (!market || !outcome) {
      setLocalError('Select a market and outcome.');
      return;
    }

    if (!stake || stake <= 0) {
      setLocalError('Please select a stake amount.');
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
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-[#060910]/95 p-6 text-center text-sm text-neutral-300">
        <p>Select a market outcome to start building your betslip.</p>
        {typeof onClose === 'function' ? (
          <button
            type="button"
            onClick={onClose}
            className="self-center rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-neutral-300 transition hover:border-white/30 hover:text-white"
          >
            Close
          </button>
        ) : null}
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-green-500/20 bg-green-950/20 p-8 text-center">
        <CheckCircle2 className="h-16 w-16 text-green-400" />
        <div className="flex flex-col gap-2">
          <h3 className="text-2xl font-semibold text-white">Wager placed!</h3>
          <p className="text-sm text-green-200">
            {formatCurrency(stake, { compact: false, maximumFractionDigits: 0 })} on{' '}
            <span className="font-semibold">{outcome.label}</span>
          </p>
          <p className="text-xs text-neutral-400">Odds lock in when the market closes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-[#060910]/95 p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Betslip</span>
          <h3 className="text-lg font-semibold text-white">{market.name}</h3>
          <p className="text-sm text-neutral-400">{outcome.label}</p>
        </div>
        {typeof onClose === 'function' ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close betslip"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/5 bg-white/5 p-4">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>Pool size</span>
          <span>{formatCurrency(pool?.total ?? market.pool_total ?? 0, { compact: false, maximumFractionDigits: 0 })}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>Countdown</span>
          <span>{countdown.label}</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Outcome share</span>
          {outcomeStats ? (
            <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between text-sm text-neutral-300">
                <span>{outcome.label}</span>
                <span>{formatPercent(outcomeStats.share)}</span>
              </div>
              <p className="text-xs text-neutral-500">
                {formatCurrency(outcomeStats.total, { compact: false, maximumFractionDigits: 0 })} wagered ·{' '}
                {outcomeStats.wagerCount} bets
              </p>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">No wagers yet on this outcome.</p>
          )}
        </div>
        {estimatedReturn > 0 ? (
          <div className="flex items-center justify-between rounded-xl border border-[#9FF7D3]/20 bg-[#9FF7D3]/10 px-4 py-3 text-xs text-[#9FF7D3]">
            <span>Estimated return</span>
            <span>{formatCurrency(estimatedReturn, { compact: false, maximumFractionDigits: 1 })}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-xs uppercase tracking-[0.3em] text-neutral-500">Quick stake</label>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_STAKES.map((qs) => (
            <button
              key={qs.value}
              type="button"
              onClick={() => handleQuickStake(qs.value)}
              disabled={isPlacing}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                stake === qs.value
                  ? 'border-[#9FF7D3] bg-[#9FF7D3]/10 text-[#9FF7D3]'
                  : 'border-white/10 bg-white/5 text-white hover:border-white/20 hover:bg-white/10'
              } disabled:opacity-50`}
            >
              {formatCurrency(qs.value)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label htmlFor="custom-stake" className="text-xs uppercase tracking-[0.3em] text-neutral-500">
          Custom amount
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">💎</span>
          <input
            id="custom-stake"
            type="text"
            inputMode="numeric"
            value={customStake}
            onChange={handleCustomStakeChange}
            disabled={isPlacing}
            placeholder="Enter amount..."
            className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-white placeholder:text-neutral-600 focus:border-[#9FF7D3]/40 focus:outline-none focus:ring-2 focus:ring-[#9FF7D3]/20 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm">
        <span className="text-neutral-400">Your balance</span>
        <span className="font-semibold text-white">{formatCurrency(balance)}</span>
      </div>

      {localError ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" />
          <span>{localError}</span>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
              : 'border-red-500/30 bg-red-950/20 text-red-300'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handlePlaceWager}
        disabled={isPlacing || !stake || stake > balance}
        className="flex items-center justify-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-6 py-4 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/20 hover:text-white disabled:opacity-50 disabled:hover:border-[#9FF7D3]/40 disabled:hover:bg-[#9FF7D3]/10 disabled:hover:text-[#9FF7D3]"
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

      {stake > 0 && stake <= balance ? (
        <p className="text-center text-xs text-neutral-500">Estimated payout varies based on final pool size.</p>
      ) : null}
    </div>
  );
}

