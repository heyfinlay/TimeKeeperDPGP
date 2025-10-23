import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 0;

/** @type {import('@supabase/supabase-js').SupabaseClient<Database> | null} */
export const supabase = isSupabaseConfigured
  ? createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    })
  : null;

export const supabaseEnvironment = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};
