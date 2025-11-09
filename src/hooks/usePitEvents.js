/**
 * usePitEvents Hook
 *
 * Real-time pit events for a session
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient.js';
import { getPitEvents } from '@/services/pitEvents.js';

export function usePitEvents(sessionId) {
  const [pitEvents, setPitEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setPitEvents([]);
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const loadPitEvents = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getPitEvents(sessionId);
        if (mounted) {
          setPitEvents(data);
        }
      } catch (err) {
        console.error('Failed to load pit events:', err);
        if (mounted) {
          setError(err.message);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadPitEvents();

    // Subscribe to pit events changes
    const subscription = supabase
      .channel(`pit_events:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pit_events',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          // Reload pit events on any change
          loadPitEvents();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [sessionId]);

  return { pitEvents, isLoading, error, refresh: () => getPitEvents(sessionId).then(setPitEvents) };
}
