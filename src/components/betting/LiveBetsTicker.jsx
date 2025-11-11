import { Activity, Clock, RefreshCcw } from 'lucide-react';
import { useMarketWagers } from '@/hooks/useMarketWagers.js';
import { formatCurrency, formatRelativeTime } from '@/utils/betting.js';
import { resolveOutcomeIdentity } from '@/utils/outcomes.js';

const buildClassName = (base, extra) => [base, extra].filter(Boolean).join(' ');

export default function LiveBetsTicker({ marketId, className = '' }) {
  const { wagers, isLoading, supportsWagers, error, reload } = useMarketWagers(marketId);

  const containerClasses = buildClassName(
    'rounded-2xl border border-accent-emerald/20 bg-shell-900/85 px-4 py-4 text-sm text-slate-300',
    className,
  );

  const latestTimestamp = wagers[0]?.placedAt ?? null;
  const headerStatus = isLoading
    ? 'Syncing…'
    : latestTimestamp
      ? `Updated ${formatRelativeTime(latestTimestamp)}`
      : 'Awaiting wagers';

  return (
    <section className={containerClasses}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent-emerald" />
          <span className="text-xs uppercase tracking-[0.35em] text-accent-emerald">Live bets</span>
        </div>
        <span className="text-xs text-slate-500">{headerStatus}</span>
      </header>

      {!supportsWagers ? (
        <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-xs text-slate-500">
          Realtime bet tracking is unavailable while Supabase is disabled.
        </p>
      ) : !marketId ? (
        <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-xs text-slate-500">
          Choose a market to watch wagers land in real time.
        </p>
      ) : error ? (
        <div className="flex flex-col gap-2 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-xs text-red-200">
          <span>Unable to load recent wagers.</span>
          <button
            type="button"
            onClick={() => reload()}
            className="inline-flex items-center gap-2 self-start rounded-full border border-red-500/40 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-red-200 transition-colors duration-150 hover:border-red-400 hover:text-white"
          >
            <RefreshCcw className="h-3 w-3" /> Retry
          </button>
        </div>
      ) : wagers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-xs text-slate-500">
          No wagers placed yet. Be first to drop a Diamond on this market.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
          {wagers.map((wager, index) => {
            const identity = resolveOutcomeIdentity(
              {
                label: wager.outcomeLabel,
                abbreviation: wager.outcomeAbbreviation,
                color: wager.outcomeColor ?? undefined,
              },
              { fallbackIndex: index },
            );
            const badgeStyle = {
              backgroundImage: `linear-gradient(135deg, ${identity.primaryColor}, ${identity.secondaryColor})`,
            };
            return (
              <li
                key={wager.id}
                className="flex items-center gap-3 rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-3 py-3 text-sm transition-colors duration-150 ease-out-back hover:border-accent-emerald/40 hover:bg-accent-emerald/10"
              >
                <span
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase tracking-wide text-white shadow-lg shadow-black/30"
                  style={badgeStyle}
                  aria-hidden="true"
                >
                  {identity.abbreviation}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white" title={identity.displayName}>
                    {wager.outcomeLabel}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(wager.placedAt)}
                    </span>
                    <span>·</span>
                    <span>{formatCurrency(wager.stake, { compact: false, maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                {wager.marketName ? (
                  <span className="hidden max-w-[120px] flex-shrink-0 truncate text-right text-[0.65rem] uppercase tracking-[0.25em] text-slate-500 sm:block">
                    {wager.marketName}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
