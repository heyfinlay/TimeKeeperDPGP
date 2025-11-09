import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured, subscribeToTable, supabase } from '@/lib/supabaseClient.js';
import { useSessionId } from '@/state/SessionContext.jsx';

const SESSION_SELECT_COLUMNS =
  'id, name, event_id, phase, banner_state, started_at, clock_ms, lap_limit, is_final, created_at, updated_at';

const DEFAULT_SESSION = {
  id: null,
  name: 'Race Session',
  event_id: null,
  phase: 'warmup',
  banner_state: 'green',
  started_at: null,
  clock_ms: 0,
  lap_limit: null,
  is_final: false,
};

export function useRaceSession() {
  const sessionId = useSessionId();
  const [session, setSession] = useState(DEFAULT_SESSION);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const applySessionRow = useCallback((row) => {
    if (!mountedRef.current) return;
    if (!row) {
      setSession(DEFAULT_SESSION);
      return;
    }
    setSession({
      id: row.id ?? sessionId,
      name: row.name ?? DEFAULT_SESSION.name,
      event_id: row.event_id ?? null,
      phase: row.phase ?? row.procedure_phase ?? DEFAULT_SESSION.phase,
      banner_state: row.banner_state ?? row.flag_status ?? DEFAULT_SESSION.banner_state,
      started_at: row.started_at ?? row.race_started_at ?? null,
      clock_ms: Number.isFinite(row.clock_ms) ? row.clock_ms : Number.parseInt(row.clock_ms, 10) || 0,
      lap_limit: Number.isFinite(row.lap_limit)
        ? row.lap_limit
        : Number.parseInt(row.lap_limit, 10) || null,
      is_final: Boolean(row.is_final),
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    });
  }, [sessionId]);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!sessionId) {
        applySessionRow(DEFAULT_SESSION);
        setIsLoading(false);
        return DEFAULT_SESSION;
      }
      if (!isSupabaseConfigured || !supabase) {
        applySessionRow({ ...DEFAULT_SESSION, id: sessionId });
        setIsLoading(false);
        return DEFAULT_SESSION;
      }
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const { data, error: selectError } = await supabase
          .from('sessions')
          .select(SESSION_SELECT_COLUMNS)
          .eq('id', sessionId)
          .maybeSingle();
        if (selectError) throw selectError;
        applySessionRow(data ?? DEFAULT_SESSION);
        setError(null);
        return data ?? DEFAULT_SESSION;
      } catch (refreshError) {
        console.error('Failed to load session metadata', refreshError);
        setError(refreshError?.message ?? 'Unable to load session metadata.');
        return DEFAULT_SESSION;
      } finally {
        setIsLoading(false);
      }
    },
    [applySessionRow, sessionId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured || !supabase) {
      return () => {};
    }
    const unsubscribe = subscribeToTable(
      {
        schema: 'public',
        table: 'sessions',
        event: '*',
        filter: `id=eq.${sessionId}`,
      },
      (payload) => {
        if (payload?.new) {
          applySessionRow(payload.new);
        }
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, [sessionId, applySessionRow]);

  const sessionPhase = session?.phase ?? DEFAULT_SESSION.phase;
  const bannerState = session?.banner_state ?? DEFAULT_SESSION.banner_state;

  return {
    session,
    sessionPhase,
    bannerState,
    isLoading,
    error,
    refresh,
  };
}

export function useRaceClock(session) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = useMemo(() => {
    if (!session) return false;
    if (!session.started_at) return false;
    if (session.banner_state === 'suspended' || session.phase === 'red') {
      return false;
    }
    return session.phase === 'green' || session.phase === 'countdown' || session.phase === 'vsc' || session.phase === 'sc';
  }, [session]);

  useEffect(() => {
    if (!ticking) return () => {};
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => {
      window.clearInterval(interval);
    };
  }, [ticking]);

  const startedAtMs = session?.started_at ? new Date(session.started_at).getTime() : null;
  const baseClock = Number.isFinite(session?.clock_ms) ? session.clock_ms : 0;

  if (!startedAtMs) {
    return baseClock;
  }
  if (!ticking) {
    return baseClock;
  }
  const elapsed = Math.max(0, now - startedAtMs);
  return Math.max(baseClock, elapsed);
}
