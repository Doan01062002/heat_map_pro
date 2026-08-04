import React from 'react';

/**
 * StatsOverlay — Real-time KPI overlay shown on the admin dashboard.
 *
 * Props:
 * @param {{ totalDrivers: number, totalDeviations: number, cellCount: number }} stats
 * @param {string} connectionStatus
 */
export default function StatsOverlay({ stats, connectionStatus }) {
  const statusColors = {
    connected: '#4caf50',
    connecting: '#ff9800',
    disconnected: '#9e9e9e',
    error: '#f44336',
  };

  return (
    <div style={styles.overlay}>
      <h3 style={styles.title}>📊 Deviation Heatmap</h3>

      <div style={styles.statsGrid}>
        <StatCard label="Active Drivers" value={stats.totalDrivers} icon="🚗" />
        <StatCard label="Deviations / sec" value={stats.totalDeviations} icon="⚠️" color="#ff6b6b" />
        <StatCard label="Active Cells" value={stats.cellCount} icon="⬡" color="#4fc3f7" />
      </div>

      <div style={styles.connectionRow}>
        <span
          style={{
            ...styles.statusDot,
            backgroundColor: statusColors[connectionStatus],
          }}
        />
        <span style={styles.statusText}>{connectionStatus}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={styles.card}>
      <span style={styles.icon}>{icon}</span>
      <span style={{ ...styles.value, color: color || '#f0f0f0' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      <span style={styles.label}>{label}</span>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    backgroundColor: 'rgba(22, 27, 34, 0.92)',
    backdropFilter: 'blur(12px)',
    borderRadius: '12px',
    padding: '16px',
    width: '240px',
    border: '1px solid #30363d',
    zIndex: 1000,
    fontFamily: 'Inter, sans-serif',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#f0f0f0',
  },
  statsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    backgroundColor: 'rgba(13, 17, 23, 0.6)',
    borderRadius: '8px',
  },
  icon: {
    fontSize: '16px',
  },
  value: {
    fontSize: '18px',
    fontWeight: 700,
    flex: 1,
  },
  label: {
    fontSize: '11px',
    color: '#8b949e',
    textAlign: 'right',
  },
  connectionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #30363d',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  statusText: {
    fontSize: '11px',
    color: '#8b949e',
    textTransform: 'capitalize',
  },
};
