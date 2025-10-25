import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventSession } from '@/context/SessionContext.jsx';
import { LEGACY_SESSION_ID } from '@/utils/raceData.js';

export default function Sessions() {
  const {
    sessions,
    activeSessionId,
    selectSession,
    createSession,
    refreshSessions,
    isLoading,
    error,
    supportsSessions,
  } = useEventSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!supportsSessions) {
      const fallbackSession = activeSessionId ?? LEGACY_SESSION_ID;
      navigate(`/control/${fallbackSession}`, { replace: true });
    }
  }, [activeSessionId, navigate, supportsSessions]);

  useEffect(() => {
    if (!supportsSessions) return;
    if (!refreshSessions) return;
    refreshSessions().catch((refreshError) => {
      console.error('Failed to refresh sessions from chooser', refreshError);
    });
  }, [refreshSessions, supportsSessions]);

  const sortedSessions = useMemo(
    () =>
      [...(sessions ?? [])].sort((a, b) => {
        const aCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
        return bCreated - aCreated;
      }),
    [sessions],
  );

  const handleSelectSession = useCallback(
    (sessionId) => {
      if (!sessionId) return;
      selectSession(sessionId);
      navigate(`/control/${sessionId}`);
    },
    [navigate, selectSession],
  );

  const handleCreateSession = useCallback(async () => {
    const created = await createSession();
    if (created?.id) {
      selectSession(created.id);
      navigate(`/control/${created.id}`);
    }
  }, [createSession, navigate, selectSession]);

  if (!supportsSessions) {
    return null;
  }

  const isEmpty = !isLoading && sortedSessions.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold text-white">Select a session</h1>
        <p className="text-sm text-neutral-400">
          Choose a session to open race control. Create a new session to start a fresh log.
        </p>
      </header>
      <section className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1 text-left">
            <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Active session</span>
            <span className="text-sm font-semibold text-white">
              {activeSessionId ? `Session ${activeSessionId.slice(0, 8)}…` : 'None selected'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => void refreshSessions()}
              disabled={isLoading}
              className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-neutral-300 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => void handleCreateSession()}
              className="rounded-full border border-[#9FF7D3]/30 bg-[#9FF7D3]/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/60 hover:text-white"
            >
              New session
            </button>
          </div>
        </div>
        {error ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
        ) : null}
      </section>
      <section className="rounded-3xl border border-white/5 bg-[#05070F]/70 p-6">
        <h2 className="text-lg font-semibold text-white">Available sessions</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-neutral-400">Loading sessions…</p>
        ) : isEmpty ? (
          <p className="mt-4 text-sm text-neutral-400">No sessions available yet. Create one to get started.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {sortedSessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[#060910]/70 px-4 py-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-white">{session.name ?? 'Untitled session'}</span>
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                    {String(session.status ?? 'draft').toUpperCase()}
                    {session.starts_at ? ` • Starts ${new Date(session.starts_at).toLocaleString()}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectSession(session.id)}
                  className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
