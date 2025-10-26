import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { isSupabaseConfigured } from '../../lib/supabaseClient.js';

const AuthGate = ({ children }) => {
  const { status, user, profile, profileError, signInWithDiscord, signOut } = useAuth();

  if (!isSupabaseConfigured) {
    return children ?? null;
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-gray-300">
        <ShieldCheck className="h-10 w-10 animate-pulse text-blue-400" />
        <p className="text-sm uppercase tracking-[0.3em] text-gray-400">Checking permissions…</p>
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center text-gray-200">
        <ShieldCheck className="h-10 w-10 text-blue-400" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-wide">Restricted Control Panel</h2>
          <p className="max-w-md text-sm text-gray-400">
            You need to authenticate with Discord to access the race control tools. Only authorised admins and
            marshals are able to view timing data or make changes.
          </p>
        </div>
        <button
          onClick={() => signInWithDiscord()}
          className="rounded bg-[#5865F2] px-4 py-2 text-sm font-semibold uppercase tracking-[0.25em] text-white shadow transition hover:bg-[#4752C4]"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {profileError && (
        <div className="rounded border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Unable to load your marshal profile. Please refresh the page or contact an administrator.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/60 px-4 py-3 text-sm text-gray-300">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Signed in as</p>
          <p className="font-semibold text-gray-100">
            {profile?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email}
          </p>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Role: {profile?.role ?? 'marshal'}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-xs uppercase tracking-[0.25em] text-gray-200 transition hover:bg-gray-700"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
      {children}
    </div>
  );
};

export default AuthGate;
