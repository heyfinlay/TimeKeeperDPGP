import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

const LOG_LAP_RPC = 'log_lap_atomic';
const INVALIDATE_LAST_LAP_RPC = 'invalidate_last_lap_atomic';

const isMissingRpcError = (error, rpcName) => {
  if (!error) return false;
  if (error.code === 'PGRST116' || error.code === 'PGRST204') {
    return true;
  }
  const message = String(error.message ?? error.details ?? '').toLowerCase();
  return message.includes(rpcName) && message.includes('function');
};

const isAmbiguousSessionIdError = (error) => {
  if (!error) return false;
  if (error.code === '42702') {
    return true;
  }
  const message = String(error.message ?? error.details ?? '').toLowerCase();
  return message.includes('session_id') && message.includes('ambiguous');
};

const ensureSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase must be configured to log laps.');
  }
};

const fallbackLogLap = async ({ sessionId, driverId, lapTimeMs }) => {
  const { data: lastLap, error: lastLapError } = await supabase
    .from('laps')
    .select('lap_number')
    .eq('session_id', sessionId)
    .eq('driver_id', driverId)
    .order('lap_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastLapError) throw lastLapError;
  const nextLapNumber = (lastLap?.lap_number ?? 0) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from('laps')
    .insert({
      session_id: sessionId,
      driver_id: driverId,
      lap_time_ms: lapTimeMs,
      lap_number: nextLapNumber,
      source: 'manual',
      invalidated: false,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  const { data: driverRow, error: driverError } = await supabase
    .from('drivers')
    .select('laps, last_lap_ms, best_lap_ms, total_time_ms')
    .eq('id', driverId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (driverError) throw driverError;

  const laps = (driverRow?.laps ?? 0) + 1;
  const bestLapRaw = driverRow?.best_lap_ms;
  const bestLap =
    bestLapRaw === null || bestLapRaw === undefined ? lapTimeMs : Math.min(bestLapRaw, lapTimeMs);
  const totalTime = (driverRow?.total_time_ms ?? 0) + lapTimeMs;

  const { error: updateError } = await supabase
    .from('drivers')
    .update({
      laps,
      last_lap_ms: lapTimeMs,
      best_lap_ms: bestLap,
      total_time_ms: totalTime,
      updated_at: new Date().toISOString(),
    })
    .eq('id', driverId)
    .eq('session_id', sessionId);
  if (updateError) throw updateError;

  return {
    lap_id: inserted?.id ?? null,
    session_id: sessionId,
    driver_id: driverId,
    laps,
    last_lap_ms: lapTimeMs,
    best_lap_ms: bestLap,
    total_time_ms: totalTime,
  };
};

export async function logLapAtomic({ sessionId, driverId, lapTimeMs }) {
  ensureSupabase();
  const { data, error } = await supabase.rpc(LOG_LAP_RPC, {
    p_session_id: sessionId,
    p_driver_id: driverId,
    p_lap_time_ms: lapTimeMs,
  });
  if (error) {
    if (isMissingRpcError(error, LOG_LAP_RPC) || isAmbiguousSessionIdError(error)) {
      return fallbackLogLap({ sessionId, driverId, lapTimeMs });
    }
    throw error;
  }
  return data?.[0] ?? null;
}

const fallbackInvalidateLastLap = async ({ sessionId, driverId, mode }) => {
  const { data: lastLap, error: lastLapError } = await supabase
    .from('laps')
    .select('id')
    .eq('session_id', sessionId)
    .eq('driver_id', driverId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastLapError) throw lastLapError;
  if (!lastLap?.id) {
    throw new Error('No laps recorded for this driver.');
  }

  const lapUpdates = { invalidated: true };
  if (mode === 'remove_lap') {
    lapUpdates.checkpoint_missed = true;
  } else {
    lapUpdates.checkpoint_missed = false;
  }

  const { error: updateLapError } = await supabase
    .from('laps')
    .update(lapUpdates)
    .eq('id', lastLap.id)
    .eq('session_id', sessionId);
  if (updateLapError) throw updateLapError;

  const { data: driverRow, error: driverError } = await supabase
    .from('drivers')
    .select('laps')
    .eq('id', driverId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (driverError) throw driverError;

  const { data: validLaps, error: validLapsError } = await supabase
    .from('laps')
    .select('lap_time_ms, recorded_at')
    .eq('session_id', sessionId)
    .eq('driver_id', driverId)
    .eq('invalidated', false);
  if (validLapsError) throw validLapsError;

  const timestampForLap = (lap) => {
    if (!lap?.recorded_at) return 0;
    const timestamp = new Date(lap.recorded_at).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  };

  const sortedValidLaps = Array.isArray(validLaps)
    ? [...validLaps].sort((a, b) => timestampForLap(b) - timestampForLap(a))
    : [];
  const lastValidLap = sortedValidLaps[0]?.lap_time_ms ?? null;
  const bestValidLap = sortedValidLaps.reduce((best, current) => {
    if (current?.lap_time_ms === null || current?.lap_time_ms === undefined) {
      return best;
    }
    return best === null ? current.lap_time_ms : Math.min(best, current.lap_time_ms);
  }, null);
  const totalValidTime = sortedValidLaps.reduce((sum, current) => {
    if (current?.lap_time_ms === null || current?.lap_time_ms === undefined) {
      return sum;
    }
    return sum + current.lap_time_ms;
  }, 0);

  let lapsCount = driverRow?.laps ?? 0;
  if (mode === 'remove_lap') {
    lapsCount = Math.max(lapsCount - 1, 0);
  }

  const { error: updateDriverError } = await supabase
    .from('drivers')
    .update({
      last_lap_ms: lastValidLap,
      best_lap_ms: bestValidLap,
      total_time_ms: totalValidTime,
      laps: lapsCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', driverId)
    .eq('session_id', sessionId);
  if (updateDriverError) throw updateDriverError;

  return {
    invalidated_lap_id: lastLap.id,
    session_id: sessionId,
    driver_id: driverId,
    laps: lapsCount,
    last_lap_ms: lastValidLap ?? null,
    best_lap_ms: bestValidLap ?? null,
    total_time_ms: totalValidTime ?? 0,
  };
};

export async function invalidateLastLap({ sessionId, driverId, mode = 'time_only' }) {
  ensureSupabase();
  const { data, error } = await supabase.rpc(INVALIDATE_LAST_LAP_RPC, {
    p_session_id: sessionId,
    p_driver_id: driverId,
    p_mode: mode,
  });
  if (error) {
    if (isMissingRpcError(error, INVALIDATE_LAST_LAP_RPC) || isAmbiguousSessionIdError(error)) {
      return fallbackInvalidateLastLap({ sessionId, driverId, mode });
    }
    throw error;
  }
  return data?.[0] ?? null;
}
