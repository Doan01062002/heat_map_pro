import React from 'react';

/**
 * ControlPanel — Simulation configuration sidebar.
 * Allows adjusting driver count, deviation percentage, and start/stop.
 */
export default function ControlPanel({
  driverCount,
  onDriverCountChange,
  deviationPercent,
  onDeviationPercentChange,
  isRunning,
  onStart,
  onStop,
  connectionStatus = 'disconnected',
}) {
  const isConnected = connectionStatus === 'connected';

  return (
    <div style={{
      width: '280px',
      background: '#1a1a2e',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      overflowY: 'auto',
    }}>
      {/* Title */}
      <div>
        <h2 style={{ color: '#e0e0ff', margin: 0, fontSize: '18px', fontWeight: 600 }}>
          🚗 Driver Simulator
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', margin: '4px 0 0' }}>
          Simulate GPS traces for virtual drivers
        </p>
      </div>

      {/* Connection Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '8px',
        background: isConnected ? 'rgba(68,255,68,0.08)' : 'rgba(255,68,68,0.08)',
        border: `1px solid ${isConnected ? 'rgba(68,255,68,0.2)' : 'rgba(255,68,68,0.2)'}`,
      }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: isConnected ? '#44ff44' : '#ff4444',
          boxShadow: `0 0 6px ${isConnected ? '#44ff44' : '#ff4444'}`,
        }} />
        <span style={{ color: isConnected ? '#88ff88' : '#ff8888', fontSize: '13px' }}>
          {connectionStatus === 'connecting' ? 'Connecting...' :
           isConnected ? 'Connected to Backend' : 'Disconnected'}
        </span>
      </div>

      {/* Driver Count */}
      <div>
        <label style={{ color: '#aaa', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
          Number of Drivers: <b style={{ color: '#fff' }}>{driverCount}</b>
        </label>
        <input
          type="range"
          min="10"
          max="500"
          step="10"
          value={driverCount}
          onChange={(e) => onDriverCountChange(Number(e.target.value))}
          disabled={isRunning}
          style={{ width: '100%', accentColor: '#6c63ff' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '11px' }}>
          <span>10</span><span>250</span><span>500</span>
        </div>
      </div>

      {/* Deviation Percent */}
      <div>
        <label style={{ color: '#aaa', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
          Deviation Rate: <b style={{ color: '#ff6b6b' }}>{deviationPercent}%</b>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={deviationPercent}
          onChange={(e) => onDeviationPercentChange(Number(e.target.value))}
          disabled={isRunning}
          style={{ width: '100%', accentColor: '#ff6b6b' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '11px' }}>
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>

      {/* Start/Stop Button */}
      <button
        onClick={isRunning ? onStop : onStart}
        style={{
          padding: '14px',
          borderRadius: '10px',
          border: 'none',
          cursor: 'pointer',
          fontSize: '15px',
          fontWeight: 600,
          color: '#fff',
          background: isRunning
            ? 'linear-gradient(135deg, #ff416c, #ff4b2b)'
            : 'linear-gradient(135deg, #6c63ff, #4834d4)',
          boxShadow: isRunning
            ? '0 4px 20px rgba(255,65,108,0.3)'
            : '0 4px 20px rgba(108,99,255,0.3)',
          transition: 'all 0.3s ease',
          letterSpacing: '0.5px',
        }}
      >
        {isRunning ? '⏹ Stop Simulation' : '▶ Start Simulation'}
      </button>

      {/* Info */}
      <div style={{
        padding: '12px',
        background: 'rgba(108,99,255,0.06)',
        borderRadius: '8px',
        border: '1px solid rgba(108,99,255,0.15)',
      }}>
        <p style={{ color: '#999', fontSize: '12px', margin: 0, lineHeight: '1.5' }}>
          Each driver follows a pre-defined route in HCMC.
          <b style={{ color: '#ff6b6b' }}> {deviationPercent}%</b> of drivers will
          deviate from their route by 400-800m. GPS batches are sent every <b style={{ color: '#fff' }}>3 seconds</b>.
        </p>
      </div>
    </div>
  );
}
