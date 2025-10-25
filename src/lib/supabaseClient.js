import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 0;

const supabaseOptions = {
  auth: {
    persistSession: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 5,
    },
  },
};

export const supabase = isSupabaseConfigured
  ? /** @type {import('@supabase/supabase-js').SupabaseClient | null} */ (
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, supabaseOptions)
    )
  : null;

const REST_ENDPOINT = isSupabaseConfigured
  ? `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
  : null;
const STORAGE_ENDPOINT = isSupabaseConfigured
  ? `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object`
  : null;

const resolveAccessToken = async ({ accessToken, requireSession = false } = {}) => {
  if (!isSupabaseConfigured || !supabase) {
    if (requireSession) {
      throw new Error('Supabase session is required but Supabase is not configured.');
    }
    return null;
  }

  if (accessToken) {
    return accessToken;
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Failed to resolve Supabase session', error);
    }
    const sessionToken = data?.session?.access_token;
    if (sessionToken) {
      return sessionToken;
    }
  } catch (sessionError) {
    console.error('Unexpected error while resolving Supabase session', sessionError);
  }

  if (requireSession) {
    throw new Error('Supabase session is required but not available.');
  }

  return SUPABASE_ANON_KEY ?? null;
};

export const getAuthHeaders = async ({ accessToken, requireSession = false } = {}) => {
  if (!isSupabaseConfigured) {
    return {};
  }

  const token = await resolveAccessToken({ accessToken, requireSession });
  if (!token) {
    return {};
  }

  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
};

const parseFilters = (filters = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, value);
    }
  });
  return searchParams;
};

const request = async (
  table,
  {
    method = 'GET',
    filters,
    body,
    prefer,
    signal,
    headers = {},
    select,
    order,
    accessToken,
    requireSession = false,
  } = {},
) => {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  const searchParams = parseFilters(filters);
  if (select) {
    searchParams.set('select', select);
  }
  if (order?.column) {
    const direction = order.ascending === false ? 'desc' : 'asc';
    searchParams.set('order', `${order.column}.${direction}`);
  }
  const url = `${REST_ENDPOINT}/${table}${
    searchParams.toString() ? `?${searchParams.toString()}` : ''
  }`;
  const authHeaders = await getAuthHeaders({ accessToken, requireSession });
  const response = await fetch(url, {
    method,
    headers: {
      ...authHeaders,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) {
    const errorText = await response.text();
    let parsed = null;
    try {
      parsed = errorText ? JSON.parse(errorText) : null;
    } catch (parseError) {
      parsed = null;
    }
    const error = new Error(`Supabase request failed (${response.status}): ${errorText}`);
    error.status = response.status;
    if (parsed && typeof parsed === 'object') {
      error.code = parsed.code;
      error.details = parsed.details;
      error.hint = parsed.hint;
      error.supabase = parsed;
      if (typeof parsed.message === 'string') {
        error.supabaseMessage = parsed.message;
      }
    }
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('Failed to parse Supabase response', error);
    return null;
  }
};

export const supabaseSelect = (table, options = {}) =>
  request(table, { ...options, method: 'GET' });

export const supabaseInsert = (table, rows, options = {}) =>
  request(table, {
    method: 'POST',
    body: rows,
    prefer: 'return=representation',
    ...options,
  });

export const supabaseUpsert = (table, rows, options = {}) =>
  request(table, {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
    ...options,
  });

export const supabaseUpdate = (table, patch, options = {}) =>
  request(table, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
    ...options,
  });

export const supabaseDelete = (table, options = {}) =>
  request(table, { method: 'DELETE', ...options });

const encodeStoragePath = (path) =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export const supabaseStorageUpload = async (
  bucket,
  objectPath,
  body,
  {
    contentType = 'application/octet-stream',
    upsert = true,
    accessToken,
    requireSession = false,
  } = {},
) => {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Unable to upload to storage.');
  }
  const url = `${STORAGE_ENDPOINT}/${bucket}/${encodeStoragePath(objectPath)}${
    upsert ? '?upsert=true' : ''
  }`;
  const authHeaders = await getAuthHeaders({ accessToken, requireSession });
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'Content-Type': contentType,
    },
    body,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase storage upload failed (${response.status}): ${errorText}`);
  }
  return response.json().catch(() => null);
};

export const buildStorageObjectUrl = (bucket, objectPath) => {
  if (!isSupabaseConfigured) return null;
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`;
};

export const subscribeToTable = (
  { schema = 'public', table, event = '*', filter },
  callback,
) => {
  if (!isSupabaseConfigured || !supabase) {
    console.warn('Supabase realtime subscription skipped. Supabase is not configured.');
    return () => {};
  }

  const channelName = `table:${schema}:${table}:${Math.random().toString(36).slice(2)}`;
  const channel = supabase.channel(channelName);

  channel.on(
    'postgres_changes',
    {
      event,
      schema,
      table,
      ...(filter ? { filter } : {}),
    },
    (payload) => {
      callback?.(payload);
    },
  );

  channel
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('Supabase realtime channel error', { schema, table, filter });
      }
    })
    .catch((error) => {
      console.error('Failed to subscribe to Supabase realtime channel', error);
    });

  let active = true;

  return () => {
    if (!active) return;
    active = false;
    channel.unsubscribe().catch((error) => {
      console.error('Failed to unsubscribe from Supabase realtime channel', error);
    });
  };
};

export const supabaseEnvironment = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};

const includesCaseInsensitive = (source, search) => {
  if (!source || !search) return false;
  return source.toLowerCase().includes(search.toLowerCase());
};

const extractMessage = (error) => {
  if (!error) return '';
  if (typeof error.supabaseMessage === 'string') {
    return error.supabaseMessage;
  }
  if (typeof error.details === 'string') {
    return error.details;
  }
  if (error.supabase && typeof error.supabase.message === 'string') {
    return error.supabase.message;
  }
  if (typeof error.message === 'string') {
    return error.message;
  }
  return '';
};

export const isTableMissingError = (error, table) => {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.status === 404) {
    if (!table) return true;
    const message = extractMessage(error);
    return (
      includesCaseInsensitive(message, `table '${table}`) ||
      includesCaseInsensitive(message, `'${table}'`)
    );
  }
  return false;
};

export const isColumnMissingError = (error, column) => {
  if (!error) return false;
  if (error.code === '42703' || error.status === 400) {
    if (!column) return true;
    const message = extractMessage(error);
    return includesCaseInsensitive(message, column);
  }
  return false;
};
