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

export const loginWithAdminCredentials = async (
  { username, password },
  options = {},
) => {
  const trimmedUsername = typeof username === 'string' ? username.trim() : '';
  const rawPassword = typeof password === 'string' ? password : '';

  if (!trimmedUsername || !rawPassword) {
    throw new Error('Username and password are required.');
  }

  const endpoint = resolveEndpoint(options);
  if (!endpoint) {
    throw new Error('Admin credential endpoint is not configured.');
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is not available.');
  }

  const response = await fetchImpl(`${endpoint}/admin-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: trimmedUsername, password: rawPassword }),
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  const data = await response.json();
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
