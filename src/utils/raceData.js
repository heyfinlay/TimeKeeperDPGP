export const SESSION_ROW_ID = 'live-session';
export const SESSION_UUID = '00000000-0000-4000-8000-000000000001';

export const createUuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });

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
  is_in_pit: driver.isInPit ?? false,
  pending_invalid: driver.hasInvalidToResolve ?? false,
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
        id: entry.id,
        lapNumber: entry.lap_number,
        duration: entry.duration_ms ?? null,
        invalidated: entry.invalidated ?? false,
        startedAt: entry.started_at ? new Date(entry.started_at) : null,
        endedAt: entry.ended_at ? new Date(entry.ended_at) : null,
        recordedAt: entry.ended_at
          ? new Date(entry.ended_at)
          : entry.started_at
            ? new Date(entry.started_at)
            : new Date(),
      })),
    );
  });
  return byDriver;
};

export const hydrateDriverState = (driverRow, lapRowsMap) => {
  const lapEntries = lapRowsMap.get(driverRow.id) ?? [];
  const completedLapEntries = lapEntries.filter(
    (entry) => entry.endedAt && entry.invalidated === false,
  );
  const completedLaps = completedLapEntries.length;
  const validLapEntries = completedLapEntries.filter((entry) => entry.duration !== null);
  const lapDurations = validLapEntries.map((entry) => entry.duration ?? 0);
  const filteredLapTimes = lapDurations.filter((time) => typeof time === 'number' && time > 0);
  const totalTime =
    driverRow.total_time_ms ?? filteredLapTimes.reduce((sum, time) => sum + (time ?? 0), 0);
  const lastValidLap = validLapEntries.length ? validLapEntries[validLapEntries.length - 1] : null;
  const lastLap = driverRow.last_lap_ms ?? lastValidLap?.duration ?? null;
  const bestLap =
    driverRow.best_lap_ms ?? (filteredLapTimes.length ? Math.min(...filteredLapTimes) : null);
  const currentLap = lapEntries.find((entry) => !entry.endedAt) ?? null;
  const lapNumber =
    currentLap?.lapNumber ?? (lapEntries.length ? lapEntries[lapEntries.length - 1].lapNumber + 1 : 1);
  const hasInvalidToResolve = driverRow.pending_invalid ?? false;
  const isInPit = driverRow.is_in_pit ?? false;
  return {
    id: driverRow.id,
    number: driverRow.number,
    name: driverRow.name,
    team: driverRow.team,
    marshalId: driverRow.marshal_id,
    laps: completedLaps,
    lapTimes: filteredLapTimes,
    lapHistory: lapEntries,
    lastLap,
    bestLap,
    totalTime,
    pits: driverRow.pits ?? 0,
    status: driverRow.status ?? 'ready',
    currentLapStart: currentLap?.startedAt ?? null,
    driverFlag: driverRow.driver_flag ?? 'none',
    pitComplete: driverRow.pit_complete ?? false,
    isInPit,
    hasInvalidToResolve,
    currentLapNumber: lapNumber,
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
