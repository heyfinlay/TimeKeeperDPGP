/**
 * usePenalties Hook
 *
 * Real-time penalties for a session
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient.js';
import { getPenalties } from '@/services/penalties.js';

export function usePenalties(sessionId) {
  const [penalties, setPenalties] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setPenalties([]);
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const loadPenalties = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getPenalties(sessionId);
        if (mounted) {
          setPenalties(data);
        }
      } catch (err) {
        console.error('Failed to load penalties:', err);
        if (mounted) {
          setError(err.message);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadPenalties();

    // Subscribe to penalties changes
    const subscription = supabase
      .channel(`penalties:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'penalties',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          // Reload penalties on any change
          loadPenalties();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [sessionId]);

  return { penalties, isLoading, error, refresh: () => getPenalties(sessionId).then(setPenalties) };
}
