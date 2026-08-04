import React, { useRef, useEffect, useState } from 'react';
import HeatmapLayer from './HeatmapLayer';

/**
 * MapContainer — MapLibre base map with Deck.gl heatmap overlay.
 * Uses Carto dark-matter basemap (free, no API key).
 */

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const PORTO_CENTER = [-8.6291, 41.1579];

export default function MapContainer({ cells = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize MapLibre
  useEffect(() => {
    let map;

    async function init() {
      const maplibregl = (await import('maplibre-gl')).default;

      // CSS
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
        pitch: 45,
        bearing: -15,
        attributionControl: false,
      });

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

      {/* Render heatmap overlay when map is ready */}
      {mapLoaded && mapRef.current && (
        <HeatmapLayer
          map={mapRef.current}
          cells={cells}
        />
      )}

      {/* Title overlay */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '10px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 700 }}>
          🗺️ Deviation Heatmap
        </div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
          Porto, Portugal — Taxi Trajectory Analysis
        </div>
      </div>
    </div>
  );
}
