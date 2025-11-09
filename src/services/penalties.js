/**
 * Penalties Service
 *
 * Handles time penalties applied to drivers
 */
import { supabase } from '@/lib/supabaseClient.js';

/**
 * Apply a time penalty to a driver
 * @param {Object} params
 * @param {string} params.sessionId - Session UUID
 * @param {string} params.driverId - Driver UUID
 * @param {string} params.category - Penalty category (e.g., 'track_limits', 'false_start')
 * @param {number} params.timePenaltyMs - Time penalty in milliseconds
 * @param {string} [params.reason] - Optional reason for penalty
 * @returns {Promise<string>} Penalty ID
 */
export async function applyPenalty({ sessionId, driverId, category, timePenaltyMs, reason = null }) {
  if (!sessionId || !driverId || !category || timePenaltyMs == null) {
    throw new Error('Missing required parameters: sessionId, driverId, category, timePenaltyMs');
  }

  if (timePenaltyMs < 0) {
    throw new Error('Time penalty cannot be negative');
  }

  try {
    const { data, error } = await supabase.rpc('apply_penalty', {
      p_session_id: sessionId,
      p_driver_id: driverId,
      p_category: category,
      p_time_penalty_ms: timePenaltyMs,
      p_reason: reason,
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Failed to apply penalty:', error);
    throw new Error(error.message || 'Failed to apply penalty');
  }
}

/**
 * Get penalties for a session
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array>} Penalties
 */
export async function getPenalties(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  try {
    const { data, error } = await supabase
      .from('penalties')
      .select('*, drivers(number, name)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Failed to fetch penalties:', error);
    throw error;
  }
}

/**
 * Get total penalties for a driver
 * @param {string} sessionId - Session UUID
 * @param {string} driverId - Driver UUID
 * @returns {Promise<number>} Total penalty time in milliseconds
 */
export async function getDriverPenaltyTotal(sessionId, driverId) {
  if (!sessionId || !driverId) {
    throw new Error('sessionId and driverId are required');
  }

  try {
    const { data, error } = await supabase
      .from('penalties')
      .select('time_penalty_ms')
      .eq('session_id', sessionId)
      .eq('driver_id', driverId);

    if (error) throw error;

    const total = (data || []).reduce((sum, p) => sum + (p.time_penalty_ms || 0), 0);
    return total;
  } catch (error) {
    console.error('Failed to calculate driver penalty total:', error);
    throw error;
  }
}

/**
 * Penalty categories with display labels
 */
export const PENALTY_CATEGORIES = {
  track_limits: 'Track Limits',
  false_start: 'False Start',
  causing_collision: 'Causing Collision',
  unsafe_rejoin: 'Unsafe Rejoin',
  speeding_pit_lane: 'Speeding in Pit Lane',
  ignoring_flags: 'Ignoring Flags',
  unsportsmanlike: 'Unsportsmanlike Conduct',
  other: 'Other',
};

/**
 * Common penalty times in milliseconds
 */
export const COMMON_PENALTIES = {
  '5s': 5000,
  '10s': 10000,
  '15s': 15000,
  '20s': 20000,
  '30s': 30000,
  '1m': 60000,
  '2m': 120000,
};
