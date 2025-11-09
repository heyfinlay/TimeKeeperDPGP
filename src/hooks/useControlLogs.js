import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, subscribeToTable, supabase } from '@/lib/supabaseClient.js';
import { useSessionId } from '@/state/SessionContext.jsx';

const CONTROL_LOG_COLUMNS = 'id, action, payload, actor, created_at';

export function useControlLogs({ limit = 80 } = {}) {
  const sessionId = useSessionId();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!sessionId) {
        setLogs([]);
        setIsLoading(false);
        return [];
      }
      if (!isSupabaseConfigured || !supabase) {
        setIsLoading(false);
        return [];
      }
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const { data, error: selectError } = await supabase
          .from('control_logs')
          .select(CONTROL_LOG_COLUMNS)
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (selectError) throw selectError;
        if (mountedRef.current) {
          setLogs(Array.isArray(data) ? data : []);
          setError(null);
        }
        return data ?? [];
      } catch (refreshError) {
        console.error('Failed to load control logs', refreshError);
        if (mountedRef.current) {
          setError(refreshError?.message ?? 'Unable to load control logs.');
        }
        return [];
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [sessionId, limit],
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
        table: 'control_logs',
        event: 'INSERT',
        filter: `session_id=eq.${sessionId}`,
      },
      () => {
        void refresh({ silent: true });
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, [sessionId, refresh]);

  return { logs, isLoading, error, refresh };
}
