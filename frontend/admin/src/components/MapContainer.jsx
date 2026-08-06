import React, { useRef, useEffect, useState } from 'react';
import HeatmapLayer from './HeatmapLayer';

/**
 * MapContainer — MapLibre base map with road-following heatmap overlay.
 * Uses Carto dark-matter basemap (free, no API key).
 */

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const PORTO_CENTER = [-8.6291, 41.1579];

export default function MapContainer({ points = [], selectedTrip = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Layer Visibility Toggle States
  const [show3DH3Grid, setShow3DH3Grid] = useState(true);
  const [showHeatmap, setShowHeatmap]   = useState(true);

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

      // Store maplibregl reference for popups
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
          showHeatmap={showHeatmap}
          show3DH3Grid={show3DH3Grid}
        />
      )}

      {/* Floating Layer Toggle Controls */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '30px',
        padding: '6px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        zIndex: 10,
      }}>
        <button
          onClick={() => setShow3DH3Grid(v => !v)}
          style={{
            background: show3DH3Grid
              ? 'linear-gradient(135deg, #2e7d32, #1b5e20)'
              : 'rgba(255,255,255,0.08)',
            color: '#fff',
            border: show3DH3Grid ? '1px solid #81c784' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: '20px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: show3DH3Grid ? '0 0 12px rgba(46,125,50,0.5)' : 'none',
            transition: 'all 0.25s ease',
          }}
        >
          Lưới 3D H3 (~3m) <span style={{ opacity: 0.8, fontSize: '10px' }}>{show3DH3Grid ? 'ON' : 'OFF'}</span>
        </button>

        <button
          onClick={() => setShowHeatmap(v => !v)}
          style={{
            background: showHeatmap
              ? 'linear-gradient(135deg, #1565c0, #0d47a1)'
              : 'rgba(255,255,255,0.08)',
            color: '#fff',
            border: showHeatmap ? '1px solid #64b5f6' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: '20px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: showHeatmap ? '0 0 12px rgba(21,101,192,0.5)' : 'none',
            transition: 'all 0.25s ease',
          }}
        >
          Heatmap <span style={{ opacity: 0.8, fontSize: '10px' }}>{showHeatmap ? 'ON' : 'OFF'}</span>
        </button>
      </div>

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
          Deviation Heatmap & 3D H3 Grid
        </div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
          Porto, Portugal — Taxi Trajectory Analysis
        </div>
      </div>
    </div>
  );
}
