import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers, TrendingUp, Timer } from 'lucide-react';
import { isSupabaseConfigured, supabaseSelect, isTableMissingError } from '@/lib/supabaseClient.js';

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

const formatStatus = (raw) => {
  if (!raw) return 'Unknown';
  return String(raw).replaceAll('_', ' ');
};

const formatClosesAt = (timestamp) => {
  if (!timestamp) return 'No scheduled close';
  const closeDate = new Date(timestamp);
  if (Number.isNaN(closeDate.getTime())) return 'No scheduled close';
  const diffMs = closeDate.getTime() - Date.now();
  if (diffMs <= 0) {
    return 'Closed';
  }
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) {
    return `Closes in ${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  return `Closes in ${hours}h`;
};

const normaliseEvents = (rows = []) =>
  rows.map((event) => ({
    ...event,
    markets: Array.isArray(event?.markets)
      ? event.markets.map((market) => ({
          ...market,
          outcomes: Array.isArray(market?.outcomes) ? market.outcomes : [],
        }))
      : [],
  }));

export default function MarketsLanding() {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [supportsMarkets, setSupportsMarkets] = useState(!isSupabaseConfigured);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSupportsMarkets(false);
      return;
    }

    let isActive = true;
    const loadMarkets = async () => {
      setIsLoading(true);
      try {
        const rows = await supabaseSelect('events', {
          select: 'id,title,venue,starts_at,status,markets(id,name,type,rake_bps,status,closes_at,outcomes(id,label,sort_order))',
          order: { column: 'starts_at', ascending: true },
        });
        if (!isActive) return;
        setEvents(normaliseEvents(Array.isArray(rows) ? rows : []));
        setSupportsMarkets(true);
        setError(null);
      } catch (loadError) {
        if (!isActive) return;
        if (isTableMissingError(loadError, 'events')) {
          setSupportsMarkets(false);
          setEvents([]);
          setError(null);
        } else {
          console.error('Failed to load markets', loadError);
          setSupportsMarkets(true);
          setEvents([]);
          setError('Unable to load live markets right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadMarkets();
    return () => {
      isActive = false;
    };
  }, []);

  const hasLiveData = useMemo(() => supportsMarkets && events.length > 0, [supportsMarkets, events]);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#060910]/80 p-8 shadow-[0_0_40px_rgba(15,23,42,0.45)]">
        <span className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">Diamond Sports Book</span>
        <h1 className="text-4xl font-semibold text-white sm:text-5xl">Markets and tote boards</h1>
        <p className="max-w-2xl text-sm text-neutral-300 sm:text-base">
          Gamble on everything - from podiums to power plays. Pick an event to see live pools, wager breakdowns, and realtime odds fed directly from race control telemetry.
        </p>
        <p className="text-[0.7rem] uppercase tracking-[0.3em] text-neutral-500">
          All wagers settled in Diamonds (in-game currency). Parody product; no real-world stakes.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        {highlights.map(({ icon: Icon, title, copy }) => (
          <div key={title} className="flex flex-col gap-3 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
              <Icon className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <p className="text-sm text-neutral-400">{copy}</p>
          </div>
        ))}
      </section>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Timer className="h-4 w-4 animate-spin" /> Loading live markets...
        </div>
      ) : null}

      {error ? <p className="text-sm text-amber-300">{error}</p> : null}

      {hasLiveData ? (
        <section className="flex flex-col gap-6">
          {events.map((event) => (
            <div key={event.id} className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
              <header className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Event</span>
                <h2 className="text-2xl font-semibold text-white">{event.title}</h2>
                <p className="text-sm text-neutral-400">
                  {event.venue ? `${event.venue} • ` : ''}
                  {event.starts_at ? new Date(event.starts_at).toLocaleString() : 'Schedule TBC'}
                </p>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                {event.markets.map((market) => (
                  <div key={market.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#060910]/80 p-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.35em] text-neutral-500">
                      <span>{market.type}</span>
                      <span>{formatStatus(market.status)}</span>
                    </div>
                    <h3 className="text-lg font-semibold text-white">{market.name}</h3>
                    <p className="text-xs text-neutral-400">
                      {formatClosesAt(market.closes_at)} • Rake {Number.isFinite(market.rake_bps) ? (market.rake_bps / 100).toFixed(2) : '0.00'}%
                    </p>
                    <ul className="flex flex-wrap gap-2 text-xs text-neutral-300">
                      {market.outcomes.slice(0, 4).map((outcome) => (
                        <li key={outcome.id} className="rounded-full border border-white/10 px-3 py-1">
                          {outcome.label}
                        </li>
                      ))}
                      {market.outcomes.length > 4 ? (
                        <li className="rounded-full border border-white/10 px-3 py-1 text-neutral-500">
                          +{market.outcomes.length - 4} more
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-dashed border-white/10 bg-[#05070F]/40 p-8 text-sm text-neutral-400">
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
    </div>
  );
}