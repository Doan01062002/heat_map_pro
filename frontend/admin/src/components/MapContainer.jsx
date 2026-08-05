import React, { useRef, useEffect, useState } from 'react';
import HeatmapLayer from './HeatmapLayer';

/**
 * MapContainer — MapLibre base map with Heat-Lines, heatmap gradient, and trip detail overlays.
 * Uses Carto dark-matter basemap (free, no API key).
 */

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const PORTO_CENTER = [-8.6291, 41.1579];

export default function MapContainer({
  points = [],
  selectedTrip = null,
  trajectories = [],
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Layer Visibility Controls
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showTrajectories, setShowTrajectories] = useState(true);

  useEffect(() => {
    let map;
    async function init() {
      const maplibregl = (await import('maplibre-gl')).default;

      if (!document.getElementById('maplibre-css')) {
        const link = document.createElement('link');
        link.id = 'maplibre-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
        document.head.appendChild(link);
      }

      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: PORTO_CENTER,
        zoom: 12,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
      });

      map._maplibregl = maplibregl;
      map.addControl(new maplibregl.NavigationControl(), 'top-right');

      map.on('load', () => {
        mapRef.current = map;
        setMapLoaded(true);
      });
    }

    init();
    return () => { if (map) map.remove(); };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {mapLoaded && mapRef.current && (
        <HeatmapLayer
          map={mapRef.current}
          points={points}
          selectedTrip={selectedTrip}
          trajectories={trajectories}
          showHeatmap={showHeatmap}
          showTrajectories={showTrajectories}
        />
      )}

      {/* Title overlay */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '10px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.08)',
        zIndex: 5,
      }}>
        <div style={{ fontSize: '15px', fontWeight: 700 }}>
          Deviation Heatmap
        </div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
          Porto, Portugal — Taxi Trajectory Analysis
        </div>
      </div>

      {/* Floating Layer Control Bar */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        left: '16px',
        display: 'flex',
        gap: '8px',
        background: 'rgba(10, 10, 30, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '12px',
        padding: '6px 10px',
        zIndex: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <button
          onClick={() => setShowHeatmap(h => !h)}
          style={{
            background: showHeatmap ? 'rgba(108, 99, 255, 0.25)' : 'transparent',
            border: showHeatmap ? '1px solid #6c63ff' : '1px solid rgba(255,255,255,0.1)',
            color: showHeatmap ? '#a29bfe' : '#888',
            padding: '7px 13px',
            borderRadius: '8px',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            transition: 'all 0.2s ease',
          }}
        >
          <span>🔥</span>
          <span>Bản đồ nhiệt</span>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: showHeatmap ? '#00e676' : '#555',
            boxShadow: showHeatmap ? '0 0 6px #00e676' : 'none',
          }} />
        </button>

        <button
          onClick={() => setShowTrajectories(t => !t)}
          style={{
            background: showTrajectories ? 'rgba(255, 159, 67, 0.25)' : 'transparent',
            border: showTrajectories ? '1px solid #ff9f43' : '1px solid rgba(255,255,255,0.1)',
            color: showTrajectories ? '#ffc048' : '#888',
            padding: '7px 13px',
            borderRadius: '8px',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            transition: 'all 0.2s ease',
          }}
        >
          <span>🛣️</span>
          <span>Dải đường lệch tuyến</span>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: showTrajectories ? '#00e676' : '#555',
            boxShadow: showTrajectories ? '0 0 6px #00e676' : 'none',
          }} />
        </button>
      </div>
    </div>
  );
}
