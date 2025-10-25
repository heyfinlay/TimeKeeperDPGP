import { useEffect, useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useEventSession } from '@/context/SessionContext.jsx';
import { LEGACY_SESSION_ID } from '@/utils/raceData.js';
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
    if (sessionId !== LEGACY_SESSION_ID) {
      return <Navigate to={`/control/${LEGACY_SESSION_ID}`} replace />;
    }
    return children;
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
