import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Clock,
  Crown,
  Loader2,
  RefreshCcw,
  Users,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useEventSession } from '../../context/SessionContext.jsx';
import { useWagers } from '../../hooks/useWagers.js';
import MarketCard from '@/components/betting/MarketCard.jsx';
import { useParimutuelStore } from '@/state/parimutuelStore.js';
const tierOrder = ['Silver', 'Gold', 'Diamond', 'VIP', 'Marshal', 'Admin'];

const baseMarkets = [
  {
    id: 'race-winner',
    title: 'Overall Winner',
    description: 'Who takes the chequered flag first? Track live volume across the grid.',
    poolTotal: 18650,
    change: 1.8,
    participants: [
      { id: 'team-solstice', name: 'Team Solstice', contribution: 5400 },
      { id: 'apex-velocity', name: 'Apex Velocity', contribution: 4825 },
      { id: 'nebula-works', name: 'Nebula Works', contribution: 3960 },
      { id: 'others', name: 'Other entries', contribution: 2465 },
    ],
    closesInMinutes: 45,
  },
  {
    id: 'fastest-lap',
    title: 'Fastest Lap',
    description: 'Back the driver most likely to light up the timing screens.',
    poolTotal: 12240,
    change: -0.6,
    participants: [
      { id: 'driver-hale', name: 'S. Hale', contribution: 3920 },
      { id: 'driver-ko', name: 'M. Ko', contribution: 3510 },
      { id: 'driver-fern', name: 'A. Fernández', contribution: 2780 },
      { id: 'driver-others', name: 'Field', contribution: 2030 },
    ],
    closesInMinutes: 28,
  },
  {
    id: 'safety-car',
    title: 'Safety Car Deployment',
    description: 'Predict if race control will dispatch the safety car this session.',
    poolTotal: 8640,
    change: 3.2,
    participants: [
      { id: 'yes', name: 'Yes - deployment likely', contribution: 4920 },
      { id: 'no', name: 'No - green all the way', contribution: 3720 },
    ],
    closesInMinutes: 12,
  },
];

const buildFallbackMarket = (market) => ({
  id: market.id,
  name: market.title,
  type: 'Promo',
  status: 'open',
  description: market.description,
  closes_at: new Date(Date.now() + market.closesInMinutes * 60000).toISOString(),
  outcomes: market.participants.map((participant, index) => ({
    id: participant.id,
    label: participant.name,
    pool_total: participant.contribution,
    sort_order: index,
  })),
  pool_total: market.poolTotal,
  rake_bps: 0,
});

const buildFallbackPool = (market) => ({
  total: market.poolTotal,
  rakeBps: 0,
  outcomes: market.participants.reduce((acc, participant) => {
    acc[participant.id] = { total: participant.contribution, wagerCount: 0 };
    return acc;
  }, {}),
});

const deriveTier = (profile) => {
  if (!profile) {
    return {
      label: 'Silver',
      nextTier: 'Gold',
      progress: 20,
      description: 'Complete your profile to start earning stewarding credits.',
    };
  }

  const role = String(profile.role ?? '').toLowerCase();
  if (role === 'admin') {
    return {
      label: 'Admin',
      nextTier: null,
      progress: 100,
      description: 'Full control enabled. You manage marshal access and market governance.',
    };
  }

  if (role === 'marshal') {
    return {
      label: 'Marshal',
      nextTier: null,
      progress: 82,
      description: 'Trusted race operations lead. Keep coordinating the grid to reach VIP.',
    };
  }

  const configuredTier = tierOrder.find((tier) => tier.toLowerCase() === String(profile?.tier ?? '').toLowerCase());
  const levelName = configuredTier ?? 'Gold';
  const currentIndex = tierOrder.findIndex((tier) => tier === levelName);
  const nextTier = tierOrder[currentIndex + 1] ?? null;
  const xp = Number(profile?.experience_points ?? 0);
  const progress = Math.min(100, Math.round(((xp % 1000) / 1000) * 100));

  return {
    label: levelName,
    nextTier,
    progress,
    description: nextTier
      ? `Only ${nextTier} stewards can trigger advanced interventions. Earn ${1000 - (xp % 1000)} more credits to level up.`
      : 'Keep contributing to unlock marshal privileges.',
  };
};

const formatCountdown = (target, current) => {
  if (!target) {
    return {
      label: 'Awaiting schedule',
      detail: 'No upcoming sessions are scheduled yet.',
    };
  }

  const targetTime = new Date(target);
  const now = current instanceof Date ? current : new Date(current ?? Date.now());
  const diff = targetTime.getTime() - now.getTime();

  if (Number.isNaN(diff)) {
    return {
      label: 'Scheduling',
      detail: 'Unable to determine the next session start.',
    };
  }

  if (diff <= 0) {
    return {
      label: 'In progress',
      detail: 'The next session is running right now.',
    };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return {
    label: parts.join(' '),
    detail: 'Until the next session briefing begins.',
  };
};

const DashboardPage = () => {
  const { status, user, profile, isSupabaseConfigured } = useAuth();
  const navigate = useNavigate();
  const { sessions, refreshSessions, activeSessionId } = useEventSession();
  const { wagers, isLoading: isLoadingWagers, supportsWagers } = useWagers();
  const { state: parimutuelState, actions: pariActions } = useParimutuelStore();
  const { loadEvents: loadParimutuelEvents, selectEvent: selectPariEvent, selectMarket: selectPariMarket } = pariActions;
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const isAuthenticated = status === 'authenticated' && !!user;
  const profileSupportsIcPhone = useMemo(
    () => (profile ? Object.prototype.hasOwnProperty.call(profile, 'ic_phone_number') : false),
    [profile],
  );
  const profileComplete = Boolean(profile?.display_name?.trim());
  const controlPath = activeSessionId ? `/control/${activeSessionId}` : '/sessions';

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (status === 'unauthenticated') {
      navigate('/', { replace: true });
      return;
    }
    if (status === 'authenticated' && user && !profileComplete) {
      navigate('/account/setup', { replace: true });
    }
  }, [isSupabaseConfigured, status, user, profileComplete, navigate]);

  useEffect(() => {
    if (!refreshSessions) return;
    setIsRefreshingSessions(true);
    refreshSessions()
      .catch((error) => console.error('Failed to refresh sessions on dashboard load', error))
      .finally(() => setIsRefreshingSessions(false));
  }, [refreshSessions]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (parimutuelState.status === 'idle') {
      void loadParimutuelEvents();
    }
  }, [parimutuelState.status, loadParimutuelEvents]);

  const nextSession = useMemo(() => {
    if (!sessions?.length) return null;
    const upcoming = sessions
      .filter((session) => {
        if (!session?.starts_at) return false;
        const startDate = new Date(session.starts_at);
        return startDate.getTime() > now.getTime();
      })
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

    if (upcoming.length) {
      return upcoming[0];
    }

    return sessions.find((session) => String(session?.status).toLowerCase() === 'active') ?? null;
  }, [now, sessions]);

  const countdown = useMemo(() => formatCountdown(nextSession?.starts_at, now), [nextSession?.starts_at, now]);

  const marketsLoading = parimutuelState.status === 'loading';
  const marketsError = parimutuelState.status === 'error' ? parimutuelState.error : null;

  const dashboardMarkets = useMemo(() => {
    if (!parimutuelState.supportsMarkets || parimutuelState.events.length === 0) {
      return baseMarkets.map((market) => ({
        market: buildFallbackMarket(market),
        pool: buildFallbackPool(market),
        eventId: null,
        fallback: true,
      }));
    }
    const activeEvent =
      parimutuelState.events.find((event) => event.id === parimutuelState.selectedEventId) ??
      parimutuelState.events[0];
    if (!activeEvent) {
      return [];
    }
    return activeEvent.markets.map((market) => ({
      market,
      pool: parimutuelState.pools[market.id],
      eventId: activeEvent.id,
      fallback: false,
    }));
  }, [parimutuelState.supportsMarkets, parimutuelState.events, parimutuelState.pools, parimutuelState.selectedEventId]);
  const tier = useMemo(() => deriveTier(profile), [profile]);

  const handleRefreshSessions = async () => {
    if (!refreshSessions) return;
    setIsRefreshingSessions(true);
    try {
      await refreshSessions();
    } finally {
      setIsRefreshingSessions(false);
    }
  };

  if (isSupabaseConfigured && status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Loading your dashboard…
      </div>
    );
  }

  if (isSupabaseConfigured && !isAuthenticated) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Redirecting to sign in…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#060910]/80 p-8 shadow-[0_0_50px_rgba(15,23,42,0.45)]">
        <div className="flex flex-col gap-3 text-left sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">
              <Sparkles className="h-4 w-4" />
              Diamond Sports Book
            </span>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">Los Santos tote operations hub</h1>
          </div>
          <div className="flex flex-col items-start gap-2 text-sm text-neutral-400 sm:items-end sm:text-right">
            <span>Gamble on everything - from podiums to power plays.</span>
            <span>Live markets mirror marshal telemetry in real time.</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/markets"
            className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
          >
            View live markets
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to={controlPath}
            className="inline-flex items-center gap-2 rounded-full border border-[#7C6BFF]/40 bg-[#7C6BFF]/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-[#dcd7ff] transition hover:border-[#7C6BFF]/70 hover:text-white"
          >
            Manage sessions
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="text-[0.7rem] uppercase tracking-[0.3em] text-neutral-500">
          All wagers settled in Diamonds (in-game currency). Parody product; no real-world stakes.
        </p>
      </section>
      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6 rounded-3xl border border-white/5 bg-gradient-to-br from-[#0B1120] via-[#060910] to-[#05070F] p-8 shadow-[0_0_50px_rgba(15,23,42,0.6)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">Next session</span>
              <h2 className="text-3xl font-semibold text-white">
                {nextSession?.name ?? 'Awaiting session announcement'}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleRefreshSessions}
              disabled={isRefreshingSessions}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-neutral-300 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshingSessions ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </button>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <div className="flex items-center gap-3 text-[#9FF7D3]">
                <Clock className="h-5 w-5" />
                <span className="text-xs uppercase tracking-[0.35em]">Countdown</span>
              </div>
              <p className="text-2xl font-semibold text-white">{countdown.label}</p>
              <p className="text-sm text-neutral-400">{countdown.detail}</p>
              {nextSession?.starts_at ? (
                <p className="text-xs text-neutral-500">
                  Scheduled start: {new Date(nextSession.starts_at).toLocaleString()}
                </p>
              ) : null}
              <Link
                to="/live"
                className="mt-auto inline-flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:text-white"
              >
                View live schedule <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <div className="flex items-center gap-3 text-[#7C6BFF]">
                <Activity className="h-5 w-5" />
                <span className="text-xs uppercase tracking-[0.35em]">Status</span>
              </div>
              <p className="text-2xl font-semibold text-white">
                {nextSession?.status ? String(nextSession.status).replaceAll('_', ' ') : 'Standby'}
              </p>
              <p className="text-sm text-neutral-400">
                {nextSession?.description ?? 'Monitoring telemetry feeds and steward alerts ahead of the next green flag.'}
              </p>
              <div className="mt-auto flex items-center gap-2 text-xs text-neutral-500">
                <Users className="h-4 w-4" />
                <span>Stewards synced: {profile?.assigned_driver_ids?.length ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#060910]/80 p-8">
          <div className="flex items-center gap-3 text-[#F5A97F]">
            <Crown className="h-5 w-5" />
            <span className="text-xs uppercase tracking-[0.35em]">Account tier</span>
          </div>
          <h2 className="text-3xl font-semibold text-white">{profile?.display_name ?? user?.email ?? 'TimeKeeper user'}</h2>
          <p className="text-sm text-neutral-400">{tier.description}</p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>{tier.label}</span>
              {tier.nextTier ? <span>Next: {tier.nextTier}</span> : <span>Maxed</span>}
            </div>
            <div className="h-2 w-full rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-[#F5A97F] via-[#9FF7D3] to-[#7C6BFF]"
                style={{ width: `${Math.min(100, Math.max(0, tier.progress ?? 0))}%` }}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-neutral-400">
              {profileSupportsIcPhone ? (
                <span>IC phone: {profile?.ic_phone_number ?? 'Not set'}</span>
              ) : null}
              <span>Role: {profile?.role ? String(profile.role).replaceAll('_', ' ') : 'Unassigned'}</span>
            </div>
          </div>
          <Link
            to="/account/setup"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:text-white"
          >
            Update details <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Open betting markets</span>
            <h2 className="text-2xl font-semibold text-white">Live pool overview</h2>
          </div>
          <Link
            to="/markets"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-neutral-300 transition hover:border-white/30 hover:text-white"
          >
            Live Markets <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {marketsLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Syncing live pools...
          </div>
        ) : null}

        {marketsError ? <p className="text-sm text-amber-300">{marketsError}</p> : null}

        {dashboardMarkets.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-3">
            {dashboardMarkets.map(({ market, pool, eventId }) => (
              <MarketCard
                key={`${eventId ?? 'promo'}-${market.id}`}
                market={market}
                pool={pool}
                onSelect={() => {
                  if (eventId) {
                    selectPariEvent(eventId);
                    selectPariMarket(market.id);
                  }
                  navigate('/markets');
                }}
                ctaLabel="View market"
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">No live markets available right now.</p>
        )}
      </section>

      {/* Active Bets & Settled Bets */}
      {supportsWagers && (
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold text-white">Your Wagers</h2>

          {isLoadingWagers ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your wagers...
            </div>
          ) : wagers.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-3xl border border-dashed border-white/10 bg-[#05070F]/40 p-8 text-center">
              <p className="text-sm font-semibold text-white">No wagers yet</p>
              <p className="text-xs text-neutral-400">
                Head to the markets page to place your first bet
              </p>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Active Bets */}
              <div className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-[#9FF7D3]" />
                  <h3 className="text-lg font-semibold text-white">Active Bets</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {wagers
                    .filter((w) => w.status === 'pending' || w.status === 'accepted')
                    .slice(0, 5)
                    .map((wager) => (
                      <div
                        key={wager.id}
                        className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#060910]/80 p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                              {wager.eventTitle}
                            </span>
                            <span className="text-sm font-semibold text-white">
                              {wager.marketName}
                            </span>
                            <span className="text-sm text-[#9FF7D3]">{wager.outcomeLabel}</span>
                          </div>
                          <span className="text-sm font-semibold text-white">
                            💎 {(wager.stake / 1000).toFixed(1)}K
                          </span>
                        </div>
                        <span className="text-xs text-neutral-400">
                          Placed {new Date(wager.placedAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  {wagers.filter((w) => w.status === 'pending' || w.status === 'accepted').length === 0 && (
                    <p className="text-sm text-neutral-500">No active bets</p>
                  )}
                </div>
              </div>

              {/* Settled Bets */}
              <div className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-[#7C6BFF]" />
                  <h3 className="text-lg font-semibold text-white">Settled Bets</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {wagers
                    .filter((w) => w.status !== 'pending' && w.status !== 'accepted')
                    .slice(0, 5)
                    .map((wager) => {
                      const isWon = wager.status === 'won';
                      const isRefunded = wager.status === 'refunded';
                      return (
                        <div
                          key={wager.id}
                          className={`flex flex-col gap-2 rounded-2xl border p-4 ${
                            isWon
                              ? 'border-green-500/20 bg-green-950/20'
                              : isRefunded
                                ? 'border-amber-500/20 bg-amber-950/20'
                                : 'border-red-500/20 bg-red-950/20'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                                {wager.eventTitle}
                              </span>
                              <span className="text-sm font-semibold text-white">
                                {wager.marketName}
                              </span>
                              <span
                                className={`text-sm ${isWon ? 'text-green-300' : isRefunded ? 'text-amber-300' : 'text-red-300'}`}
                              >
                                {wager.outcomeLabel}
                              </span>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={`text-xs font-semibold uppercase ${isWon ? 'text-green-400' : isRefunded ? 'text-amber-400' : 'text-red-400'}`}
                              >
                                {isWon ? 'Won' : isRefunded ? 'Refunded' : 'Lost'}
                              </span>
                              <span className="text-sm font-semibold text-white">
                                💎 {(wager.stake / 1000).toFixed(1)}K
                              </span>
                            </div>
                          </div>
                          <span className="text-xs text-neutral-400">
                            Placed {new Date(wager.placedAt).toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  {wagers.filter((w) => w.status !== 'pending' && w.status !== 'accepted').length === 0 && (
                    <p className="text-sm text-neutral-500">No settled bets</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default DashboardPage;
