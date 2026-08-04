import React, { useRef, useEffect, useState } from 'react';

/**
 * MapView — Renders simulated driver positions on an interactive map.
 * Uses MapLibre GL JS with a free tile source (OpenStreetMap via Carto).
 *
 * Drivers are rendered as colored circles:
 *   🟢 Green = following route
 *   🔴 Red = deviating from route
 */

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const HCMC_CENTER = { lng: 106.7009, lat: 10.7769 };

export default function MapView({ isRunning, driverCount, driverPositions = [] }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  // Initialize map
  useEffect(() => {
    let map;

    async function initMap() {
      const maplibregl = (await import('maplibre-gl')).default;

      // Import CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
      document.head.appendChild(link);

      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: [HCMC_CENTER.lng, HCMC_CENTER.lat],
        zoom: 13,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

      mapRef.current = map;
    }

    initMap();

    return () => {
      if (map) map.remove();
    };
  }, []);

  // Update driver markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    import('maplibre-gl').then(({ default: maplibregl }) => {
      driverPositions.forEach((driver) => {
        const el = document.createElement('div');
        el.style.width = '10px';
        el.style.height = '10px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = driver.isDeviating ? '#ff4444' : '#44ff44';
        el.style.border = '2px solid rgba(255,255,255,0.6)';
        el.style.boxShadow = driver.isDeviating
          ? '0 0 8px rgba(255,68,68,0.8)'
          : '0 0 6px rgba(68,255,68,0.6)';
        el.title = `${driver.id} ${driver.isDeviating ? '⚠ Deviating' : '✓ On route'}`;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([driver.lng, driver.lat])
          .addTo(map);

        markersRef.current.push(marker);
      });
    });
  }, [driverPositions]);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%' }}
      />
      {/* Overlay showing driver count on map */}
      {isRunning && driverPositions.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '24px',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          padding: '8px 14px',
          borderRadius: '8px',
          fontSize: '13px',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ color: '#44ff44' }}>●</span> On route: {driverPositions.filter(d => !d.isDeviating).length}
          <span style={{ margin: '0 8px' }}>|</span>
          <span style={{ color: '#ff4444' }}>●</span> Deviating: {driverPositions.filter(d => d.isDeviating).length}
        </div>
      )}
      {!isRunning && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'rgba(255,255,255,0.5)',
          fontSize: '16px',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          Press <b>Start Simulation</b> to see drivers on the map
        </div>
      )}
    </div>
  );
}
