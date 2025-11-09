/**
 * useControlLogs Hook
 *
 * Real-time control logs (audit trail) for a session
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient.js';

export function useControlLogs(sessionId, limit = 50) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setLogs([]);
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const loadLogs = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('control_logs')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (fetchError) throw fetchError;

        if (mounted) {
          setLogs(data || []);
        }
      } catch (err) {
        console.error('Failed to load control logs:', err);
        if (mounted) {
          setError(err.message);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadLogs();

    // Subscribe to control logs changes (INSERT only for performance)
    const subscription = supabase
      .channel(`control_logs:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'control_logs',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (mounted && payload.new) {
            // Prepend new log entry
            setLogs((prev) => [payload.new, ...prev].slice(0, limit));
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [sessionId, limit]);

  return { logs, isLoading, error };
}
