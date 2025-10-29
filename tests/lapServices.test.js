import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/lib/supabaseClient.js', () => {
  const rpc = vi.fn();
  const from = vi.fn();
  return {
    isSupabaseConfigured: true,
    supabase: { rpc, from },
  };
});

import { logLapAtomic, invalidateLastLap } from '../src/services/laps.js';
import { parseLapInput } from '../src/components/DriverTimingPanel.jsx';
import { supabase } from '../src/lib/supabaseClient.js';

const createFilterChain = (resultPromise) => {
  const chain = {
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => resultPromise),
  };
  return chain;
};

const createUpdateChain = (resultPromise) => {
  const secondEq = vi.fn(() => resultPromise);
  const firstEq = vi.fn(() => ({
    eq: secondEq,
  }));
  return {
    update: vi.fn(() => ({
      eq: firstEq,
    })),
    __firstEq: firstEq,
    __secondEq: secondEq,
  };
};

const createInsertChain = (resultPromise) => {
  const single = vi.fn(() => resultPromise);
  const select = vi.fn(() => ({
    single,
  }));
  const insert = vi.fn(() => ({ select }));
  return { insert, __select: select, __single: single };
};

describe('lap services', () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.from.mockReset();
  });

  test('parseLapInput handles mixed formats', () => {
    expect(parseLapInput('1:05.321')).toBe(65321);
    expect(parseLapInput('75')).toBe(75000);
    expect(parseLapInput('90000')).toBe(90000);
  });

  test('logLapAtomic uses RPC when available', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ lap_id: 'lap-1' }], error: null });
    supabase.from.mockImplementation(() => {
      throw new Error('from should not be called when RPC succeeds');
    });

    const result = await logLapAtomic({
      sessionId: 'session-1',
      driverId: 'driver-1',
      lapTimeMs: 65000,
    });

    expect(supabase.rpc).toHaveBeenCalledWith('log_lap_atomic', {
      p_session_id: 'session-1',
      p_driver_id: 'driver-1',
      p_lap_time_ms: 65000,
    });
    expect(result).toEqual([{ lap_id: 'lap-1' }]);
  });

  test('logLapAtomic falls back when RPC is missing', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'function log_lap_atomic does not exist' },
    });

    const lapsSelectChain = createFilterChain(
      Promise.resolve({ data: { lap_number: 2 }, error: null }),
    );
    const lapsInsertChain = createInsertChain(
      Promise.resolve({ data: { id: 'lap-new' }, error: null }),
    );
    const driverSelectChain = createFilterChain(
      Promise.resolve({
        data: { laps: 4, best_lap_ms: 62000, total_time_ms: 240000 },
        error: null,
      }),
    );
    const driverUpdateChain = createUpdateChain(
      Promise.resolve({ data: null, error: null }),
    );

    let call = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'laps' && call === 0) {
        call += 1;
        return {
          select: vi.fn(() => lapsSelectChain),
        };
      }
      if (table === 'laps' && call === 1) {
        call += 1;
        return lapsInsertChain;
      }
      if (table === 'drivers' && call === 2) {
        call += 1;
        return {
          select: vi.fn(() => driverSelectChain),
        };
      }
      if (table === 'drivers' && call === 3) {
        call += 1;
        return driverUpdateChain;
      }
      throw new Error(`Unexpected table ${table} at call ${call}`);
    });

    await logLapAtomic({
      sessionId: 'session-2',
      driverId: 'driver-2',
      lapTimeMs: 65000,
    });

    expect(lapsSelectChain.eq.mock.calls).toEqual([
      ['session_id', 'session-2'],
      ['driver_id', 'driver-2'],
    ]);
    expect(driverSelectChain.eq.mock.calls).toEqual([
      ['id', 'driver-2'],
      ['session_id', 'session-2'],
    ]);
    expect(lapsInsertChain.insert).toHaveBeenCalledWith({
      session_id: 'session-2',
      driver_id: 'driver-2',
      lap_time_ms: 65000,
      lap_number: 3,
      source: 'manual',
      invalidated: false,
    });
    expect(driverUpdateChain.update).toHaveBeenCalledWith({
      laps: 5,
      last_lap_ms: 65000,
      best_lap_ms: 62000,
      total_time_ms: 305000,
      updated_at: expect.any(String),
    });
    expect(driverUpdateChain.__firstEq).toHaveBeenCalledWith('id', 'driver-2');
    expect(driverUpdateChain.__secondEq).toHaveBeenCalledWith('session_id', 'session-2');
  });

  test('invalidateLastLap marks most recent lap', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    const selectChain = createFilterChain(
      Promise.resolve({ data: { id: 'lap-10' }, error: null }),
    );
    const updateChain = createUpdateChain(
      Promise.resolve({ data: null, error: null }),
    );

    let call = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'laps' && call === 0) {
        call += 1;
        return {
          select: vi.fn(() => selectChain),
        };
      }
      if (table === 'laps' && call === 1) {
        call += 1;
        return updateChain;
      }
      throw new Error(`Unexpected call ${call} for table ${table}`);
    });

    await invalidateLastLap({ sessionId: 'session-3', driverId: 'driver-3' });

    expect(selectChain.eq.mock.calls).toEqual([
      ['session_id', 'session-3'],
      ['driver_id', 'driver-3'],
      ['invalidated', false],
    ]);
    expect(updateChain.update).toHaveBeenCalledWith({ invalidated: true });
    expect(updateChain.__firstEq).toHaveBeenCalledWith('id', 'lap-10');
    expect(updateChain.__secondEq).toHaveBeenCalledWith('session_id', 'session-3');
  });
});
