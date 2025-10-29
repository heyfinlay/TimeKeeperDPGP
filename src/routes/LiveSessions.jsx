import { useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEventSession } from '@/context/SessionContext.jsx';
import { LEGACY_SESSION_ID } from '@/utils/raceData.js';

const statusOrder = new Map([
  ['active', 0],
  ['scheduled', 1],
  ['draft', 2],
]);

const formatDate = (value) => {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not scheduled';
  }
  return date.toLocaleString();
};

export default function LiveSessions() {
  const navigate = useNavigate();
  const {
    sessions,
    refreshSessions,
    isLoading,
    error,
    supportsSessions,
    activeSessionId,
  } = useEventSession();

  useEffect(() => {
    if (!supportsSessions) {
      return;
    }
    if (!refreshSessions) return;
    refreshSessions().catch((refreshError) => {
      console.error('Failed to refresh sessions for live session list', refreshError);
    });
  }, [refreshSessions, supportsSessions]);

  const openSessions = useMemo(() => {
    if (!Array.isArray(sessions)) return [];
    return sessions
      .filter((session) => session?.id && session.id !== LEGACY_SESSION_ID)
      .filter((session) => (session?.status ?? '').toLowerCase() !== 'completed')
      .sort((a, b) => {
        const aStatus = statusOrder.get((a?.status ?? '').toLowerCase()) ?? 3;
        const bStatus = statusOrder.get((b?.status ?? '').toLowerCase()) ?? 3;
        if (aStatus !== bStatus) {
          return aStatus - bStatus;
        }
        const aCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
        return bCreated - aCreated;
      });
  }, [sessions]);

  const activeSessionIsLegacy = activeSessionId === LEGACY_SESSION_ID;
  const safeActiveSessionId =
    !supportsSessions || activeSessionIsLegacy ? null : activeSessionId;

  const handleNavigate = useCallback(
    (path) => () => {
      navigate(path);
    },
    [navigate],
  );

  if (!supportsSessions) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-12 text-center text-gray-200">
        <h1 className="text-2xl font-semibold text-white">Managed sessions unavailable</h1>
        <p className="text-sm text-neutral-400">
          This Supabase project is missing the sessions schema required for multi-session control. Migrate the
          database to enable the new workflow.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold text-white">Live sessions</h1>
        <p className="text-sm text-neutral-400">
          Choose an active session for race control or open the public live timing board.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs uppercase tracking-[0.3em]">
          <button
            type="button"
            onClick={handleNavigate('/sessions/new')}
            className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-5 py-3 font-semibold text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
          >
            Start new session
          </button>
          <button
            type="button"
            onClick={() => {
              if (!refreshSessions) return;
              void refreshSessions();
            }}
            disabled={isLoading}
            className="rounded-full border border-white/10 px-5 py-3 font-semibold text-white/80 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
      </header>
      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1 text-left">
            <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Active session</span>
            <span className="text-sm font-semibold text-white">
              {safeActiveSessionId ? `Session ${safeActiveSessionId.slice(0, 8)}…` : 'None selected'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              to={safeActiveSessionId ? `/control/${safeActiveSessionId}` : '#'}
              className={`rounded-full border px-4 py-2 font-semibold uppercase tracking-[0.35em] transition ${
                safeActiveSessionId
                  ? 'border-[#9FF7D3]/40 bg-[#9FF7D3]/15 text-[#9FF7D3] hover:border-[#9FF7D3]/70 hover:text-white'
                  : 'pointer-events-none border-white/10 text-neutral-600'
              }`}
            >
              Open control
            </Link>
            <Link
              to={safeActiveSessionId ? `/live/${safeActiveSessionId}` : '#'}
              className={`rounded-full border px-4 py-2 font-semibold uppercase tracking-[0.35em] transition ${
                safeActiveSessionId
                  ? 'border-[#7C6BFF]/40 bg-[#7C6BFF]/15 text-[#dcd7ff] hover:border-[#7C6BFF]/70 hover:text-white'
                  : 'pointer-events-none border-white/10 text-neutral-600'
              }`}
            >
              View live
            </Link>
          </div>
        </div>
      </section>
      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Open sessions</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
            {openSessions.length} available
          </span>
        </div>
        {isLoading && !openSessions.length ? (
          <p className="mt-4 text-sm text-neutral-400">Loading sessions…</p>
        ) : null}
        {!isLoading && openSessions.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">
            No sessions are currently open. Start a new session to begin race control.
          </p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-4">
          {openSessions.map((session) => {
            const status = String(session?.status ?? 'draft').toLowerCase();
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#060910]/70 px-5 py-4"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold text-white">{session?.name ?? 'Untitled session'}</span>
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                    {status.toUpperCase()} • Created {formatDate(session?.created_at)}
                  </span>
                  {session?.starts_at ? (
                    <span className="text-xs text-neutral-400">
                      Starts {formatDate(session.starts_at)}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleNavigate(`/control/${session.id}`)}
                    className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
                  >
                    Race control
                  </button>
                  <button
                    type="button"
                    onClick={handleNavigate(`/live/${session.id}`)}
                    className="rounded-full border border-[#7C6BFF]/40 bg-[#7C6BFF]/15 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-[#dcd7ff] transition hover:border-[#7C6BFF]/70 hover:text-white"
                  >
                    Live timing
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
