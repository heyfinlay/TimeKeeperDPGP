import { createClient } from '@supabase/supabase-js';

/** @typedef {import('./database.types').Database} Database */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 0;

let supabaseClient = null;

if (isSupabaseConfigured) {
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 5,
      },
    },
  });
}

/** @type {import('@supabase/supabase-js').SupabaseClient<Database> | null} */
export const supabase = supabaseClient;

export const supabaseEnvironment = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};
