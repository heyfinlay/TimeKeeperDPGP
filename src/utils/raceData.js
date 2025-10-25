export const LEGACY_SESSION_ID = '00000000-0000-0000-0000-000000000000';

export const createClientId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `log-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const toDriverRow = (driver) => ({
  id: driver.id,
  number: driver.number,
  name: driver.name,
  team: driver.team,
  marshal_user_id: driver.marshalId ? driver.marshalId : null,
  laps: driver.laps,
  last_lap_ms: driver.lastLap,
  best_lap_ms: driver.bestLap,
  pits: driver.pits,
  status: driver.status,
  driver_flag: driver.driverFlag,
  pit_complete: driver.pitComplete,
  total_time_ms: driver.totalTime ?? driver.lapTimes.reduce((sum, lap) => sum + lap, 0),
  session_id: driver.sessionId ?? LEGACY_SESSION_ID,
  updated_at: new Date().toISOString(),
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

const parseInteger = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const coerceBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

export const groupLapRows = (lapRows = []) => {
  const byDriver = new Map();
  lapRows.forEach((lap) => {
    if (!byDriver.has(lap.driver_id)) {
      byDriver.set(lap.driver_id, []);
    }
    byDriver.get(lap.driver_id).push(lap);
  });
  byDriver.forEach((entries, driverId) => {
    entries.sort((a, b) => {
      const aNumber = parseInteger(a.lap_number) ?? 0;
      const bNumber = parseInteger(b.lap_number) ?? 0;
      return aNumber - bNumber;
    });
    byDriver.set(
      driverId,
      entries.map((entry) => ({
        lapNumber: parseInteger(entry.lap_number) ?? 0,
        lapTime: parseInteger(entry.lap_time_ms) ?? 0,
        source: entry.source ?? 'manual',
        recordedAt: entry.recorded_at ? new Date(entry.recorded_at) : new Date(),
      })),
    );
  });
  return byDriver;
};

const resolveTrackStatus = (trackStatus, flagStatus) => {
  if (trackStatus && flagStatus && trackStatus !== flagStatus) {
    return flagStatus;
  }
  return trackStatus ?? flagStatus ?? DEFAULT_SESSION_STATE.trackStatus;
};

export const hydrateDriverState = (driverRow, lapRowsMap) => {
  const lapEntries = lapRowsMap.get(driverRow.id) ?? [];
  const lapTimes = lapEntries.map((entry) => entry.lapTime);
  const laps = parseInteger(driverRow.laps) ?? lapTimes.length;
  const totalTime =
    parseInteger(driverRow.total_time_ms) ?? lapTimes.reduce((sum, time) => sum + time, 0);
  const lastLap =
    parseInteger(driverRow.last_lap_ms) ??
    (lapEntries.length ? lapEntries[lapEntries.length - 1].lapTime : null);
  const bestLap =
    parseInteger(driverRow.best_lap_ms) ?? (lapTimes.length ? Math.min(...lapTimes) : null);
  const marshalId =
    driverRow.marshal_user_id ?? driverRow.marshal_id ?? driverRow.marshalId ?? null;

  return {
    id: driverRow.id,
    number: driverRow.number,
    name: driverRow.name,
    team: driverRow.team,
    marshalId,
    sessionId: driverRow.session_id ?? LEGACY_SESSION_ID,
    laps,
    lapTimes,
    lapHistory: lapEntries,
    lastLap,
    bestLap,
    totalTime,
    pits: parseInteger(driverRow.pits) ?? 0,
    status: driverRow.status ?? 'ready',
    currentLapStart: null,
    driverFlag: driverRow.driver_flag ?? 'none',
    pitComplete: coerceBoolean(driverRow.pit_complete, false),
    hasInvalidToResolve: false,
  };
};

export const sessionRowToState = (sessionRow) => ({
  eventType: sessionRow?.event_type ?? 'Race',
  totalLaps: parseInteger(sessionRow?.total_laps) ?? 25,
  totalDuration: parseInteger(sessionRow?.total_duration) ?? 45,
  procedurePhase: sessionRow?.procedure_phase ?? 'setup',
  flagStatus: sessionRow?.flag_status ?? 'green',
  trackStatus: resolveTrackStatus(sessionRow?.track_status, sessionRow?.flag_status),
  announcement: sessionRow?.announcement ?? '',
  isTiming: coerceBoolean(sessionRow?.is_timing, false),
  isPaused: coerceBoolean(sessionRow?.is_paused, false),
  raceTime: parseInteger(sessionRow?.race_time_ms) ?? 0,
});

export async function invalidateLastLap(sessionId, driverId, supabaseClient) {
  if (!supabaseClient || !sessionId || !driverId) return;

  const { data: last, error } = await supabaseClient
    .from('laps')
    .select('id, lap_number')
    .eq('session_id', sessionId)
    .eq('driver_id', driverId)
    .order('lap_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch last lap for invalidation', error);
    return;
  }

  if (!last) return;

  const { error: updateError } = await supabaseClient
    .from('laps')
    .update({ invalidated: true })
    .eq('id', last.id);

  if (updateError) {
    console.error('Failed to invalidate lap', updateError);
  }
}
