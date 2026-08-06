import React, { useState, useEffect, useRef } from 'react';
import { searchLocations } from '../lib/routeService';

export default function LocationInput({
  origin,
  destination,
  onSelectOrigin,
  onSelectDestination,
  onSwap,
  activePicking,
  onSetActivePicking,
}) {
  const [originText, setOriginText] = useState(origin?.label || '');
  const [destText, setDestText] = useState(destination?.label || '');

  const [originSuggestions, setOriginSuggestions] = useState([]);
  const [destSuggestions, setDestSuggestions] = useState([]);

  const [showOriginDrop, setShowOriginDrop] = useState(false);
  const [showDestDrop, setShowDestDrop] = useState(false);

  const originTimer = useRef(null);
  const destTimer = useRef(null);

  // Sync props to text inputs when props change
  useEffect(() => {
    if (origin?.label) setOriginText(origin.label);
    else if (origin?.lat) setOriginText(`${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`);
    else if (!origin) setOriginText('');
  }, [origin]);

  useEffect(() => {
    if (destination?.label) setDestText(destination.label);
    else if (destination?.lat) setDestText(`${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}`);
    else if (!destination) setDestText('');
  }, [destination]);

  const containerRef = useRef(null);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowOriginDrop(false);
        setShowDestDrop(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Origin Search Change
  const handleOriginChange = (e) => {
    const val = e.target.value;
    setOriginText(val);

    if (originTimer.current) clearTimeout(originTimer.current);
    originTimer.current = setTimeout(async () => {
      if (val.trim().length >= 2) {
        const results = await searchLocations(val);
        setOriginSuggestions(results);
        setShowOriginDrop(true);
      } else {
        setOriginSuggestions([]);
        setShowOriginDrop(false);
      }
    }, 300);
  };

  // Destination Search Change
  const handleDestChange = (e) => {
    const val = e.target.value;
    setDestText(val);

    if (destTimer.current) clearTimeout(destTimer.current);
    destTimer.current = setTimeout(async () => {
      if (val.trim().length >= 2) {
        const results = await searchLocations(val);
        setDestSuggestions(results);
        setShowDestDrop(true);
      } else {
        setDestSuggestions([]);
        setShowDestDrop(false);
      }
    }, 300);
  };

  return (
    <div ref={containerRef} style={styles.container}>
      <div style={styles.inputStack}>
        {/* Origin Row */}
        <div style={styles.inputRow}>
          <div style={styles.iconCircleGreen} title="Điểm đi (Origin)" />
          <div style={styles.inputWrapper}>
            <input
              type="text"
              placeholder="Vị trí của bạn / Nhập điểm đi..."
              value={originText}
              onChange={handleOriginChange}
              onFocus={() => {
                if (originSuggestions.length > 0) setShowOriginDrop(true);
                onSetActivePicking('origin');
              }}
              style={activePicking === 'origin' ? styles.inputActive : styles.input}
            />
            {originText && (
              <button
                type="button"
                onClick={() => { setOriginText(''); onSelectOrigin(null); setOriginSuggestions([]); setShowOriginDrop(false); }}
                style={styles.clearBtn}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Vertical Connecting Dots */}
        <div style={styles.dotsContainer}>
          <span style={styles.dot} />
          <span style={styles.dot} />
          <span style={styles.dot} />
        </div>

        {/* Destination Row */}
        <div style={styles.inputRow}>
          <div style={styles.iconPinRed} title="Điểm đến (Destination)">📍</div>
          <div style={styles.inputWrapper}>
            <input
              type="text"
              placeholder="Nhập điểm đến (Destination)..."
              value={destText}
              onChange={handleDestChange}
              onFocus={() => {
                if (destSuggestions.length > 0) setShowDestDrop(true);
                onSetActivePicking('dest');
              }}
              style={activePicking === 'dest' ? styles.inputActive : styles.input}
            />
            {destText && (
              <button
                type="button"
                onClick={() => { setDestText(''); onSelectDestination(null); setDestSuggestions([]); setShowDestDrop(false); }}
                style={styles.clearBtn}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Autocomplete Dropdown - Origin */}
        {showOriginDrop && originSuggestions.length > 0 && (
          <div style={{ ...styles.dropdown, top: '48px' }}>
            {originSuggestions.map(item => (
              <div
                key={item.id}
                style={styles.dropdownItem}
                onClick={() => {
                  setOriginText(item.label);
                  onSelectOrigin({ lat: item.lat, lng: item.lng, label: item.label });
                  setShowOriginDrop(false);
                  setOriginSuggestions([]);
                }}
              >
                📍 <span style={{ fontWeight: 600 }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Autocomplete Dropdown - Destination */}
        {showDestDrop && destSuggestions.length > 0 && (
          <div style={{ ...styles.dropdown, top: '100px' }}>
            {destSuggestions.map(item => (
              <div
                key={item.id}
                style={styles.dropdownItem}
                onClick={() => {
                  setDestText(item.label);
                  onSelectDestination({ lat: item.lat, lng: item.lng, label: item.label });
                  setShowDestDrop(false);
                  setDestSuggestions([]);
                }}
              >
                🏁 <span style={{ fontWeight: 600 }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Swap Button ⇅ */}
      <button
        type="button"
        onClick={onSwap}
        title="Đổi chiều Điểm đi / Điểm đến"
        style={styles.swapBtn}
      >
        ⇅
      </button>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '14px',
    padding: '12px 14px',
    position: 'relative',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  inputStack: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  iconCircleGreen: {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    border: '3px solid #064e3b',
    boxShadow: '0 0 8px #10b981',
  },
  iconPinRed: {
    fontSize: '16px',
    lineHeight: 1,
  },
  dotsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    marginLeft: '5px',
    margin: '2px 0 2px 5px',
  },
  dot: {
    width: '3px',
    height: '3px',
    borderRadius: '50%',
    backgroundColor: '#64748b',
  },
  inputWrapper: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '8px 30px 8px 12px',
    color: '#f8fafc',
    fontSize: '13px',
    outline: 'none',
    transition: 'all 0.2s',
  },
  inputActive: {
    width: '100%',
    backgroundColor: '#1e293b',
    border: '1px solid #38bdf8',
    borderRadius: '8px',
    padding: '8px 30px 8px 12px',
    color: '#f8fafc',
    fontSize: '13px',
    outline: 'none',
    boxShadow: '0 0 10px rgba(56, 189, 248, 0.3)',
  },
  clearBtn: {
    position: 'absolute',
    right: '8px',
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '12px',
    cursor: 'pointer',
  },
  swapBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#38bdf8',
    fontSize: '18px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  dropdown: {
    position: 'absolute',
    left: 0, right: 0,
    backgroundColor: '#1e293b',
    border: '1px solid #38bdf8',
    borderRadius: '8px',
    zIndex: 99,
    maxHeight: '180px',
    overflowY: 'auto',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.8)',
  },
  dropdownItem: {
    padding: '10px 12px',
    color: '#e2e8f0',
    fontSize: '12px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
};
