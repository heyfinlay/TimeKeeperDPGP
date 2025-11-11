import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Layers, Timer, TrendingUp } from 'lucide-react';
import BetslipDrawer from '@/components/betting/BetslipDrawer.jsx';
import PoolAnalytics from '@/components/betting/PoolAnalytics.jsx';
import { driverStats, useParimutuelStore } from '@/state/parimutuelStore.js';
import { formatCountdown, formatCurrency, formatPercent } from '@/utils/betting.js';

const HIGHLIGHTS = [
  {
    icon: Layers,
    title: 'Event-driven pools',
    copy: 'Track tote boards by race or vendor showdown with instant status updates.',
  },
  {
    icon: TrendingUp,
    title: 'Realtime odds pulses',
    copy: 'See returns shift as Diamonds land across every outcome.',
  },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

const findEventByMarketId = (events, marketId) =>
  events.find((event) => event.markets?.some((market) => market.id === marketId)) ?? null;

const normaliseStatus = (status) => {
  if (!status) return 'Scheduled';
  return String(status).replaceAll('_', ' ');
};

function useCountdown(target) {
  const [value, setValue] = useState(() => formatCountdown(target));
  useEffect(() => {
    setValue(formatCountdown(target));
    if (!target) {
      return undefined;
    }
    const timer = setInterval(() => setValue(formatCountdown(target)), 1000);
    return () => clearInterval(timer);
  }, [target]);
  return value;
}

function PoolDistributionModal({ open, onClose, market, stats, pool }) {
  const modalRef = useRef(null);
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    lastFocusedRef.current = document.activeElement;
    const current = modalRef.current;

    const focusFirst = () => {
      if (!current) return;
      const focusable = current.querySelectorAll(FOCUSABLE);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        current.focus();
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typeof onClose === 'function') {
          onClose();
        }
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      if (!current) {
        return;
      }
      const focusable = current.querySelectorAll(FOCUSABLE);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !current.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const timer = window.requestAnimationFrame(focusFirst);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(timer);
      document.removeEventListener('keydown', handleKeyDown);
      if (lastFocusedRef.current && typeof lastFocusedRef.current.focus === 'function') {
        lastFocusedRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => {
          if (typeof onClose === 'function') {
            onClose();
          }
        }}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pool distribution"
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-[#050a1a]/95 p-6 text-white shadow-[0_20px_60px_rgba(5,10,26,0.6)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Live pool distribution</span>
            <h3 className="text-xl font-semibold" title={market?.name}>
              {market?.name ?? 'Market'}
            </h3>
            <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">
              {normaliseStatus(market?.status)} · {stats.length} outcomes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close pool distribution"
          >
            ×
          </button>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-neutral-300">
          <span>Pool size</span>
          <span>{formatCurrency(pool?.total ?? market?.pool_total ?? 0, { compact: false, maximumFractionDigits: 0 })}</span>
        </div>
        <ul className="mt-4 flex flex-col gap-3">
          {stats.length === 0 ? (
            <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-neutral-500">
              No wagers yet. Pool distribution updates as soon as Diamonds land.
            </li>
          ) : (
            stats.map((entry) => (
              <li key={entry.outcomeId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between text-sm text-neutral-200">
                  <span className="truncate pr-3" title={entry.label}>
                    {entry.label}
                  </span>
                  <span>{formatPercent(entry.share)}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-[#7C6BFF] via-[#9FF7D3] to-[#dcd7ff]"
                    style={{ width: `${Math.min(100, Math.round(entry.share * 100))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  {formatCurrency(entry.total, { compact: false, maximumFractionDigits: 0 })} wagered · {entry.wagerCount}{' '}
                  bets
                </p>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function PageHeader({ onOpenBetslip, hasMarket }) {
  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">Diamond Sports Book</span>
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Markets & Tote</h1>
        <p className="text-sm text-neutral-300 sm:text-base">
          Follow live tote pools, track odds pulses, and pop open the betslip when you are ready to stake.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200 transition hover:border-white/30 hover:bg-white/10"
        >
          <Timer className="h-4 w-4 text-[#9FF7D3]" /> Realtime telemetry feed
        </button>
        <button
          type="button"
          onClick={onOpenBetslip}
          disabled={!hasMarket}
          className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/50 bg-[#9FF7D3]/15 px-4 py-2 text-xs uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/25 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
        >
          Open betslip <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[0.7rem] uppercase tracking-[0.3em] text-neutral-500">
        All wagers settle in Diamonds (in-game currency). Parody product only.
      </p>
    </header>
  );
}

function EventSummaryCard({ events, activeEventId, onSelectEvent, onOpenBetslip, supportsMarkets }) {
  const activeEvent = events.find((event) => event.id === activeEventId) ?? null;
  const countdown = useCountdown(activeEvent?.starts_at);
  return (
    <section className="tk-glass-panel flex flex-col gap-5 rounded-2xl p-5 md:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Event summary</span>
          {supportsMarkets ? null : (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-amber-200">
              Offline
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="markets-event" className="text-xs uppercase tracking-[0.3em] text-neutral-500">
            Event
          </label>
          <div className="relative">
            <select
              id="markets-event"
              value={activeEvent?.id ?? ''}
              onChange={(event) => onSelectEvent(event.target.value)}
              className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-4 pr-10 text-sm text-white transition focus:border-[#9FF7D3]/40 focus:outline-none focus:ring-2 focus:ring-[#9FF7D3]/20"
            >
              {events.map((event) => (
                <option key={event.id} value={event.id} className="bg-[#050a1a] text-white">
                  {event.title}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-neutral-500">⌄</span>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-300">
        <div className="flex min-w-[120px] flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Starts</span>
          <span className="font-semibold text-white">{countdown.label}</span>
          <span className="text-xs text-neutral-500">{countdown.detail}</span>
        </div>
        <div className="flex min-w-[120px] flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Markets</span>
          <span className="font-semibold text-white">{activeEvent?.markets?.length ?? 0}</span>
        </div>
        {activeEvent?.venue ? (
          <div className="flex min-w-[160px] flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Venue</span>
            <span className="truncate font-semibold text-white" title={activeEvent.venue}>
              {activeEvent.venue}
            </span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenBetslip}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-[#9FF7D3]/50 bg-[#9FF7D3]/15 px-4 py-3 text-xs uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/25 hover:text-white"
      >
        Build betslip <ArrowRight className="h-4 w-4" />
      </button>
    </section>
  );
}

function ActiveMarketCard({
  event,
  market,
  stats,
  pool,
  onSelectOutcome,
  onOpenBetslip,
  onOpenPool,
  onSelectMarket,
}) {
  const countdown = useCountdown(market?.closes_at);
  const marketOptions = Array.isArray(event?.markets) ? event.markets : [];
  return (
    <section className="tk-glass-panel flex flex-col gap-5 rounded-2xl p-5 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">
            <span>Active market</span>
            <span className="rounded-full bg-[#7C6BFF]/10 px-3 py-1 text-[0.65rem] text-[#7C6BFF]">
              {normaliseStatus(market?.status)}
            </span>
          </div>
          <h2 className="text-2xl font-semibold text-white" title={market?.name}>
            {market?.name ?? 'Select a market'}
          </h2>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="markets-market" className="text-xs uppercase tracking-[0.3em] text-neutral-500">
            Switch market
          </label>
          <div className="relative min-w-[200px]">
            <select
              id="markets-market"
              value={market?.id ?? ''}
              onChange={(event) => onSelectMarket(event.target.value)}
              className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-4 pr-10 text-sm text-white transition focus:border-[#9FF7D3]/40 focus:outline-none focus:ring-2 focus:ring-[#9FF7D3]/20"
            >
              {marketOptions.map((item) => (
                <option key={item.id} value={item.id} className="bg-[#050a1a] text-white">
                  {item.name}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-neutral-500">⌄</span>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-300">
        <div className="flex min-w-[120px] flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Time left</span>
          <span className="font-semibold text-white">{countdown.label}</span>
          <span className="text-xs text-neutral-500">{countdown.detail}</span>
        </div>
        <div className="flex min-w-[120px] flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Pool size</span>
          <span className="font-semibold text-white">
            {formatCurrency(pool?.total ?? market?.pool_total ?? 0, { compact: false, maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {stats.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-neutral-500">
            No wagers yet. Tap an outcome to be the first in the pool.
          </p>
        ) : (
          stats.map((entry) => {
            const matchedOutcome = market?.outcomes?.find((item) => item.id === entry.outcomeId);
            const swatch = matchedOutcome?.color ?? '#9FF7D3';
            return (
              <button
                key={entry.outcomeId}
            type="button"
            onClick={() => onSelectOutcome(entry)}
            className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition hover:border-[#9FF7D3]/40 hover:bg-[#9FF7D3]/10"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: swatch }}
                aria-hidden="true"
              />
              <span className="truncate text-sm font-medium text-white" title={entry.label}>
                {entry.label}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1 text-sm text-neutral-300">
              <span className="font-semibold text-white">{formatPercent(entry.share)}</span>
              <span className="text-xs text-neutral-500">
                {formatCurrency(entry.total, { compact: false, maximumFractionDigits: 0 })}
              </span>
            </span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-300">
        <button
          type="button"
          onClick={onOpenPool}
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:text-white"
        >
          Live pool distribution
        </button>
        <button
          type="button"
          onClick={onOpenBetslip}
          className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/50 bg-[#9FF7D3]/15 px-4 py-2 text-xs uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/25 hover:text-white"
        >
          Open betslip <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

function HighlightsSection() {
  return (
    <section className="hidden md:grid md:grid-cols-2 md:gap-4">
      {HIGHLIGHTS.map((item) => (
        <article
          key={item.title}
          className="tk-glass-panel flex flex-col gap-3 rounded-2xl p-5 text-sm text-neutral-300"
        >
          <div className="flex items-center gap-3 text-white">
            <item.icon className="h-5 w-5 text-[#9FF7D3]" />
            <h3 className="text-base font-semibold">{item.title}</h3>
          </div>
          <p>{item.copy}</p>
        </article>
      ))}
    </section>
  );
}

export default function MarketsLanding() {
  const {
    state: { status, events, supportsMarkets, pools, selectedEventId, selectedMarketId },
    actions,
  } = useParimutuelStore();

  const [activeEventId, setActiveEventId] = useState(null);
  const [isBetslipOpen, setIsBetslipOpen] = useState(false);
  const [drawerOutcomeId, setDrawerOutcomeId] = useState(null);
  const [isPoolModalOpen, setIsPoolModalOpen] = useState(false);

  useEffect(() => {
    if (status === 'idle') {
      void actions.loadEvents();
    }
  }, [status, actions]);

  useEffect(() => {
    if (!events.length) {
      setActiveEventId(null);
      return;
    }
    if (selectedEventId && events.some((event) => event.id === selectedEventId)) {
      setActiveEventId(selectedEventId);
      return;
    }
    const fallback = events[0]?.id ?? null;
    setActiveEventId(fallback);
    if (fallback) {
      actions.selectEvent(fallback);
    }
  }, [events, selectedEventId, actions]);

  const activeEvent = useMemo(
    () => events.find((event) => String(event.id) === String(activeEventId)) ?? null,
    [events, activeEventId],
  );

  const activeMarket = useMemo(() => {
    if (!activeEvent) {
      return null;
    }
    const candidate =
      activeEvent.markets?.find((market) => String(market.id) === String(selectedMarketId)) ?? null;
    return candidate ?? activeEvent.markets?.[0] ?? null;
  }, [activeEvent, selectedMarketId]);

  useEffect(() => {
    if (!activeEvent) {
      return;
    }
    const markets = Array.isArray(activeEvent.markets) ? activeEvent.markets : [];
    if (markets.length === 0) {
      return;
    }
    const hasSelected = markets.some((market) => String(market.id) === String(selectedMarketId));
    if (!hasSelected) {
      actions.selectMarket(markets[0].id);
    }
  }, [activeEvent, selectedMarketId, actions]);

  const activePool = activeMarket ? pools[activeMarket.id] ?? null : null;
  const stats = useMemo(() => driverStats(activeMarket, activePool), [activeMarket, activePool]);

  const handleSelectEvent = (eventId) => {
    const resolvedEvent = events.find((item) => String(item.id) === String(eventId)) ?? null;
    const resolvedId = resolvedEvent?.id ?? eventId;
    setActiveEventId(resolvedId);
    actions.selectEvent(resolvedId);
    const firstMarket = resolvedEvent?.markets?.[0];
    if (firstMarket) {
      actions.selectMarket(firstMarket.id);
    }
  };

  const handleSelectMarket = (marketId) => {
    if (!activeEvent) {
      return;
    }
    const nextMarket = activeEvent.markets?.find((item) => String(item.id) === String(marketId));
    if (!nextMarket) {
      return;
    }
    actions.selectMarket(nextMarket.id);
  };

  const openBetslip = (market, outcome) => {
    if (!market) {
      return;
    }
    const hostEvent = findEventByMarketId(events, market.id);
    if (hostEvent) {
      setActiveEventId(hostEvent.id);
      actions.selectEvent(hostEvent.id);
    }
    actions.selectMarket(market.id);
    setDrawerOutcomeId(outcome?.outcomeId ?? outcome?.id ?? null);
    setIsBetslipOpen(true);
  };

  const handleOpenPool = () => {
    setIsPoolModalOpen(true);
  };

  const handleClosePool = () => {
    setIsPoolModalOpen(false);
  };

  const handleCloseBetslip = () => {
    setIsBetslipOpen(false);
  };

  const hasMarket = Boolean(activeMarket);

  return (
    <div className="tk-markets-shell w-full">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 md:px-6">
        <PageHeader onOpenBetslip={() => openBetslip(activeMarket, null)} hasMarket={hasMarket} />
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {activeEvent ? (
              <EventSummaryCard
                events={events}
                activeEventId={activeEvent.id}
                onSelectEvent={handleSelectEvent}
                onOpenBetslip={() => openBetslip(activeMarket, null)}
                supportsMarkets={supportsMarkets}
              />
            ) : null}
            {activeEvent && activeMarket ? (
              <ActiveMarketCard
                event={activeEvent}
                market={activeMarket}
                stats={stats}
                pool={activePool}
                onSelectOutcome={(entry) => openBetslip(activeMarket, entry)}
                onOpenBetslip={() => openBetslip(activeMarket, null)}
                onOpenPool={handleOpenPool}
                onSelectMarket={handleSelectMarket}
              />
            ) : null}
            <HighlightsSection />
          </div>
          <div className="flex flex-col gap-6 md:sticky md:top-6">
            <button
              type="button"
              onClick={() => openBetslip(activeMarket, null)}
              disabled={!hasMarket}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#9FF7D3]/50 bg-[#9FF7D3]/15 px-4 py-3 text-xs uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/25 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
            >
              Open betslip <ArrowRight className="h-4 w-4" />
            </button>
            <PoolAnalytics marketId={activeMarket?.id} />
          </div>
        </div>
      </div>
      <BetslipDrawer
        open={isBetslipOpen}
        onClose={handleCloseBetslip}
        marketId={activeMarket?.id}
        outcomeId={drawerOutcomeId}
      />
      <PoolDistributionModal
        open={isPoolModalOpen}
        onClose={handleClosePool}
        market={activeMarket}
        stats={stats}
        pool={activePool}
      />
    </div>
  );
}
