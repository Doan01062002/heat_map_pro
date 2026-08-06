import React from 'react';

/**
 * StatsBar — Top bar showing real-time simulation metrics.
 */
export default function StatsBar({ stats, connectionStatus, isRunning, driver, onOpenAuth, onLogout }) {
  const statusColor = {
    connected: '#44ff44',
    connecting: '#ffaa44',
    disconnected: '#ff4444',
  }[connectionStatus] || '#ff4444';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 20px',
      background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>📡</span>
        <span style={{ color: '#fff', fontSize: '15px', fontWeight: 600 }}>
          Heatmap Simulator
        </span>
        <span style={{
          padding: '2px 10px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: 600,
          background: isRunning ? 'rgba(68,255,68,0.15)' : 'rgba(255,255,255,0.06)',
          color: isRunning ? '#44ff44' : '#888',
          border: `1px solid ${isRunning ? 'rgba(68,255,68,0.3)' : 'rgba(255,255,255,0.08)'}`,
        }}>
          {isRunning ? '● LIVE' : 'IDLE'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <MetricBadge label="Active Drivers" value={stats.activeDrivers} color="#6c63ff" />
        <MetricBadge label="Points Sent" value={stats.pointsSent.toLocaleString()} color="#44ddff" />
        <MetricBadge label="Batches" value={stats.batchesSent} color="#ff9f43" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
          }} />
          <span style={{ color: '#aaa', fontSize: '12px' }}>
            WS: {connectionStatus}
          </span>
        </div>

        {/* Driver Auth Badge / Button */}
        {driver ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            backgroundColor: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '20px', padding: '4px 14px',
          }}>
            <div style={{ fontSize: '13px', color: '#e2e8f0' }}>
              👤 <strong>{driver.full_name}</strong> <span style={{ color: '#818cf8', fontSize: '11px' }}>({driver.driver_id})</span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              title="Đăng xuất"
              style={{
                background: 'none', border: 'none', color: '#ef4444',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer', marginLeft: '4px'
              }}
            >
              Đăng xuất
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenAuth}
            style={{
              backgroundColor: '#6366f1', color: '#fff', border: 'none',
              borderRadius: '20px', padding: '6px 16px', fontSize: '13px',
              fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 10px rgba(99, 102, 241, 0.4)'
            }}
          >
            🔑 Đăng nhập / Đăng ký
          </button>
        )}
      </div>
    </div>
  );
}

function MetricBadge({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color, fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ color: '#777', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
    </div>
  );
}
