import React, { useState } from 'react';

/**
 * FilterPanel — Sidebar for switching live/history mode and date range.
 */
export default function FilterPanel({
  mode, onModeChange,
  dateRange, onDateRangeChange,
  onFetchHistory, historyLoading,
  connectionStatus,
}) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const isConnected = connectionStatus === 'connected';

  const handleFetch = () => {
    if (!fromDate || !toDate) return;
    const fromMs = new Date(fromDate).getTime();
    const toMs = new Date(toDate).getTime();
    onFetchHistory(fromMs, toMs);
  };

  return (
    <div style={{
      width: '260px',
      background: 'linear-gradient(180deg, #0f0c29 0%, #1a1a2e 100%)',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '22px' }}>🔥</span>
          <div>
            <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '16px' }}>
              Heatmap Admin
            </div>
            <div style={{ color: '#555', fontSize: '11px' }}>Driver Deviation Monitor</div>
          </div>
        </div>

        {/* WS Status */}
        <div style={{
          marginTop: '12px',
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '7px 10px',
          borderRadius: '8px',
          background: isConnected ? 'rgba(68,255,68,0.07)' : 'rgba(255,68,68,0.07)',
          border: `1px solid ${isConnected ? 'rgba(68,255,68,0.18)' : 'rgba(255,68,68,0.18)'}`,
        }}>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: isConnected ? '#44ff44' : '#ff4444',
            boxShadow: `0 0 6px ${isConnected ? '#44ff44' : '#ff4444'}`,
            flexShrink: 0,
          }} />
          <span style={{ color: '#aaa', fontSize: '12px' }}>
            {connectionStatus === 'connecting' ? 'Connecting...' :
             isConnected ? 'Live stream active' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Mode Toggle */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ color: '#777', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
          Display Mode
        </div>
        <div style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
          {['live', 'history'].map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                transition: 'all 0.2s',
                background: mode === m
                  ? 'linear-gradient(135deg, #6c63ff, #4834d4)'
                  : 'rgba(255,255,255,0.03)',
                color: mode === m ? '#fff' : '#666',
              }}
            >
              {m === 'live' ? '● LIVE' : '📅 History'}
            </button>
          ))}
        </div>
      </div>

      {/* History Range Picker */}
      {mode === 'history' && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ color: '#777', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
            Date Range
          </div>

          {['From', 'To'].map((label, i) => {
            const val = i === 0 ? fromDate : toDate;
            const setter = i === 0 ? setFromDate : setToDate;
            return (
              <div key={label} style={{ marginBottom: '10px' }}>
                <label style={{ color: '#666', fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                  {label}
                </label>
                <input
                  type="datetime-local"
                  value={val}
                  onChange={(e) => setter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: '#ddd',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    colorScheme: 'dark',
                  }}
                />
              </div>
            );
          })}

          <button
            onClick={handleFetch}
            disabled={!fromDate || !toDate || historyLoading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: 'none',
              cursor: fromDate && toDate && !historyLoading ? 'pointer' : 'not-allowed',
              background: fromDate && toDate && !historyLoading
                ? 'linear-gradient(135deg, #6c63ff, #4834d4)'
                : 'rgba(255,255,255,0.06)',
              color: fromDate && toDate ? '#fff' : '#555',
              fontSize: '13px',
              fontWeight: 600,
              marginTop: '4px',
            }}
          >
            {historyLoading ? '⏳ Loading...' : '🔍 Fetch History'}
          </button>
        </div>
      )}

      {/* Legend */}
      <div style={{ padding: '16px 20px' }}>
        <div style={{ color: '#777', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
          Intensity Legend
        </div>
        {[
          { color: '#00e664', label: 'Low deviation' },
          { color: '#ccee00', label: 'Medium deviation' },
          { color: '#ff8800', label: 'High deviation' },
          { color: '#ff0022', label: 'Critical deviation' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '14px', height: '14px', borderRadius: '50%',
              background: color,
              boxShadow: `0 0 6px ${color}60`,
              flexShrink: 0,
            }} />
            <span style={{ color: '#888', fontSize: '12px' }}>{label}</span>
          </div>
        ))}
        <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
          <div style={{ color: '#555', fontSize: '11px', lineHeight: 1.6 }}>
            🛤️ Zoom in to see trajectory lines on roads
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 'auto', padding: '12px 20px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        color: '#444', fontSize: '11px',
      }}>
        Heat Map Pro v1.0.0
      </div>
    </div>
  );
}
