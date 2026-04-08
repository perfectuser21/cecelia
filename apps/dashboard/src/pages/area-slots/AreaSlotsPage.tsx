/**
 * AreaSlotsPage — Area Slot 配置面板
 * 路由：/area-slots
 * 每条 Area 线配置 min/max/weight，实时显示运行状态
 */

import { useState, useEffect, useCallback } from 'react';

interface AreaConfig {
  min: number;
  max: number;
  weight: number;
}

interface AreaStatus {
  running: number;
  queued: number;
}

const AREA_META: Record<string, { label: string; emoji: string; desc: string }> = {
  cecelia:    { label: 'Cecelia',    emoji: '🧠', desc: '自身进化（代码/架构/意识层）' },
  zenithjoy:  { label: 'ZenithJoy', emoji: '📱', desc: '自媒体业务（发布/采集/内容）' },
  investment: { label: 'Investment', emoji: '📈', desc: '投资系统' },
};

const BRAIN_API = '/api/brain';

export default function AreaSlotsPage() {
  const [config, setConfig] = useState<Record<string, AreaConfig>>({});
  const [status, setStatus] = useState<Record<string, AreaStatus>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${BRAIN_API}/config/area-slots`);
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        setStatus(data.status || {});
        setError(null);
      } else {
        setError(data.error ?? '配置加载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请检查 Brain 服务状态');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const timer = setInterval(fetchConfig, 10000); // 每 10 秒刷新状态
    return () => clearInterval(timer);
  }, [fetchConfig]);

  const handleChange = (area: string, field: keyof AreaConfig, value: number) => {
    setConfig(prev => ({
      ...prev,
      [area]: { ...prev[area], [field]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${BRAIN_API}/config/area-slots`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setMessage('保存成功，立即生效');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage(`保存失败: ${data.error}`);
      }
    } catch (err) {
      setMessage('网络错误');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={styles.container}><p>加载中...</p></div>;
  }

  if (error && Object.keys(config).length === 0) {
    return (
      <div style={styles.container}>
        <p style={{ color: '#f85149' }}>⚠️ {error}</p>
        <button onClick={fetchConfig} style={{ marginTop: '8px', padding: '6px 14px', cursor: 'pointer' }}>重试</button>
      </div>
    );
  }

  const areas = Object.keys(AREA_META);
  const totalMin = areas.reduce((s, a) => s + (config[a]?.min || 0), 0);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Area Slot 配置</h1>
      <p style={styles.subtitle}>
        每条业务线的保底/上限/权重。保底总和: <strong>{totalMin}</strong> slot
      </p>

      <div style={styles.grid}>
        {areas.map(area => {
          const meta = AREA_META[area];
          const cfg = config[area] || { min: 0, max: 0, weight: 0 };
          const st = status[area] || { running: 0, queued: 0 };
          const deficit = Math.max(0, cfg.min - st.running);

          return (
            <div key={area} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.emoji}>{meta.emoji}</span>
                <div>
                  <h3 style={styles.areaName}>{meta.label}</h3>
                  <p style={styles.areaDesc}>{meta.desc}</p>
                </div>
              </div>

              <div style={styles.statusRow}>
                <span style={styles.statusBadge}>
                  {st.running} 在跑
                </span>
                <span style={styles.statusBadge}>
                  {st.queued} 排队
                </span>
                {deficit > 0 && (
                  <span style={{ ...styles.statusBadge, background: '#fee2e2', color: '#dc2626' }}>
                    欠债 {deficit}
                  </span>
                )}
              </div>

              <div style={styles.fields}>
                <label style={styles.label}>
                  保底 (min)
                  <input
                    type="number"
                    min={0}
                    max={16}
                    value={cfg.min}
                    onChange={e => handleChange(area, 'min', parseInt(e.target.value) || 0)}
                    style={styles.input}
                  />
                </label>
                <label style={styles.label}>
                  上限 (max)
                  <input
                    type="number"
                    min={0}
                    max={16}
                    value={cfg.max}
                    onChange={e => handleChange(area, 'max', parseInt(e.target.value) || 0)}
                    style={styles.input}
                  />
                </label>
                <label style={styles.label}>
                  权重 (weight)
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={cfg.weight}
                    onChange={e => handleChange(area, 'weight', parseInt(e.target.value) || 1)}
                    style={styles.input}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.footer}>
        <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
          {saving ? '保存中...' : '保存配置'}
        </button>
        {message && <span style={styles.message}>{message}</span>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 900,
    margin: '0 auto',
    padding: '24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    color: '#666',
    marginBottom: 24,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 16,
  },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 20,
    background: '#fff',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  emoji: {
    fontSize: 32,
  },
  areaName: {
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },
  areaDesc: {
    fontSize: 13,
    color: '#888',
    margin: 0,
  },
  statusRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },
  statusBadge: {
    fontSize: 12,
    padding: '2px 8px',
    borderRadius: 12,
    background: '#f3f4f6',
    color: '#374151',
  },
  fields: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  label: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 14,
    color: '#555',
  },
  input: {
    width: 60,
    padding: '4px 8px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    textAlign: 'right' as const,
  },
  footer: {
    marginTop: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  saveBtn: {
    padding: '8px 24px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  message: {
    fontSize: 14,
    color: '#16a34a',
  },
};
