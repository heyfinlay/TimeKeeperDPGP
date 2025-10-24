import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock, Flag, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const FALLBACK_DISCORD_AUTH_URL =
  import.meta.env.VITE_DISCORD_FALLBACK_AUTH_URL ??
  'https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&response_type=code&scope=identify%20email%20guilds&prompt=consent';

const statHighlights = [
  {
    icon: Clock,
    title: 'Live race telemetry',
    description: 'Instant signal propagation keeps every marshal in sync with the grid.',
    accent: 'from-[#7C6BFF]/60 via-[#7C6BFF]/10 to-transparent',
  },
  {
    icon: ShieldCheck,
    title: 'Protected control surface',
    description: 'Discord-authenticated roles ensure only accredited officials can take action.',
    accent: 'from-[#9FF7D3]/60 via-[#9FF7D3]/10 to-transparent',
  },
  {
    icon: Flag,
    title: 'Procedure-perfect tooling',
    description: 'Modelled workflows for full-course yellows, race restarts, and post-session audits.',
    accent: 'from-[#F5A97F]/60 via-[#F5A97F]/10 to-transparent',
  },
];

const WelcomePage = () => {
  const { signInWithDiscord, status, isSupabaseConfigured } = useAuth();

  const isAuthenticated = status === 'authenticated';
  const isCheckingAuth = status === 'loading';

  const primaryCtaLabel = useMemo(() => {
    if (isCheckingAuth) return 'Checking access…';
    if (isAuthenticated) return 'Enter race control';
    return 'Sign in with Discord';
  }, [isAuthenticated, isCheckingAuth]);

  const handleSignIn = () => {
    if (isAuthenticated) {
      return;
    }

    if (isSupabaseConfigured && typeof signInWithDiscord === 'function') {
      signInWithDiscord().catch((error) => {
        console.error('Supabase Discord sign-in failed. Redirecting to Discord OAuth.', error);
        window.location.href = FALLBACK_DISCORD_AUTH_URL;
      });
      return;
    }

    window.location.href = FALLBACK_DISCORD_AUTH_URL;
  };

  return (
    <div className="relative isolate overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-b from-[#0B1120] via-[#060916] to-[#05070F] px-6 pb-16 pt-12 shadow-[0_0_60px_rgba(64,82,117,0.35)]">
      <div className="pointer-events-none absolute -left-32 -top-48 h-96 w-96 rounded-full bg-[#7C6BFF]/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-40 h-80 w-80 rounded-full bg-[#9FF7D3]/20 blur-3xl" />

      <div className="relative mx-auto flex max-w-5xl flex-col gap-12 text-gray-200">
        <header className="flex flex-col gap-6 text-center md:gap-8">
          <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#7C6BFF]/50 bg-[#7C6BFF]/10 px-4 py-1 text-xs uppercase tracking-[0.35em] text-[#dcd7ff]">
            <Sparkles className="h-4 w-4" /> Official race control suite
          </span>
          <h1 className="text-4xl font-light leading-tight text-white sm:text-5xl md:text-6xl">
            Precision control for the <span className="font-semibold text-transparent bg-gradient-to-r from-[#9FF7D3] via-[#7C6BFF] to-[#dcd7ff] bg-clip-text">DayBreak Grand Prix</span>
          </h1>
          <p className="mx-auto max-w-2xl text-base text-gray-400 sm:text-lg">
            TimeKeeper orchestrates every marshal, commentator, and race engineer from a single, deeply instrumented command
            center. Authenticate with Discord to unlock stewarding tools, broadcast dashboards, and resilient telemetry feeds.
          </p>
        </header>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          {isAuthenticated ? (
            <Link
              to="/control"
              className="group inline-flex items-center gap-3 rounded-full bg-[#9FF7D3] px-7 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#041313] transition hover:bg-[#7de6c0]"
            >
              {primaryCtaLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isCheckingAuth}
              className="group inline-flex items-center gap-3 rounded-full bg-[#5865F2] px-7 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-white transition hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {primaryCtaLabel}
              {!isCheckingAuth && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
            </button>
          )}

          <Link
            to="/live"
            className="inline-flex items-center gap-3 rounded-full border border-[#7C6BFF]/40 bg-transparent px-6 py-3 text-sm uppercase tracking-[0.3em] text-[#bdb3ff] transition hover:border-[#7C6BFF]/80 hover:text-white"
          >
            View live timing
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {statHighlights.map(({ icon: Icon, title, description, accent }) => (
            <div
              key={title}
              className={`relative overflow-hidden rounded-2xl border border-white/5 bg-[#05070F]/70 p-6 shadow-[0_0_30px_rgba(15,23,42,0.6)] backdrop-blur`}
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent}`} />
              <div className="relative flex flex-col gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-white">{title}</h2>
                <p className="text-sm text-gray-400">{description}</p>
              </div>
            </div>
          ))}
        </div>

        <footer className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#060910]/80 px-6 py-5 text-xs uppercase tracking-[0.35em] text-gray-500 sm:flex-row">
          <span>Built for endurance operations • Synced to race control</span>
          <div className="flex gap-4 text-[#9FF7D3]">
            <Link to="/live" className="transition hover:text-white">
              Live timing
            </Link>
            <Link to="/control" className="transition hover:text-white">
              Control tools
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default WelcomePage;
