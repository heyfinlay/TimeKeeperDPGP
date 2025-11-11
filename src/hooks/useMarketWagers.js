import { useCallback, useEffect, useState } from 'react';
import {
  isSupabaseConfigured,
  supabaseSelect,
  subscribeToTable,
  isTableMissingError,
} from '@/lib/supabaseClient.js';

const DEFAULT_LIMIT = 12;

export function useMarketWagers(marketId, { limit = DEFAULT_LIMIT } = {}) {
  const [wagers, setWagers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [supportsWagers, setSupportsWagers] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);

  const loadWagers = useCallback(async () => {
    if (!marketId || !isSupabaseConfigured) {
      setSupportsWagers(isSupabaseConfigured);
      setWagers([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const rows = await supabaseSelect('wagers', {
        select:
          'id,stake,placed_at,outcome_id,market_id,outcomes(label,color,abbreviation),markets(name)',
        filters: {
          market_id: `eq.${marketId}`,
          limit: String(limit),
        },
        order: { column: 'placed_at', ascending: false },
      });

      const normalized = Array.isArray(rows)
        ? rows.map((row) => ({
            id: row.id,
            stake: Number(row.stake ?? 0),
            placedAt: row.placed_at,
            outcomeId: row.outcome_id,
            marketId: row.market_id,
            outcomeLabel: row.outcomes?.label ?? 'Outcome',
            outcomeColor: row.outcomes?.color ?? null,
            outcomeAbbreviation: row.outcomes?.abbreviation ?? null,
            marketName: row.markets?.name ?? '',
          }))
        : [];

      setWagers(normalized);
      setSupportsWagers(true);
      setError(null);
    } catch (caughtError) {
      if (isTableMissingError(caughtError, 'wagers')) {
        setSupportsWagers(false);
        setWagers([]);
        setError(null);
      } else {
        console.error('Failed to load market wagers', caughtError);
        setError(caughtError);
      }
    } finally {
      setIsLoading(false);
    }
  }, [limit, marketId]);

  useEffect(() => {
    void loadWagers();
  }, [loadWagers]);

  useEffect(() => {
    if (!marketId || !isSupabaseConfigured || !supportsWagers) {
      return undefined;
    }

    const unsubscribe = subscribeToTable(
      { schema: 'public', table: 'wagers', event: '*', filter: `market_id=eq.${marketId}` },
      () => {
        void loadWagers();
      },
      { maxRetries: 3 },
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [marketId, loadWagers, supportsWagers]);

  return {
    wagers,
    isLoading,
    supportsWagers,
    error,
    reload: loadWagers,
  };
}
