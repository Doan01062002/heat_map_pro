import React, { useState } from 'react';
import DriverList from './DriverList';

/**
 * FilterPanel — Sidebar with mode toggle, date filter, and driver list.
 */
export default function FilterPanel({
  mode, onModeChange,
  dateRange, onDateRangeChange,
  onFetchHistory, historyLoading,
  connectionStatus,
  trips, selectedTripId, selectedTrip, onSelectTrip,
}) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activeTab, setActiveTab] = useState('map'); // 'map' | 'trips'

  const isConnected = connectionStatus === 'connected';

  const handleFetch = () => {
    if (!fromDate || !toDate) return;
    onFetchHistory(new Date(fromDate).getTime(), new Date(toDate).getTime());
  };

  return (
    <div style={{
      width: '260px',
      background: 'linear-gradient(180deg, #0f0c29 0%, #1a1a2e 100%)',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'hidden',
    }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <div>
            <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '15px' }}>Heatmap Admin</div>
            <div style={{ color: '#444', fontSize: '10px' }}>Driver Deviation Monitor</div>
          </div>
        </div>

        {/* WS Status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '6px 10px', borderRadius: '8px',
          background: isConnected ? 'rgba(68,255,68,0.07)' : 'rgba(255,68,68,0.07)',
          border: `1px solid ${isConnected ? 'rgba(68,255,68,0.18)' : 'rgba(255,68,68,0.18)'}`,
        }}>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
            background: isConnected ? '#44ff44' : '#ff4444',
            boxShadow: `0 0 6px ${isConnected ? '#44ff44' : '#ff4444'}`,
          }} />
          <span style={{ color: '#aaa', fontSize: '11px' }}>
            {connectionStatus === 'connecting' ? 'Connecting…' : isConnected ? 'Live stream active' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* ── Mode Toggle ────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ color: '#777', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
          Display Mode
        </div>
        <div style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
          {['live', 'history'].map(m => (
            <button key={m} onClick={() => onModeChange(m)} style={{
              flex: 1, padding: '9px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, transition: 'all 0.2s',
              background: mode === m ? 'linear-gradient(135deg,#6c63ff,#4834d4)' : 'rgba(255,255,255,0.03)',
              color: mode === m ? '#fff' : '#555',
            }}>
              {m === 'live' ? 'LIVE' : 'History'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Date Range (history only) ───────────────────────────── */}
      {mode === 'history' && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ color: '#777', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
            Date Range
          </div>
          {[['From', fromDate, setFromDate], ['To', toDate, setToDate]].map(([label, val, setter]) => (
            <div key={label} style={{ marginBottom: '8px' }}>
              <label style={{ color: '#555', fontSize: '10px', display: 'block', marginBottom: '3px' }}>{label}</label>
              <input
                type="datetime-local"
                value={val}
                onChange={e => setter(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#ddd', fontSize: '11px', colorScheme: 'dark',
                }}
              />
            </div>
          ))}
          <button
            onClick={handleFetch}
            disabled={!fromDate || !toDate || historyLoading}
            style={{
              width: '100%', padding: '9px', borderRadius: '8px', border: 'none',
              cursor: fromDate && toDate && !historyLoading ? 'pointer' : 'not-allowed',
              background: fromDate && toDate && !historyLoading
                ? 'linear-gradient(135deg,#6c63ff,#4834d4)' : 'rgba(255,255,255,0.05)',
              color: fromDate && toDate ? '#fff' : '#444',
              fontSize: '12px', fontWeight: 600,
            }}
          >
            {historyLoading ? 'Loading…' : 'Fetch History'}
          </button>
        </div>
      )}

      {/* ── Tab switcher: Map controls vs Trip list ────────────── */}
      <div style={{
        display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
      }}>
        {[['map', 'Map'], ['trips', 'Trips']].map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
              background: activeTab === tab ? 'rgba(108,99,255,0.18)' : 'transparent',
              color: activeTab === tab ? '#c0b8ff' : '#555',
              fontSize: '12px', fontWeight: 600,
              borderBottom: activeTab === tab ? '2px solid #6c63ff' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────── */}
      {activeTab === 'map' && (
        <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1 }}>
          {/* Legend */}
          <div style={{ color: '#777', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
            Intensity Legend
          </div>
          {[
            { color: '#00e664', label: 'Low deviation' },
            { color: '#ccee00', label: 'Medium deviation' },
            { color: '#ff8800', label: 'High deviation' },
            { color: '#ff2244', label: 'Critical deviation' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                width: '13px', height: '13px', borderRadius: '50%',
                background: color, boxShadow: `0 0 6px ${color}60`, flexShrink: 0,
              }} />
              <span style={{ color: '#777', fontSize: '12px' }}>{label}</span>
            </div>
          ))}

          <div style={{
            marginTop: '16px', padding: '10px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ color: '#555', fontSize: '11px', lineHeight: 1.7 }}>
              <div style={{ color: '#4fc3f7', fontWeight: 600, marginBottom: '4px' }}>Trip Detail Legend</div>
              <div>━━ <span style={{ color: '#4fc3f7' }}>Planned route</span> (origin→dest)</div>
              <div>━━ <span style={{ color: '#ff6b35' }}>Actual GPS path</span></div>
              <div>● <span style={{ color: '#888' }}>GPS waypoints</span></div>
            </div>
          </div>

          <div style={{ marginTop: '12px', color: '#444', fontSize: '11px', lineHeight: 1.6 }}>
            Switch to <b style={{ color: '#8888cc' }}>Trips tab</b> to select a trip and see its route on the map.
          </div>
        </div>
      )}

      {activeTab === 'trips' && (
        <DriverList
          trips={trips}
          selectedTripId={selectedTripId}
          selectedTrip={selectedTrip}
          onSelectTrip={onSelectTrip}
          loading={historyLoading}
        />
      )}

      {/* Footer */}
      <div style={{
        padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.04)',
        color: '#333', fontSize: '10px', flexShrink: 0,
      }}>
        Heat Map Pro v1.0.0
      </div>
    </div>
  );
}
