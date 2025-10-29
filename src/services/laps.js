import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

const LOG_LAP_RPC = 'log_lap_atomic';

const isMissingRpcError = (error) => {
  if (!error) return false;
  if (error.code === 'PGRST116' || error.code === 'PGRST204') {
    return true;
  }
  const message = String(error.message ?? error.details ?? '').toLowerCase();
  return message.includes(LOG_LAP_RPC) && message.includes('function');
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

  return inserted;
};

export async function logLapAtomic({ sessionId, driverId, lapTimeMs }) {
  ensureSupabase();
  const { data, error } = await supabase.rpc(LOG_LAP_RPC, {
    p_session_id: sessionId,
    p_driver_id: driverId,
    p_lap_time_ms: lapTimeMs,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return fallbackLogLap({ sessionId, driverId, lapTimeMs });
    }
    throw error;
  }
  return data;
}

export async function invalidateLastLap({ sessionId, driverId }) {
  ensureSupabase();
  const { data: lastLap, error: selectError } = await supabase
    .from('laps')
    .select('id')
    .eq('session_id', sessionId)
    .eq('driver_id', driverId)
    .eq('invalidated', false)
    .order('lap_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!lastLap?.id) {
    return null;
  }
  const { error: updateError } = await supabase
    .from('laps')
    .update({ invalidated: true })
    .eq('id', lastLap.id)
    .eq('session_id', sessionId);
  if (updateError) throw updateError;
  return lastLap;
}
