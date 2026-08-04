/**
 * api.js — REST API client for historical heatmap queries.
 *
 * Used when the admin dashboard switches to "History" mode.
 * Fetches aggregated H3 cell data from PostgreSQL via the Go backend.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

/**
 * Fetch historical heatmap data for a given time range.
 *
 * @param {number} fromMs - Start timestamp in Unix milliseconds
 * @param {number} toMs - End timestamp in Unix milliseconds
 * @returns {Promise<{ cells: Array<{ h3_index: string, intensity: number }>, total_cells: number }>}
 */
export async function fetchHistoricalHeatmap(fromMs, toMs) {
  const url = `${API_BASE}/history?from=${fromMs}&to=${toMs}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch deviation events for a specific driver.
 *
 * @param {Object} params
 * @param {string} [params.driverId] - Filter by driver ID
 * @param {number} [params.fromMs] - Start timestamp
 * @param {number} [params.toMs] - End timestamp
 * @param {number} [params.limit] - Max results (default: 100)
 * @returns {Promise<{ events: Array, total: number }>}
 */
export async function fetchDeviationEvents({ driverId, fromMs, toMs, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (driverId) params.set('driver_id', driverId);
  if (fromMs) params.set('from', String(fromMs));
  if (toMs) params.set('to', String(toMs));
  params.set('limit', String(limit));

  const url = `${API_BASE}/deviations?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Check backend health status.
 *
 * @returns {Promise<{ status: string, redis_connected: boolean, postgres_connected: boolean, osrm_connected: boolean }>}
 */
export async function checkHealth() {
  const response = await fetch(`${API_BASE}/health`);
  return response.json();
}
