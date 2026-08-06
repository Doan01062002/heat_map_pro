import React, { useRef, useEffect } from 'react';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const HCMC_CENTER = { lng: 106.7009, lat: 10.7769 };

export default function MapView({
  isRunning,
  driverPositions = [],
  origin,
  destination,
  plannedRouteCoords = [],
  actualRouteCoords = [],
  activePicking,
  isDrawMode,
  onMapClickPoint,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const mapLoadedRef = useRef(false);

  const driverMarkersRef = useRef([]);
  const originMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);

  const activePickingRef = useRef(activePicking);
  useEffect(() => { activePickingRef.current = activePicking; }, [activePicking]);

  const isDrawModeRef = useRef(isDrawMode);
  useEffect(() => { isDrawModeRef.current = isDrawMode; }, [isDrawMode]);

  const onMapClickPointRef = useRef(onMapClickPoint);
  useEffect(() => { onMapClickPointRef.current = onMapClickPoint; }, [onMapClickPoint]);

  // Initialize MapLibre
  useEffect(() => {
    let map;

    async function initMap() {
      const maplibregl = (await import('maplibre-gl')).default;

      // Import CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
      if (!document.querySelector('link[href*="maplibre-gl.css"]')) {
        document.head.appendChild(link);
      }

      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: [HCMC_CENTER.lng, HCMC_CENTER.lat],
        zoom: 13,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

      map.on('load', () => {
        mapLoadedRef.current = true;

        // Planned route source & layer
        map.addSource('sim-planned-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'sim-planned-layer',
          type: 'line',
          source: 'sim-planned-src',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#38bdf8', 'line-width': 5, 'line-dasharray': [3, 2] },
        });

        // Actual route source & layer
        map.addSource('sim-actual-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'sim-actual-layer',
          type: 'line',
          source: 'sim-actual-src',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#f97316', 'line-width': 5, 'line-opacity': 0.95 },
        });

        // Waypoints circle dots layer
        map.addSource('sim-waypoints-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'sim-waypoints-layer',
          type: 'circle',
          source: 'sim-waypoints-src',
          paint: {
            'circle-radius': 6,
            'circle-color': '#f97316',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });
      });

      // Map Click Handler for picking points or drawing
      map.on('click', (e) => {
        if (onMapClickPointRef.current) {
          onMapClickPointRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }, activePickingRef.current);
        }
      });

      mapRef.current = map;
    }

    initMap();

    return () => {
      if (map) map.remove();
    };
  }, []);

  // Render Planned Route Line
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const src = map.getSource('sim-planned-src');
    if (!src) return;

    if (plannedRouteCoords && plannedRouteCoords.length > 0) {
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: plannedRouteCoords },
        }],
      });

      // Fit bounds to route
      import('maplibre-gl').then(({ default: maplibregl }) => {
        const bounds = new maplibregl.LngLatBounds();
        plannedRouteCoords.forEach(c => bounds.extend(c));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
      });
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [plannedRouteCoords]);

  // Render Actual Route Line & Waypoint Dots
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const lineSrc = map.getSource('sim-actual-src');
    const pointSrc = map.getSource('sim-waypoints-src');

    if (actualRouteCoords && actualRouteCoords.length > 0) {
      if (lineSrc) {
        lineSrc.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: actualRouteCoords },
          }],
        });
      }
      if (pointSrc) {
        pointSrc.setData({
          type: 'FeatureCollection',
          features: actualRouteCoords.map(c => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: c },
          })),
        });
      }
    } else {
      if (lineSrc) lineSrc.setData({ type: 'FeatureCollection', features: [] });
      if (pointSrc) pointSrc.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [actualRouteCoords]);

  // Render Origin & Destination Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import('maplibre-gl').then(({ default: maplibregl }) => {
      // Origin Marker
      if (originMarkerRef.current) originMarkerRef.current.remove();
      if (origin?.lat && origin?.lng) {
        const el = document.createElement('div');
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#10b981';
        el.style.border = '3px solid #064e3b';
        el.style.boxShadow = '0 0 12px #10b981';
        el.style.pointerEvents = (isDrawMode || activePicking) ? 'none' : 'auto';
        el.title = `Điểm đi: ${origin.label || 'Origin'}`;

        originMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([origin.lng, origin.lat])
          .addTo(map);
      }

      // Destination Marker
      if (destMarkerRef.current) destMarkerRef.current.remove();
      if (destination?.lat && destination?.lng) {
        const el = document.createElement('div');
        el.style.fontSize = '24px';
        el.style.lineHeight = '1';
        el.style.pointerEvents = (isDrawMode || activePicking) ? 'none' : 'auto';
        el.innerHTML = '📍';
        el.title = `Điểm đến: ${destination.label || 'Destination'}`;

        destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([destination.lng, destination.lat])
          .addTo(map);
      }
    });
  }, [origin, destination, isDrawMode, activePicking]);

  // Update Driver Animation Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    driverMarkersRef.current.forEach((m) => m.remove());
    driverMarkersRef.current = [];

    import('maplibre-gl').then(({ default: maplibregl }) => {
      driverPositions.forEach((driver) => {
        const el = document.createElement('div');
        el.style.width = '14px';
        el.style.height = '14px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = driver.isDeviating ? '#ef4444' : '#10b981';
        el.style.border = '2px solid #ffffff';
        el.style.boxShadow = driver.isDeviating
          ? '0 0 10px rgba(239, 68, 68, 0.9)'
          : '0 0 8px rgba(16, 185, 129, 0.8)';
        el.title = `Tài xế: ${driver.id} ${driver.isDeviating ? '⚠ Đang bẻ lái' : '✓ Đúng tuyến'}`;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([driver.lng, driver.lat])
          .addTo(map);

        driverMarkersRef.current.push(marker);
      });
    });
  }, [driverPositions]);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', cursor: (activePicking || isDrawMode) ? 'crosshair' : 'grab' }}
      />

      {/* Helper Notification for Map Picking or Drawing Mode */}
      {isDrawMode ? (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#ea580c',
          color: '#ffffff',
          padding: '10px 20px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: 700,
          boxShadow: '0 10px 25px rgba(234, 88, 12, 0.6)',
          zIndex: 999,
          pointerEvents: 'none',
        }}>
          ✏️ Đang vẽ lộ trình thực tế: Click liên tiếp các điểm trên bản đồ để nối tuyến đường bẻ lái!
        </div>
      ) : activePicking ? (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#0284c7',
          color: '#ffffff',
          padding: '10px 20px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: 700,
          boxShadow: '0 10px 25px rgba(2, 132, 199, 0.5)',
          zIndex: 999,
          pointerEvents: 'none',
        }}>
          👇 Click trực tiếp lên bản đồ để chọn {activePicking === 'origin' ? 'Điểm đi 🟢' : 'Điểm đến 📍'}
        </div>
      ) : null}

      {/* Driver Simulation Overlay */}
      {isRunning && driverPositions.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '24px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          color: '#f8fafc',
          padding: '10px 16px',
          borderRadius: '10px',
          fontSize: '13px',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ color: '#10b981', fontWeight: 700 }}>● Đúng tuyến:</span> {driverPositions.filter(d => !d.isDeviating).length}
          <span style={{ margin: '0 10px', color: '#475569' }}>|</span>
          <span style={{ color: '#ef4444', fontWeight: 700 }}>● Đang bẻ lái:</span> {driverPositions.filter(d => d.isDeviating).length}
        </div>
      )}
    </div>
  );
}
