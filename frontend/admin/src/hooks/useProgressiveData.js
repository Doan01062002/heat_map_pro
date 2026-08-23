// useProgressiveData.js
// Progressive Data Hydration Engine for Heatmap Admin Dashboard.
//
// Three-phase loading strategy:
//   Phase 1 (instant ~300ms): /api/stats-summary  → full dataset counts, actual date range from DB
//   Phase 2 (background):     /api/trips-summary  → paginated trip list, 200/page
//   Phase 3 (background):     /api/points         → chunked GPS points, configurable chunk size
//
// Cache: sessionStorage with configurable TTL.
// No hardcoded dates, limits, or dataset-specific values — everything comes from the API.

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Cache configuration ───────────────────────────────────────────────────────
const CACHE_PREFIX  = 'hmp_v1_';          // prefix all sessionStorage keys
const CACHE_TTL_MS  = 5 * 60 * 1000;     // 5-minute TTL; matches a browser session

// ── Fetch configuration ───────────────────────────────────────────────────────
// These control background chunk sizes. Tuned for 386k points / 9,944 trips.
const TRIPS_PAGE_SIZE  = 200;             // trips per page (max 500 per backend)
const POINTS_CHUNK     = 50_000;          // GPS points per chunk

// ── Helpers ───────────────────────────────────────────────────────────────────
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function cacheSet(key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // sessionStorage quota exceeded — silently skip caching
  }
}

function makeCacheKey(fromMs, toMs, driverId) {
  // Produces a unique cache key per time range + driver filter.
  // fromMs and toMs come from the DB (data_from_ms / data_to_ms), so this is
  // always dataset-specific — never hardcoded.
  return `${fromMs}_${toMs}_${driverId || 'all'}`;
}

// ── Main Hook ─────────────────────────────────────────────────────────────────
/**
 * useProgressiveData — progressive data hydration for the heatmap admin dashboard.
 *
 * @param {object} params
 * @param {string} params.apiUrl        Base URL of the backend (e.g. http://localhost:8080)
 * @param {number|null} params.fromMs   Range start in Unix ms. If null, API uses epoch (full range).
 * @param {number|null} params.toMs     Range end in Unix ms.   If null, API uses now+24h.
 * @param {string|null} params.driverId Optional driver filter.
 * @param {boolean}     params.enabled  Set false to pause loading (e.g. when in Live mode).
 *
 * @returns {{
 *   stats: { totalPoints, totalTrips, totalDrivers, deviatedPoints,
 *             avgDeviation, maxDeviation, dataFromMs, dataToMs, loaded },
 *   trips: TripSummary[],       // grows with each page
 *   tripsTotal: number,         // authoritative count from DB (available after Phase 1)
 *   tripsLoading: boolean,
 *   tripsComplete: boolean,
 *   points: Point[],            // grows with each chunk
 *   pointsLoadedCount: number,
 *   pointsComplete: boolean,
 *   isInitializing: boolean,    // true only during Phase 1
 *   error: string|null,
 * }}
 */
export function useProgressiveData({ apiUrl, fromMs = null, toMs = null, driverId = null, enabled = true }) {
  // ── Phase 1 state: Stats ─────────────────────────────────────────────────
  const [stats, setStats] = useState({
    totalPoints: 0, totalTrips: 0, totalDrivers: 0,
    deviatedPoints: 0, avgDeviation: 0, maxDeviation: 0,
    dataFromMs: null, dataToMs: null,
    loaded: false,
  });

  // ── Phase 2 state: Trips (paginated) ────────────────────────────────────
  const [trips, setTrips]             = useState([]);
  const [tripsTotal, setTripsTotal]   = useState(0);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsComplete, setTripsComplete] = useState(false);

  // ── Phase 3 state: Points (chunked) ─────────────────────────────────────
  const [points, setPoints]                       = useState([]);
  const [pointsLoadedCount, setPointsLoadedCount] = useState(0);
  const [pointsComplete, setPointsComplete]       = useState(false);

  // ── Global loading / error ──────────────────────────────────────────────
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError]                   = useState(null);

  const abortRef = useRef(null);

  // Build query string — never hardcodes specific dates.
  // If fromMs/toMs are null, the backend defaults to epoch → now, returning everything.
  const timeParams = [
    fromMs != null ? `from=${fromMs}` : '',
    toMs   != null ? `to=${toMs}`     : '',
  ].filter(Boolean).join('&');

  const driverParam = driverId ? `&driver_id=${encodeURIComponent(driverId)}` : '';
  const cacheKey    = makeCacheKey(fromMs, toMs, driverId);

  // ── Phase 1: Load stats ───────────────────────────────────────────────────
  const loadStats = useCallback(async (signal) => {
    const cached = cacheGet(`stats_${cacheKey}`);
    if (cached) {
      setStats({ ...cached, loaded: true });
      return cached;
    }

    const qs  = [timeParams, driverParam].filter(Boolean).join('');
    const res = await fetch(`${apiUrl}/api/stats-summary${qs ? '?' + qs : ''}`, { signal });
    if (!res.ok) throw new Error(`stats-summary HTTP ${res.status}`);
    const d = await res.json();

    const s = {
      totalPoints:    d.total_points    ?? 0,
      totalTrips:     d.total_trips     ?? 0,
      totalDrivers:   d.total_drivers   ?? 0,
      deviatedPoints: d.deviated_points ?? 0,
      avgDeviation:   d.avg_deviation   ?? 0,
      maxDeviation:   d.max_deviation   ?? 0,
      // The backend returns the actual data range present in the DB.
      // Frontend uses these timestamps instead of any hardcoded dataset dates.
      dataFromMs: d.data_from_ms ?? null,
      dataToMs:   d.data_to_ms  ?? null,
      loaded: true,
    };
    setStats(s);
    cacheSet(`stats_${cacheKey}`, s);
    return s;
  }, [apiUrl, cacheKey, timeParams, driverParam]);

  // ── Phase 2: Load all trips (background, paginated) ───────────────────────
  const loadAllTrips = useCallback(async (signal) => {
    const cached = cacheGet(`trips_${cacheKey}`);
    if (cached) {
      setTrips(cached.trips);
      setTripsTotal(cached.total);
      setTripsComplete(true);
      return;
    }

    setTripsLoading(true);
    let page     = 1;
    let allTrips = [];

    try {
      while (true) {
        if (signal.aborted) break;

        const qs = [
          timeParams,
          driverParam,
          `page=${page}`,
          `page_size=${TRIPS_PAGE_SIZE}`,
        ].filter(Boolean).join('&');

        const res = await fetch(`${apiUrl}/api/trips-summary?${qs}`, { signal });
        if (!res.ok) throw new Error(`trips-summary HTTP ${res.status}`);
        const d = await res.json();

        const batch = d.trips || [];
        allTrips = allTrips.concat(batch);

        // Update state progressively — sidebar fills as pages arrive
        setTrips([...allTrips]);
        setTripsTotal(d.total ?? allTrips.length);

        if (!d.has_more || batch.length === 0) break;
        page++;

        // Yield between pages to keep UI responsive
        await new Promise(r => setTimeout(r, 80));
      }

      cacheSet(`trips_${cacheKey}`, { trips: allTrips, total: allTrips.length });
      setTripsComplete(true);
    } finally {
      setTripsLoading(false);
    }
  }, [apiUrl, cacheKey, timeParams, driverParam]);

  // ── Phase 3: Load all GPS points (background, chunked) ────────────────────
  // totalPointsHint: provided by Phase 1 stats so we know when to stop.
  // If hint is 0 or unavailable, we stop when a chunk returns < POINTS_CHUNK rows.
  const loadAllPoints = useCallback(async (signal, totalPointsHint) => {
    const cached = cacheGet(`points_${cacheKey}`);
    if (cached) {
      setPoints(cached);
      setPointsLoadedCount(cached.length);
      setPointsComplete(true);
      return;
    }

    let allPoints = [];
    let offset    = 0;
    const cap     = totalPointsHint > 0 ? totalPointsHint : Number.MAX_SAFE_INTEGER;

    while (offset < cap) {
      if (signal.aborted) break;

      const qs = [
        timeParams,
        driverParam,
        `limit=${POINTS_CHUNK}`,
        `offset=${offset}`,
      ].filter(Boolean).join('&');

      const res = await fetch(`${apiUrl}/api/points?${qs}`, { signal });
      if (!res.ok) throw new Error(`points HTTP ${res.status}`);
      const d = await res.json();

      const chunk = d.points || [];
      if (chunk.length === 0) break;

      allPoints = allPoints.concat(chunk);
      setPoints([...allPoints]);
      setPointsLoadedCount(allPoints.length);
      offset += chunk.length;

      if (chunk.length < POINTS_CHUNK) break; // last partial chunk

      // Yield between chunks to allow heatmap layer to re-render
      await new Promise(r => setTimeout(r, 120));
    }

    cacheSet(`points_${cacheKey}`, allPoints);
    setPointsComplete(true);
  }, [apiUrl, cacheKey, timeParams, driverParam]);

  // ── Orchestrator: coordinates all three phases ────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    // Reset all state before each new load
    setStats({ totalPoints: 0, totalTrips: 0, totalDrivers: 0, deviatedPoints: 0, avgDeviation: 0, maxDeviation: 0, dataFromMs: null, dataToMs: null, loaded: false });
    setTrips([]);
    setTripsTotal(0);
    setTripsComplete(false);
    setPoints([]);
    setPointsLoadedCount(0);
    setPointsComplete(false);
    setError(null);
    setIsInitializing(true);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    (async () => {
      try {
        // Phase 1 must finish first: stats provide totalPoints for Phase 3 cap
        const loadedStats = await loadStats(signal);
        setIsInitializing(false);

        // Phases 2 and 3 run in parallel — user sees trips + heatmap fill together
        await Promise.all([
          loadAllTrips(signal),
          loadAllPoints(signal, loadedStats?.totalPoints ?? 0),
        ]);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('[useProgressiveData]', err.message);
          setError(err.message);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  // Re-run when filter params change; apiUrl + loaders are stable references
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fromMs, toMs, driverId, apiUrl]);

  return {
    stats,
    trips, tripsTotal, tripsLoading, tripsComplete,
    points, pointsLoadedCount, pointsComplete,
    isInitializing, error,
  };
}
