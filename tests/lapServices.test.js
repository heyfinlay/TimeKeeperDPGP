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

const createLastLapChain = (resultPromise) => {
  const maybeSingle = vi.fn(() => resultPromise);
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const secondEq = vi.fn(() => ({ order }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  return {
    select: vi.fn(() => ({ eq: firstEq })),
    __firstEq: firstEq,
    __secondEq: secondEq,
    __order: order,
    __limit: limit,
    __maybeSingle: maybeSingle,
  };
};

const createListSelectChain = (resultPromise) => {
  const thirdEq = vi.fn(() => resultPromise);
  const secondEq = vi.fn(() => ({ eq: thirdEq }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  return {
    select: vi.fn(() => ({ eq: firstEq })),
    __firstEq: firstEq,
    __secondEq: secondEq,
    __thirdEq: thirdEq,
  };
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
    supabase.rpc.mockResolvedValue({
      data: [
        {
          lap_id: 'lap-1',
          session_id: 'session-1',
          driver_id: 'driver-1',
          laps: 4,
          last_lap_ms: 65000,
          best_lap_ms: 64000,
          total_time_ms: 260000,
        },
      ],
      error: null,
    });
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
    expect(result).toEqual({
      lap_id: 'lap-1',
      session_id: 'session-1',
      driver_id: 'driver-1',
      laps: 4,
      last_lap_ms: 65000,
      best_lap_ms: 64000,
      total_time_ms: 260000,
    });
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

    const result = await logLapAtomic({
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

    expect(result).toEqual({
      lap_id: 'lap-new',
      session_id: 'session-2',
      driver_id: 'driver-2',
      laps: 5,
      last_lap_ms: 65000,
      best_lap_ms: 62000,
      total_time_ms: 305000,
    });
  });

  test('invalidateLastLap uses RPC with default mode', async () => {
    supabase.rpc.mockResolvedValue({
      data: [
        {
          invalidated_lap_id: 'lap-3',
          session_id: 'session-3',
          driver_id: 'driver-3',
          laps: 5,
          last_lap_ms: 64000,
          best_lap_ms: 62000,
          total_time_ms: 320000,
        },
      ],
      error: null,
    });

    const result = await invalidateLastLap({ sessionId: 'session-3', driverId: 'driver-3' });

    expect(supabase.rpc).toHaveBeenCalledWith('invalidate_last_lap_atomic', {
      p_session_id: 'session-3',
      p_driver_id: 'driver-3',
      p_mode: 'time_only',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(result).toEqual({
      invalidated_lap_id: 'lap-3',
      session_id: 'session-3',
      driver_id: 'driver-3',
      laps: 5,
      last_lap_ms: 64000,
      best_lap_ms: 62000,
      total_time_ms: 320000,
    });
  });

  test('invalidateLastLap allows removing laps', async () => {
    supabase.rpc.mockResolvedValue({
      data: [
        {
          invalidated_lap_id: 'lap-4',
          session_id: 'session-4',
          driver_id: 'driver-4',
          laps: 7,
          last_lap_ms: 63000,
          best_lap_ms: 60000,
          total_time_ms: 441000,
        },
      ],
      error: null,
    });

    const result = await invalidateLastLap({
      sessionId: 'session-4',
      driverId: 'driver-4',
      mode: 'remove_lap',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('invalidate_last_lap_atomic', {
      p_session_id: 'session-4',
      p_driver_id: 'driver-4',
      p_mode: 'remove_lap',
    });
    expect(result).toEqual({
      invalidated_lap_id: 'lap-4',
      session_id: 'session-4',
      driver_id: 'driver-4',
      laps: 7,
      last_lap_ms: 63000,
      best_lap_ms: 60000,
      total_time_ms: 441000,
    });
  });

  test('invalidateLastLap falls back when RPC is missing', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'function invalidate_last_lap_atomic does not exist' },
    });

    const lastLapChain = createLastLapChain(
      Promise.resolve({ data: { id: 'lap-99' }, error: null }),
    );
    const updateLapChain = createUpdateChain(
      Promise.resolve({ data: null, error: null }),
    );
    const driverSelectChain = createFilterChain(
      Promise.resolve({ data: { laps: 8 }, error: null }),
    );
    const validLapListChain = createListSelectChain(
      Promise.resolve({
        data: [
          { lap_time_ms: 65000, recorded_at: '2024-01-01T00:02:00Z' },
          { lap_time_ms: 66000, recorded_at: '2024-01-01T00:01:00Z' },
        ],
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
        return lastLapChain;
      }
      if (table === 'laps' && call === 1) {
        call += 1;
        return updateLapChain;
      }
      if (table === 'drivers' && call === 2) {
        call += 1;
        return { select: vi.fn(() => driverSelectChain) };
      }
      if (table === 'laps' && call === 3) {
        call += 1;
        return validLapListChain;
      }
      if (table === 'drivers' && call === 4) {
        call += 1;
        return driverUpdateChain;
      }
      throw new Error(`Unexpected table ${table} at call ${call}`);
    });

    const result = await invalidateLastLap({ sessionId: 'session-5', driverId: 'driver-5', mode: 'remove_lap' });

    expect(supabase.rpc).toHaveBeenCalledWith('invalidate_last_lap_atomic', {
      p_session_id: 'session-5',
      p_driver_id: 'driver-5',
      p_mode: 'remove_lap',
    });

    expect(lastLapChain.select).toHaveBeenCalledWith('id');
    expect(lastLapChain.__firstEq).toHaveBeenCalledWith('session_id', 'session-5');
    expect(lastLapChain.__secondEq).toHaveBeenCalledWith('driver_id', 'driver-5');
    expect(lastLapChain.__order).toHaveBeenCalledWith('recorded_at', { ascending: false });
    expect(lastLapChain.__limit).toHaveBeenCalledWith(1);
    expect(updateLapChain.update).toHaveBeenCalledWith({ invalidated: true, checkpoint_missed: true });
    expect(driverSelectChain.eq.mock.calls).toEqual([
      ['id', 'driver-5'],
      ['session_id', 'session-5'],
    ]);
    expect(validLapListChain.select).toHaveBeenCalledWith('lap_time_ms, recorded_at');
    expect(validLapListChain.__firstEq).toHaveBeenCalledWith('session_id', 'session-5');
    expect(validLapListChain.__secondEq).toHaveBeenCalledWith('driver_id', 'driver-5');
    expect(validLapListChain.__thirdEq).toHaveBeenCalledWith('invalidated', false);
    expect(driverUpdateChain.update).toHaveBeenCalledWith({
      last_lap_ms: 65000,
      best_lap_ms: 65000,
      total_time_ms: 131000,
      laps: 7,
      updated_at: expect.any(String),
    });

    expect(result).toEqual({
      invalidated_lap_id: 'lap-99',
      session_id: 'session-5',
      driver_id: 'driver-5',
      laps: 7,
      last_lap_ms: 65000,
      best_lap_ms: 65000,
      total_time_ms: 131000,
    });
  });
});
