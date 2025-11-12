import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCcw, User, Clock } from 'lucide-react';
import {
  isSupabaseConfigured,
  supabaseSelect,
  subscribeToTable,
  isTableMissingError,
} from '@/lib/supabaseClient.js';
import { formatCurrency, formatRelativeTime } from '@/utils/betting.js';

const DEFAULT_LIMIT = 20;

const generateFallbackId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wager-${Math.random().toString(36).slice(2)}`;
};

const normalizeRow = (row) => {
  const profile = row?.profiles ?? null;
  const alias = profile?.display_name || profile?.handle || 'Anonymous';
  const outcome = row?.outcomes ?? null;
  return {
    id: row?.id ?? generateFallbackId(),
    alias,
    stake: Number(row?.stake ?? 0),
    outcomeLabel: outcome?.label || 'Outcome',
    placedAt: row?.placed_at ?? null,
    marketId: row?.market_id ?? null,
  };
};

const buildStatusLabel = ({ isLoading, wagers }) => {
  if (isLoading && wagers.length === 0) {
    return 'Syncing wagers…';
  }
  const latest = wagers[0]?.placedAt ?? null;
  if (!latest) {
    return 'Awaiting wagers';
  }
  return `Updated ${formatRelativeTime(latest)}`;
};

export default function LiveBetsFeed({ marketId = null, limit = DEFAULT_LIMIT, className = '' }) {
  const [wagers, setWagers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [supportsRealtime, setSupportsRealtime] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);

  const loadWagers = useCallback(async () => {
    if (!isSupabaseConfigured || !marketId) {
      setSupportsRealtime(isSupabaseConfigured);
      setWagers([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const rows = await supabaseSelect('wagers', {
        select:
          'id,stake,placed_at,market_id,outcome_id,profiles:profiles!wagers_user_id_fkey(handle,display_name),outcomes(label)',
        filters: { limit: String(limit), market_id: `eq.${marketId}` },
        order: { column: 'placed_at', ascending: false },
      });
      const normalized = Array.isArray(rows) ? rows.map(normalizeRow) : [];
      setWagers(normalized);
      setSupportsRealtime(true);
      setError(null);
    } catch (caught) {
      if (isTableMissingError(caught, 'wagers')) {
        setSupportsRealtime(false);
        setWagers([]);
        setError(null);
      } else {
        console.error('Failed to load live wagers', caught);
        setError(caught);
      }
    } finally {
      setIsLoading(false);
    }
  }, [limit, marketId]);

  useEffect(() => {
    void loadWagers();
  }, [loadWagers]);

  useEffect(() => {
    if (!marketId || !isSupabaseConfigured || !supportsRealtime) {
      return undefined;
    }

    const unsubscribe = subscribeToTable(
      { schema: 'public', table: 'wagers', event: '*', filter: `market_id=eq.${marketId}` },
      () => {
        void loadWagers();
      },
      { maxRetries: 3 },
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [marketId, supportsRealtime, loadWagers]);

  const statusLabel = useMemo(() => buildStatusLabel({ isLoading, wagers }), [isLoading, wagers]);

  const containerClasses = [
    'tk-glass-panel flex flex-col gap-4 rounded-2xl border border-accent-emerald/15 bg-shell-900/85 p-6',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  let body = null;

  if (!isSupabaseConfigured) {
    body = (
      <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
        Supabase is not configured, so live wagers are unavailable.
      </p>
    );
  } else if (!marketId) {
    body = (
      <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
        Choose a market to begin streaming wager activity.
      </p>
    );
  } else if (!supportsRealtime) {
    body = (
      <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
        This environment does not support live wagers. Historical data will appear once bets are placed.
      </p>
    );
  } else if (error) {
    body = (
      <div className="flex flex-col gap-3 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
        <span>Unable to load the latest wagers.</span>
        <button
          type="button"
          onClick={() => {
            void loadWagers();
          }}
          className="inline-flex items-center gap-2 self-start rounded-full border border-red-500/40 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-red-200 transition-colors duration-150 hover:border-red-400 hover:text-white"
        >
          <RefreshCcw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  } else if (isLoading && wagers.length === 0) {
    body = (
      <p className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm text-slate-300">
        Loading wagers…
      </p>
    );
  } else if (wagers.length === 0) {
    body = (
      <p className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 px-4 py-3 text-sm text-slate-400">
        No bets have been placed on this market yet.
      </p>
    );
  } else {
    body = (
      <div className="overflow-hidden rounded-xl border border-accent-emerald/15">
        <table className="min-w-full divide-y divide-shell-800/80 text-left text-sm text-slate-200">
          <thead className="bg-shell-800/80 text-xs uppercase tracking-[0.25em] text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Bettor
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Wager
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Outcome
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Placed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-shell-800/60">
            {wagers.map((wager) => {
              const timestamp = wager.placedAt ? new Date(wager.placedAt) : null;
              const timestampLabel = timestamp ? timestamp.toLocaleString() : 'Unknown';
              return (
                <tr key={wager.id} className="bg-shell-900/30 text-sm text-slate-300">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-white">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-shell-800/80 text-xs font-semibold uppercase text-accent-emerald">
                        <User className="h-4 w-4" />
                      </span>
                      <span className="truncate" title={wager.alias}>
                        {wager.alias}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">
                    {formatCurrency(wager.stake, { compact: false, maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-3 text-white">{wager.outcomeLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    <span className="flex items-center gap-2" title={timestampLabel}>
                      <Clock className="h-3.5 w-3.5" />
                      {formatRelativeTime(wager.placedAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className={containerClasses} aria-live="polite">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-accent-emerald">
          <Activity className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.35em]">Live Bets</span>
        </div>
        <span className="text-xs text-slate-500">{statusLabel}</span>
      </header>
      {body}
    </section>
  );
}
