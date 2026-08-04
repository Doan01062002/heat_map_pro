import React, { useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'maplibre-gl';
import { createHeatmapLayer } from './HeatmapLayer';

/**
 * MapContainer — Combines MapLibre base map with Deck.gl heatmap overlay.
 *
 * Props:
 * @param {Map<string, { h3_index: string, intensity: number }>} cells - H3 cell data
 */

// Ho Chi Minh City center
const INITIAL_VIEW_STATE = {
  longitude: 106.7009,
  latitude: 10.7769,
  zoom: 12,
  pitch: 45,
  bearing: -17,
  maxZoom: 18,
  minZoom: 8,
};

// Free dark map style (no API key needed)
const MAP_STYLE =
  import.meta.env.VITE_MAP_STYLE ||
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function MapContainer({ cells }) {
  const layers = useMemo(() => {
    if (!cells || cells.size === 0) return [];
    return [createHeatmapLayer(cells)];
  }, [cells]);

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      getTooltip={({ object }) => {
        if (!object) return null;
        return {
          html: `
            <div style="font-family: Inter, sans-serif; font-size: 12px;">
              <strong>H3 Cell</strong><br/>
              Index: ${object.h3_index}<br/>
              Deviations: <strong style="color: #ff6b6b;">${object.intensity}</strong>
            </div>
          `,
          style: {
            backgroundColor: '#1a1a2e',
            color: '#e0e0e0',
            borderRadius: '8px',
            padding: '8px 12px',
            border: '1px solid #30363d',
          },
        };
      }}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      {/* MapLibre base map */}
      {/* Note: In deck.gl v9, use the Map component directly */}
      {/* TODO: Add MapLibre Map component here */}
    </DeckGL>
  );
}
