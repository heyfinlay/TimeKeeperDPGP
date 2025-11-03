import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

const NO_SUPABASE_ERROR = 'Supabase is not configured for admin operations.';

export async function fetchAdminSessions() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(NO_SUPABASE_ERROR);
  }
  const query = supabase
    .from('sessions')
    .select(
      'id, name, status, starts_at, ends_at, updated_at, created_at, drivers(id, name, number, marshal_user_id, team), session_members(user_id, role)',
    )
    .order('updated_at', { ascending: false, nullsFirst: false });

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

export async function fetchMarshalDirectory() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(NO_SUPABASE_ERROR);
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .in('role', ['marshal', 'admin', 'race_control'])
    .order('display_name', { ascending: true, nullsFirst: false });
  if (error) {
    throw error;
  }
  return (Array.isArray(data) ? data : []).map((profile) => ({
    id: profile.id,
    displayName: profile.display_name ?? 'Marshal',
    role: profile.role ?? 'marshal',
  }));
}

export async function updateSessionState(sessionId, patch = {}) {
  if (!sessionId) {
    throw new Error('A session ID is required to update state.');
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(NO_SUPABASE_ERROR);
  }
  const nextPatch = { ...patch };
  if (!nextPatch.updated_at) {
    nextPatch.updated_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('sessions')
    .update(nextPatch)
    .eq('id', sessionId)
    .select('*')
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ?? null;
}

export async function assignMarshalToDriver({ sessionId, driverId, marshalUserId }) {
  if (!sessionId || !driverId) {
    throw new Error('Session and driver identifiers are required for marshal assignment.');
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(NO_SUPABASE_ERROR);
  }
  const resolvedMarshalId = marshalUserId && String(marshalUserId).trim().length ? marshalUserId : null;

  const { data: currentDriver, error: currentDriverError } = await supabase
    .from('drivers')
    .select('id, marshal_user_id')
    .eq('session_id', sessionId)
    .eq('id', driverId)
    .maybeSingle();
  if (currentDriverError) {
    throw currentDriverError;
  }
  const previousMarshalId = currentDriver?.marshal_user_id ?? null;

  const { data: updatedDriver, error: driverError } = await supabase
    .from('drivers')
    .update({ marshal_user_id: resolvedMarshalId })
    .eq('session_id', sessionId)
    .eq('id', driverId)
    .select('id, marshal_user_id, session_id, name, number')
    .maybeSingle();
  if (driverError) {
    throw driverError;
  }

  if (resolvedMarshalId) {
    const { error: membershipError } = await supabase
      .from('session_members')
      .upsert(
        { session_id: sessionId, user_id: resolvedMarshalId, role: 'marshal' },
        { onConflict: 'session_id,user_id' },
      );
    if (membershipError) {
      throw membershipError;
    }
  }

  if (previousMarshalId && previousMarshalId !== resolvedMarshalId) {
    const { count: remainingAssignments, error: marshalAssignmentCountError } = await supabase
      .from('drivers')
      .select('id', { head: true, count: 'exact' })
      .eq('session_id', sessionId)
      .eq('marshal_user_id', previousMarshalId);
    if (marshalAssignmentCountError) {
      throw marshalAssignmentCountError;
    }
    if ((remainingAssignments ?? 0) === 0) {
      const { error: revokeError } = await supabase
        .from('session_members')
        .delete()
        .eq('session_id', sessionId)
        .eq('user_id', previousMarshalId)
        .eq('role', 'marshal');
      if (revokeError) {
        throw revokeError;
      }
    }
  }

  return updatedDriver ?? null;
}
