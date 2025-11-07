import { createClient } from '@supabase/supabase-js';

/** @typedef {import('./database.types').Database} Database */

/**
 * Create a Supabase client configured for trusted server-side execution.
 *
 * @param {object} [config]
 * @param {string} [config.supabaseUrl]
 * @param {string} [config.supabaseKey]
 * @param {import('@supabase/supabase-js').SupabaseClientOptions<Database>} [config.options]
 * @returns {import('@supabase/supabase-js').SupabaseClient<Database>}
 */
export const createSupabaseServerClient = ({
  supabaseUrl = process.env.SUPABASE_URL ?? '',
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  options = {},
} = {}) => {
  const url = supabaseUrl.trim();
  const key = supabaseKey.trim();
  if (!url || !key) {
    throw new Error('Supabase URL and service role key are required to create a server client.');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    ...options,
  });
};
