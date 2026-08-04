import React from 'react';

/**
 * StatsOverlay — Glassmorphism KPI cards floating over the map.
 * Supports both live mode (drivers/deviations) and history mode (trips/points).
 */
export default function StatsOverlay({ stats, mode, connectionStatus }) {
  const isLive = mode === 'live';

  const cards = isLive
    ? [
        { label: 'Active Drivers',   value: stats.totalDrivers   || 0, color: '#6c63ff', icon: '🚗' },
        { label: 'Deviations',       value: stats.totalDeviations || 0, color: '#ff4444', icon: '⚠️' },
        { label: 'Hot Cells',        value: stats.hotCells        || 0, color: '#ff9f43', icon: '🔥' },
      ]
    : [
        { label: 'Trips Loaded',     value: stats.totalDrivers   || 0, color: '#6c63ff', icon: '🛤️' },
        { label: 'GPS Points',       value: stats.totalDeviations || 0, color: '#ff4444', icon: '📍' },
        { label: 'Trajectories',     value: stats.hotCells        || 0, color: '#ff9f43', icon: '🔥' },
      ];

  return (
    <div style={{
      position: 'absolute',
      top: '16px',
      right: '60px',
      display: 'flex',
      gap: '10px',
      zIndex: 10,
    }}>
      {cards.map(({ label, value, color, icon }) => (
        <div key={label} style={{
          background: 'rgba(10, 10, 30, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '12px 18px',
          minWidth: '100px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '14px', marginBottom: '4px' }}>{icon}</div>
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
      ))}

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
          {isLive ? '● LIVE' : '📅 HISTORY'}
        </div>
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          {isLive ? connectionStatus : 'Porto 2013'}
        </div>
      </div>
    </div>
  );
}
