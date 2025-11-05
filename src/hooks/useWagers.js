import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext.jsx';
import {
  isSupabaseConfigured,
  supabaseSelect,
  subscribeToTable,
  isTableMissingError,
} from '@/lib/supabaseClient.js';

export function useWagers() {
  const { status, user } = useAuth();
  const [wagers, setWagers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [supportsWagers, setSupportsWagers] = useState(!isSupabaseConfigured);

  const userId = user?.id ?? null;
  const isReady = isSupabaseConfigured && status === 'authenticated' && Boolean(userId);

  useEffect(() => {
    if (!isReady) {
      setWagers([]);
      setSupportsWagers(false);
      setIsLoading(false);
      return;
    }

    let isActive = true;
    const loadWagers = async () => {
      setIsLoading(true);
      try {
        const rows = await supabaseSelect('wagers', {
          select: 'id,stake,placed_at,status,outcome_id,market_id,markets(name,type,event_id,events(title)),outcomes(label)',
          filters: { user_id: `eq.${userId}` },
          order: { column: 'placed_at', ascending: false },
        });

        if (!isActive) return;

        const normalized = Array.isArray(rows)
          ? rows.map((w) => ({
              id: w.id,
              stake: w.stake,
              placedAt: w.placed_at,
              status: w.status,
              outcomeLabel: w.outcomes?.label || 'Unknown',
              marketName: w.markets?.name || 'Unknown Market',
              marketType: w.markets?.type || '',
              eventTitle: w.markets?.events?.title || 'Unknown Event',
            }))
          : [];

        setWagers(normalized);
        setSupportsWagers(true);
      } catch (error) {
        if (!isActive) return;
        if (isTableMissingError(error, 'wagers')) {
          setSupportsWagers(false);
          setWagers([]);
        } else {
          console.error('Failed to load wagers:', error);
          setWagers([]);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadWagers();

    return () => {
      isActive = false;
    };
  }, [isReady, userId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!isReady || !supportsWagers) return;

    const unsubscribe = subscribeToTable(
      {
        schema: 'public',
        table: 'wagers',
        event: '*',
        filter: `user_id=eq.${userId}`,
      },
      () => {
        // Reload wagers on any change
        void (async () => {
          try {
            const rows = await supabaseSelect('wagers', {
              select: 'id,stake,placed_at,status,outcome_id,market_id,markets(name,type,event_id,events(title)),outcomes(label)',
              filters: { user_id: `eq.${userId}` },
              order: { column: 'placed_at', ascending: false },
            });

            const normalized = Array.isArray(rows)
              ? rows.map((w) => ({
                  id: w.id,
                  stake: w.stake,
                  placedAt: w.placed_at,
                  status: w.status,
                  outcomeLabel: w.outcomes?.label || 'Unknown',
                  marketName: w.markets?.name || 'Unknown Market',
                  marketType: w.markets?.type || '',
                  eventTitle: w.markets?.events?.title || 'Unknown Event',
                }))
              : [];

            setWagers(normalized);
          } catch (error) {
            console.error('Failed to reload wagers:', error);
          }
        })();
      },
      { maxRetries: 3 },
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [isReady, userId, supportsWagers]);

  return { wagers, isLoading, supportsWagers };
}
