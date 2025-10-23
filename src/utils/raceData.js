export const SESSION_ROW_ID = 'live-session';

export const createClientId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `log-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const toDriverRow = (driver) => ({
  id: driver.id,
  number: driver.number,
  name: driver.name,
  team: driver.team,
  marshal_id: driver.marshalId,
  laps: driver.laps,
  last_lap_ms: driver.lastLap,
  best_lap_ms: driver.bestLap,
  pits: driver.pits,
  status: driver.status,
  driver_flag: driver.driverFlag,
  pit_complete: driver.pitComplete,
  total_time_ms: driver.totalTime ?? driver.lapTimes.reduce((sum, lap) => sum + lap, 0),
  updated_at: new Date().toISOString(),
});

export const groupLapRows = (lapRows = []) => {
  const byDriver = new Map();
  lapRows.forEach((lap) => {
    if (!byDriver.has(lap.driver_id)) {
      byDriver.set(lap.driver_id, []);
    }
    byDriver.get(lap.driver_id).push(lap);
  });
  byDriver.forEach((entries, driverId) => {
    entries.sort((a, b) => a.lap_number - b.lap_number);
    byDriver.set(
      driverId,
      entries.map((entry) => ({
        lapNumber: entry.lap_number,
        lapTime: entry.lap_time_ms,
        source: entry.source ?? 'manual',
        recordedAt: entry.recorded_at ? new Date(entry.recorded_at) : new Date(),
      })),
    );
  });
  return byDriver;
};

export const hydrateDriverState = (driverRow, lapRowsMap) => {
  const lapEntries = lapRowsMap.get(driverRow.id) ?? [];
  const lapTimes = lapEntries.map((entry) => entry.lapTime);
  const laps = driverRow.laps ?? lapTimes.length;
  const totalTime = driverRow.total_time_ms ?? lapTimes.reduce((sum, time) => sum + time, 0);
  const lastLap =
    driverRow.last_lap_ms ?? (lapEntries.length ? lapEntries[lapEntries.length - 1].lapTime : null);
  const bestLap =
    driverRow.best_lap_ms ?? (lapTimes.length ? Math.min(...lapTimes) : null);
  return {
    id: driverRow.id,
    number: driverRow.number,
    name: driverRow.name,
    team: driverRow.team,
    marshalId: driverRow.marshal_id,
    laps,
    lapTimes,
    lapHistory: lapEntries,
    lastLap,
    bestLap,
    totalTime,
    pits: driverRow.pits ?? 0,
    status: driverRow.status ?? 'ready',
    currentLapStart: null,
    driverFlag: driverRow.driver_flag ?? 'none',
    pitComplete: driverRow.pit_complete ?? false,
  };
};

export const sessionRowToState = (sessionRow) => ({
  eventType: sessionRow?.event_type ?? 'Race',
  totalLaps: sessionRow?.total_laps ?? 25,
  totalDuration: sessionRow?.total_duration ?? 45,
  procedurePhase: sessionRow?.procedure_phase ?? 'setup',
  flagStatus: sessionRow?.flag_status ?? 'green',
  trackStatus: sessionRow?.track_status ?? 'green',
  announcement: sessionRow?.announcement ?? '',
  isTiming: sessionRow?.is_timing ?? false,
  isPaused: sessionRow?.is_paused ?? false,
  raceTime: sessionRow?.race_time_ms ?? 0,
});

export const DEFAULT_SESSION_STATE = {
  eventType: 'Race',
  totalLaps: 25,
  totalDuration: 45,
  procedurePhase: 'setup',
  flagStatus: 'green',
  trackStatus: 'green',
  announcement: '',
  isTiming: false,
  isPaused: false,
  raceTime: 0,
};
