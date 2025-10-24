import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Clock,
  Crown,
  Loader2,
  RefreshCcw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useEventSession } from '../../context/SessionContext.jsx';

const MARKET_REFRESH_INTERVAL = 5000;
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
  const { sessions, refreshSessions } = useEventSession();
  const [markets, setMarkets] = useState(baseMarkets);
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const isAuthenticated = status === 'authenticated' && !!user;
  const profileSupportsIcPhone = useMemo(
    () => (profile ? Object.prototype.hasOwnProperty.call(profile, 'ic_phone_number') : false),
    [profile],
  );
  const profileComplete =
    Boolean(profile?.display_name?.trim()) && (!profileSupportsIcPhone || Boolean(profile?.ic_phone_number?.trim()));

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
    const interval = setInterval(() => {
      setMarkets((currentMarkets) =>
        currentMarkets.map((market) => {
          const volatility = (Math.random() - 0.5) * 0.04;
          const delta = market.poolTotal * volatility;
          const nextTotal = Math.max(0, Math.round((market.poolTotal + delta) * 100) / 100);
          const change = Math.round(((nextTotal - market.poolTotal) / Math.max(market.poolTotal, 1)) * 1000) / 10;
          return {
            ...market,
            poolTotal: nextTotal,
            change,
          };
        }),
      );
    }, MARKET_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

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
            to="/control"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-neutral-300 transition hover:border-white/30 hover:text-white"
          >
            Enter race control <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {markets.map((market) => {
            const totalContribution = market.participants.reduce((sum, participant) => sum + participant.contribution, 0);
            return (
              <div
                key={market.id}
                className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6 shadow-[0_0_40px_rgba(15,23,42,0.45)]"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/30 bg-[#9FF7D3]/10 px-3 py-1 text-[0.6rem] uppercase tracking-[0.35em] text-[#9FF7D3]">
                      Open
                    </span>
                    <h3 className="text-xl font-semibold text-white">{market.title}</h3>
                    <p className="text-sm text-neutral-400">{market.description}</p>
                  </div>
                  <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs ${market.change >= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-200'}`}>
                    <TrendingUp className="h-4 w-4" />
                    <span>{market.change >= 0 ? '+' : ''}{market.change.toFixed(1)}%</span>
                  </div>
                </header>

                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline justify-between text-neutral-300">
                    <div className="flex flex-col">
                      <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Pool size</span>
                      <span className="text-2xl font-semibold text-white">${market.poolTotal.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-neutral-500">Closes in {market.closesInMinutes}m</div>
                  </div>
                  <div className="flex flex-col gap-3">
                    {market.participants.map((participant) => {
                      const share = totalContribution ? Math.round((participant.contribution / totalContribution) * 100) : 0;
                      return (
                        <div key={participant.id} className="flex flex-col gap-2">
                          <div className="flex items-center justify-between text-sm text-neutral-300">
                            <span>{participant.name}</span>
                            <span>${participant.contribution.toLocaleString()}</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-white/10">
                            <div
                              className="h-2 rounded-full bg-gradient-to-r from-[#7C6BFF] via-[#9FF7D3] to-[#dcd7ff]"
                              style={{ width: `${share}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <footer className="mt-auto flex items-center justify-between text-xs text-neutral-500">
                  <div className="inline-flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-[#7C6BFF]" />
                    <span>Live volume updates every 5s</span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-[#9FF7D3] transition hover:text-white"
                  >
                    Manage market <ArrowRight className="h-4 w-4" />
                  </button>
                </footer>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default DashboardPage;
