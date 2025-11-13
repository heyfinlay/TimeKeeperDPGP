import { supabase } from './supabaseClient.js';

export const PROFILE_COLUMN_SELECTION =
  'id, role, handle, display_name, ic_phone_number, assigned_driver_ids, team_id, tier, experience_points';

const DEFAULT_ROLE = 'marshal';

const normaliseString = (value) => {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normaliseRole = (value) => {
  const role = normaliseString(value);
  return typeof role === 'string' ? role.toLowerCase() : null;
};

const VALID_ROLES = new Set(['spectator', 'driver', 'marshal', 'admin']);

const resolveRoleFromClaims = (claims = {}) => {
  if (!claims || typeof claims !== 'object') {
    return null;
  }
  const claimedRole = normaliseRole(
    claims.role ?? claims.role_hint ?? claims.roleHint ?? claims.profile_role,
  );
  if (claimedRole && VALID_ROLES.has(claimedRole) && claimedRole !== 'admin') {
    return claimedRole;
  }
  return null;
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
    const resolvedRole = normaliseRole(patch.role);
    payload.role = resolvedRole ?? DEFAULT_ROLE;
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

export const ensureProfileForCurrentUser = async (profile = {}, options = {}) => {
  const supabaseClient = options.supabase ?? supabase;
  if (!supabaseClient) {
    throw new Error('Supabase client is not configured.');
  }

  const payload = {};

  const displayNameSource = Object.prototype.hasOwnProperty.call(profile, 'display_name')
    ? profile.display_name
    : profile.displayName;
  const resolvedDisplayName = normaliseString(displayNameSource);
  if (resolvedDisplayName) {
    payload.display_name = resolvedDisplayName;
  }

  const roleSource = (() => {
    if (Object.prototype.hasOwnProperty.call(profile, 'role_hint')) {
      return profile.role_hint;
    }
    if (Object.prototype.hasOwnProperty.call(profile, 'roleHint')) {
      return profile.roleHint;
    }
    return profile.role;
  })();
  const resolvedRoleHint = normaliseRole(roleSource);
  if (resolvedRoleHint) {
    payload.role_hint = resolvedRoleHint;
  }

  const { data, error } = await supabaseClient.rpc('ensure_profile_for_current_user', payload);
  if (error) {
    throw error;
  }
  return data ?? null;
};

export const resolveProfileRole = (profile = {}, options = {}) => {
  const profileRole = normaliseRole(profile?.role);
  if (profileRole && VALID_ROLES.has(profileRole)) {
    return profileRole;
  }

  const claimsRole = resolveRoleFromClaims(options.claims);
  if (claimsRole && VALID_ROLES.has(claimsRole)) {
    return claimsRole;
  }

  return DEFAULT_ROLE;
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

