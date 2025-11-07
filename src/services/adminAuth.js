/**
 * @deprecated This file contains legacy admin authentication that has been replaced.
 *
 * **IMPORTANT: This authentication method is DEPRECATED and will be removed.**
 *
 * Diamond Sports Book now uses Discord OAuth for ALL authentication, including admins.
 * Admin access is gated by `profiles.role='admin'` in the database.
 *
 * Use the new authentication module instead:
 * @see src/lib/auth.js
 *
 * Migration guide:
 * 1. Remove all calls to `loginWithAdminCredentials`
 * 2. Use `signInWithDiscord()` from AuthContext or `src/lib/auth.js`
 * 3. Grant admin access by updating user's profile: `UPDATE profiles SET role='admin' WHERE id='<user_id>';`
 */

import { isSupabaseConfigured, supabaseEnvironment } from '@/lib/supabaseClient.js';

const normalizeUrl = (url) => {
  if (!url) return null;
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

const buildDefaultFunctionsUrl = () => {
  if (!isSupabaseConfigured) {
    return null;
  }
  const base = normalizeUrl(supabaseEnvironment.url);
  if (!base) {
    return null;
  }
  if (base.includes('.supabase.co')) {
    return base.replace('.supabase.co', '.functions.supabase.co');
  }
  return `${base}/functions/v1`;
};

const resolveEndpoint = (options = {}) => {
  if (options.functionsUrl) {
    return normalizeUrl(options.functionsUrl);
  }
  const fromEnv = normalizeUrl(import.meta.env?.VITE_ADMIN_AUTH_ENDPOINT);
  if (fromEnv) {
    return fromEnv;
  }
  return buildDefaultFunctionsUrl();
};

const buildError = async (response) => {
  let message = `Admin credential request failed (${response.status})`;
  try {
    const payload = await response.json();
    if (payload?.error) {
      message = typeof payload.error === 'string' ? payload.error : message;
    }
  } catch (error) {
    if (error) {
      // swallow JSON parse errors
    }
  }
  const error = new Error(message);
  error.status = response.status;
  return error;
};

/**
 * @deprecated Use Discord OAuth via `signInWithDiscord()` from AuthContext instead.
 *
 * This function is no longer supported. Diamond Sports Book now uses Discord OAuth
 * for all authentication. Admin access is determined by `profiles.role='admin'`.
 *
 * @throws {Error} Always throws - this authentication method is deprecated
 */
export const loginWithAdminCredentials = async (
  { username, password },
  options = {},
) => {
  throw new Error(
    'Admin credential login is deprecated. Use Discord OAuth via signInWithDiscord() instead. ' +
      'Admin access is now gated by profiles.role="admin" in the database. ' +
      'See src/lib/auth.js for the new authentication methods.',
  );

  // Legacy implementation preserved for reference but unreachable
  /* istanbul ignore next */
  const trimmedUsername = typeof username === 'string' ? username.trim() : '';
  /* istanbul ignore next */
  const rawPassword = typeof password === 'string' ? password : '';

  /* istanbul ignore next */
  if (!trimmedUsername || !rawPassword) {
    throw new Error('Username and password are required.');
  }

  /* istanbul ignore next */
  const endpoint = resolveEndpoint(options);
  /* istanbul ignore next */
  if (!endpoint) {
    throw new Error('Admin credential endpoint is not configured.');
  }

  /* istanbul ignore next */
  const fetchImpl = options.fetch ?? globalThis.fetch;
  /* istanbul ignore next */
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is not available.');
  }

  /* istanbul ignore next */
  const response = await fetchImpl(`${endpoint}/admin-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: trimmedUsername, password: rawPassword }),
  });

  /* istanbul ignore next */
  if (!response.ok) {
    throw await buildError(response);
  }

  /* istanbul ignore next */
  const data = await response.json();
  /* istanbul ignore next */
  return {
    accessToken: data?.access_token ?? null,
    refreshToken: data?.refresh_token ?? null,
    expiresIn: data?.expires_in ?? null,
    expiresAt: data?.expires_at ?? null,
    tokenType: data?.token_type ?? null,
    user: data?.user ?? null,
    raw: data,
  };
};
