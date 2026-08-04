import { useEffect, useRef } from 'react';

/**
 * HeatmapLayer — Renders a smooth gradient heatmap using MapLibre's native
 * heatmap layer type. Produces the classic green → yellow → red blob effect.
 *
 * Each H3 cell is plotted as a weighted point; MapLibre's GPU-accelerated
 * heatmap kernel blends them into smooth gradients automatically.
 */

export default function HeatmapLayer({ map, cells = [] }) {
  const sourceAdded = useRef(false);
  const prevCellCount = useRef(0);

  useEffect(() => {
    if (!map || cells.length === 0) return;

    // Convert cells to GeoJSON with weight
    const maxIntensity = Math.max(...cells.map(c => c.intensity || 1), 1);

    const features = cells.map((cell) => {
      const coords = parseCellCenter(cell.h3_index);
      if (!coords) return null;

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [coords.lng, coords.lat],
        },
        properties: {
          intensity: cell.intensity || 1,
          // Normalized weight [0, 1] for heatmap
          weight: Math.min((cell.intensity || 1) / maxIntensity, 1),
          h3_index: cell.h3_index,
        },
      };
    }).filter(Boolean);

    const geojson = {
      type: 'FeatureCollection',
      features,
    };

    if (!sourceAdded.current) {
      // Add GeoJSON source
      map.addSource('heatmap-source', {
        type: 'geojson',
        data: geojson,
      });

      // ---- Layer 1: Smooth heatmap (the main visual) ----
      map.addLayer({
        id: 'heatmap-heat',
        type: 'heatmap',
        source: 'heatmap-source',
        maxzoom: 18,
        paint: {
          // Weight: use the normalized weight property
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0, 0,
            5, 0.3,
            50, 0.6,
            500, 0.85,
            2000, 1,
          ],

          // Intensity (zoom-dependent amplification)
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            8, 0.8,
            12, 1.5,
            15, 2.5,
          ],

          // Radius in pixels (zoom-dependent)
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, 15,
            10, 25,
            12, 35,
            14, 50,
            16, 70,
          ],

          // Color ramp: transparent → green → yellow → orange → red
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0, 0, 0, 0)',
            0.1,  'rgba(0, 228, 0, 0.3)',
            0.25, 'rgba(49, 252, 0, 0.5)',
            0.4,  'rgba(171, 252, 0, 0.6)',
            0.55, 'rgba(252, 244, 0, 0.7)',
            0.7,  'rgba(252, 176, 0, 0.8)',
            0.85, 'rgba(252, 80, 0, 0.85)',
            1.0,  'rgba(240, 10, 10, 0.9)',
          ],

          // Opacity (fade slightly at high zoom to reveal points)
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            8, 0.9,
            14, 0.75,
            18, 0.5,
          ],
        },
      });

      // ---- Layer 2: Circle points (visible at high zoom) ----
      map.addLayer({
        id: 'heatmap-points',
        type: 'circle',
        source: 'heatmap-source',
        minzoom: 14,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'intensity'],
            1, 4,
            100, 8,
            1000, 14,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'intensity'],
            1, '#00ff80',
            50, '#ffff00',
            300, '#ff8800',
            1000, '#ff0040',
          ],
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.4)',
        },
      });

      // Popup on click
      map.on('click', 'heatmap-points', (e) => {
        if (!e.features || !e.features.length) return;
        const props = e.features[0].properties;
        const coords = e.lngLat;

        new (map._maplibregl || window.maplibregl).Popup({ offset: 10 })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:Inter,sans-serif;font-size:13px;color:#333;min-width:140px">
              <div style="font-weight:700;margin-bottom:6px">📍 Cell Info</div>
              <div>Cell: <code style="font-size:11px;color:#666">${props.h3_index}</code></div>
              <div>Deviations: <b style="color:#ff4444">${props.intensity}</b></div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'heatmap-points', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'heatmap-points', () => {
        map.getCanvas().style.cursor = '';
      });

      sourceAdded.current = true;
    } else {
      // Update existing source
      const source = map.getSource('heatmap-source');
      if (source) {
        source.setData(geojson);
      }
    }

    prevCellCount.current = cells.length;
  }, [map, cells]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (map && sourceAdded.current) {
        try {
          if (map.getLayer('heatmap-heat')) map.removeLayer('heatmap-heat');
          if (map.getLayer('heatmap-points')) map.removeLayer('heatmap-points');
          if (map.getSource('heatmap-source')) map.removeSource('heatmap-source');
        } catch (e) {
          // Map may already be destroyed
        }
        sourceAdded.current = false;
      }
    };
  }, [map]);

  return null;
}

/**
 * Parse cell center coordinates from grid-based cell index.
 * Format: "H<resolution>:<latGrid>:<lngGrid>"
 */
function parseCellCenter(cellIndex) {
  if (!cellIndex) return null;

  const match = cellIndex.match(/^H(\d+):(\d+):(\d+)$/);
  if (!match) return null;

  const resolution = parseInt(match[1], 10);
  const latGrid = parseInt(match[2], 10);
  const lngGrid = parseInt(match[3], 10);

  // Cell size lookup (must match backend spatial/h3_indexer.go)
  const cellSizes = {
    4: 0.1326, 5: 0.0500, 6: 0.0189, 7: 0.00713,
    8: 0.00414, 9: 0.00156, 10: 0.000589,
  };
  const cellSize = cellSizes[resolution] || cellSizes[8];

  const lat = latGrid * cellSize - 90.0 + cellSize / 2;
  let lng = lngGrid * cellSize + cellSize / 2;
  if (lng > 180) lng -= 360;

  return { lat, lng };
}
