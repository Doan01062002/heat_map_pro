import { useEffect, useRef } from 'react';

/**
 * HeatmapLayer — Renders heatmap cells as colored circles on the MapLibre map.
 *
 * Uses MapLibre's native GeoJSON source + circle layer instead of Deck.gl
 * to avoid heavy dependencies. Each cell is a point at the cell center,
 * colored and sized by intensity.
 *
 * Color scale: green (low) → yellow (medium) → red (high)
 */

export default function HeatmapLayer({ map, cells = [] }) {
  const sourceAdded = useRef(false);

  useEffect(() => {
    if (!map) return;

    // Convert cells to GeoJSON
    const features = cells.map((cell) => {
      // Parse cell center from H-format: "H8:latGrid:lngGrid"
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
          h3_index: cell.h3_index,
        },
      };
    }).filter(Boolean);

    const geojson = {
      type: 'FeatureCollection',
      features,
    };

    if (!sourceAdded.current) {
      // First time: add source and layers
      map.addSource('heatmap-cells', {
        type: 'geojson',
        data: geojson,
      });

      // Glow layer (larger, more transparent)
      map.addLayer({
        id: 'heatmap-glow',
        type: 'circle',
        source: 'heatmap-cells',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'intensity'],
            1, 14,
            50, 25,
            500, 40,
            2000, 55,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'intensity'],
            1, 'rgba(0, 255, 128, 0.1)',
            50, 'rgba(255, 255, 0, 0.15)',
            300, 'rgba(255, 128, 0, 0.2)',
            1000, 'rgba(255, 0, 0, 0.3)',
          ],
          'circle-blur': 1,
        },
      });

      // Core layer (smaller, more opaque)
      map.addLayer({
        id: 'heatmap-core',
        type: 'circle',
        source: 'heatmap-cells',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'intensity'],
            1, 4,
            50, 8,
            500, 14,
            2000, 22,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'intensity'],
            1, '#00ff80',
            50, '#ffff00',
            300, '#ff8800',
            1000, '#ff0040',
            2000, '#ff0066',
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
      });

      // Popup on click
      map.on('click', 'heatmap-core', (e) => {
        const props = e.features[0].properties;
        const coords = e.lngLat;

        const popup = new (map._maplibregl || window.maplibregl).Popup({ offset: 10 })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:Inter,sans-serif;font-size:13px;color:#333">
              <b>Cell: ${props.h3_index}</b><br/>
              Deviations: <b style="color:#ff4444">${props.intensity}</b>
            </div>
          `)
          .addTo(map);
      });

      // Cursor change on hover
      map.on('mouseenter', 'heatmap-core', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'heatmap-core', () => {
        map.getCanvas().style.cursor = '';
      });

      sourceAdded.current = true;
    } else {
      // Update existing source data
      const source = map.getSource('heatmap-cells');
      if (source) {
        source.setData(geojson);
      }
    }
  }, [map, cells]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (map && sourceAdded.current) {
        try {
          if (map.getLayer('heatmap-glow')) map.removeLayer('heatmap-glow');
          if (map.getLayer('heatmap-core')) map.removeLayer('heatmap-core');
          if (map.getSource('heatmap-cells')) map.removeSource('heatmap-cells');
        } catch (e) {
          // Map may already be destroyed
        }
        sourceAdded.current = false;
      }
    };
  }, [map]);

  return null; // This component only manages map layers
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
