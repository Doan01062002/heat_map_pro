import React, { useEffect } from 'react';

export default function ToastNotification({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onClose();
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const trip = toast.trip || {};
  const origLabel = trip.origin?.label || 'Điểm đi';
  const destLabel = trip.destination?.label || 'Điểm đến';
  const driverName = trip.driver_name || trip.driver_id || 'Tài xế';

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(12px)',
      border: '1px solid #10b981',
      borderRadius: '14px',
      padding: '14px 18px',
      color: '#f8fafc',
      boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)',
      zIndex: 9999,
      maxWidth: '360px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      animation: 'slideIn 0.3s ease-out',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#10b981', fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          🔔 Chuyến xe mới vừa lưu!
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
        🚘 {driverName} <span style={{ fontSize: '11px', color: '#38bdf8' }}>({trip.driver_id})</span>
      </div>

      <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
        🟢 {origLabel} → 📍 {destLabel}
      </div>

      <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
        <span>Quãng đường: <b style={{ color: '#38bdf8' }}>{trip.distance_km || 0} km</b></span>
        <span>|</span>
        <span>Trạng thái: <b style={{ color: trip.is_deviated ? '#ef4444' : '#10b981' }}>{trip.is_deviated ? '🔴 Bẻ lái' : '🟢 Đúng tuyến'}</b></span>
      </div>
    </div>
  );
}
