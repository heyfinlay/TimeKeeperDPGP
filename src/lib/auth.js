/**
 * Authentication utilities for Diamond Sports Book
 *
 * @module lib/auth
 */

import { supabase, isSupabaseConfigured } from './supabaseClient.js';

/**
 * Sign in with Discord OAuth
 *
 * This is the ONLY supported authentication method for Diamond Sports Book.
 * All users (including admins) must authenticate via Discord OAuth.
 * Admin access is gated by `profiles.role='admin'` in the database.
 *
 * @param {Object} options - Sign-in options
 * @param {string} [options.redirectTo] - URL to redirect to after auth (defaults to /auth/callback)
 * @returns {Promise<void>}
 *
 * @example
 * import { signInWithDiscord } from '@/lib/auth.js';
 *
 * await signInWithDiscord();
 */
export const signInWithDiscord = async (options = {}) => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Cannot authenticate.');
  }

  const redirectTo =
    options.redirectTo ||
    (typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: redirectTo ? { redirectTo } : {},
  });

  if (error) {
    console.error('Discord sign-in failed', error);
    throw error;
  }
};

/**
 * Sign out the current user
 *
 * @returns {Promise<void>}
 */
export const signOut = async () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Sign-out failed', error);
    throw error;
  }
};

/**
 * Get the current authenticated user
 *
 * @returns {Promise<{user: Object | null, error: Error | null}>}
 */
export const getCurrentUser = async () => {
  if (!isSupabaseConfigured || !supabase) {
    return { user: null, error: new Error('Supabase is not configured.') };
  }

  const { data, error } = await supabase.auth.getUser();
  return { user: data?.user ?? null, error };
};

/**
 * Check if the current user is an admin
 *
 * @returns {Promise<boolean>}
 */
export const isAdmin = async () => {
  if (!isSupabaseConfigured || !supabase) {
    return false;
  }

  try {
    const { user } = await getCurrentUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    return profile?.role === 'admin';
  } catch (error) {
    console.error('Failed to check admin status', error);
    return false;
  }
};
