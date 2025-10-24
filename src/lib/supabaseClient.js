import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 0;

-const REST_ENDPOINT = isSupabaseConfigured
  ? `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
  : null;
const REALTIME_ENDPOINT = isSupabaseConfigured
  ? `${SUPABASE_URL.replace('https://', 'wss://').replace(/\/$/, '')}/realtime/v1/websocket`
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
  { method = 'GET', filters, body, prefer, signal, headers = {}, select, order } = {},
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
  const response = await fetch(url, {
    method,
    headers: {
      ...AUTH_HEADERS,
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
  { contentType = 'application/octet-stream', upsert = true } = {},
) => {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Unable to upload to storage.');
  }
  const url = `${STORAGE_ENDPOINT}/${bucket}/${encodeStoragePath(objectPath)}${
    upsert ? '?upsert=true' : ''
  }`;
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
  return response.json().catch(() => null);
};

export const buildStorageObjectUrl = (bucket, objectPath) => {
  if (!isSupabaseConfigured) return null;
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`;
};

const HEARTBEAT_INTERVAL = 25000;

export const subscribeToTable = (
  { schema = 'public', table, event = '*', filter },
  callback,
) => {
  if (!isSupabaseConfigured) {
    console.warn('Supabase realtime subscription skipped. Supabase is not configured.');
    return () => {};
  }
  if (typeof WebSocket === 'undefined') {
    console.warn('Supabase realtime subscription skipped. WebSocket API is unavailable in this environment.');
    return () => {};
  }
  const params = new URLSearchParams({
    apikey: SUPABASE_ANON_KEY,
    vsn: '1.0.0',
  });
  const ws = new WebSocket(`${REALTIME_ENDPOINT}?${params.toString()}`, ['phoenix']);
  const channel = `realtime:${schema}:${table}`;
  let heartbeatTimer = null;
  let joined = false;

  const joinRef = Date.now().toString();
  const joinPayload = {
    topic: channel,
    event: 'phx_join',
    payload: {
      config: {
        broadcast: { ack: false },
        postgres_changes: [
          {
            event,
            schema,
            table,
            ...(filter ? { filter } : {}),
          },
        ],
      },
    },
    ref: joinRef,
    join_ref: joinRef,
  };

  const sendHeartbeat = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          topic: 'phoenix',
          event: 'heartbeat',
          payload: {},
          ref: Date.now().toString(),
        }),
      );
    }
  };

  ws.onopen = () => {
    ws.send(JSON.stringify(joinPayload));
    ws.send(
      JSON.stringify({
        topic: channel,
        event: 'access_token',
        payload: { access_token: SUPABASE_ANON_KEY },
        ref: `${joinRef}-token`,
      }),
    );
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'phx_reply' && data.payload?.status === 'ok') {
        joined = true;
        return;
      }
      if (data.event === 'postgres_changes' && joined) {
        callback?.(data.payload);
      }
      if (data.event === 'phx_error' || data.event === 'phx_close') {
        console.warn('Supabase realtime channel closed', data);
      }
    } catch (error) {
      console.error('Failed to parse realtime payload', error);
    }
  };

  ws.onerror = (event) => {
    console.error('Supabase realtime error', event);
  };

  return () => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            topic: channel,
            event: 'phx_leave',
            payload: {},
            ref: `${Date.now()}-leave`,
          }),
        );
      }
      ws.close();
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
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
