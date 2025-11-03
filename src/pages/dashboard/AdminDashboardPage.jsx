import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCcw } from 'lucide-react';
import SessionMarshalAssignments from '@/components/admin/SessionMarshalAssignments.jsx';
import {
  assignMarshalToDriver,
  fetchAdminSessions,
  fetchMarshalDirectory,
  updateSessionState,
} from '@/services/admin.js';
import { isSupabaseConfigured } from '@/lib/supabaseClient.js';

const describeStatus = (session) => {
  const status = String(session?.status ?? 'draft').toLowerCase();
  const label = status.replace(/_/g, ' ');
  const startsAt = session?.starts_at ? new Date(session.starts_at) : null;
  const endsAt = session?.ends_at ? new Date(session.ends_at) : null;
  const updatedAt = session?.updated_at ? new Date(session.updated_at) : null;

  const parts = [];
  if (startsAt) {
    parts.push(`Starts ${startsAt.toLocaleString()}`);
  }
  if (endsAt) {
    parts.push(`Ends ${endsAt.toLocaleString()}`);
  }
  if (!startsAt && updatedAt) {
    parts.push(`Updated ${updatedAt.toLocaleString()}`);
  }

  return {
    label: label ? label[0].toUpperCase() + label.slice(1) : 'Draft',
    detail: parts.join(' • '),
  };
};

export default function AdminDashboardPage() {
  const [sessions, setSessions] = useState([]);
  const [marshals, setMarshals] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingAssignments, setPendingAssignments] = useState({});

  const sessionLookup = useMemo(() => {
    const map = new Map();
    sessions.forEach((session) => {
      map.set(session.id, session);
    });
    return map;
  }, [sessions]);

  const refreshData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSessions([]);
      setMarshals([]);
      setError('Supabase is not configured. Admin dashboard is unavailable.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [sessionRows, marshalRows] = await Promise.all([fetchAdminSessions(), fetchMarshalDirectory()]);
      setSessions(Array.isArray(sessionRows) ? sessionRows : []);
      setMarshals(Array.isArray(marshalRows) ? marshalRows : []);
    } catch (loadError) {
      console.error('Failed to load admin dashboard data', loadError);
      setError(loadError?.message ?? 'Unable to load admin dashboard data.');
      setSessions([]);
      setMarshals([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshData();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshData]);

  const handleAssignMarshal = useCallback(
    async (sessionId, driverId, marshalId) => {
      const nextMarshalId = marshalId?.trim() ? marshalId : '';
      const currentSession = sessionLookup.get(sessionId);
      const currentDriver = currentSession?.drivers?.find((driver) => driver.id === driverId) ?? null;
      const previousMarshal = currentDriver?.marshal_user_id ?? '';

      setPendingAssignments((prev) => ({ ...prev, [driverId]: true }));
      setSessions((prevSessions) =>
        prevSessions.map((session) => {
          if (session.id !== sessionId) return session;
          return {
            ...session,
            drivers: session.drivers.map((driver) =>
              driver.id === driverId
                ? { ...driver, marshal_user_id: nextMarshalId || null }
                : driver,
            ),
          };
        }),
      );

      try {
        await assignMarshalToDriver({ sessionId, driverId, marshalUserId: nextMarshalId || null });
        setError(null);
      } catch (assignError) {
        console.error('Failed to assign marshal', assignError);
        setSessions((prevSessions) =>
          prevSessions.map((session) => {
            if (session.id !== sessionId) return session;
            return {
              ...session,
              drivers: session.drivers.map((driver) =>
                driver.id === driverId
                  ? { ...driver, marshal_user_id: previousMarshal || null }
                  : driver,
              ),
            };
          }),
        );
        setError(assignError?.message ?? 'Unable to assign marshal to driver.');
      } finally {
        setPendingAssignments((prev) => {
          const next = { ...prev };
          delete next[driverId];
          return next;
        });
      }
    },
    [sessionLookup],
  );

  const handleSessionStateUpdate = useCallback(
    async (sessionId, patch) => {
      const currentSession = sessionLookup.get(sessionId);
      const previousSession = currentSession ? { ...currentSession } : null;
      setSessions((prevSessions) =>
        prevSessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                ...patch,
              }
            : session,
        ),
      );
      try {
        const updated = await updateSessionState(sessionId, patch);
        if (updated) {
          setSessions((prevSessions) =>
            prevSessions.map((session) => (session.id === sessionId ? { ...session, ...updated } : session)),
          );
        }
        setError(null);
      } catch (updateError) {
        console.error('Failed to update session state', updateError);
        if (previousSession) {
          setSessions((prevSessions) =>
            prevSessions.map((session) => (session.id === sessionId ? previousSession : session)),
          );
        }
        setError(updateError?.message ?? 'Unable to update session state.');
      }
    },
    [sessionLookup],
  );

  const sessionCount = sessions.length;

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-10 text-center text-sm text-neutral-300">
        <h1 className="text-2xl font-semibold text-white">Admin dashboard unavailable</h1>
        <p className="text-neutral-400">
          Supabase must be configured to manage sessions and marshal assignments.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold text-white">Admin control</h1>
        <p className="text-sm text-neutral-400">
          Review every race session, update statuses, and assign marshals across the grid.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs uppercase tracking-[0.35em] text-neutral-400">
          <span className="rounded-full border border-white/10 px-4 py-2 text-white/80">
            {sessionCount} session{sessionCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRefreshing || isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Refreshing…
              </>
            ) : (
              <>
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </>
            )}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-3xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-[20vh] items-center justify-center text-sm text-neutral-400">
          Loading sessions…
        </div>
      ) : null}

      {!isLoading && sessions.length === 0 ? (
        <div className="rounded-3xl border border-white/5 bg-[#05070F]/80 px-6 py-5 text-center text-sm text-neutral-300">
          No sessions found. Create one to begin assigning marshals.
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {sessions.map((session) => {
          const status = describeStatus(session);
          return (
            <section key={session.id} className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
              <header className="flex flex-col gap-2 text-left md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">{session.name ?? 'Unnamed session'}</h2>
                  <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">
                    {status.label}
                    {status.detail ? ` • ${status.detail}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/control/${session.id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
                  >
                    Open control
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      handleSessionStateUpdate(session.id, {
                        status: 'active',
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white"
                  >
                    Mark active
                  </button>
                </div>
              </header>
              <SessionMarshalAssignments
                session={session}
                marshals={marshals}
                pendingAssignments={pendingAssignments}
                onAssign={handleAssignMarshal}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
