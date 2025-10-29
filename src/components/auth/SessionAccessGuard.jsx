import { useEffect, useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useEventSession } from '@/context/SessionContext.jsx';
import { isSupabaseConfigured } from '@/lib/supabaseClient.js';

export default function SessionAccessGuard({ children }) {
  const { sessionId } = useParams();
  const {
    sessions,
    selectSession,
    supportsSessions,
    isLoading,
    error,
  } = useEventSession();

  useEffect(() => {
    if (!sessionId) return;
    selectSession(sessionId);
  }, [selectSession, sessionId]);

  const sessionKnown = useMemo(() => {
    if (!Array.isArray(sessions)) return false;
    return sessions.some((session) => session?.id === sessionId);
  }, [sessions, sessionId]);

  if (!sessionId) {
    return <Navigate to="/sessions" replace />;
  }

  if (!supportsSessions) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="max-w-lg rounded-2xl border border-white/5 bg-[#060910]/80 px-6 py-5 text-center text-sm text-neutral-300">
          <p className="text-base font-semibold text-white">Managed sessions unavailable</p>
          <p className="mt-2 text-neutral-400">
            This Supabase project is missing the sessions schema required for race control. Return to the session list and
            update your database before trying again.
          </p>
        </div>
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return children;
  }

  if (isLoading && !sessionKnown) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-400">
        Loading session…
      </div>
    );
  }

  if (!sessionKnown) {
    if (error) {
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
            Unable to load session data. Return to the session list and try again.
          </div>
        </div>
      );
    }
    return <Navigate to="/sessions" replace />;
  }

  return children;
}
