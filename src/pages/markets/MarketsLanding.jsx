import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ArrowRight, Layers, Timer, TrendingUp } from 'lucide-react';
import BetslipDrawer from '@/components/betting/BetslipDrawer.jsx';
import PoolAnalytics from '@/components/betting/PoolAnalytics.jsx';
import { driverStats, useParimutuelStore } from '@/state/parimutuelStore.js';
import { formatCountdown, formatCurrency, formatOdds, formatPercent } from '@/utils/betting.js';
import { resolveOutcomeIdentity } from '@/utils/outcomes.js';

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
        className="relative z-10 w-full max-w-lg rounded-2xl border border-accent-emerald/15 bg-shell-900/95 p-6 text-white shadow-shell-card"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Live pool distribution</span>
            <h3 className="text-xl font-semibold" title={market?.name}>
              {market?.name ?? 'Market'}
            </h3>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {normaliseStatus(market?.status)} · {stats.length} outcomes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-full p-2 text-slate-400 transition-colors duration-200 ease-out-back hover:bg-shell-800/70 hover:text-white"
            aria-label="Close pool distribution"
          >
            ×
          </button>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3 text-sm text-slate-300">
          <span>Pool size</span>
          <span>{formatCurrency(pool?.total ?? market?.pool_total ?? 0, { compact: false, maximumFractionDigits: 0 })}</span>
        </div>
        <ul className="mt-4 flex flex-col gap-3">
          {stats.length === 0 ? (
            <li className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 p-3 text-sm text-slate-500">
              No wagers yet. Pool distribution updates as soon as Diamonds land.
            </li>
          ) : (
            stats.map((entry) => (
              <li key={entry.outcomeId} className="rounded-xl border border-accent-emerald/15 bg-shell-800/60 p-3">
                <div className="flex items-center justify-between text-sm text-slate-200">
                  <span className="truncate pr-3" title={entry.label}>
                    {entry.label}
                  </span>
                  <span>{formatPercent(entry.share)}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-shell-900/70">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-accent-blue via-accent-emerald to-accent-ocean"
                    style={{ width: `${Math.min(100, Math.round(entry.share * 100))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
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
      <div className="flex flex-col gap-3">
        <span className="text-xs uppercase tracking-[0.35em] text-accent-emerald">Diamond Sports Book</span>
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Markets & Tote</h1>
        <p className="text-sm text-slate-300 sm:text-base">
          Follow live tote pools, track odds pulses, and pop open the betslip when you are ready to stake.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="interactive-cta inline-flex items-center gap-2 rounded-full border border-accent-blue/25 bg-shell-800/60 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 hover:text-white"
        >
          <Timer className="h-4 w-4 text-accent-blue" /> Realtime telemetry feed
        </button>
        <button
          type="button"
          onClick={onOpenBetslip}
          disabled={!hasMarket}
          className="interactive-cta inline-flex items-center gap-2 rounded-full border border-accent-emerald/50 bg-accent-emerald/15 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent-emerald hover:border-accent-emerald/70 hover:bg-accent-emerald/20 hover:text-white disabled:cursor-not-allowed disabled:border-slate-600/40 disabled:bg-slate-800/60 disabled:text-slate-500"
        >
          Open betslip <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[0.7rem] uppercase tracking-[0.3em] text-slate-500">
        All wagers settle in Diamonds (in-game currency). Parody product only.
      </p>
    </header>
  );
}

function EventSummaryCard({ events, activeEventId, onSelectEvent, onOpenBetslip, supportsMarkets }) {
  const activeEvent = events.find((event) => event.id === activeEventId) ?? null;
  const countdown = useCountdown(activeEvent?.starts_at);
  return (
    <section className="tk-glass-panel interactive-card flex flex-col gap-6 rounded-2xl p-6">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.35em] text-accent-blue">Event summary</span>
          {supportsMarkets ? null : (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-amber-200">
              Offline
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <label htmlFor="markets-event" className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Event
          </label>
          <div className="relative">
            <select
              id="markets-event"
              value={activeEvent?.id ?? ''}
              onChange={(event) => onSelectEvent(event.target.value)}
              className="focus-ring w-full appearance-none rounded-xl border border-accent-emerald/15 bg-shell-800/60 py-3 pl-4 pr-10 text-sm text-white transition-colors duration-200 ease-out-back hover:border-accent-emerald/30"
            >
              {events.map((event) => (
                <option key={event.id} value={event.id} className="bg-shell-900 text-white">
                  {event.title}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">⌄</span>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <div className="flex min-w-[120px] flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Starts</span>
          <span className="font-semibold text-white">{countdown.label}</span>
          <span className="text-xs text-slate-500">{countdown.detail}</span>
        </div>
        <div className="flex min-w-[120px] flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Markets</span>
          <span className="font-semibold text-white">{activeEvent?.markets?.length ?? 0}</span>
        </div>
        {activeEvent?.venue ? (
          <div className="flex min-w-[160px] flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Venue</span>
            <span className="truncate font-semibold text-white" title={activeEvent.venue}>
              {activeEvent.venue}
            </span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenBetslip}
        className="interactive-cta inline-flex items-center justify-center gap-2 rounded-full border border-accent-emerald/50 bg-accent-emerald/15 px-4 py-3 text-xs uppercase tracking-[0.3em] text-accent-emerald hover:border-accent-emerald/70 hover:bg-accent-emerald/20 hover:text-white"
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
  const totalPool = Number(pool?.total ?? market?.pool_total ?? 0);
  const rakeBps = Number.isFinite(Number(pool?.rakeBps ?? market?.rake_bps))
    ? Number(pool?.rakeBps ?? market?.rake_bps)
    : 0;
  const rakeRatio = Math.min(Math.max(rakeBps / 10000, 0), 1);
  const payoutRate = Math.max(0, 1 - rakeRatio);
  const netPool = Math.max(0, totalPool * payoutRate);
  return (
    <section className="tk-glass-panel interactive-card flex flex-col gap-6 rounded-2xl p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-accent-blue">
            <span>Active market</span>
            <span className="rounded-full bg-accent-blue/15 px-3 py-1 text-[0.65rem] text-accent-blue">
              {normaliseStatus(market?.status)}
            </span>
          </div>
          <h2 className="text-2xl font-semibold text-white" title={market?.name}>
            {market?.name ?? 'Select a market'}
          </h2>
        </div>
        <div className="flex flex-col gap-3">
          <label htmlFor="markets-market" className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Switch market
          </label>
          <div className="relative min-w-[200px]">
            <select
              id="markets-market"
              value={market?.id ?? ''}
              onChange={(event) => onSelectMarket(event.target.value)}
              className="focus-ring w-full appearance-none rounded-xl border border-accent-emerald/15 bg-shell-800/60 py-3 pl-4 pr-10 text-sm text-white transition-colors duration-200 ease-out-back hover:border-accent-emerald/30"
            >
              {marketOptions.map((item) => (
                <option key={item.id} value={item.id} className="bg-shell-900 text-white">
                  {item.name}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">⌄</span>
          </div>
        </div>
      </header>
      <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-2 rounded-2xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Time left</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-white">{countdown.label}</span>
            <span className="text-xs text-slate-500">{countdown.detail}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-3">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Pool size</span>
          <span className="text-2xl font-semibold text-white">
            {formatCurrency(totalPool, { compact: false, maximumFractionDigits: 0 })}
          </span>
          <span className="text-xs text-slate-500">
            Net {formatCurrency(netPool, { compact: false, maximumFractionDigits: 0 })} after rake
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {stats.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-accent-emerald/15 bg-shell-800/40 px-4 py-6 text-center text-sm text-slate-500">
            No wagers yet. Odds appear the moment the first Diamond is staked.
          </p>
        ) : (
          stats.map((entry, index) => {
            const matchedOutcome = market?.outcomes?.find((item) => item.id === entry.outcomeId);
            const themedOutcome = matchedOutcome ?? { label: entry.label, color: '#5FF2C7' };
            const identity = resolveOutcomeIdentity(
              { ...themedOutcome, label: entry.label },
              { fallbackIndex: index },
            );
            const badgeStyle = {
              backgroundImage: `linear-gradient(135deg, ${identity.primaryColor}, ${identity.secondaryColor})`,
            };
            return (
              <button
                key={entry.outcomeId}
                type="button"
                onClick={() => onSelectOutcome(entry)}
                className="focus-ring group flex items-center gap-4 rounded-2xl border border-accent-emerald/15 bg-shell-800/60 px-4 py-4 text-left transition-all duration-200 ease-out-back motion-safe:hover:-translate-y-[1px] motion-safe:hover:border-accent-emerald/40 motion-safe:hover:bg-accent-emerald/10"
              >
                <span
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-sm font-semibold uppercase tracking-wide text-white shadow-lg shadow-black/30"
                  style={badgeStyle}
                  aria-hidden="true"
                >
                  {identity.abbreviation}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white" title={entry.label}>
                    {entry.label}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span>{formatPercent(entry.share)}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>{entry.wagerCount ?? 0} bets</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-right">
                  <span className="text-lg font-semibold text-accent-emerald">
                    {formatOdds(entry.odds)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatCurrency(entry.total, { compact: false, maximumFractionDigits: 0 })} Diamonds
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        {market?.id ? (
          <Link
            to={`/markets/${market.id}`}
            className="interactive-cta inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-xs uppercase tracking-[0.3em] text-accent-blue hover:border-accent-blue/30 hover:text-white"
          >
            View market page
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onOpenPool}
          className="interactive-cta inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-xs uppercase tracking-[0.3em] text-accent-emerald hover:border-accent-emerald/30 hover:text-white"
        >
          Live pool distribution
        </button>
        <button
          type="button"
          onClick={onOpenBetslip}
          className="interactive-cta inline-flex items-center gap-2 rounded-full border border-accent-emerald/50 bg-accent-emerald/15 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent-emerald hover:border-accent-emerald/70 hover:bg-accent-emerald/20 hover:text-white"
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
          className="tk-glass-panel interactive-card flex flex-col gap-3 rounded-2xl p-6 text-sm text-slate-300"
        >
          <div className="flex items-center gap-3 text-white">
            <item.icon className="h-5 w-5 text-accent-emerald" />
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
              className="interactive-cta inline-flex w-full items-center justify-center gap-2 rounded-full border border-accent-emerald/50 bg-accent-emerald/15 px-4 py-3 text-xs uppercase tracking-[0.3em] text-accent-emerald hover:border-accent-emerald/70 hover:bg-accent-emerald/20 hover:text-white disabled:cursor-not-allowed disabled:border-slate-600/40 disabled:bg-slate-800/60 disabled:text-slate-500"
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
