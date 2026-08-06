import React from 'react';
import LocationInput from './LocationInput';

export default function ControlPanel({
  origin,
  destination,
  onSelectOrigin,
  onSelectDestination,
  onSwap,
  activePicking,
  onSetActivePicking,
  routeInfo,
  onFetchPlanRoute,
  isDrawMode,
  onToggleDrawMode,
  isMatching,
  onMatchRoute,
  onClearActualRoute,
  hasPlanRoute,
  hasActualRoute,
  driverTrips = [],
  onReloadTrip,
  reviewingTrip = null,
  onExitReviewMode,
  isRunning,
  onStart,
  onStop,
  connectionStatus = 'disconnected',
}) {
  const isConnected = connectionStatus === 'connected';
  const isReviewMode = Boolean(reviewingTrip);

  return (
    <div style={{
      width: '340px',
      height: '100%',
      flexShrink: 0,
      background: '#0f172a',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      overflowY: 'auto',
      color: '#f8fafc',
    }}>
      {/* Title */}
      <div>
        <h2 style={{ color: '#f8fafc', margin: 0, fontSize: '18px', fontWeight: 700 }}>
          🗺️ Tìm kiếm & Lập tuyến đường
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '12px', margin: '4px 0 0' }}>
          Nhập điểm đi / điểm đến giống Google Maps để mô phỏng bẻ lái
        </p>
      </div>

      {/* Review Mode Banner */}
      {isReviewMode && (
        <div style={{
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          border: '1px solid #38bdf8',
          borderRadius: '10px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: '0 4px 20px rgba(56, 189, 248, 0.25)',
        }}>
          <div style={{ color: '#38bdf8', fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>👁️ ĐANG XEM LẠI CHUYẾN XE</span>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>{reviewingTrip.trip_id.slice(-8)}</span>
          </div>
          <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.5 }}>
            Các nút thao tác đã được khóa để tránh sai lệch hoặc tạo dữ liệu trùng lặp.
          </div>
          <button
            type="button"
            onClick={onExitReviewMode}
            style={{
              backgroundColor: '#38bdf8',
              color: '#0f172a',
              border: 'none',
              borderRadius: '6px',
              padding: '8px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            ✖️ Thoát xem lại (Tạo chuyến mới)
          </button>
        </div>
      )}

      {/* Location Search Component */}
      <LocationInput
        origin={origin}
        destination={destination}
        onSelectOrigin={onSelectOrigin}
        onSelectDestination={onSelectDestination}
        onSwap={onSwap}
        activePicking={activePicking}
        onSetActivePicking={onSetActivePicking}
        disabled={isReviewMode}
      />

      {/* Action 1: Fetch Plan Route */}
      <button
        type="button"
        disabled={!origin || !destination || isRunning || isReviewMode}
        onClick={onFetchPlanRoute}
        style={{
          padding: '12px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: (!origin || !destination || isReviewMode) ? '#334155' : '#0284c7',
          color: isReviewMode ? '#94a3b8' : '#fff',
          fontSize: '14px',
          fontWeight: 700,
          cursor: (!origin || !destination || isRunning || isReviewMode) ? 'not-allowed' : 'pointer',
          boxShadow: (!origin || !destination || isReviewMode) ? 'none' : '0 4px 14px rgba(2, 132, 199, 0.4)',
        }}
      >
        🔵 1. Vẽ tuyến đường dự kiến (Plan Route)
      </button>

      {/* Route Info Badge */}
      {routeInfo && (
        <div style={{
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '8px',
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ color: '#38bdf8', fontSize: '14px', fontWeight: 700 }}>
              {routeInfo.distanceKm} km
            </div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>Quãng đường dự kiến</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#38bdf8', fontSize: '14px', fontWeight: 700 }}>
              ~{routeInfo.durationMin} phút
            </div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>Thời gian ước tính</div>
          </div>
        </div>
      )}

      {/* Action 2: Interactive Draw Actual Route on Map & Map Matching */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '10px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        opacity: isReviewMode ? 0.6 : 1,
      }}>
        <label style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 600 }}>
          Tự vẽ lộ trình thực tế bẻ lái:
        </label>

        <button
          type="button"
          disabled={isRunning || !origin || !destination || isReviewMode}
          onClick={onToggleDrawMode}
          style={{
            padding: '10px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: isDrawMode ? '#ef4444' : isReviewMode ? '#334155' : '#f97316',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            cursor: (isRunning || !origin || !destination || isReviewMode) ? 'not-allowed' : 'pointer',
            boxShadow: (isDrawMode && !isReviewMode) ? '0 0 12px rgba(239, 68, 68, 0.5)' : (isReviewMode ? 'none' : '0 4px 14px rgba(249, 115, 22, 0.4)'),
          }}
        >
          {isDrawMode ? '⏹ Tắt chế độ vẽ (Done Drawing)' : '✏️ 2. Vẽ đường đi thực tế trên bản đồ'}
        </button>

        {hasActualRoute && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={isRunning || isMatching || isReviewMode}
              onClick={onMatchRoute}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isReviewMode ? '#334155' : '#8b5cf6',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: (isRunning || isMatching || isReviewMode) ? 'not-allowed' : 'pointer',
              }}
            >
              {isMatching ? 'Đang khớp OSRM...' : '✨ Khớp đường OSRM'}
            </button>

            <button
              type="button"
              disabled={isRunning || isReviewMode}
              onClick={onClearActualRoute}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: 'transparent',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: (isRunning || isReviewMode) ? 'not-allowed' : 'pointer',
              }}
            >
              🗑️ Xóa
            </button>
          </div>
        )}
      </div>

      {/* Action 3: Save Trip Button OR Lock State */}
      {isReviewMode ? (
        <button
          type="button"
          disabled
          style={{
            padding: '14px',
            borderRadius: '10px',
            border: '1px solid #334155',
            fontSize: '14px',
            fontWeight: 700,
            color: '#94a3b8',
            backgroundColor: '#1e293b',
            cursor: 'not-allowed',
            textAlign: 'center',
          }}
        >
          🔒 Chuyến xe đã được lưu (Đang xem lại)
        </button>
      ) : (
        (hasActualRoute || hasPlanRoute) && (
          <button
            type="button"
            onClick={onStart}
            style={{
              padding: '14px',
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 700,
              color: '#fff',
              backgroundColor: '#10b981',
              boxShadow: '0 4px 20px rgba(16, 185, 129, 0.4)',
              transition: 'all 0.3s ease',
            }}
          >
            💾 3. Lưu chuyến xe
          </button>
        )
      )}

      {/* Driver Trip History Section */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '10px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ color: '#cbd5e1', fontSize: '13px', fontWeight: 700 }}>
            📜 Lịch sử chuyến xe:
          </label>
          <span style={{ backgroundColor: '#334155', color: '#94a3b8', fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
            {driverTrips.length} chuyến
          </span>
        </div>

        {driverTrips.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', padding: '10px 0' }}>
            Chưa có chuyến xe nào được lưu.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
            {driverTrips.map((t) => {
              const origLabel = t.origin?.label || 'Điểm đi';
              const destLabel = t.destination?.label || 'Điểm đến';
              const timeStr = t.created_at ? new Date(t.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
              const isSelected = reviewingTrip?.trip_id === t.trip_id;

              return (
                <div
                  key={t.trip_id}
                  style={{
                    backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.15)' : '#0f172a',
                    border: `1px solid ${isSelected ? '#38bdf8' : '#334155'}`,
                    borderRadius: '8px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8' }}>
                    <span style={{ fontWeight: 700, color: '#38bdf8' }}>{t.trip_id.slice(-8)}</span>
                    <span>{timeStr}</span>
                  </div>

                  <div style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    🟢 {origLabel} → 📍 {destLabel}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#cbd5e1' }}>{t.distance_km || 0} km</span>
                      <span style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        backgroundColor: t.is_deviated ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                        color: t.is_deviated ? '#fca5a5' : '#6ee7b7',
                      }}>
                        {t.is_deviated ? '🔴 Bẻ lái' : '🟢 Đúng tuyến'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => isSelected ? onExitReviewMode() : onReloadTrip(t)}
                      style={{
                        backgroundColor: isSelected ? '#ef4444' : '#3b82f6',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      {isSelected ? '✖️ Bỏ xem' : '👁️ Xem lại'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connection Indicator */}
      <div style={{
        marginTop: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '8px',
        backgroundColor: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
      }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          backgroundColor: isConnected ? '#10b981' : '#ef4444',
          boxShadow: `0 0 6px ${isConnected ? '#10b981' : '#ef4444'}`,
        }} />
        <span style={{ color: isConnected ? '#6ee7b7' : '#fca5a5', fontSize: '12px' }}>
          {isConnected ? 'Đã kết nối Backend WebSocket' : 'Mất kết nối Backend'}
        </span>
      </div>
    </div>
  );
}
