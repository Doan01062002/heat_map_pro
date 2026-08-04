import React, { useMemo } from 'react';
import { H3HexagonLayer } from '@deck.gl/geo-layers';

/**
 * HeatmapLayer — Creates a Deck.gl H3HexagonLayer from heatmap cell data.
 *
 * This is a pure function (not a React component) that returns a Deck.gl layer
 * to be passed to the DeckGL component's layers prop.
 *
 * @param {Map<string, { h3_index: string, intensity: number }>} cells
 * @returns {H3HexagonLayer}
 */
export function createHeatmapLayer(cells) {
  const data = Array.from(cells.values());

  // Find max intensity for normalization
  const maxIntensity = data.reduce((max, c) => Math.max(max, c.intensity), 1);

  return new H3HexagonLayer({
    id: 'heatmap-h3-hexagons',
    data,
    pickable: true,
    filled: true,
    extruded: true,
    wireframe: false,

    // Map H3 index
    getHexagon: (d) => d.h3_index,

    // Color: gradient from blue (low) → yellow (medium) → red (high)
    getFillColor: (d) => {
      const t = d.intensity / maxIntensity;
      if (t < 0.33) {
        // Blue → Cyan
        return [0, Math.floor(100 + t * 3 * 155), 255, 180];
      } else if (t < 0.66) {
        // Cyan → Yellow
        const t2 = (t - 0.33) / 0.33;
        return [Math.floor(t2 * 255), 255, Math.floor(255 * (1 - t2)), 200];
      } else {
        // Yellow → Red
        const t3 = (t - 0.66) / 0.34;
        return [255, Math.floor(255 * (1 - t3)), 0, 220];
      }
    },

    // Height: proportional to deviation count
    getElevation: (d) => d.intensity,
    elevationScale: 50,

    // Line around each hexagon
    getLineColor: [255, 255, 255, 40],
    getLineWidth: 1,

    // Tooltip
    autoHighlight: true,
    highlightColor: [255, 255, 255, 100],

    // Transitions for smooth updates
    transitions: {
      getFillColor: 500,
      getElevation: 500,
    },

    // Update triggers
    updateTriggers: {
      getFillColor: [maxIntensity],
      getElevation: [data.length],
    },
  });
}

/**
 * HeatmapLayer React wrapper — memoizes the layer creation.
 *
 * Props:
 * @param {Map} cells - H3 cell data from useHeatmapStream
 * @param {function} onLayerCreated - Callback with the created layer
 */
export default function HeatmapLayer({ cells }) {
  const layer = useMemo(() => createHeatmapLayer(cells), [cells]);

  // This component doesn't render anything — it's a helper
  // The actual rendering is done by passing the layer to DeckGL
  return null;
}

// Export the layer creator for direct use in MapContainer
export { createHeatmapLayer as getHeatmapLayer };
