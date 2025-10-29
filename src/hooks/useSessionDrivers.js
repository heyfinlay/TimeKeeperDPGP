import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionId } from '@/state/SessionContext.jsx';
import { isSupabaseConfigured, subscribeToTable, supabase } from '@/lib/supabaseClient.js';

const DRIVERS_SELECT_COLUMNS =
  'id, number, name, team, laps, last_lap_ms, best_lap_ms, pits, total_time_ms, marshal_user_id';

export function useSessionDrivers({ onlyMine = false, userId } = {}) {
  const sessionId = useSessionId();
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!sessionId) {
        if (!mountedRef.current) return [];
        setDrivers([]);
        setIsLoading(false);
        setError(null);
        return [];
      }
      if (!isSupabaseConfigured || !supabase) {
        if (!mountedRef.current) return [];
        setIsLoading(false);
        return [];
      }

      if (!silent && mountedRef.current) {
        setIsLoading(true);
      }

      try {
        let query = supabase
          .from('drivers')
          .select(DRIVERS_SELECT_COLUMNS)
          .eq('session_id', sessionId)
          .order('number', { ascending: true, nullsFirst: true });
        if (onlyMine && userId) {
          query = query.eq('marshal_user_id', userId);
        }
        const { data, error: selectError } = await query;
        if (selectError) {
          throw selectError;
        }
        if (!mountedRef.current) return data ?? [];
        setDrivers(Array.isArray(data) ? data : []);
        setError(null);
        return data ?? [];
      } catch (refreshError) {
        console.error('Failed to load session drivers', refreshError);
        if (!mountedRef.current) return [];
        setError(refreshError?.message ?? 'Unable to load drivers.');
        return [];
      } finally {
        if (!mountedRef.current) return [];
        setIsLoading(false);
      }
    },
    [sessionId, onlyMine, userId],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!sessionId) {
      setDrivers([]);
      setIsLoading(false);
      setError(null);
      return () => {};
    }
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return () => {};
    }

    void refresh();

    const stopDrivers = subscribeToTable(
      {
        schema: 'public',
        table: 'drivers',
        event: '*',
        filter: `session_id=eq.${sessionId}`,
      },
      () => {
        void refresh({ silent: true });
      },
    );
    const stopLaps = subscribeToTable(
      {
        schema: 'public',
        table: 'laps',
        event: '*',
        filter: `session_id=eq.${sessionId}`,
      },
      () => {
        void refresh({ silent: true });
      },
    );

    return () => {
      stopDrivers?.();
      stopLaps?.();
    };
  }, [sessionId, refresh]);

  return {
    drivers,
    isLoading,
    error,
    refresh,
  };
}
