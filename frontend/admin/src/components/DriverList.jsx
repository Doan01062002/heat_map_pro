import React, { useState } from 'react';

/**
 * DriverList — Sidebar section showing list of trips/drivers.
 * Click a trip to see its detail overlay on the map.
 */
export default function DriverList({ trips = [], selectedTripId, onSelectTrip, loading }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('deviation'); // 'deviation' | 'points'

  const filtered = trips
    .filter(t =>
      t.driver_id.toLowerCase().includes(search.toLowerCase()) ||
      t.trip_id.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) =>
      sortBy === 'deviation'
        ? b.avg_deviation - a.avg_deviation
        : b.point_count - a.point_count
    );

  const deviationColor = (dev) => {
    if (dev < 500)   return '#00e664';
    if (dev < 2000)  return '#ccee00';
    if (dev < 10000) return '#ff8800';
    return '#ff2244';
  };

  const formatDev = (meters) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
    return `${Math.round(meters)}m`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ color: '#777', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
          🚕 Trip List
          {loading && <span style={{ marginLeft: '8px', color: '#555' }}>loading…</span>}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search driver / trip ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: '#ccc',
            fontSize: '12px',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />

        {/* Sort toggle */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          {[['deviation', '⚠️ Deviation'], ['points', '📍 Points']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              style={{
                flex: 1,
                padding: '5px 6px',
                border: 'none',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                background: sortBy === key ? 'rgba(108,99,255,0.35)' : 'rgba(255,255,255,0.05)',
                color: sortBy === key ? '#c0b8ff' : '#555',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ color: '#444', fontSize: '11px', marginTop: '8px' }}>
          {filtered.length} trips
        </div>
      </div>

      {/* Trip list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {filtered.length === 0 && !loading && (
          <div style={{ color: '#444', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
            No trips found
          </div>
        )}
        {filtered.map(trip => {
          const isSelected = trip.trip_id === selectedTripId;
          const color = deviationColor(trip.avg_deviation);
          return (
            <div
              key={trip.trip_id}
              onClick={() => onSelectTrip(isSelected ? null : trip)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
                background: isSelected
                  ? 'rgba(108,99,255,0.12)'
                  : 'transparent',
                transition: 'all 0.15s',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Driver ID */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#c0c0e0', fontSize: '12px', fontWeight: 600 }}>
                  🚗 {trip.driver_id.replace('taxi-', '')}
                </span>
                <span style={{
                  fontSize: '11px', fontWeight: 700, color,
                  background: `${color}18`,
                  padding: '2px 7px', borderRadius: '6px',
                }}>
                  {formatDev(trip.avg_deviation)}
                </span>
              </div>

              {/* Trip ID + points */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ color: '#444', fontSize: '10px', fontFamily: 'monospace' }}>
                  {trip.trip_id.slice(-8)}
                </span>
                <span style={{ color: '#555', fontSize: '10px' }}>
                  {trip.point_count} pts
                </span>
              </div>

              {isSelected && (
                <div style={{
                  marginTop: '8px',
                  padding: '7px 10px',
                  background: 'rgba(108,99,255,0.15)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#8888cc',
                  lineHeight: 1.7,
                }}>
                  <div>📍 {trip.point_count} GPS waypoints</div>
                  <div style={{ color: '#4fc3f7' }}>━━ Planned route (origin→dest)</div>
                  <div style={{ color: '#ff6b35' }}>━━ Actual GPS path</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
