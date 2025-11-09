/**
 * Results Service
 *
 * Handles session results finalization and CSV export
 */
import { supabase } from '@/lib/supabaseClient.js';
import { formatLapTime } from '@/utils/time.js';

/**
 * Finalize session results
 * Calculates final positions, applies penalties, and publishes results
 * @param {string} sessionId - Session UUID
 * @returns {Promise<void>}
 */
export async function finalizeSessionResults(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  try {
    const { error } = await supabase.rpc('finalize_session_results', {
      p_session_id: sessionId,
    });

    if (error) throw error;
  } catch (error) {
    console.error('Failed to finalize results:', error);
    throw new Error(error.message || 'Failed to finalize results');
  }
}

/**
 * Get finalized results for a session
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array>} Results
 */
export async function getSessionResults(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  try {
    const { data, error } = await supabase
      .from('results_final')
      .select('*, drivers(number, name, team)')
      .eq('session_id', sessionId)
      .order('final_position', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Failed to fetch results:', error);
    throw error;
  }
}

/**
 * Generate CSV export of session results
 * @param {string} sessionId - Session UUID
 * @param {string} sessionName - Session name
 * @returns {Promise<string>} CSV content
 */
export async function exportResultsToCSV(sessionId, sessionName) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  try {
    const results = await getSessionResults(sessionId);

    if (!results || results.length === 0) {
      throw new Error('No results to export');
    }

    // CSV header
    const headers = [
      'Position',
      'Number',
      'Driver',
      'Team',
      'Classification',
      'Laps',
      'Total Time',
      'Best Lap',
      'Penalties',
      'Final Time',
    ];

    // CSV rows
    const rows = results.map((result) => [
      result.final_position,
      result.drivers?.number || '',
      result.drivers?.name || 'Unknown Driver',
      result.drivers?.team || '',
      result.classification,
      result.total_laps,
      result.total_time_ms ? formatLapTime(result.total_time_ms) : 'N/A',
      result.best_lap_ms ? formatLapTime(result.best_lap_ms) : 'N/A',
      result.total_penalty_ms ? formatLapTime(result.total_penalty_ms) : '0.000',
      result.final_time_ms ? formatLapTime(result.final_time_ms) : 'N/A',
    ]);

    // Build CSV content
    const csvContent = [
      `"${sessionName || 'Session'} - Final Results"`,
      `"Generated: ${new Date().toLocaleString()}"`,
      '',
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  } catch (error) {
    console.error('Failed to export results to CSV:', error);
    throw error;
  }
}

/**
 * Download CSV file
 * @param {string} csvContent - CSV content
 * @param {string} filename - Filename (without extension)
 */
export function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Finalize results and download CSV
 * @param {string} sessionId - Session UUID
 * @param {string} sessionName - Session name
 * @returns {Promise<void>}
 */
export async function finalizeAndExport(sessionId, sessionName) {
  await finalizeSessionResults(sessionId);
  const csvContent = await exportResultsToCSV(sessionId, sessionName);
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${sessionName}_Results_${timestamp}`;
  downloadCSV(csvContent, filename);
}
