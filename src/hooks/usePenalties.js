import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, subscribeToTable, supabase } from '@/lib/supabaseClient.js';
import { useSessionId } from '@/state/SessionContext.jsx';

const PENALTY_COLUMNS = 'id, driver_id, category, value_ms, reason, issued_by, created_at';

export function usePenalties() {
  const sessionId = useSessionId();
  const [penalties, setPenalties] = useState([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!sessionId) {
        setPenalties([]);
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
          .from('penalties')
          .select(PENALTY_COLUMNS)
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false });
        if (selectError) throw selectError;
        if (mountedRef.current) {
          setPenalties(Array.isArray(data) ? data : []);
          setError(null);
        }
        return data ?? [];
      } catch (refreshError) {
        console.error('Failed to load penalties', refreshError);
        if (mountedRef.current) {
          setError(refreshError?.message ?? 'Unable to load penalties.');
        }
        return [];
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [sessionId],
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
        table: 'penalties',
        event: '*',
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

  return { penalties, isLoading, error, refresh };
}
