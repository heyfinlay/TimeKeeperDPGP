import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Layers, Timer, TrendingUp } from 'lucide-react';
import MarketCard from '@/components/betting/MarketCard.jsx';
import Betslip from '@/components/betting/Betslip.jsx';
import { driverStats, useParimutuelStore } from '@/state/parimutuelStore.js';
import { formatCurrency, formatPercent } from '@/utils/betting.js';

const highlights = [
  {
    icon: Layers,
    title: 'Event-driven pools',
    copy: 'Group wagers by race, rumble, or vendor showdown to follow tote movement at a glance.',
  },
  {
    icon: TrendingUp,
    title: 'Realtime odds pulses',
    copy: 'Watch estimated payouts shift every few seconds as Diamonds land across each outcome.',
  },
];

export default function MarketsLanding() {
  const {
    state: { status, events, supportsMarkets, error, pools, selectedEventId, selectedMarketId, placement },
    actions,
  } = useParimutuelStore();
  const [activeEventId, setActiveEventId] = useState(null);
  const [isBetslipOpen, setIsBetslipOpen] = useState(false);

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
    () => events.find((event) => event.id === activeEventId) ?? null,
    [events, activeEventId],
  );
  const activeMarkets = Array.isArray(activeEvent?.markets) ? activeEvent.markets : [];

  useEffect(() => {
    if (!activeEvent || !activeMarkets.length) {
      return;
    }
    const hasSelectedInEvent = activeMarkets.some((market) => market.id === selectedMarketId);
    if (!hasSelectedInEvent) {
      const fallback = activeMarkets[0]?.id;
      if (fallback) {
        actions.selectMarket(fallback);
      }
    }
  }, [activeEvent, activeMarkets, selectedMarketId, actions]);

  const activeMarket = useMemo(() => {
    if (!activeEvent) {
      return null;
    }
    const found = activeMarkets.find((market) => market.id === selectedMarketId);
    return found ?? activeMarkets[0] ?? null;
  }, [activeEvent, activeMarkets, selectedMarketId]);

  const activePool = activeMarket ? pools[activeMarket.id] : null;
  const marketStats = useMemo(() => driverStats(activeMarket, activePool), [activeMarket, activePool]);
  const recentActivity = useMemo(() => {
    if (!activeMarket) {
      return [];
    }
    const activity = [];
    if (placement?.lastWager && placement.lastWager.marketId === activeMarket.id) {
      const matchedOutcome = activeMarket.outcomes?.find((item) => item.id === placement.lastWager.outcomeId) ?? null;
      activity.push({
        id: placement.lastWager.id ?? `last-${placement.lastWager.outcomeId}`,
        title: `${formatCurrency(placement.lastWager.stake, { compact: false, maximumFractionDigits: 0 })} dropped on ${
          matchedOutcome?.label ?? 'an outcome'
        }`,
        detail: 'Moments ago',
      });
    }
    marketStats.slice(0, 3).forEach((entry) => {
      activity.push({
        id: `share-${entry.outcomeId}`,
        title: `${entry.label} holding ${formatPercent(entry.share)}`,
        detail: `${formatCurrency(entry.total, { compact: false, maximumFractionDigits: 0 })} across ${
          entry.wagerCount
        } bets`,
      });
    });
    return activity;
  }, [activeMarket, marketStats, placement?.lastWager]);

  const isLoading = status === 'loading';
  const hasLiveData = useMemo(
    () => supportsMarkets && events.some((event) => Array.isArray(event.markets) && event.markets.length > 0),
    [supportsMarkets, events],
  );

  const handleSelectEvent = (eventId) => {
    setActiveEventId(eventId);
    actions.selectEvent(eventId);
  };

  const handleSelectMarket = (eventId, marketId) => {
    handleSelectEvent(eventId);
    actions.selectMarket(marketId);
    setIsBetslipOpen(true);
  };

  const handleOpenBetslip = () => {
    if (!activeEvent || !activeMarket) {
      return;
    }
    actions.selectEvent(activeEvent.id);
    actions.selectMarket(activeMarket.id);
    setIsBetslipOpen(true);
  };

  const handleCloseBetslip = () => {
    setIsBetslipOpen(false);
  };

  const eventStatus = activeEvent?.status ? String(activeEvent.status).replaceAll('_', ' ') : 'Scheduled';

  return (
    <div className="tk-markets-shell relative min-h-screen w-full overflow-hidden px-4 py-12 sm:px-6 lg:px-10">
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_110%,rgba(124,107,255,0.22)_0%,rgba(12,20,45,0.3)_55%,rgba(7,12,28,0.88)_100%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-6">
          <span className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">Diamond Sports Book</span>
          <h1 className="text-4xl font-semibold text-white sm:text-5xl">Markets and tote boards</h1>
          <p className="max-w-2xl text-sm text-neutral-300 sm:text-base">
            Follow the tote in real time, see how the pool is stacking up, and open the betslip when you want to take a shot.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em]">
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-neutral-400">
              <Timer className="h-4 w-4 text-[#9FF7D3]" />
              <span>Realtime telemetry feed</span>
            </div>
            <button
              type="button"
              onClick={handleOpenBetslip}
              disabled={!activeMarket}
              className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/50 bg-[#9FF7D3]/10 px-4 py-2 text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/20 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
            >
              Open betslip <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-neutral-500">
            All wagers settled in Diamonds (in-game currency). Parody product; no real-world stakes.
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,280px)_1fr]">
          <aside className="tk-glass-panel flex flex-col gap-5 rounded-xl p-6">
            <header className="flex flex-col gap-2">
              <span className="text-[0.65rem] uppercase tracking-[0.35em] text-[#9FF7D3]">Live schedule</span>
              <h2 className="text-lg font-semibold text-white">Events</h2>
              <p className="text-xs text-neutral-400">Tap through the card to preview markets and pools.</p>
            </header>
            <div className="flex flex-col gap-2">
              {supportsMarkets ? null : (
                <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                  Supabase connection missing. Markets run in offline mode.
                </p>
              )}
              {events.map((event) => {
                const isActive = event.id === activeEventId;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => handleSelectEvent(event.id)}
                    className={`group flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition ${
                      isActive
                        ? 'border-[#9FF7D3]/60 bg-[#9FF7D3]/10 text-white shadow-[0_0_30px_rgba(124,107,255,0.25)]'
                        : 'border-white/5 text-neutral-300 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    <span className="text-[0.55rem] uppercase tracking-[0.4em] text-[#7C6BFF]">Event</span>
                    <span className="text-sm font-semibold text-white">{event.title}</span>
                    <span className="text-xs text-neutral-500">
                      {event.venue ? `${event.venue} · ` : ''}
                      {event.starts_at ? new Date(event.starts_at).toLocaleString() : 'Schedule TBC'}
                    </span>
                  </button>
                );
              })}
              {!events.length && !isLoading ? (
                <p className="rounded-lg border border-dashed border-white/10 p-4 text-xs text-neutral-400">
                  No events are currently scheduled. Check back soon for new races and rumbles.
                </p>
              ) : null}
            </div>
          </aside>

          <div className="flex flex-col gap-6">
            {activeEvent ? (
              <div className="tk-glass-panel flex flex-col gap-4 rounded-xl border border-white/10 p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Event</span>
                    <h2 className="text-2xl font-semibold text-white">{activeEvent.title}</h2>
                    <p className="text-sm text-neutral-400">
                      {activeEvent.venue ? `${activeEvent.venue} · ` : ''}
                      {activeEvent.starts_at ? new Date(activeEvent.starts_at).toLocaleString() : 'Schedule TBC'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-white/5 px-4 py-1 text-xs uppercase tracking-[0.2em] text-neutral-300">
                    <Timer className="h-4 w-4 text-[#9FF7D3]" />
                    <span className="capitalize">{eventStatus}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em]">
                  <button
                    type="button"
                    onClick={handleOpenBetslip}
                    disabled={!activeMarket}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/20 hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/5 disabled:text-neutral-500"
                  >
                    Build betslip <ArrowRight className="h-4 w-4" />
                  </button>
                  <span className="text-neutral-500">
                    {activeMarket ? `${activeMarkets.length} markets live` : 'No active markets'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="tk-glass-panel flex flex-col gap-4 rounded-2xl border border-dashed border-white/10 p-6 text-sm text-neutral-400">
                <p className="font-semibold text-white">Select an event to see live pools.</p>
                <p>We will surface tote boards and odds the moment betting opens.</p>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-4 py-2 text-sm text-neutral-300">
                <Timer className="h-4 w-4 animate-spin text-[#9FF7D3]" /> Loading live markets...
              </div>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>
            ) : null}

            {hasLiveData && activeEvent ? (
              activeMarkets.length ? (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,2.2fr)_minmax(260px,1fr)]">
                  <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
                    {activeMarkets.map((market) => (
                      <MarketCard
                        key={market.id}
                        market={market}
                        pool={pools[market.id]}
                        onSelect={() => handleSelectMarket(activeEvent.id, market.id)}
                        ctaLabel="Open betslip"
                      />
                    ))}
                  </div>
                  <aside className="tk-glass-panel flex h-full flex-col gap-4 rounded-xl border border-white/10 p-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-[0.55rem] uppercase tracking-[0.4em] text-[#9FF7D3]">Live feed</span>
                      <h3 className="text-lg font-semibold text-white">Recent pool action</h3>
                    </div>
                    {recentActivity.length ? (
                      <ul className="flex flex-col gap-3 text-sm text-neutral-300">
                        {recentActivity.map((item) => (
                          <li key={item.id} className="flex flex-col gap-1 rounded-lg border border-white/5 bg-white/5 px-4 py-3">
                            <span className="font-semibold text-white">{item.title}</span>
                            <span className="text-xs uppercase tracking-[0.2em] text-neutral-500">{item.detail}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-white/10 p-4 text-xs text-neutral-400">
                        Pool movement will appear here the moment wagers hit the tote.
                      </p>
                    )}
                  </aside>
                </div>
              ) : (
                <div className="tk-glass-panel flex flex-col gap-3 rounded-xl border border-dashed border-white/10 p-6 text-sm text-neutral-400">
                  <p className="font-semibold text-white">Markets booting up</p>
                  <p>Race control will publish pools here as soon as betting opens for this event.</p>
                </div>
              )
            ) : !isLoading ? (
              <div className="tk-glass-panel flex flex-col gap-3 rounded-xl border border-dashed border-white/10 p-6 text-sm text-neutral-400">
                <p className="font-semibold text-white">Live market board coming online</p>
                <p>Admin tools will seed the first tote shortly. Check back once the next event opens betting.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {highlights.map(({ icon: Icon, title, copy }) => (
            <div key={title} className="tk-glass-panel flex flex-col gap-3 rounded-xl border border-white/5 p-6">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
                <Icon className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold text-white">{title}</h2>
              <p className="text-sm text-neutral-400">{copy}</p>
            </div>
          ))}
        </section>
      </div>

      {isBetslipOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050a19]/80 px-4 py-10 backdrop-blur-sm">
          <div className="relative w-full max-w-xl">
            <Betslip onClose={handleCloseBetslip} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
