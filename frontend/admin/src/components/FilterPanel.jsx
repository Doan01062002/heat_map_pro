import React from 'react';

/**
 * FilterPanel — Controls for switching between live and historical views.
 *
 * Props:
 * @param {'live'|'history'} viewMode
 * @param {function} onViewModeChange
 * @param {{ from: number|null, to: number|null }} timeRange
 * @param {function} onTimeRangeChange
 */
export default function FilterPanel({ viewMode, onViewModeChange, timeRange, onTimeRangeChange }) {
  return (
    <div style={styles.panel}>
      <div style={styles.modeToggle}>
        <button
          onClick={() => onViewModeChange('live')}
          style={{
            ...styles.toggleButton,
            backgroundColor: viewMode === 'live' ? '#4fc3f7' : 'transparent',
            color: viewMode === 'live' ? '#000' : '#8b949e',
          }}
        >
          🔴 Live (5 min)
        </button>
        <button
          onClick={() => onViewModeChange('history')}
          style={{
            ...styles.toggleButton,
            backgroundColor: viewMode === 'history' ? '#4fc3f7' : 'transparent',
            color: viewMode === 'history' ? '#000' : '#8b949e',
          }}
        >
          📊 History
        </button>
      </div>

      {viewMode === 'history' && (
        <div style={styles.timeRange}>
          <label style={styles.label}>
            From:
            <input
              type="datetime-local"
              onChange={(e) => onTimeRangeChange({ ...timeRange, from: new Date(e.target.value).getTime() })}
              style={styles.dateInput}
            />
          </label>
          <label style={styles.label}>
            To:
            <input
              type="datetime-local"
              onChange={(e) => onTimeRangeChange({ ...timeRange, to: new Date(e.target.value).getTime() })}
              style={styles.dateInput}
            />
          </label>
          <button style={styles.queryButton}>
            🔍 Query
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(22, 27, 34, 0.92)',
    backdropFilter: 'blur(12px)',
    borderRadius: '12px',
    padding: '12px 16px',
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    border: '1px solid #30363d',
    zIndex: 1000,
  },
  modeToggle: {
    display: 'flex',
    gap: '4px',
    backgroundColor: '#0d1117',
    borderRadius: '8px',
    padding: '3px',
  },
  toggleButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'Inter, sans-serif',
  },
  timeRange: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  label: {
    fontSize: '12px',
    color: '#8b949e',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  dateInput: {
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#e0e0e0',
    padding: '6px 8px',
    fontSize: '12px',
    fontFamily: 'Inter, sans-serif',
  },
  queryButton: {
    padding: '8px 16px',
    backgroundColor: '#238636',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    alignSelf: 'flex-end',
    fontFamily: 'Inter, sans-serif',
  },
};
