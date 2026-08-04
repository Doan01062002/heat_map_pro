import React from 'react';

/**
 * ControlPanel — Simulation configuration and controls.
 *
 * Props:
 * @param {number} driverCount - Number of virtual drivers
 * @param {function} onDriverCountChange - Callback when driver count changes
 * @param {number} deviationPercent - Percentage of drivers that deviate
 * @param {function} onDeviationPercentChange - Callback when deviation % changes
 * @param {boolean} isRunning - Whether simulation is active
 * @param {function} onStart - Start simulation callback
 * @param {function} onStop - Stop simulation callback
 */
export default function ControlPanel({
  driverCount,
  onDriverCountChange,
  deviationPercent,
  onDeviationPercentChange,
  isRunning,
  onStart,
  onStop,
}) {
  return (
    <aside style={styles.panel}>
      <h2 style={styles.title}>🚗 Simulation Controls</h2>

      <div style={styles.field}>
        <label style={styles.label}>
          Number of Drivers: <strong>{driverCount}</strong>
        </label>
        <input
          type="range"
          min="10"
          max="1000"
          step="10"
          value={driverCount}
          onChange={(e) => onDriverCountChange(Number(e.target.value))}
          disabled={isRunning}
          style={styles.slider}
        />
      </div>

      <div style={styles.field}>
        <label style={styles.label}>
          Deviation Rate: <strong>{deviationPercent}%</strong>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={deviationPercent}
          onChange={(e) => onDeviationPercentChange(Number(e.target.value))}
          disabled={isRunning}
          style={styles.slider}
        />
      </div>

      <button
        onClick={isRunning ? onStop : onStart}
        style={{
          ...styles.button,
          backgroundColor: isRunning ? '#ef5350' : '#4caf50',
        }}
      >
        {isRunning ? '⏹ Stop Simulation' : '▶ Start Simulation'}
      </button>
    </aside>
  );
}

const styles = {
  panel: {
    width: '280px',
    padding: '20px',
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
    borderRight: '1px solid #2a2a4a',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '13px',
    color: '#b0b0b0',
  },
  slider: {
    width: '100%',
    accentColor: '#4fc3f7',
  },
  button: {
    padding: '12px',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 'auto',
  },
};
