import React, { useState, useCallback, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import MapView from './components/MapView';
import StatsBar from './components/StatsBar';
import AuthModal from './components/AuthModal';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchOSRMRoute, matchRouteOSRM } from './lib/routeService';

const DEFAULT_ORIGIN = { lat: 10.8184, lng: 106.6588, label: 'Sân bay Tân Sơn Nhất (SGN)' };
const DEFAULT_DESTINATION = { lat: 10.7725, lng: 106.6980, label: 'Chợ Bến Thành, Q.1' };

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ pointsSent: 0, batchesSent: 0, activeDrivers: 0 });
  const [driverPositions, setDriverPositions] = useState([]);

  // Origin & Destination State
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const [activePicking, setActivePicking] = useState(null);

  // Interactive Drawing & Route State
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [plannedRouteCoords, setPlannedRouteCoords] = useState([]);
  const [actualRouteCoords, setActualRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  // Driver Trips History & Review Mode State
  const [driverTrips, setDriverTrips] = useState([]);
  const [reviewingTrip, setReviewingTrip] = useState(null);
  const [successToast, setSuccessToast] = useState('');

  // Auth State
  const [driver, setDriver] = useState(() => {
    try {
      const saved = localStorage.getItem('driver_user');
      return saved ? JSON.parse(saved) : null;
    } catch (_) { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('driver_token') || '');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const workerRef = useRef(null);
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws/driver';
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
  const { connectionStatus, send } = useWebSocket(wsUrl);

  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);

  // Fetch driver trips history from full API URL
  const fetchDriverTrips = useCallback(async () => {
    if (!driver?.driver_id) return;
    try {
      const res = await fetch(`${apiUrl}/api/trips?driver_id=${driver.driver_id}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setDriverTrips(data.trips || []);
      }
    } catch (err) {
      console.warn('[Fetch Driver Trips Error]', err);
    }
  }, [driver, apiUrl]);

  useEffect(() => {
    fetchDriverTrips();
  }, [fetchDriverTrips]);

  // Fetch OSRM Plan Route
  const handleFetchPlanRoute = useCallback(async () => {
    if (!origin || !destination || reviewingTrip) return;

    const res = await fetchOSRMRoute([origin.lng, origin.lat], [destination.lng, destination.lat]);
    if (res && res.coordinates) {
      setPlannedRouteCoords(res.coordinates);
      setRouteInfo({ distanceKm: res.distanceKm, durationMin: res.durationMin });
    }
  }, [origin, destination, reviewingTrip]);

  useEffect(() => {
    handleFetchPlanRoute();
  }, []);

  // Handle Map Click
  const handleMapClickPoint = (point, target) => {
    if (reviewingTrip) return; // Locked in review mode

    if (isDrawMode) {
      if (!origin || !destination) return;
      setActualRouteCoords((prev) => {
        let waypoints = [];
        if (prev.length > 0) {
          const rawPts = prev.filter((_, idx) => idx > 0 && idx < prev.length - 1);
          waypoints = [...rawPts, [point.lng, point.lat]];
        } else {
          waypoints = [[point.lng, point.lat]];
        }
        return [
          [origin.lng, origin.lat],
          ...waypoints,
          [destination.lng, destination.lat],
        ];
      });
      return;
    }

    if (target === 'origin') {
      setOrigin({ lat: point.lat, lng: point.lng, label: `Bản đồ (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})` });
      setActivePicking(null);
    } else if (target === 'dest') {
      setDestination({ lat: point.lat, lng: point.lng, label: `Bản đồ (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})` });
      setActivePicking(null);
    }
  };

  // Match user-drawn route onto actual road network via OSRM Match API
  const handleMatchRoute = async () => {
    if (reviewingTrip || !actualRouteCoords || actualRouteCoords.length < 2) return;
    setIsMatching(true);

    let ptsToMatch = [...actualRouteCoords];
    if (origin && (ptsToMatch[0][0] !== origin.lng || ptsToMatch[0][1] !== origin.lat)) {
      ptsToMatch.unshift([origin.lng, origin.lat]);
    }
    if (destination && (ptsToMatch[ptsToMatch.length - 1][0] !== destination.lng || ptsToMatch[ptsToMatch.length - 1][1] !== destination.lat)) {
      ptsToMatch.push([destination.lng, destination.lat]);
    }

    const snappedCoords = await matchRouteOSRM(ptsToMatch);
    setActualRouteCoords(snappedCoords);
    setIsMatching(false);
  };

  const handleClearActualRoute = () => {
    if (reviewingTrip) return;
    setActualRouteCoords([]);
  };

  const handleToggleDrawMode = () => {
    if (reviewingTrip) return;
    setIsDrawMode((prev) => {
      const next = !prev;
      if (next && origin && destination && actualRouteCoords.length === 0) {
        setActualRouteCoords([
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ]);
      }
      return next;
    });
    setActivePicking(null);
  };

  const handleSwap = () => {
    if (reviewingTrip) return;
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  // Save Trip to Database & Instant History Update
  const handleSaveTrip = useCallback(async () => {
    if (reviewingTrip) return; // Locked in review mode!

    const coordsToSimulate = actualRouteCoords.length > 0 ? actualRouteCoords : plannedRouteCoords;
    if (!coordsToSimulate || coordsToSimulate.length === 0) return;

    let planWaypoints = plannedRouteCoords;
    if ((!planWaypoints || planWaypoints.length < 2) && origin && destination) {
      const planRes = await fetchOSRMRoute([origin.lng, origin.lat], [destination.lng, destination.lat]);
      if (planRes && planRes.coordinates) {
        planWaypoints = planRes.coordinates;
      }
    }

    const tripId = `TRIP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    const newTrip = {
      trip_id: tripId,
      driver_id: driver?.driver_id || 'DRV-SIMULATOR',
      driver_name: driver?.full_name || driver?.driver_id || 'Tài xế simulator',
      origin,
      destination,
      waypoints: planWaypoints.length >= 2 ? planWaypoints : [[origin.lng, origin.lat], [destination.lng, destination.lat]],
      actual_route: coordsToSimulate,
      distance_km: parseFloat(routeInfo?.distanceKm || 0),
      duration_min: routeInfo?.durationMin || 0,
      is_deviated: actualRouteCoords.length > 0,
      created_at: Date.now(),
    };

    // 1. Immediately prepend to driverTrips list in real-time
    setDriverTrips((prev) => {
      const exists = prev.some((t) => t.trip_id === tripId);
      if (exists) return prev;
      return [newTrip, ...prev];
    });

    // 2. Save trip to PostgreSQL DB & broadcast to Admin via POST /api/trips
    try {
      const res = await fetch(`${apiUrl}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTrip),
      });

      if (res.ok) {
        setSuccessToast(`✅ Đã lưu chuyến xe thành công! (${tripId})`);
        setTimeout(() => setSuccessToast(''), 4000);
      }
      fetchDriverTrips();
    } catch (err) {
      console.warn('[Save Trip Error]', err);
      setSuccessToast(`⚠️ Không thể lưu chuyến xe: ${err.message}`);
      setTimeout(() => setSuccessToast(''), 4000);
    }

    // 3. Send GPS points batch over WebSocket directly to backend for telemetry
    if (sendRef.current && coordsToSimulate.length > 0) {
      const now = Date.now();
      const points = coordsToSimulate.map(([lng, lat], idx) => ({
        driver_id: driver?.driver_id || 'DRV-SIMULATOR',
        trip_id: tripId,
        latitude: lat,
        longitude: lng,
        speed_kmh: 40,
        heading: 90,
        timestamp: now + idx * 1000,
      }));
      sendRef.current({ points });
    }
  }, [actualRouteCoords, plannedRouteCoords, routeInfo, origin, destination, driver, apiUrl, fetchDriverTrips, reviewingTrip]);

  // Reload a historical trip onto map (Review Mode)
  const handleReloadTrip = (trip) => {
    setReviewingTrip(trip);
    setIsDrawMode(false);
    if (trip.origin) setOrigin(trip.origin);
    if (trip.destination) setDestination(trip.destination);
    if (trip.waypoints) setPlannedRouteCoords(trip.waypoints);
    if (trip.actual_route) setActualRouteCoords(trip.actual_route);
    if (trip.distance_km) setRouteInfo({ distanceKm: trip.distance_km, durationMin: trip.duration_min });
  };

  // Exit Review Mode & Reset to Create New Trip
  const handleExitReviewMode = () => {
    setReviewingTrip(null);
    setIsDrawMode(false);
    setPlannedRouteCoords([]);
    setActualRouteCoords([]);
    setRouteInfo(null);
    setOrigin(DEFAULT_ORIGIN);
    setDestination(DEFAULT_DESTINATION);
  };

  const handleLogout = () => {
    localStorage.removeItem('driver_token');
    localStorage.removeItem('driver_user');
    setDriver(null);
    setToken('');
  };

  const handleAuthSuccess = (newDriver, newToken) => {
    setDriver(newDriver);
    setToken(newToken);
  };

  // Protected Route: Require Driver Login
  if (!driver) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        background: 'radial-gradient(circle at 50% 30%, #1e1b4b 0%, #0f172a 70%, #020617 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, sans-serif',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>🚗 🗺️</div>
          <h1 style={{ color: '#f8fafc', fontSize: '28px', fontWeight: 800, margin: '0 0 8px 0' }}>
            CỔNG THỬ NGHIỆM TÀI XẾ — HEATMAP PRO
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '15px', margin: 0 }}>
            Vui lòng Đăng ký hoặc Đăng nhập tài khoản tài xế để truy cập ứng dụng
          </p>
        </div>

        <AuthModal
          isOpen={true}
          onClose={() => {}}
          onAuthSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'Inter, sans-serif', position: 'relative' }}>
      {/* Floating Success Toast Alert */}
      {successToast && (
        <div style={{
          position: 'absolute',
          top: '70px',
          right: '24px',
          backgroundColor: '#10b981',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '10px',
          fontWeight: 700,
          fontSize: '14px',
          boxShadow: '0 10px 25px rgba(16, 185, 129, 0.4)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          animation: 'fadeIn 0.3s ease-in-out',
        }}>
          <span>{successToast}</span>
          <button
            type="button"
            onClick={() => setSuccessToast('')}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '14px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      <StatsBar
        stats={stats}
        connectionStatus={connectionStatus}
        isRunning={false}
        driver={driver}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ControlPanel
          origin={origin}
          destination={destination}
          onSelectOrigin={setOrigin}
          onSelectDestination={setDestination}
          onSwap={handleSwap}
          activePicking={activePicking}
          onSetActivePicking={setActivePicking}
          routeInfo={routeInfo}
          onFetchPlanRoute={handleFetchPlanRoute}
          isDrawMode={isDrawMode}
          onToggleDrawMode={handleToggleDrawMode}
          isMatching={isMatching}
          onMatchRoute={handleMatchRoute}
          onClearActualRoute={handleClearActualRoute}
          hasPlanRoute={plannedRouteCoords.length > 0}
          hasActualRoute={actualRouteCoords.length > 0}
          driverTrips={driverTrips}
          onReloadTrip={handleReloadTrip}
          reviewingTrip={reviewingTrip}
          onExitReviewMode={handleExitReviewMode}
          isRunning={false}
          onStart={handleSaveTrip}
          onStop={() => {}}
          connectionStatus={connectionStatus}
        />

        <MapView
          isRunning={false}
          driverPositions={driverPositions}
          origin={origin}
          destination={destination}
          plannedRouteCoords={plannedRouteCoords}
          actualRouteCoords={actualRouteCoords}
          activePicking={activePicking}
          isDrawMode={isDrawMode && !reviewingTrip}
          onMapClickPoint={handleMapClickPoint}
        />
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}
