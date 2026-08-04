import React from 'react';

/**
 * StatsBar — Real-time statistics bar at the top of the simulator.
 *
 * Props:
 * @param {{ pointsSent: number, batchesSent: number, activeDrivers: number }} stats
 * @param {string} connectionStatus - 'connected' | 'connecting' | 'disconnected' | 'error'
 * @param {boolean} isRunning
 */
export default function StatsBar({ stats, connectionStatus, isRunning }) {
  const statusColors = {
    connected: '#4caf50',
    connecting: '#ff9800',
    disconnected: '#9e9e9e',
    error: '#f44336',
  };

  return (
    <header style={styles.bar}>
      <span style={styles.title}>Driver Simulator</span>

      <div style={styles.stats}>
        <Stat label="Status" value={isRunning ? 'Running' : 'Stopped'} color={isRunning ? '#4caf50' : '#9e9e9e'} />
        <Stat label="Points Sent" value={stats.pointsSent.toLocaleString()} />
        <Stat label="Batches" value={stats.batchesSent.toLocaleString()} />
        <Stat label="WebSocket" value={connectionStatus} color={statusColors[connectionStatus]} />
      </div>
    </header>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <span style={{ ...styles.statValue, color: color || '#e0e0e0' }}>{value}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 20px',
    backgroundColor: '#161b22',
    borderBottom: '1px solid #30363d',
    fontFamily: 'Inter, sans-serif',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#f0f0f0',
  },
  stats: {
    display: 'flex',
    gap: '24px',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: '10px',
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  statValue: {
    fontSize: '13px',
    fontWeight: 500,
  },
};
