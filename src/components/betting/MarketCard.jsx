import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, Clock } from 'lucide-react';
import { driverStats } from '@/state/parimutuelStore.js';
import { formatCurrency, formatPercent, formatCountdown } from '@/utils/betting.js';

const normaliseStatus = (status) => {
  if (!status) return 'Unknown';
  return String(status).replaceAll('_', ' ');
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

  useEffect(() => {
    setCountdown(formatCountdown(market?.closes_at));
    const timer = setInterval(() => {
      setCountdown(formatCountdown(market?.closes_at));
    }, 1000);
    return () => clearInterval(timer);
  }, [market?.closes_at]);

  const poolTotal = useMemo(() => {
    if (pool?.total !== undefined) {
      return pool.total;
    }
    return derivedStats.reduce((sum, entry) => sum + (entry.total ?? 0), 0);
  }, [pool?.total, derivedStats]);

  return (
    <div className="flex h-full flex-col gap-5 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6 shadow-[0_0_40px_rgba(15,23,42,0.45)]">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/30 bg-[#9FF7D3]/10 px-3 py-1 text-[0.6rem] uppercase tracking-[0.35em] text-[#9FF7D3]">
            {market?.type ?? 'Market'}
          </span>
          <h3 className="text-xl font-semibold text-white">{market?.name ?? 'Unknown market'}</h3>
          {market?.description ? (
            <p className="text-sm text-neutral-400">{market.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-neutral-300">
          <Clock className="h-4 w-4" />
          <span>{normaliseStatus(market?.status)}</span>
        </div>
      </header>

      <div className="flex items-baseline justify-between text-neutral-300">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Pool size</span>
          <span className="text-2xl font-semibold text-white">{formatCurrency(poolTotal, { compact: false, maximumFractionDigits: 0 })}</span>
        </div>
        <div className="text-right text-xs text-neutral-500">
          <p className="font-semibold text-neutral-300">{countdown.label}</p>
          <p>{countdown.detail}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {derivedStats.length === 0 ? (
          <p className="text-sm text-neutral-500">No wagers yet. Be the first to place a bet.</p>
        ) : (
          derivedStats.slice(0, 4).map((entry) => (
            <div key={entry.outcomeId} className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm text-neutral-300">
                <span>{entry.label}</span>
                <span className="text-xs text-neutral-400">
                  {formatCurrency(entry.total)} · {formatPercent(entry.share)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-[#7C6BFF] via-[#9FF7D3] to-[#dcd7ff]"
                  style={{ width: `${Math.min(100, Math.round(entry.share * 100))}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <footer className="mt-auto flex items-center justify-between text-xs text-neutral-500">
        <div className="inline-flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#7C6BFF]" />
          <span>Live pool distribution</span>
        </div>
        {typeof onSelect === 'function' ? (
          <button
            type="button"
            onClick={onSelect}
            className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
          >
            {ctaLabel} <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </footer>
    </div>
  );
}

