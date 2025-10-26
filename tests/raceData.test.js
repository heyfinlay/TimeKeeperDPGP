import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SESSION_STATE,
  LEGACY_SESSION_ID,
  groupLapRows,
  hydrateDriverState,
  sessionRowToState,
  toDriverRow,
} from '../src/utils/raceData.js';

describe('groupLapRows', () => {
  test('groups lap entries by driver and sorts by lap number', () => {
    const grouped = groupLapRows([
      {
        driver_id: 'a',
        lap_number: '2',
        lap_time_ms: '80000',
        recorded_at: '2024-01-01T00:00:10Z',
      },
      {
        driver_id: 'a',
        lap_number: '1',
        lap_time_ms: '82000',
        recorded_at: '2024-01-01T00:00:05Z',
      },
      { driver_id: 'b', lap_number: 1, lap_time_ms: '90000' },
    ]);

    expect(grouped.get('a')?.map((lap) => lap.lapNumber)).toEqual([1, 2]);
    expect(grouped.get('a')?.[0].lapTime).toBe(82000);
    expect(grouped.get('b')?.[0].source).toBe('manual');
    expect(typeof grouped.get('b')?.[0].lapTime).toBe('number');
  });
});

describe('hydrateDriverState', () => {
  test('hydrates driver from session rows with lap information', () => {
    const lapRows = groupLapRows([
      { driver_id: 'driver-1', lap_number: '1', lap_time_ms: '60000' },
      { driver_id: 'driver-1', lap_number: '2', lap_time_ms: '59000' },
    ]);

    const driver = hydrateDriverState(
      {
        id: 'driver-1',
        number: 7,
        name: 'Driver',
        team: 'Team',
        marshal_user_id: 'm1',
        session_id: 'session-1',
        laps: '2',
        last_lap_ms: '59000',
        best_lap_ms: '58000',
        total_time_ms: '119000',
      },
      lapRows,
    );

    expect(driver.laps).toBe(2);
    expect(driver.bestLap).toBe(58000);
    expect(driver.totalTime).toBe(119000);
    expect(driver.lapTimes).toEqual([60000, 59000]);
    expect(driver.lastLap).toBe(59000);
    expect(driver.sessionId).toBe('session-1');
  });
});

describe('sessionRowToState', () => {
  test('returns defaults when missing data', () => {
    expect(sessionRowToState(undefined)).toEqual(DEFAULT_SESSION_STATE);
  });

  test('hydrates values from the session row', () => {
    const state = sessionRowToState({
      event_type: 'Practice',
      total_laps: '12',
      total_duration: '30',
      procedure_phase: 'formation',
      flag_status: 'yellow',
      track_status: 'yellow',
      announcement: 'Incident turn 3',
      is_timing: 'true',
      is_paused: 'true',
      race_time_ms: '90000',
    });

    expect(state.eventType).toBe('Practice');
    expect(state.totalLaps).toBe(12);
    expect(state.flagStatus).toBe('yellow');
    expect(state.isPaused).toBe(true);
    expect(state.raceTime).toBe(90000);
  });

  test('prefers flag status when track status is stale', () => {
    const state = sessionRowToState({
      flag_status: 'yellow',
      track_status: 'green',
    });

    expect(state.trackStatus).toBe('yellow');
  });
});

describe('toDriverRow', () => {
  test('maps view model back to persistence row shape', () => {
    const row = toDriverRow({
      id: 'driver-1',
      number: 11,
      name: 'Driver',
      team: 'Team',
      marshalId: 'm2',
      laps: 5,
      lastLap: 60500,
      bestLap: 60000,
      pits: 1,
      status: 'running',
      driverFlag: 'blue',
      pitComplete: true,
      totalTime: 320000,
      lapTimes: [64000, 63000, 62000, 61000, 60000],
    });

    expect(row).toMatchObject({
      marshal_user_id: 'm2',
      marshal_id: 'm2',
      last_lap_ms: 60500,
      best_lap_ms: 60000,
      total_time_ms: 320000,
      session_id: LEGACY_SESSION_ID,
    });
    expect(typeof row.updated_at).toBe('string');
  });
});
