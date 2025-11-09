import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

const ensureSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase must be configured for race control operations.');
  }
};

const callRpc = async (name, params) => {
  ensureSupabase();
  const { error } = await supabase.rpc(name, params ?? {});
  if (error) {
    throw error;
  }
};

export async function startSession(sessionId) {
  await callRpc('start_session', { p_session_id: sessionId });
}

export async function pauseSession(sessionId) {
  await callRpc('pause_session', { p_session_id: sessionId });
}

export async function resumeSession(sessionId) {
  await callRpc('resume_session', { p_session_id: sessionId });
}

export async function finalizeResults(sessionId) {
  await callRpc('finalize_results', { p_session_id: sessionId });
}

export async function setFlag(sessionId, flag) {
  await callRpc('set_flag', { p_session_id: sessionId, p_flag: flag });
}

export async function applyPenalty(sessionId, driverId, { category, valueMs = 0, reason, issuedBy }) {
  ensureSupabase();
  const { error } = await supabase.from('penalties').insert({
    session_id: sessionId,
    driver_id: driverId,
    category,
    value_ms: valueMs,
    reason,
    issued_by: issuedBy ?? null,
  });
  if (error) throw error;
}

export async function logControlAction(sessionId, action, payload = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return;
  }
  const { error } = await supabase.from('control_logs').insert({
    session_id: sessionId,
    action,
    payload,
  });
  if (error) {
    console.warn('Unable to persist control log entry', error);
  }
}
