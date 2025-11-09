/**
 * Pit Events Service
 *
 * Handles pit in/out logging with automatic duration calculation
 */
import { supabase } from '@/lib/supabaseClient.js';

/**
 * Log a pit event (in or out)
 * @param {Object} params
 * @param {string} params.sessionId - Session UUID
 * @param {string} params.driverId - Driver UUID
 * @param {string} params.eventType - 'in' or 'out'
 * @returns {Promise<string>} Event ID
 */
export async function logPitEvent({ sessionId, driverId, eventType }) {
  if (!sessionId || !driverId || !eventType) {
    throw new Error('Missing required parameters: sessionId, driverId, eventType');
  }

  if (!['in', 'out'].includes(eventType)) {
    throw new Error('Event type must be "in" or "out"');
  }

  try {
    const { data, error } = await supabase.rpc('log_pit_event', {
      p_session_id: sessionId,
      p_driver_id: driverId,
      p_event_type: eventType,
    });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Failed to log pit event:', error);
    throw new Error(error.message || 'Failed to log pit event');
  }
}

/**
 * Get pit events for a session
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array>} Pit events
 */
export async function getPitEvents(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  try {
    const { data, error } = await supabase
      .from('pit_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Failed to fetch pit events:', error);
    throw error;
  }
}

/**
 * Get pit events for a specific driver
 * @param {string} sessionId - Session UUID
 * @param {string} driverId - Driver UUID
 * @returns {Promise<Array>} Pit events
 */
export async function getDriverPitEvents(sessionId, driverId) {
  if (!sessionId || !driverId) {
    throw new Error('sessionId and driverId are required');
  }

  try {
    const { data, error } = await supabase
      .from('pit_events')
      .select('*')
      .eq('session_id', sessionId)
      .eq('driver_id', driverId)
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Failed to fetch driver pit events:', error);
    throw error;
  }
}
