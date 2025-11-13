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
import { computeToteQuote } from '@/utils/tote.js';

const STORAGE_KEY = 'parimutuel-store:v1';

const baseState = {
  status: 'idle',
  events: [],
  supportsMarkets: isSupabaseConfigured,
  error: null,
  selectedEventId: null,
  selectedMarketId: null,
  pools: {},
  poolHistory: {},
  quotePreview: {
    marketId: null,
    outcomeId: null,
    stake: 0,
    quote: null,
    source: 'local',
    isLoading: false,
    error: null,
    updatedAt: null,
  },
  historyWindow: '1m',
  realtime: {
    lastUpdate: null,
    isStale: false,
    lagMs: 0,
  },
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

const clampNumber = (value, min, max) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const resolveTakeout = (market, fallback = 0.1) => {
  const takeout = Number(market?.takeout);
  if (Number.isFinite(takeout)) {
    return clampNumber(takeout, 0, 0.25);
  }
  const rakeBps = Number(market?.rake_bps);
  if (Number.isFinite(rakeBps)) {
    return clampNumber(rakeBps / 10000, 0, 0.25);
  }
  return fallback;
};

const createEmptyHistoryEntry = () => ({
  windows: {},
  isLoading: {},
  errors: {},
  lastUpdatedAt: {},
});

const buildLocalHistoryPayload = ({ market, pool, windowKey }) => {
  const stats = driverStats(market, pool);
  const now = new Date().toISOString();
  const total = Number(pool?.total ?? market?.pool_total ?? 0);
  const takeout = resolveTakeout(pool ?? market);
  return {
    window: windowKey,
    anchorAt: now,
    updatedAt: now,
    takeout,
    totalPool: Number.isFinite(total) ? total : 0,
    anchorPool: Number.isFinite(total) ? total : 0,
    runners: stats.map((entry) => ({
      outcomeId: entry.outcomeId,
      label: entry.label,
      current: {
        pool: entry.total,
        share: entry.share,
        odds: entry.odds || null,
        wagerCount: entry.wagerCount,
      },
      anchor: {
        pool: entry.total,
        share: entry.share,
        odds: entry.odds || null,
        timestamp: now,
      },
      delta: {
        share: 0,
        handle: 0,
        odds: 0,
        trend: 'flat',
      },
      sparkline: [],
    })),
  };
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
      const takeout = resolveTakeout(market);
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
        takeout,
        updatedAt: market.updated_at ?? market.closes_at ?? null,
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
  const existing = pools[marketId] ?? { total: 0, outcomes: {}, takeout: 0.1 };
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
  const takeout = resolveTakeout(pool ?? market);
  const rakeMultiplier = Math.max(0, 1 - takeout);
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
  LOAD_HISTORY_START: 'LOAD_HISTORY_START',
  LOAD_HISTORY_SUCCESS: 'LOAD_HISTORY_SUCCESS',
  LOAD_HISTORY_ERROR: 'LOAD_HISTORY_ERROR',
  SET_HISTORY_WINDOW: 'SET_HISTORY_WINDOW',
  SYNC_POOL_SUMMARY: 'SYNC_POOL_SUMMARY',
  PREVIEW_QUOTE_START: 'PREVIEW_QUOTE_START',
  PREVIEW_QUOTE_SUCCESS: 'PREVIEW_QUOTE_SUCCESS',
  PREVIEW_QUOTE_ERROR: 'PREVIEW_QUOTE_ERROR',
  CLEAR_QUOTE_PREVIEW: 'CLEAR_QUOTE_PREVIEW',
  SET_REALTIME_STATUS: 'SET_REALTIME_STATUS',
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
      const history = {};
      events.forEach((event) => {
        event?.markets?.forEach((market) => {
          if (!history[market.id]) {
            history[market.id] = createEmptyHistoryEntry();
          }
        });
      });
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
        poolHistory: history,
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
        poolHistory: {},
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
      const events = updateEventsWithPool(state.events, marketId, outcomeId, delta);
      const pools = updatePoolsWithDelta(state.pools, marketId, outcomeId, delta);
      return {
        ...state,
        events,
        pools,
        placement: {
          isPlacing: false,
          marketId,
          outcomeId,
          error: null,
          lastWager: wager ?? null,
        },
        quotePreview:
          state.quotePreview.marketId === marketId
            ? { ...baseState.quotePreview }
            : state.quotePreview,
        realtime: {
          ...state.realtime,
          lastUpdate: new Date().toISOString(),
          isStale: false,
          lagMs: 0,
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
    case ActionTypes.LOAD_HISTORY_START: {
      const { marketId, window: windowKey } = action.payload ?? {};
      if (!marketId || !windowKey) {
        return state;
      }
      const existing = state.poolHistory[marketId] ?? createEmptyHistoryEntry();
      return {
        ...state,
        poolHistory: {
          ...state.poolHistory,
          [marketId]: {
            ...existing,
            isLoading: { ...existing.isLoading, [windowKey]: true },
            errors: { ...existing.errors, [windowKey]: null },
          },
        },
      };
    }
    case ActionTypes.LOAD_HISTORY_SUCCESS: {
      const { marketId, window: windowKey, payload } = action.payload ?? {};
      if (!marketId || !windowKey) {
        return state;
      }
      const existing = state.poolHistory[marketId] ?? createEmptyHistoryEntry();
      return {
        ...state,
        poolHistory: {
          ...state.poolHistory,
          [marketId]: {
            ...existing,
            windows: { ...existing.windows, [windowKey]: payload },
            isLoading: { ...existing.isLoading, [windowKey]: false },
            errors: { ...existing.errors, [windowKey]: null },
            lastUpdatedAt: {
              ...existing.lastUpdatedAt,
              [windowKey]: payload?.updatedAt ?? new Date().toISOString(),
            },
          },
        },
      };
    }
    case ActionTypes.LOAD_HISTORY_ERROR: {
      const { marketId, window: windowKey, error } = action.payload ?? {};
      if (!marketId || !windowKey) {
        return state;
      }
      const existing = state.poolHistory[marketId] ?? createEmptyHistoryEntry();
      return {
        ...state,
        poolHistory: {
          ...state.poolHistory,
          [marketId]: {
            ...existing,
            isLoading: { ...existing.isLoading, [windowKey]: false },
            errors: { ...existing.errors, [windowKey]: error ?? 'Failed to load history.' },
          },
        },
      };
    }
    case ActionTypes.SET_HISTORY_WINDOW:
      return {
        ...state,
        historyWindow: action.payload?.window ?? state.historyWindow,
      };
    case ActionTypes.SYNC_POOL_SUMMARY: {
      const { marketId, summary } = action.payload ?? {};
      if (!marketId || !summary) {
        return state;
      }
      const takeout = resolveTakeout(summary, state.pools[marketId]?.takeout ?? 0.1);
      const outcomes = Array.isArray(summary?.outcomes)
        ? summary.outcomes.reduce((acc, outcome) => {
            const contribution = Number(outcome.pool ?? 0);
            const wagerCount = Number(outcome.wagerCount ?? outcome.wagers ?? 0);
            acc[outcome.outcomeId] = {
              total: Number.isFinite(contribution) ? contribution : 0,
              wagerCount: Number.isFinite(wagerCount) ? wagerCount : 0,
            };
            return acc;
          }, {})
        : {};
      const nextPools = {
        ...state.pools,
        [marketId]: {
          total: Number(summary.totalPool ?? 0),
          takeout,
          outcomes,
          updatedAt: summary.updatedAt ?? new Date().toISOString(),
        },
      };
      const nextEvents = state.events.map((event) => ({
        ...event,
        markets: event.markets?.map((market) => {
          if (market.id !== marketId) {
            return market;
          }
          return {
            ...market,
            takeout,
            pool_total: Number(summary.totalPool ?? market.pool_total ?? 0),
            status: summary.status ?? market.status,
            closes_at: summary.closeTime ?? market.closes_at,
            outcomes: market.outcomes?.map((outcome) => {
              const next = outcomes[outcome.id];
              if (!next) {
                return outcome;
              }
              return {
                ...outcome,
                pool_total: next.total,
                wager_count: next.wagerCount,
              };
            }),
          };
        }),
      }));
      return {
        ...state,
        events: nextEvents,
        pools: nextPools,
        realtime: {
          ...state.realtime,
          lastUpdate: summary.snapshotAt ?? new Date().toISOString(),
          isStale: false,
          lagMs: 0,
        },
      };
    }
    case ActionTypes.PREVIEW_QUOTE_START:
      return {
        ...state,
        quotePreview: {
          ...state.quotePreview,
          marketId: action.payload?.marketId ?? null,
          outcomeId: action.payload?.outcomeId ?? null,
          stake: action.payload?.stake ?? 0,
          isLoading: true,
          error: null,
        },
      };
    case ActionTypes.PREVIEW_QUOTE_SUCCESS:
      return {
        ...state,
        quotePreview: {
          marketId: action.payload?.marketId ?? null,
          outcomeId: action.payload?.outcomeId ?? null,
          stake: action.payload?.stake ?? 0,
          quote: action.payload?.quote ?? null,
          updatedAt: action.payload?.updatedAt ?? new Date().toISOString(),
          source: action.payload?.source ?? 'local',
          isLoading: false,
          error: null,
        },
      };
    case ActionTypes.PREVIEW_QUOTE_ERROR:
      return {
        ...state,
        quotePreview: {
          ...state.quotePreview,
          isLoading: false,
          error: action.payload?.message ?? 'Unable to fetch quote preview.',
        },
      };
    case ActionTypes.CLEAR_QUOTE_PREVIEW:
      return {
        ...state,
        quotePreview: { ...baseState.quotePreview },
      };
    case ActionTypes.SET_REALTIME_STATUS:
      return {
        ...state,
        realtime: {
          lastUpdate: action.payload?.lastUpdate ?? state.realtime.lastUpdate,
          isStale: action.payload?.isStale ?? state.realtime.isStale,
          lagMs: action.payload?.lagMs ?? state.realtime.lagMs,
        },
      };
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
  poolHistory: {},
  quotePreview: { ...baseState.quotePreview },
  placement: { ...baseState.placement },
  realtime: { ...baseState.realtime },
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const interval = window.setInterval(() => {
      const current = stateRef.current.realtime;
      if (!current?.lastUpdate) {
        return;
      }
      const last = new Date(current.lastUpdate).getTime();
      if (Number.isNaN(last)) {
        return;
      }
      const lagMs = Math.max(0, Date.now() - last);
      const isStale = lagMs > 5000;
      if (
        current.isStale !== isStale ||
        Math.abs((current.lagMs ?? 0) - lagMs) > 250
      ) {
        dispatch({
          type: ActionTypes.SET_REALTIME_STATUS,
          payload: {
            isStale,
            lagMs,
            lastUpdate: stateRef.current.realtime.lastUpdate,
          },
        });
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

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
      // Fetch events with markets and outcomes
      const rows = await supabaseSelect('events', {
        select:
          'id,title,venue,starts_at,status,session_id,markets(id,name,type,rake_bps,takeout,status,closes_at,outcomes(id,label,sort_order,color,driver_id))',
        order: { column: 'starts_at', ascending: true },
      });

      // Fetch pool data from materialized views
      const [marketPools, outcomePools] = await Promise.all([
        supabaseSelect('market_pools', { select: 'market_id,total_pool,unique_bettors,total_wagers,takeout' }),
        supabaseSelect('outcome_pools', { select: 'outcome_id,total_staked,wager_count' }),
      ]);

      // Create lookup maps for efficient merging
      const marketPoolsMap = (marketPools || []).reduce((acc, mp) => {
        acc[mp.market_id] = mp;
        return acc;
      }, {});

      const outcomePoolsMap = (outcomePools || []).reduce((acc, op) => {
        acc[op.outcome_id] = op;
        return acc;
      }, {});
      const events = Array.isArray(rows)
        ? rows.map((event) => ({
            ...event,
            markets: Array.isArray(event?.markets)
              ? event.markets.map((market) => {
                  const marketPoolData = marketPoolsMap[market.id];
                  const computedTakeout = resolveTakeout(
                    {
                      takeout: market.takeout ?? marketPoolData?.takeout ?? null,
                      rake_bps: market.rake_bps,
                    },
                    0.1,
                  );
                  return {
                    ...market,
                    pool_total: marketPoolData?.total_pool ?? 0,
                    unique_bettors: marketPoolData?.unique_bettors ?? 0,
                    total_wagers: marketPoolData?.total_wagers ?? 0,
                    takeout: computedTakeout,
                    outcomes: Array.isArray(market?.outcomes)
                      ? market.outcomes.map((outcome) => {
                          const outcomePoolData = outcomePoolsMap[outcome.id];
                          return {
                            ...outcome,
                            pool_total: outcomePoolData?.total_staked ?? 0,
                            wager_count: outcomePoolData?.wager_count ?? 0,
                          };
                        })
                      : [],
                  };
                })
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

  const setHistoryWindow = useCallback((windowKey) => {
    if (!windowKey) {
      return;
    }
    dispatch({ type: ActionTypes.SET_HISTORY_WINDOW, payload: { window: windowKey } });
  }, []);

  const loadMarketHistory = useCallback(
    async ({ marketId, window: windowKey } = {}) => {
      const currentState = stateRef.current;
      const targetMarketId = marketId ?? currentState.selectedMarketId;
      const resolvedWindow = windowKey ?? currentState.historyWindow ?? '1m';
      if (!targetMarketId) {
        return { success: false, error: new Error('No market selected') };
      }

      dispatch({
        type: ActionTypes.LOAD_HISTORY_START,
        payload: { marketId: targetMarketId, window: resolvedWindow },
      });

      const market = findMarket(currentState.events, targetMarketId);
      const pool = currentState.pools[targetMarketId] ?? null;

      if (!isSupabaseConfigured || !supabase) {
        const payload = buildLocalHistoryPayload({
          market,
          pool,
          windowKey: resolvedWindow,
        });
        dispatch({
          type: ActionTypes.LOAD_HISTORY_SUCCESS,
          payload: { marketId: targetMarketId, window: resolvedWindow, payload },
        });
        return { success: true, data: payload, offline: true };
      }

      try {
        const { data, error } = await supabase.rpc('get_market_history', {
          p_market_id: targetMarketId,
          p_window: resolvedWindow,
        });
        if (error) {
          throw error;
        }
        const payload = data ?? buildLocalHistoryPayload({
          market,
          pool,
          windowKey: resolvedWindow,
        });
        dispatch({
          type: ActionTypes.LOAD_HISTORY_SUCCESS,
          payload: { marketId: targetMarketId, window: resolvedWindow, payload },
        });
        return { success: true, data: payload };
      } catch (error) {
        console.error('Failed to load market history', error);
        dispatch({
          type: ActionTypes.LOAD_HISTORY_ERROR,
          payload: {
            marketId: targetMarketId,
            window: resolvedWindow,
            error: error?.message ?? 'Failed to load history.',
          },
        });
        return { success: false, error };
      }
    },
    [],
  );

  const syncMarketSummary = useCallback(
    async (marketId) => {
      const currentState = stateRef.current;
      const targetMarketId = marketId ?? currentState.selectedMarketId;
      if (!targetMarketId) {
        return { success: false, error: new Error('No market selected') };
      }

      const market = findMarket(currentState.events, targetMarketId);
      const pool = currentState.pools[targetMarketId] ?? null;

      if (!isSupabaseConfigured || !supabase) {
        const stats = driverStats(market, pool);
        const summary = {
          marketId: targetMarketId,
          totalPool: Number(pool?.total ?? market?.pool_total ?? 0),
          takeout: resolveTakeout(pool ?? market),
          outcomes: stats.map((entry) => ({
            outcomeId: entry.outcomeId,
            pool: entry.total,
            wagerCount: entry.wagerCount,
          })),
          status: market?.status ?? null,
          closeTime: market?.closes_at ?? null,
          snapshotAt: new Date().toISOString(),
        };
        dispatch({
          type: ActionTypes.SYNC_POOL_SUMMARY,
          payload: { marketId: targetMarketId, summary },
        });
        return { success: true, data: summary, offline: true };
      }

      try {
        const { data, error } = await supabase.rpc('get_market_summary', {
          p_market_id: targetMarketId,
        });
        if (error) {
          throw error;
        }
        if (data) {
          dispatch({
            type: ActionTypes.SYNC_POOL_SUMMARY,
            payload: { marketId: targetMarketId, summary: data },
          });
        }
        return { success: true, data };
      } catch (error) {
        console.error('Failed to sync market summary', error);
        return { success: false, error };
      }
    },
    [],
  );

  const previewQuote = useCallback(
    async ({ marketId, outcomeId, stake, sampleRate = 0.25 } = {}) => {
      const currentState = stateRef.current;
      const targetMarketId = marketId ?? currentState.selectedMarketId;
      const numericStake = Math.max(Number(stake) || 0, 0);
      if (!targetMarketId || !outcomeId) {
        dispatch({ type: ActionTypes.CLEAR_QUOTE_PREVIEW });
        return { success: false, error: new Error('Market or outcome missing') };
      }

      const market = findMarket(currentState.events, targetMarketId);
      if (!market) {
        dispatch({ type: ActionTypes.CLEAR_QUOTE_PREVIEW });
        return { success: false, error: new Error('Market not found') };
      }

      const outcome = findOutcome(market, outcomeId);
      if (!outcome) {
        dispatch({ type: ActionTypes.CLEAR_QUOTE_PREVIEW });
        return { success: false, error: new Error('Outcome not found') };
      }

      if (numericStake <= 0) {
        dispatch({ type: ActionTypes.CLEAR_QUOTE_PREVIEW });
        return { success: true, cleared: true };
      }

      dispatch({
        type: ActionTypes.PREVIEW_QUOTE_START,
        payload: { marketId: targetMarketId, outcomeId: outcome.id, stake: numericStake },
      });

      const pool = currentState.pools[targetMarketId] ?? null;
      const totalPool = Number(pool?.total ?? market?.pool_total ?? 0);
      const runnerPool = Number(pool?.outcomes?.[outcome.id]?.total ?? outcome?.pool_total ?? 0);
      const takeout = resolveTakeout(pool ?? market);

      const localQuote = computeToteQuote({
        T: totalPool,
        W: runnerPool,
        r: takeout,
        s: numericStake,
      });

      dispatch({
        type: ActionTypes.PREVIEW_QUOTE_SUCCESS,
        payload: {
          marketId: targetMarketId,
          outcomeId: outcome.id,
          stake: numericStake,
          quote: localQuote,
          source: 'local',
          updatedAt: new Date().toISOString(),
        },
      });

      if (!isSupabaseConfigured || !supabase) {
        return { success: true, quote: localQuote, offline: true };
      }

      try {
        const { data, error } = await supabase.rpc('quote_market_outcome', {
          p_market_id: targetMarketId,
          p_outcome_id: outcome.id,
          p_stake: numericStake,
        });
        if (error) {
          throw error;
        }
        const normalise = (value, fallback) => {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            return numeric;
          }
          return fallback;
        };
        const remotePayload = data ?? {};
        const remoteQuote = {
          baselineMultiplier: normalise(
            remotePayload.baselineMultiplier ?? remotePayload.baseline_multiplier,
            localQuote.baselineMultiplier,
          ),
          effectiveMultiplier: normalise(
            remotePayload.effectiveMultiplier ?? remotePayload.effective_multiplier,
            localQuote.effectiveMultiplier,
          ),
          estPayout: normalise(
            remotePayload.estPayout ?? remotePayload.est_payout,
            localQuote.estPayout,
          ),
          impliedProb: normalise(
            remotePayload.impliedProb ?? remotePayload.implied_prob,
            localQuote.impliedProb,
          ),
          priceImpact: normalise(
            remotePayload.priceImpact ?? remotePayload.price_impact,
            localQuote.priceImpact,
          ),
          maxPossiblePayout: normalise(
            remotePayload.maxPossiblePayout ?? remotePayload.max_possible_payout,
            localQuote.maxPossiblePayout,
          ),
          shareAfterBet: normalise(
            remotePayload.shareAfterBet ?? remotePayload.share_after_bet,
            localQuote.shareAfterBet ?? localQuote.impliedProb,
          ),
        };

        dispatch({
          type: ActionTypes.PREVIEW_QUOTE_SUCCESS,
          payload: {
            marketId: targetMarketId,
            outcomeId: outcome.id,
            stake: numericStake,
            quote: remoteQuote,
            source: 'remote',
            updatedAt: new Date().toISOString(),
          },
        });

        if (sampleRate > 0 && Math.random() <= sampleRate && supabase) {
          supabase
            .rpc('log_quote_telemetry', {
              p_market_id: targetMarketId,
              p_outcome_id: outcome.id,
              p_stake: numericStake,
              p_baseline:
                remoteQuote.baselineMultiplier ?? localQuote.baselineMultiplier ?? null,
              p_effective:
                remoteQuote.effectiveMultiplier ?? localQuote.effectiveMultiplier ?? null,
              p_price_impact:
                remoteQuote.priceImpact ?? localQuote.priceImpact ?? null,
              p_sample_rate: sampleRate,
            })
            .catch((telemetryError) => {
              console.warn('Failed to record quote telemetry', telemetryError);
            });
        }

        return { success: true, quote: remoteQuote };
      } catch (error) {
        console.error('Failed to preview quote', error);
        dispatch({
          type: ActionTypes.PREVIEW_QUOTE_ERROR,
          payload: { message: error?.message ?? 'Unable to fetch quote preview.' },
        });
        return { success: false, error, quote: localQuote };
      }
    },
    [],
  );

  const clearQuotePreview = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_QUOTE_PREVIEW });
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
        setHistoryWindow,
        loadMarketHistory,
        syncMarketSummary,
        selectEvent,
        selectMarket,
        placeWager,
        previewQuote,
        clearToast,
        clearQuotePreview,
      },
    }),
    [
      state,
      loadEvents,
      setHistoryWindow,
      loadMarketHistory,
      syncMarketSummary,
      selectEvent,
      selectMarket,
      placeWager,
      previewQuote,
      clearToast,
      clearQuotePreview,
    ],
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

