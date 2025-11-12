import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock } from 'lucide-react';
import PoolAnalytics from '@/components/betting/PoolAnalytics.jsx';
import LiveBetsFeed from '@/components/markets/LiveBetsFeed.jsx';
import { useParimutuelStore } from '@/state/parimutuelStore.js';
import { formatCurrency, formatCountdown } from '@/utils/betting.js';

const findMarketById = (events, marketId) => {
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

const findEventForMarket = (events, marketId) => {
  if (!marketId) {
    return null;
  }
  return events.find((event) => event.markets?.some((market) => String(market.id) === String(marketId))) ?? null;
};

export default function MarketPage() {
  const { marketId: routeMarketId } = useParams();
  const {
    state: { events, status, supportsMarkets, selectedEventId, selectedMarketId, pools },
    actions,
  } = useParimutuelStore();

  useEffect(() => {
    if (status === 'idle') {
      void actions.loadEvents();
    }
  }, [status, actions]);

  const resolvedMarketId = useMemo(
    () => routeMarketId ?? selectedMarketId ?? null,
    [routeMarketId, selectedMarketId],
  );

  const market = useMemo(
    () => findMarketById(events, resolvedMarketId),
    [events, resolvedMarketId],
  );

  const parentEvent = useMemo(
    () => findEventForMarket(events, market?.id ?? resolvedMarketId),
    [events, market?.id, resolvedMarketId],
  );

  useEffect(() => {
    if (!market?.id) {
      return;
    }
    if (market.id !== selectedMarketId) {
      actions.selectMarket(market.id);
    }
    if (parentEvent?.id && parentEvent.id !== selectedEventId) {
      actions.selectEvent(parentEvent.id);
    }
  }, [market?.id, parentEvent?.id, actions, selectedMarketId, selectedEventId]);

  const pool = market ? pools?.[market.id] ?? null : null;
  const handle = formatCurrency(pool?.total ?? market?.pool_total ?? 0, {
    compact: false,
    maximumFractionDigits: 0,
  });
  const countdown = formatCountdown(market?.closes_at ?? null);

  if (!supportsMarkets) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <section className="tk-glass-panel flex flex-col gap-4 rounded-2xl border border-accent-emerald/20 bg-shell-900/85 p-6 text-sm text-slate-300">
          <h1 className="text-2xl font-semibold text-white">Markets unavailable</h1>
          <p>Realtime betting is disabled because Supabase is not configured for this environment.</p>
        </section>
      </main>
    );
  }

  if (status === 'loading' || (status === 'idle' && !market)) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <section className="tk-glass-panel flex flex-col gap-3 rounded-2xl border border-accent-emerald/20 bg-shell-900/85 p-6 text-sm text-slate-300">
          <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Loading market</span>
          <p>Fetching market details…</p>
        </section>
      </main>
    );
  }

  if (!market) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <section className="tk-glass-panel flex flex-col gap-4 rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-sm text-red-200">
          <h1 className="text-2xl font-semibold text-white">Market not found</h1>
          <p>We couldn&apos;t locate the requested market. It may have been closed or removed.</p>
          <Link
            to="/markets"
            className="inline-flex items-center gap-2 self-start rounded-full border border-red-500/40 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-red-200 transition-colors duration-150 hover:border-red-400 hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" /> Back to markets
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Link
        to="/markets"
        className="inline-flex w-max items-center gap-2 text-xs uppercase tracking-[0.3em] text-accent-emerald transition-colors duration-150 hover:text-white"
      >
        <ArrowLeft className="h-3 w-3" /> Back to markets
      </Link>

      <section className="tk-glass-panel flex flex-col gap-4 rounded-2xl border border-accent-emerald/20 bg-shell-900/90 p-6 text-slate-300">
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Market overview</span>
          <h1 className="text-3xl font-semibold text-white">{market.name ?? 'Market'}</h1>
          {parentEvent ? (
            <p className="text-sm text-slate-400">Part of {parentEvent.title ?? 'event'}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span>
            Handle <span className="font-semibold text-white">{handle}</span>
          </span>
          <span className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> {countdown.label}
          </span>
          <span className="text-slate-500">{countdown.detail}</span>
        </div>
      </section>

      <PoolAnalytics marketId={market.id} />

      <LiveBetsFeed marketId={market.id} />
    </main>
  );
}
