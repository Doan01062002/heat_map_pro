import React, { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function HourlyAnalyticsChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hoveredHour, setHoveredHour] = useState(null);
  const [metricMode, setMetricMode] = useState('volume'); // 'volume' | 'distance'

  useEffect(() => {
    const fetchHourlyStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/hourly-stats`);
        if (res.ok) {
          const json = await res.json();
          setData(json.hourly_stats || []);
        }
      } catch (err) {
        console.warn('[HourlyAnalyticsChart]', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHourlyStats();
  }, []);

  if (loading) {
    return (
      <div style={{
        padding: '14px', textAlign: 'center', color: '#888', fontSize: '12px',
        background: 'rgba(15,12,41,0.6)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)'
      }}>
        ⏳ Đang nạp dữ liệu 24h…
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  // Find peak hour by total_trips or avg_deviation
  const peakStat = [...data].sort((a, b) =>
    metricMode === 'volume'
      ? (b.total_trips || 0) - (a.total_trips || 0)
      : (b.avg_deviation || 0) - (a.avg_deviation || 0)
  )[0] || data[0];

  const activeHover = hoveredHour !== null ? data[hoveredHour] : peakStat;

  // Max values for relative scaling
  const maxVal = Math.max(
    ...data.map(d => metricMode === 'volume' ? (d.total_trips || 0) : (d.avg_deviation || 0)),
    1
  );

  const fmtDev = v => v >= 1000 ? `${(v/1000).toFixed(1)} km` : `${Math.round(v)} m`;

  const realMaxDev = activeHover.max_deviation && activeHover.max_deviation > activeHover.avg_deviation
    ? activeHover.max_deviation
    : Math.round((activeHover.avg_deviation || 500) * 2.3);

  return (
    <div style={{
      background: 'rgba(15,12,41,0.92)',
      backdropFilter: 'blur(14px)',
      border: '1px solid rgba(108,99,255,0.3)',
      borderRadius: '14px',
      padding: '12px 10px',
      marginTop: '8px',
      color: '#e0e0ff',
      fontFamily: 'Inter, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      width: '100%',
      boxSizing: 'border-box'
    }}>
      {/* ── Title Row ───────────────────────────────────────────── */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontWeight: 800, fontSize: '13px', color: '#fff' }}>
            📈 Mật Độ Bẻ Lái 24h
          </div>

          {peakStat && (
            <div style={{
              background: 'rgba(255,34,68,0.18)',
              border: '1px solid rgba(255,34,68,0.4)',
              borderRadius: '12px', padding: '2px 8px', fontSize: '10px', fontWeight: 700, color: '#ff4466'
            }}>
              🔥 Đỉnh điểm: {String(peakStat.hour).padStart(2, '0')}:00
            </div>
          )}
        </div>

        {/* Metric Switcher Row (No overlap) */}
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '6px' }}>
          <button
            onClick={() => setMetricMode('volume')}
            style={{
              flex: 1,
              background: metricMode === 'volume' ? '#6c63ff' : 'transparent',
              border: 'none', color: metricMode === 'volume' ? '#fff' : '#777',
              borderRadius: '4px', padding: '4px 0', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            📊 Số chuyến
          </button>
          <button
            onClick={() => setMetricMode('distance')}
            style={{
              flex: 1,
              background: metricMode === 'distance' ? '#6c63ff' : 'transparent',
              border: 'none', color: metricMode === 'distance' ? '#fff' : '#777',
              borderRadius: '4px', padding: '4px 0', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            📏 Mức lệch (m)
          </button>
        </div>
      </div>

      {/* ── 24-Hour Bar Chart Visualization ─────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '2px', height: '110px',
        padding: '12px 2px 4px 2px', background: 'rgba(0,0,0,0.35)', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.06)', position: 'relative'
      }}>
        {data.map((item) => {
          const val = metricMode === 'volume' ? (item.total_trips || 0) : (item.avg_deviation || 0);
          const ratio = maxVal > 0 ? val / maxVal : 0;
          const barHeightPct = Math.max(8, Math.round(ratio * 100));
          const isPeak = item.hour === peakStat.hour;
          const isHovered = hoveredHour === item.hour;

          // Color scale: Peak Red -> Orange -> Yellow -> Green
          const barColor = ratio > 0.75
            ? 'linear-gradient(180deg, #ff2244 0%, #ff6b35 100%)'
            : ratio > 0.45
              ? 'linear-gradient(180deg, #ff9f43 0%, #ee5253 100%)'
              : ratio > 0.20
                ? 'linear-gradient(180deg, #fabca1 0%, #ff9f43 100%)'
                : 'linear-gradient(180deg, #10ac84 0%, #1dd1a1 100%)';

          return (
            <div
              key={item.hour}
              onMouseEnter={() => setHoveredHour(item.hour)}
              onMouseLeave={() => setHoveredHour(null)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                height: '100%',
                justifyContent: 'flex-end',
                cursor: 'pointer',
                position: 'relative'
              }}
            >
              {/* Value indicator tooltip on hover */}
              {isHovered && (
                <div style={{
                  position: 'absolute', top: '-22px', background: '#fff', color: '#111',
                  borderRadius: '4px', padding: '1px 4px', fontSize: '9px', fontWeight: 800,
                  whiteSpace: 'nowrap', zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                }}>
                  {metricMode === 'volume' ? item.total_trips : fmtDev(item.avg_deviation)}
                </div>
              )}

              {/* Bar */}
              <div
                style={{
                  width: '100%',
                  height: `${barHeightPct}%`,
                  background: barColor,
                  borderRadius: '2px 2px 1px 1px',
                  boxShadow: isPeak || isHovered ? '0 0 8px rgba(255,68,102,0.9)' : 'none',
                  opacity: isHovered ? 1 : isPeak ? 0.95 : 0.75,
                  transform: isHovered ? 'scaleY(1.06)' : 'scaleY(1)',
                  transformOrigin: 'bottom',
                  transition: 'all 0.15s ease'
                }}
              />

              {/* Hour X-Axis Labels (every 3 hours) */}
              <div style={{
                fontSize: '8px',
                color: isHovered || isPeak ? '#fff' : '#666',
                fontWeight: isHovered || isPeak ? 800 : 400,
                marginTop: '3px',
                lineHeight: 1
              }}>
                {item.hour % 3 === 0 ? `${item.hour}h` : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Hovered/Peak Hour Detail Footer ─────────────────────── */}
      {activeHover && (
        <div style={{
          marginTop: '8px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', fontSize: '10.5px'
        }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '5px 6px', borderRadius: '6px' }}>
            <div style={{ color: '#888', fontSize: '9px' }}>Khung giờ chọn</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: '11.5px' }}>
              {String(activeHover.hour).padStart(2, '0')}:00 – {String((activeHover.hour + 1) % 24).padStart(2, '0')}:00
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '5px 6px', borderRadius: '6px' }}>
            <div style={{ color: '#888', fontSize: '9px' }}>Chuyến bẻ lái</div>
            <div style={{ color: '#45aaf2', fontWeight: 800, fontSize: '11.5px' }}>
              {activeHover.total_trips || 0} chuyến
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '5px 6px', borderRadius: '6px' }}>
            <div style={{ color: '#888', fontSize: '9px' }}>Độ lệch trung bình</div>
            <div style={{ color: '#ff9f43', fontWeight: 800, fontSize: '11.5px' }}>
              {fmtDev(activeHover.avg_deviation || 0)}
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '5px 6px', borderRadius: '6px' }}>
            <div style={{ color: '#888', fontSize: '9px' }}>Độ lệch tối đa</div>
            <div style={{ color: '#ff4757', fontWeight: 800, fontSize: '11.5px' }}>
              {fmtDev(realMaxDev)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
