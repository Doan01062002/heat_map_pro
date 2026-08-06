import React, { useState } from 'react';

/**
 * DriverList — Sidebar section showing list of trips/drivers.
 * Click a trip to see its detail overlay on the map.
 */
export default function DriverList({ trips = [], selectedTripId, onSelectTrip, loading }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'deviation' | 'points'

  const filtered = trips
    .filter(t => {
      const q = search.toLowerCase();
      const dId = (t.driver_id || '').toLowerCase();
      const tId = (t.trip_id || '').toLowerCase();
      const dName = (t.driver_name || '').toLowerCase();
      const orig = (t.origin?.label || '').toLowerCase();
      const dest = (t.destination?.label || '').toLowerCase();
      return dId.includes(q) || tId.includes(q) || dName.includes(q) || orig.includes(q) || dest.includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return (b.created_at || 0) - (a.created_at || 0);
      if (sortBy === 'deviation') return (b.avg_deviation || (b.is_deviated ? 1000 : 0)) - (a.avg_deviation || (a.is_deviated ? 1000 : 0));
      return (b.point_count || 0) - (a.point_count || 0);
    });

  const deviationColor = (dev, isDeviated) => {
    if (isDeviated) return '#ff2244';
    if (!dev) return '#00e664';
    if (dev < 500)   return '#00e664';
    if (dev < 2000)  return '#ccee00';
    if (dev < 10000) return '#ff8800';
    return '#ff2244';
  };

  const formatDev = (meters, distanceKm, isDeviated) => {
    if (distanceKm) return `${distanceKm} km`;
    if (!meters) return isDeviated ? '🔴 Bẻ lái' : '🟢 Đúng tuyến';
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
          Trip List
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
          {[['newest', 'Newest'], ['deviation', 'Deviation'], ['points', 'Points']].map(([key, label]) => (
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
          const color = deviationColor(trip.avg_deviation, trip.is_deviated);
          const name = trip.driver_name || trip.driver_id;
          const origLabel = trip.origin?.label;
          const destLabel = trip.destination?.label;

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
              {/* Driver ID & Name */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#c0c0e0', fontSize: '12px', fontWeight: 600 }}>
                  {name.replace('taxi-', 'Taxi ')}
                </span>
                <span style={{
                  fontSize: '11px', fontWeight: 700, color,
                  background: `${color}18`,
                  padding: '2px 7px', borderRadius: '6px',
                }}>
                  {formatDev(trip.avg_deviation, trip.distance_km, trip.is_deviated)}
                </span>
              </div>

              {/* Origin -> Destination if present */}
              {origLabel && destLabel && (
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  🟢 {origLabel} → 📍 {destLabel}
                </div>
              )}

              {/* Trip ID + points */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ color: '#444', fontSize: '10px', fontFamily: 'monospace' }}>
                  {trip.trip_id.slice(-8)}
                </span>
                <span style={{ color: '#555', fontSize: '10px' }}>
                  {trip.created_at ? new Date(trip.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : `${trip.point_count || 0} pts`}
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
                  <div>{trip.point_count || (trip.actual_route?.length || 0)} GPS waypoints</div>
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
