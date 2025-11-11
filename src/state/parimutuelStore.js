import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  isSupabaseConfigured,
  supabase,
  supabaseSelect,
  isTableMissingError,
} from '@/lib/supabaseClient.js';

const STORAGE_KEY = 'parimutuel-store:v1';

const baseState = {
  status: 'idle',
  events: [],
  supportsMarkets: isSupabaseConfigured,
  error: null,
  selectedEventId: null,
  selectedMarketId: null,
  pools: {},
  placement: {
    isPlacing: false,
    marketId: null,
    outcomeId: null,
    error: null,
    lastWager: null,
  },
  toast: null,
  lastLoadedAt: null,
};

const bootstrapState = () => {
  if (typeof window === 'undefined') {
    return baseState;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return baseState;
    }
    const parsed = JSON.parse(stored);
    return {
      ...baseState,
      selectedEventId: parsed?.selectedEventId ?? baseState.selectedEventId,
      selectedMarketId: parsed?.selectedMarketId ?? baseState.selectedMarketId,
    };
  } catch (error) {
    console.warn('Failed to bootstrap parimutuel store from storage', error);
    return baseState;
  }
};

const buildPoolsFromEvents = (events = []) => {
  return events.reduce((acc, event) => {
    if (!Array.isArray(event?.markets)) {
      return acc;
    }
    event.markets.forEach((market) => {
      if (!market?.id) {
        return;
      }
      const marketTotal = Number(market.pool_total ?? market.total_pool ?? 0);
      const rakeBps = Number.isFinite(Number(market.rake_bps)) ? Number(market.rake_bps) : 0;
      const outcomes = Array.isArray(market?.outcomes)
        ? market.outcomes.reduce((outAcc, outcome) => {
            if (!outcome?.id) {
              return outAcc;
            }
            const contribution = Number(outcome.pool_total ?? outcome.total_pool ?? outcome.total ?? 0);
            const wagers = Number(outcome.wager_count ?? outcome.total_wagers ?? 0);
            outAcc[outcome.id] = {
              total: Number.isFinite(contribution) ? contribution : 0,
              wagerCount: Number.isFinite(wagers) ? wagers : 0,
            };
            return outAcc;
          }, {})
        : {};
      const totalFromOutcomes = Object.values(outcomes).reduce((sum, value) => sum + value.total, 0);
      acc[market.id] = {
        total: Number.isFinite(marketTotal) && marketTotal > 0 ? marketTotal : totalFromOutcomes,
        outcomes,
        rakeBps,
      };
    });
    return acc;
  }, {});
};

const findEvent = (events, eventId) => events.find((event) => event.id === eventId) ?? null;

const findMarket = (events, marketId) => {
  for (const event of events) {
    if (!Array.isArray(event?.markets)) continue;
    const market = event.markets.find((item) => item.id === marketId);
    if (market) {
      return market;
    }
  }
  return null;
};

const findOutcome = (market, outcomeId) =>
  market?.outcomes?.find((outcome) => outcome.id === outcomeId) ?? null;

const updateEventsWithPool = (events, marketId, outcomeId, delta) =>
  events.map((event) => ({
    ...event,
    markets: event.markets?.map((market) => {
      if (market.id !== marketId) {
        return market;
      }
      const nextMarketTotal = Number(market.pool_total ?? 0) + delta;
      return {
        ...market,
        pool_total: Math.max(0, nextMarketTotal),
        outcomes: market.outcomes?.map((outcome) => {
          if (outcome.id !== outcomeId) {
            return outcome;
          }
          const nextOutcomeTotal = Number(outcome.pool_total ?? 0) + delta;
          return {
            ...outcome,
            pool_total: Math.max(0, nextOutcomeTotal),
          };
        }),
      };
    }),
  }));

const updatePoolsWithDelta = (pools, marketId, outcomeId, delta) => {
  const existing = pools[marketId] ?? { total: 0, outcomes: {}, rakeBps: 0 };
  const outcome = existing.outcomes[outcomeId] ?? { total: 0, wagerCount: 0 };
  const total = Math.max(0, Number(existing.total ?? 0) + delta);
  return {
    ...pools,
    [marketId]: {
      ...existing,
      total,
      outcomes: {
        ...existing.outcomes,
        [outcomeId]: {
          ...outcome,
          total: Math.max(0, Number(outcome.total ?? 0) + delta),
          wagerCount: (outcome.wagerCount ?? 0) + 1,
        },
      },
    },
  };
};

export const driverStats = (market, pool) => {
  if (!market) {
    return [];
  }
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const totalPool = Number(pool?.total ?? market?.pool_total ?? 0);
  const rakeBps = Number.isFinite(Number(pool?.rakeBps ?? market?.rake_bps))
    ? Number(pool?.rakeBps ?? market?.rake_bps)
    : 0;
  const rakeMultiplier = Math.max(0, 1 - rakeBps / 10000);
  const netPool = totalPool * rakeMultiplier;
  return outcomes
    .map((outcome) => {
      const contribution = Number(pool?.outcomes?.[outcome.id]?.total ?? outcome.pool_total ?? 0);
      const wagerCount = Number(pool?.outcomes?.[outcome.id]?.wagerCount ?? outcome.wager_count ?? 0);
      const share = totalPool > 0 ? contribution / totalPool : 0;
      const odds = contribution > 0 ? netPool / contribution : 0;
      return {
        outcomeId: outcome.id,
        label: outcome.label ?? 'Outcome',
        total: Math.max(0, contribution),
        share,
        wagerCount,
        odds,
        impliedProbability: share,
      };
    })
    .sort((a, b) => b.total - a.total);
};

export const settleEvent = (event, winningOutcomeIds = []) => {
  if (!event) {
    return event;
  }
  const winners = new Set(Array.isArray(winningOutcomeIds) ? winningOutcomeIds : [winningOutcomeIds]);
  return {
    ...event,
    status: 'settled',
    markets: event.markets?.map((market) => ({
      ...market,
      status: 'settled',
      outcomes: market.outcomes?.map((outcome) => ({
        ...outcome,
        is_winner: winners.has(outcome.id),
      })),
    })),
  };
};

export const validateWager = ({ stake, balance, market, outcome, now = new Date() }) => {
  const issues = [];
  const stakeValue = Number(stake);
  const balanceValue = Number(balance);
  if (!market) {
    issues.push('No market selected.');
  }
  if (!outcome) {
    issues.push('No outcome selected.');
  }
  if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
    issues.push('Stake must be greater than zero.');
  }
  if (Number.isFinite(balanceValue) && stakeValue > balanceValue) {
    issues.push('Insufficient balance.');
  }
  if (market?.status && String(market.status).toLowerCase() !== 'open') {
    issues.push('Market is not open for wagering.');
  }
  if (market?.closes_at) {
    const closeDate = new Date(market.closes_at);
    if (!Number.isNaN(closeDate.getTime()) && closeDate.getTime() <= now.getTime()) {
      issues.push('Market has closed.');
    }
  }
  return {
    valid: issues.length === 0,
    issues,
  };
};

const ActionTypes = {
  LOAD_START: 'LOAD_START',
  LOAD_SUCCESS: 'LOAD_SUCCESS',
  LOAD_ERROR: 'LOAD_ERROR',
  SELECT_EVENT: 'SELECT_EVENT',
  SELECT_MARKET: 'SELECT_MARKET',
  PLACE_WAGER_START: 'PLACE_WAGER_START',
  PLACE_WAGER_SUCCESS: 'PLACE_WAGER_SUCCESS',
  PLACE_WAGER_ERROR: 'PLACE_WAGER_ERROR',
  CLEAR_TOAST: 'CLEAR_TOAST',
  SETTLE_EVENT: 'SETTLE_EVENT',
};

const reducer = (state, action) => {
  switch (action.type) {
    case ActionTypes.LOAD_START:
      return {
        ...state,
        status: 'loading',
        error: null,
      };
    case ActionTypes.LOAD_SUCCESS: {
      const events = action.payload?.events ?? [];
      const pools = buildPoolsFromEvents(events);
      const persistedEventId = state.selectedEventId;
      const persistedMarketId = state.selectedMarketId;
      const nextEvent =
        events.find((event) => event.id === persistedEventId) ?? events[0] ?? null;
      const nextMarket = nextEvent?.markets?.find((market) => market.id === persistedMarketId);
      const fallbackMarket = nextEvent?.markets?.[0] ?? null;
      return {
        ...state,
        status: 'ready',
        events,
        supportsMarkets: action.payload?.supportsMarkets ?? state.supportsMarkets,
        error: null,
        pools,
        selectedEventId: nextEvent?.id ?? null,
        selectedMarketId: nextMarket?.id ?? fallbackMarket?.id ?? null,
        lastLoadedAt: new Date().toISOString(),
      };
    }
    case ActionTypes.LOAD_ERROR:
      return {
        ...state,
        status: 'error',
        error: action.payload?.message ?? 'Failed to load markets.',
        supportsMarkets: action.payload?.supportsMarkets ?? false,
        events: [],
        pools: {},
      };
    case ActionTypes.SELECT_EVENT: {
      const event = findEvent(state.events, action.payload?.eventId);
      const fallbackMarket = event?.markets?.[0] ?? null;
      return {
        ...state,
        selectedEventId: event?.id ?? null,
        selectedMarketId: fallbackMarket?.id ?? null,
        toast: null,
      };
    }
    case ActionTypes.SELECT_MARKET:
      return {
        ...state,
        selectedMarketId: action.payload?.marketId ?? null,
        toast: null,
      };
    case ActionTypes.PLACE_WAGER_START:
      return {
        ...state,
        placement: {
          isPlacing: true,
          marketId: action.payload?.marketId ?? null,
          outcomeId: action.payload?.outcomeId ?? null,
          error: null,
          lastWager: null,
        },
        toast: null,
      };
    case ActionTypes.PLACE_WAGER_SUCCESS: {
      const { marketId, outcomeId, stake = 0, wager, message } = action.payload ?? {};
      const delta = Number(stake) || 0;
      return {
        ...state,
        events: updateEventsWithPool(state.events, marketId, outcomeId, delta),
        pools: updatePoolsWithDelta(state.pools, marketId, outcomeId, delta),
        placement: {
          isPlacing: false,
          marketId,
          outcomeId,
          error: null,
          lastWager: wager ?? null,
        },
        toast: message
          ? { type: 'success', message }
          : { type: 'success', message: 'Wager placed successfully.' },
      };
    }
    case ActionTypes.PLACE_WAGER_ERROR:
      return {
        ...state,
        placement: {
          isPlacing: false,
          marketId: action.payload?.marketId ?? null,
          outcomeId: action.payload?.outcomeId ?? null,
          error: action.payload?.message ?? 'Failed to place wager.',
          lastWager: null,
        },
        toast: {
          type: 'error',
          message: action.payload?.message ?? 'Failed to place wager.',
        },
      };
    case ActionTypes.CLEAR_TOAST:
      return {
        ...state,
        toast: null,
      };
    case ActionTypes.SETTLE_EVENT: {
      const { eventId, winners } = action.payload ?? {};
      return {
        ...state,
        events: state.events.map((event) =>
          event.id === eventId ? settleEvent(event, winners) : event,
        ),
      };
    }
    default:
      return state;
  }
};

const ParimutuelContext = createContext({ state: baseState, actions: {} });

export const ParimutuelActionTypes = ActionTypes;
export const createParimutuelState = () => ({
  ...baseState,
  events: [],
  pools: {},
  placement: { ...baseState.placement },
});
export const parimutuelReducer = reducer;

export function ParimutuelProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, bootstrapState);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const persistable = {
      selectedEventId: state.selectedEventId,
      selectedMarketId: state.selectedMarketId,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch (error) {
      console.warn('Failed to persist parimutuel store', error);
    }
  }, [state.selectedEventId, state.selectedMarketId]);

  const loadEvents = useCallback(async () => {
    if (!isSupabaseConfigured) {
      dispatch({
        type: ActionTypes.LOAD_ERROR,
        payload: { supportsMarkets: false, message: 'Supabase is not configured.' },
      });
      return { success: false, error: new Error('Supabase not configured') };
    }

    dispatch({ type: ActionTypes.LOAD_START });
    try {
      const rows = await supabaseSelect('events', {
        select:
          'id,title,venue,starts_at,status,session_id,markets(id,name,type,rake_bps,status,closes_at,outcomes(id,label,sort_order,color,driver_id))',
        order: { column: 'starts_at', ascending: true },
      });
      const events = Array.isArray(rows)
        ? rows.map((event) => ({
            ...event,
            markets: Array.isArray(event?.markets)
              ? event.markets.map((market) => ({
                  ...market,
                  outcomes: Array.isArray(market?.outcomes)
                    ? market.outcomes.map((outcome) => ({
                        ...outcome,
                      }))
                    : [],
                }))
              : [],
          }))
        : [];
      dispatch({
        type: ActionTypes.LOAD_SUCCESS,
        payload: { events, supportsMarkets: true },
      });
      return { success: true, events };
    } catch (error) {
      if (isTableMissingError(error, 'events')) {
        dispatch({
          type: ActionTypes.LOAD_ERROR,
          payload: {
            supportsMarkets: false,
            message: null,
          },
        });
        return { success: false, error };
      }
      console.error('Failed to load parimutuel events', error);
      dispatch({
        type: ActionTypes.LOAD_ERROR,
        payload: {
          supportsMarkets: true,
          message: error?.message ?? 'Failed to load markets.',
        },
      });
      return { success: false, error };
    }
  }, []);

  const selectEvent = useCallback((eventId) => {
    dispatch({ type: ActionTypes.SELECT_EVENT, payload: { eventId } });
  }, []);

  const selectMarket = useCallback((marketId) => {
    dispatch({ type: ActionTypes.SELECT_MARKET, payload: { marketId } });
  }, []);

  const placeWager = useCallback(
    async ({ marketId, outcomeId, stake, balance }) => {
      const currentState = stateRef.current;
      const activeMarketId = marketId ?? currentState.selectedMarketId;
      const market = findMarket(currentState.events, activeMarketId);
      const outcome = findOutcome(market, outcomeId);
      const { valid, issues } = validateWager({
        stake,
        balance,
        market,
        outcome,
      });

      if (!valid) {
        const message = issues[0] ?? 'Unable to place wager.';
        dispatch({
          type: ActionTypes.PLACE_WAGER_ERROR,
          payload: { message, marketId: activeMarketId, outcomeId: outcome?.id ?? null },
        });
        return { success: false, issues };
      }

      if (!isSupabaseConfigured || !supabase) {
        dispatch({
          type: ActionTypes.PLACE_WAGER_SUCCESS,
          payload: {
            marketId: activeMarketId,
            outcomeId: outcome.id,
            stake: Number(stake) || 0,
            wager: {
              id: `local-${Date.now()}`,
              stake: Number(stake) || 0,
              outcomeId: outcome.id,
              marketId: activeMarketId,
            },
            message: 'Wager recorded locally (offline mode).',
          },
        });
        return { success: true, offline: true };
      }

      dispatch({
        type: ActionTypes.PLACE_WAGER_START,
        payload: { marketId: activeMarketId, outcomeId: outcome.id },
      });

      try {
        const { data, error } = await supabase.rpc('place_wager', {
          p_market_id: activeMarketId,
          p_outcome_id: outcome.id,
          p_stake: Number(stake) || 0,
        });
        if (error) {
          throw error;
        }
        if (!data?.success) {
          throw new Error(data?.message || 'Failed to place wager');
        }
        dispatch({
          type: ActionTypes.PLACE_WAGER_SUCCESS,
          payload: {
            marketId: activeMarketId,
            outcomeId: outcome.id,
            stake: Number(stake) || 0,
            wager: {
              id: data.wager_id,
              stake: Number(stake) || 0,
              outcomeId: outcome.id,
              marketId: activeMarketId,
            },
            message: data.message ?? 'Wager placed successfully.',
          },
        });
        return { success: true, data };
      } catch (error) {
        console.error('Failed to place wager via Supabase', error);
        const message = error?.message ?? 'Failed to place wager.';
        dispatch({
          type: ActionTypes.PLACE_WAGER_ERROR,
          payload: {
            message,
            marketId: activeMarketId,
            outcomeId: outcome.id,
          },
        });
        return { success: false, error };
      }
    },
    [],
  );

  const clearToast = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_TOAST });
  }, []);

  const value = useMemo(
    () => ({
      state,
      actions: {
        loadEvents,
        selectEvent,
        selectMarket,
        placeWager,
        clearToast,
      },
    }),
    [state, loadEvents, selectEvent, selectMarket, placeWager, clearToast],
  );

  return createElement(ParimutuelContext.Provider, { value }, children);
}

export const useParimutuelStore = () => {
  const context = useContext(ParimutuelContext);
  if (!context) {
    throw new Error('useParimutuelStore must be used within a ParimutuelProvider');
  }
  return context;
};

