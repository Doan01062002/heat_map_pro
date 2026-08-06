import React, { useState } from 'react';

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [vehicleType, setVehicleType] = useState('taxi');

  if (!isOpen) return null;

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = tab === 'login'
        ? { email, password }
        : { email, password, full_name: fullName, phone, license_plate: licensePlate, vehicle_type: vehicleType };

      const res = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Thao tác thất bại');
      }

      // Success
      localStorage.setItem('driver_token', data.token);
      localStorage.setItem('driver_user', JSON.stringify(data.driver));
      onAuthSuccess(data.driver, data.token);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header Tabs */}
        <div style={styles.tabHeader}>
          <button
            type="button"
            style={tab === 'login' ? styles.activeTab : styles.tab}
            onClick={() => { setTab('login'); setError(''); }}
          >
            🔑 Đăng nhập
          </button>
          <button
            type="button"
            style={tab === 'register' ? styles.activeTab : styles.tab}
            onClick={() => { setTab('register'); setError(''); }}
          >
            📝 Đăng ký tài xế
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <h2 style={styles.title}>
            {tab === 'login' ? 'Đăng nhập Cổng Tài Xế' : 'Tạo Tài Khoản Tài Xế Mới'}
          </h2>
          <p style={styles.subtitle}>
            {tab === 'login'
              ? 'Đăng nhập để truyền tọa độ GPS thực tế của bạn lên Heatmap'
              : 'Đăng ký thông tin tài xế & xe để bắt đầu thử nghiệm hệ thống'}
          </p>

          {error && <div style={styles.errorBox}>⚠️ {error}</div>}

          {tab === 'register' && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Họ và tên tài xế *</label>
              <input
                type="text"
                required
                placeholder="Nguyễn Văn A"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={styles.input}
              />
            </div>
          )}

          <div style={styles.inputGroup}>
            <label style={styles.label}>Địa chỉ Email *</label>
            <input
              type="email"
              required
              placeholder="taixe@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Mật khẩu *</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />
          </div>

          {tab === 'register' && (
            <>
              <div style={styles.row}>
                <div style={{ ...styles.inputGroup, flex: 1, marginRight: '10px' }}>
                  <label style={styles.label}>Số điện thoại</label>
                  <input
                    type="tel"
                    placeholder="0912345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={{ ...styles.inputGroup, flex: 1 }}>
                  <label style={styles.label}>Biển số xe</label>
                  <input
                    type="text"
                    placeholder="51H-999.99"
                    value={licensePlate}
                    onChange={(e) => setLicensePlate(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Loại phương tiện</label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  style={styles.select}
                >
                  <option value="taxi">Taxi (4-7 chỗ)</option>
                  <option value="motorbike">Xe máy Grab/Gojek</option>
                  <option value="truck">Xe tải / Giao hàng</option>
                </select>
              </div>
            </>
          )}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Đang xử lý...' : tab === 'login' ? 'Đăng nhập ngay' : 'Tạo tài khoản & Nhận mã Driver ID'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(5, 8, 20, 0.75)',
    backdropFilter: 'blur(8px)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#0f172a',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    width: '460px',
    maxWidth: '92vw',
    overflow: 'hidden',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
  },
  tabHeader: {
    display: 'flex',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  tab: {
    flex: 1,
    padding: '14px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  activeTab: {
    flex: 1,
    padding: '14px 16px',
    backgroundColor: '#1e293b',
    border: 'none',
    borderBottom: '2px solid #6366f1',
    color: '#38bdf8',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  form: {
    padding: '24px 28px',
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    margin: '0 0 6px 0',
    color: '#f8fafc',
    fontSize: '20px',
    fontWeight: 700,
  },
  subtitle: {
    margin: '0 0 20px 0',
    color: '#94a3b8',
    fontSize: '13px',
    lineHeight: '1.4',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid #ef4444',
    color: '#fca5a5',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    marginBottom: '16px',
  },
  inputGroup: {
    marginBottom: '14px',
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'flex',
  },
  label: {
    color: '#cbd5e1',
    fontSize: '12px',
    fontWeight: 600,
    marginBottom: '6px',
  },
  input: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '10px 12px',
    color: '#f8fafc',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  select: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '10px 12px',
    color: '#f8fafc',
    fontSize: '14px',
    outline: 'none',
  },
  submitBtn: {
    marginTop: '10px',
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
    transition: 'all 0.2s',
  },
  cancelBtn: {
    marginTop: '10px',
    backgroundColor: 'transparent',
    color: '#64748b',
    border: 'none',
    padding: '8px',
    fontSize: '13px',
    cursor: 'pointer',
  },
};
