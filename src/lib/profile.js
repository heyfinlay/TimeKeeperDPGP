import { supabase } from './supabaseClient.js';

export const PROFILE_COLUMN_SELECTION =
  'id, role, handle, display_name, ic_phone_number, assigned_driver_ids, team_id, tier, experience_points';

const normaliseString = (value) => {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normaliseArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return null;
  }
  return Array.isArray(value) ? value : null;
};

export const buildProfilePayload = (patch = {}) => {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(patch, 'display_name')) {
    payload.display_name = normaliseString(patch.display_name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'handle')) {
    payload.handle = normaliseString(patch.handle);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
    payload.role = normaliseString(patch.role);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'team_id')) {
    payload.team_id = patch.team_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ic_phone_number')) {
    payload.ic_phone_number = normaliseString(patch.ic_phone_number);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'driver_ids')) {
    payload.assigned_driver_ids = normaliseArray(patch.driver_ids);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'assigned_driver_ids')) {
    payload.assigned_driver_ids = normaliseArray(patch.assigned_driver_ids);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tier')) {
    payload.tier = patch.tier ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'experience_points')) {
    payload.experience_points = patch.experience_points ?? null;
  }

  return payload;
};

export const saveProfile = async (patch = {}, options = {}) => {
  const supabaseClient = options.supabase ?? supabase;
  if (!supabaseClient) {
    throw new Error('Supabase client is not configured.');
  }

  let userId = options.userId ?? null;
  if (!userId) {
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();
    if (userError) {
      throw userError;
    }
    userId = user?.id ?? null;
  }

  if (!userId) {
    throw new Error('Not signed in');
  }

  const updates = buildProfilePayload(patch);
  if (Object.keys(updates).length === 0) {
    return null;
  }

  const payload = {
    id: userId,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert(payload)
    .select(PROFILE_COLUMN_SELECTION)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
};

