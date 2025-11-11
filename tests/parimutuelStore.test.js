import { describe, expect, test } from 'vitest';
import {
  driverStats,
  settleEvent,
  validateWager,
  ParimutuelActionTypes,
  parimutuelReducer,
  createParimutuelState,
} from '../src/state/parimutuelStore.js';

const buildSampleEvents = () => [
  {
    id: 'event-1',
    title: 'Grand Prix',
    venue: 'Neo Suzuka',
    markets: [
      {
        id: 'market-1',
        name: 'Race Winner',
        type: 'WIN',
        status: 'open',
        rake_bps: 150,
        pool_total: 2000,
        outcomes: [
          { id: 'outcome-1', label: 'Driver A', pool_total: 1200 },
          { id: 'outcome-2', label: 'Driver B', pool_total: 800 },
        ],
      },
    ],
  },
];

describe('driverStats', () => {
  test('computes share and odds based on pool totals', () => {
    const market = {
      id: 'market-42',
      rake_bps: 500,
      pool_total: 1000,
      outcomes: [
        { id: 'alpha', label: 'Alpha', pool_total: 600 },
        { id: 'beta', label: 'Beta', pool_total: 400 },
      ],
    };
    const pool = {
      total: 1000,
      rakeBps: 1000,
      outcomes: {
        alpha: { total: 700, wagerCount: 5 },
        beta: { total: 300, wagerCount: 3 },
      },
    };

    const stats = driverStats(market, pool);
    expect(stats).toHaveLength(2);
    expect(stats[0].outcomeId).toBe('alpha');
    expect(stats[0].share).toBeCloseTo(0.7, 4);
    expect(stats[0].odds).toBeCloseTo(900 / 700, 4);
    expect(stats[0].wagerCount).toBe(5);
    expect(stats[1].outcomeId).toBe('beta');
    expect(stats[1].share).toBeCloseTo(0.3, 4);
  });
});

describe('settleEvent', () => {
  test('marks markets as settled and flags winning outcomes', () => {
    const event = {
      id: 'event-99',
      status: 'open',
      markets: [
        {
          id: 'market-9',
          status: 'open',
          outcomes: [
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
          ],
        },
      ],
    };
    const settled = settleEvent(event, ['two']);
    expect(settled.status).toBe('settled');
    expect(settled.markets[0].status).toBe('settled');
    expect(settled.markets[0].outcomes.find((o) => o.id === 'two')?.is_winner).toBe(true);
    expect(settled.markets[0].outcomes.find((o) => o.id === 'one')?.is_winner).toBeFalsy();
  });
});

describe('validateWager', () => {
  const market = {
    id: 'market-validate',
    status: 'open',
    closes_at: new Date(Date.now() + 60000).toISOString(),
  };
  const outcome = { id: 'outcome-validate' };

  test('flags insufficient balance and missing stake', () => {
    const result = validateWager({ stake: 500, balance: 300, market, outcome });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Insufficient balance.');
  });

  test('flags closed market', () => {
    const closedMarket = { ...market, status: 'closed' };
    const result = validateWager({ stake: 100, balance: 500, market: closedMarket, outcome });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Market is not open for wagering.');
  });

  test('flags market past close time', () => {
    const expiredMarket = { ...market, closes_at: new Date(Date.now() - 1000).toISOString() };
    const result = validateWager({ stake: 100, balance: 500, market: expiredMarket, outcome });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Market has closed.');
  });
});

describe('parimutuel reducer', () => {
  test('loads events and selects default market', () => {
    const initial = createParimutuelState();
    const events = buildSampleEvents();
    const loaded = parimutuelReducer(initial, {
      type: ParimutuelActionTypes.LOAD_SUCCESS,
      payload: { events, supportsMarkets: true },
    });

    expect(loaded.status).toBe('ready');
    expect(loaded.events).toHaveLength(1);
    expect(loaded.selectedEventId).toBe('event-1');
    expect(loaded.selectedMarketId).toBe('market-1');
    expect(loaded.pools['market-1'].total).toBe(2000);
    expect(loaded.poolHistory['market-1'].snapshots).toHaveLength(1);
    expect(loaded.poolHistory['market-1'].snapshots[0].total).toBe(2000);
    expect(loaded.poolHistory['market-1'].snapshots[0].outcomes['outcome-1'].total).toBe(1200);
  });

  test('updates pools after successful wager', () => {
    const events = buildSampleEvents();
    let state = parimutuelReducer(createParimutuelState(), {
      type: ParimutuelActionTypes.LOAD_SUCCESS,
      payload: { events, supportsMarkets: true },
    });

    state = parimutuelReducer(state, {
      type: ParimutuelActionTypes.PLACE_WAGER_SUCCESS,
      payload: {
        marketId: 'market-1',
        outcomeId: 'outcome-1',
        stake: 500,
        wager: { id: 'wager-1' },
      },
    });

    const market = state.events[0].markets[0];
    const outcome = market.outcomes.find((item) => item.id === 'outcome-1');
    expect(market.pool_total).toBe(2500);
    expect(outcome.pool_total).toBe(1700);
    expect(state.pools['market-1'].total).toBe(2500);
    expect(state.toast?.type).toBe('success');
    expect(state.poolHistory['market-1'].snapshots).toHaveLength(2);
    const latestSnapshot = state.poolHistory['market-1'].snapshots[1];
    expect(latestSnapshot.total).toBe(2500);
    expect(latestSnapshot.outcomes['outcome-1'].total).toBe(1700);
  });
});

