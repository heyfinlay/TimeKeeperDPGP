import { createClient } from '@supabase/supabase-js';

/** @typedef {import('./database.types').Database} Database */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 0;

const REST_ENDPOINT = isSupabaseConfigured
  ? `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
  : null;
const STORAGE_ENDPOINT = isSupabaseConfigured
  ? `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object`
  : null;

const AUTH_HEADERS = isSupabaseConfigured
  ? {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    }
  : {};

const DEFAULT_HEADERS = isSupabaseConfigured
  ? {
      ...AUTH_HEADERS,
      Accept: 'application/json',
    }
  : {};

/** @type {import('@supabase/supabase-js').SupabaseClient<Database> | null} */
let browserClient = null;

const createSupabaseBrowserClient = () => {
  if (!isSupabaseConfigured) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
};

export const getSupabaseBrowserClient = () => {
  if (browserClient) {
    return browserClient;
  }
  browserClient = createSupabaseBrowserClient();
  return browserClient;
};

const buildError = async (response) => {
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
  return error;
};

const toSearchParams = (filters = {}) =>
  Object.entries(filters).reduce((params, [key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, value);
    }
    return params;
  }, new URLSearchParams());

const buildOrderParam = (order) => {
  if (!order?.column) {
    return null;
  }
  let orderValue = `${order.column}.${order.ascending === false ? 'desc' : 'asc'}`;
  if (order.nullsFirst !== undefined) {
    orderValue += order.nullsFirst ? '.nullsfirst' : '.nullslast';
  }
  return orderValue;
};

const request = async (
  table,
  { method = 'GET', filters, order, select = '*', body, signal, prefer } = {},
) => {
  if (!REST_ENDPOINT) {
    throw new Error('Supabase is not configured.');
  }

  const url = new URL(`${REST_ENDPOINT}/${table}`);
  if (select) {
    url.searchParams.set('select', select);
  }
  if (filters) {
    const filterParams = toSearchParams(filters);
    filterParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  const orderValue = buildOrderParam(order);
  if (orderValue) {
    url.searchParams.set('order', orderValue);
  }

  const headers = { ...DEFAULT_HEADERS };
  if (prefer) {
    headers.Prefer = prefer;
  }

  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: payload,
    signal,
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

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
  { contentType = 'application/octet-stream', upsert = true } = {},
) => {
  if (!isSupabaseConfigured || !STORAGE_ENDPOINT) {
    throw new Error('Supabase is not configured. Unable to upload to storage.');
  }

  const url = `${STORAGE_ENDPOINT}/${bucket}/${encodeStoragePath(objectPath)}${upsert ? '?upsert=true' : ''}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...AUTH_HEADERS,
      'Content-Type': contentType,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase storage upload failed (${response.status}): ${errorText}`);
  }

  try {
    return await response.json();
  } catch (error) {
    return null;
  }
};

export const buildStorageObjectUrl = (bucket, objectPath) => {
  if (!isSupabaseConfigured) {
    return null;
  }
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`;
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

export const subscribeToTable = (
  { schema = 'public', table, event = '*', filter },
  callback,
  options = {},
) => {
  const supabaseClient = getSupabaseBrowserClient();
  if (!isSupabaseConfigured || !supabaseClient) {
    console.warn('Supabase realtime subscription skipped. Supabase is not configured.');
    return () => {};
  }
  if (!table) {
    console.warn('Supabase realtime subscription skipped. Table is required.');
    return () => {};
  }

  const channelName = [`realtime`, schema, table, event, filter ?? 'all']
    .filter(Boolean)
    .join('-');

  const { maxRetries = 5, retryDelayBaseMs = 500 } = options ?? {};

  let currentChannel = null;
  let disposed = false;
  let retries = 0;
  let retryTimer = null;

  const teardownChannel = () => {
    if (currentChannel) {
      try {
        supabaseClient.removeChannel(currentChannel);
      } catch (removeError) {
        console.warn(`Supabase realtime teardown issue for ${channelName}`, removeError);
      }
      currentChannel = null;
    }
  };

  const scheduleRetry = (reason) => {
    if (disposed) return;
    teardownChannel();
    if (retries >= maxRetries) {
      console.error(
        `[Supabase realtime] ${channelName} retry limit reached after ${reason}. Manual reload required.`,
      );
      return;
    }
    const delay = Math.min(30000, retryDelayBaseMs * 2 ** retries);
    retries += 1;
    console.warn(
      `[Supabase realtime] ${channelName} retrying in ${delay}ms (attempt ${retries} of ${maxRetries}) after ${reason}.`,
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      subscribe();
    }, delay);
  };

  const subscribe = () => {
    if (disposed) return;
    teardownChannel();
    const channel = supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema,
          table,
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          try {
            callback(payload);
          } catch (error) {
            console.error('Supabase realtime callback failed', error);
          }
        },
      );

    currentChannel = channel;

    channel.subscribe((status) => {
      console.info(`[Supabase realtime] ${channelName} status: ${status}`);
      if (disposed || channel !== currentChannel) {
        return;
      }
      if (status === 'SUBSCRIBED') {
        retries = 0;
        return;
      }
      if (status === 'CHANNEL_ERROR') {
        scheduleRetry('channel error');
      } else if (status === 'TIMED_OUT') {
        scheduleRetry('timeout');
      } else if (status === 'CLOSED') {
        scheduleRetry('closed');
      }
    });
  };

  subscribe();

  return () => {
    disposed = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    teardownChannel();
  };
};

export const supabaseEnvironment = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};

export const supabase = getSupabaseBrowserClient();
