import React from 'react';

/**
 * MapView — Displays simulated driver positions on a map.
 *
 * TODO: Integrate MapLibre GL JS to show:
 * - Base map (dark theme)
 * - Driver positions as markers/circles
 * - Planned routes as polylines
 * - Deviating drivers highlighted in red
 *
 * Props:
 * @param {boolean} isRunning - Whether simulation is active
 * @param {number} driverCount - Number of active drivers
 */
export default function MapView({ isRunning, driverCount }) {
  return (
    <div style={styles.container}>
      <div style={styles.placeholder}>
        <p style={styles.text}>🗺️ Map View</p>
        <p style={styles.subtext}>
          {isRunning
            ? `Simulating ${driverCount} drivers...`
            : 'Start the simulation to see driver positions'}
        </p>
        <p style={styles.hint}>
          TODO: Integrate MapLibre GL JS here
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    textAlign: 'center',
    color: '#8b949e',
  },
  text: {
    fontSize: '24px',
    marginBottom: '8px',
  },
  subtext: {
    fontSize: '14px',
    color: '#58a6ff',
  },
  hint: {
    fontSize: '12px',
    color: '#484f58',
    marginTop: '16px',
  },
};
