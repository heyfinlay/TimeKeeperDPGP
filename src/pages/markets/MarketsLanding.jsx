import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Layers, TrendingUp, Timer } from 'lucide-react';
import MarketCard from '@/components/betting/MarketCard.jsx';
import Betslip from '@/components/betting/Betslip.jsx';
import { useParimutuelStore } from '@/state/parimutuelStore.js';

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
    state: { status, events, supportsMarkets, error, pools, selectedEventId },
    actions,
  } = useParimutuelStore();
  const [mode, setMode] = useState('overview');
  const [activeEventId, setActiveEventId] = useState(null);

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

  const isLoading = status === 'loading';
  const hasLiveData = useMemo(
    () => supportsMarkets && events.some((event) => Array.isArray(event.markets) && event.markets.length > 0),
    [supportsMarkets, events],
  );
  const canEnterBetting = activeMarkets.length > 0;

  useEffect(() => {
    if (mode === 'betting' && !canEnterBetting) {
      setMode('overview');
    }
  }, [mode, canEnterBetting]);

  const handleSelectEvent = (eventId) => {
    setActiveEventId(eventId);
    actions.selectEvent(eventId);
  };

  const handleEnterBetting = () => {
    if (!canEnterBetting) {
      return;
    }
    if (!activeEventId && events[0]?.id) {
      handleSelectEvent(events[0].id);
    }
    const event = activeEvent ?? events.find((candidate) => candidate.id === activeEventId) ?? events[0] ?? null;
    const defaultMarketId = event?.markets?.[0]?.id ?? null;
    if (defaultMarketId) {
      actions.selectMarket(defaultMarketId);
    }
    setMode('betting');
  };

  const handleSelectMarket = (eventId, marketId) => {
    handleSelectEvent(eventId);
    actions.selectMarket(marketId);
    setMode('betting');
  };

  const handleBackToOverview = () => {
    setMode('overview');
  };

  return (
    <div className="tk-markets-shell relative min-h-screen w-full overflow-hidden px-4 py-10 sm:px-6 lg:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(124,107,255,0.18),transparent_60%)]" aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 lg:flex-row">
        <aside className="tk-glass-panel flex w-full flex-col gap-5 rounded-3xl p-6 lg:max-w-[18rem]">
          <header className="flex flex-col gap-2">
            <span className="text-[0.65rem] uppercase tracking-[0.35em] text-[#9FF7D3]">Live schedule</span>
            <h2 className="text-lg font-semibold text-white">Events</h2>
            <p className="text-xs text-neutral-400">Select an event to inspect pools and tote boards.</p>
          </header>
          <div className="flex flex-col gap-2">
            {supportsMarkets ? null : (
              <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
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
                  className={`group flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition ${
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
              <p className="rounded-2xl border border-dashed border-white/10 p-4 text-xs text-neutral-400">
                No events are currently scheduled. Check back soon for new races and rumbles.
              </p>
            ) : null}
          </div>
        </aside>

        <main className="flex w-full flex-1 flex-col gap-6">
          <header className="tk-glass-panel flex flex-col gap-5 rounded-3xl p-8">
            <span className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">Diamond Sports Book</span>
            <h1 className="text-4xl font-semibold text-white sm:text-5xl">Markets and tote boards</h1>
            <p className="max-w-2xl text-sm text-neutral-300 sm:text-base">
              Gamble on everything - from podiums to power plays. Pick an event to see live pools, wager breakdowns, and realtime odds
              fed directly from race control telemetry.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em]">
              {mode === 'betting' ? (
                <button
                  type="button"
                  onClick={handleBackToOverview}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-neutral-300 transition hover:border-white/30 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to overview
                </button>
              ) : canEnterBetting ? (
                <button
                  type="button"
                  onClick={handleEnterBetting}
                  className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/20 hover:text-white"
                >
                  Enter Race Control <ArrowRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <p className="text-[0.7rem] uppercase tracking-[0.3em] text-neutral-500">
              All wagers settled in Diamonds (in-game currency). Parody product; no real-world stakes.
            </p>
          </header>

          {mode === 'overview' ? (
            <section className="grid gap-4 sm:grid-cols-2">
              {highlights.map(({ icon: Icon, title, copy }) => (
                <div key={title} className="tk-glass-panel flex flex-col gap-3 rounded-3xl border border-white/5 p-6">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h2 className="text-xl font-semibold text-white">{title}</h2>
                  <p className="text-sm text-neutral-400">{copy}</p>
                </div>
              ))}
            </section>
          ) : null}

          {isLoading ? (
            <div className="flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-4 py-2 text-sm text-neutral-300">
              <Timer className="h-4 w-4 animate-spin text-[#9FF7D3]" /> Loading live markets...
            </div>
          ) : null}

          {error ? <p className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}

          {hasLiveData && activeEvent ? (
            <section className="flex flex-col gap-6">
              <div className="tk-glass-panel flex flex-col gap-4 rounded-3xl border border-white/10 p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Event</span>
                    <h2 className="text-2xl font-semibold text-white">{activeEvent.title}</h2>
                    <p className="text-sm text-neutral-400">
                      {activeEvent.venue ? `${activeEvent.venue} · ` : ''}
                      {activeEvent.starts_at ? new Date(activeEvent.starts_at).toLocaleString() : 'Schedule TBC'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-neutral-300">
                    <Timer className="h-4 w-4 text-[#9FF7D3]" />
                    <span>{activeEvent.status ? String(activeEvent.status).replaceAll('_', ' ') : 'Scheduled'}</span>
                  </div>
                </div>
                {mode === 'overview' && canEnterBetting ? (
                  <button
                    type="button"
                    onClick={handleEnterBetting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-3 text-[0.7rem] uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/20 hover:text-white sm:w-auto"
                  >
                    Enter Race Control <ArrowRight className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {activeMarkets.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    pool={pools[market.id]}
                    onSelect={() => handleSelectMarket(activeEvent.id, market.id)}
                    ctaLabel={mode === 'betting' ? 'Bet now' : 'Enter Race Control'}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="tk-glass-panel flex flex-wrap items-center gap-3 rounded-3xl border border-dashed border-white/10 p-8 text-sm text-neutral-400">
              <div className="flex-1">
                <p className="font-semibold text-white">Live market board coming online</p>
                <p>Admin tools will seed the first tote shortly. Check back once the next event opens betting.</p>
              </div>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 px-4 py-2 uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
              >
                Return to dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </main>

        <div className="w-full lg:max-w-sm">
          {mode === 'betting' ? (
            <Betslip onClose={handleBackToOverview} />
          ) : (
            <div className="tk-glass-panel hidden h-full flex-col justify-center gap-4 rounded-3xl p-6 text-sm text-neutral-400 lg:flex">
              <p className="font-semibold text-white">Race Control</p>
              <p>Select a market to preview live pools, then enter Race Control to build and place wagers.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
