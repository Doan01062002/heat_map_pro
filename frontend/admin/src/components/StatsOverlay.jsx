import React from 'react';

/**
 * StatsOverlay — Glassmorphism KPI cards floating over the map.
 *
 * History mode props (from useProgressiveData stats):
 *   stats.totalDrivers   → total trips  (mapped from activeStats.totalDrivers in App.jsx)
 *   stats.totalDeviations → total GPS points
 *   stats.hotCells        → total unique drivers
 *
 * Live mode props (from WebSocket stream):
 *   stats.totalDrivers   → active drivers
 *   stats.totalDeviations → total deviations
 *   stats.hotCells        → hot H3 cells
 */
export default function StatsOverlay({ stats, mode, connectionStatus }) {
  const isLive = mode === 'live';

  const cards = isLive
    ? [
        { label: 'Active Drivers',   value: stats.totalDrivers    || 0, color: '#6c63ff' },
        { label: 'Deviations',        value: stats.totalDeviations || 0, color: '#ff4444' },
        { label: 'Hot Cells',         value: stats.hotCells        || 0, color: '#ff9f43' },
      ]
    : [
        { label: 'TRIPS LOADED',      value: stats.totalDrivers    || 0, color: '#6c63ff' },
        { label: 'GPS POINTS',        value: stats.totalDeviations || 0, color: '#ff4444' },
        { label: 'TRAJECTORIES',      value: stats.hotCells        || 0, color: '#ff9f43' },
      ];

  // Progress fractions for loading shimmer (null = fully loaded)
  const tripsProgress  = (stats.tripsLoaded != null && stats.tripsTotal > 0)
    ? stats.tripsLoaded / stats.tripsTotal
    : null;
  const pointsProgress = (stats.pointsLoaded != null && stats.totalDeviations > 0)
    ? Math.min(1, stats.pointsLoaded / stats.totalDeviations)
    : null;

  return (
    <div style={{
      position: 'absolute',
      top: '16px',
      right: '60px',
      display: 'flex',
      gap: '10px',
      zIndex: 10,
    }}>
      {cards.map(({ label, value, color }, idx) => {
        // Determine loading progress for each card
        const progress = !isLive
          ? (idx === 0 ? tripsProgress : idx === 1 ? pointsProgress : null)
          : null;
        const isLoading = progress !== null && progress < 1;

        return (
          <div key={label} style={{
            background: 'rgba(10, 10, 30, 0.75)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${isLoading ? 'rgba(108,99,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '12px',
            padding: '12px 18px',
            minWidth: '100px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            transition: 'border-color 0.3s',
          }}>
            {/* Loading progress bar at bottom of card */}
            {isLoading && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0,
                height: '2px',
                width: `${Math.round(progress * 100)}%`,
                background: `linear-gradient(90deg, ${color}88, ${color})`,
                borderRadius: '0 0 12px 12px',
                transition: 'width 0.4s ease',
              }} />
            )}

            <div style={{
              fontSize: '22px',
              fontWeight: 800,
              color,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </div>
            <div style={{
              fontSize: '10px',
              color: '#777',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              marginTop: '4px',
            }}>
              {label}
            </div>
          </div>
        );
      })}

      {/* Mode badge */}
      <div style={{
        background: isLive ? 'rgba(68,255,68,0.1)' : 'rgba(108,99,255,0.1)',
        border: `1px solid ${isLive ? 'rgba(68,255,68,0.25)' : 'rgba(108,99,255,0.25)'}`,
        borderRadius: '12px',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 700,
          color: isLive ? '#44ff44' : '#8888ff',
        }}>
          {isLive ? 'LIVE' : 'HISTORY'}
        </div>
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          {isLive ? connectionStatus : 'Full Dataset'}
        </div>
      </div>
    </div>
  );
}
