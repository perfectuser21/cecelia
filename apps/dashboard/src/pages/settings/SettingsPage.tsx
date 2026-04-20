import { useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  last_toggled_at: string | null;
  env_override: boolean;
};

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brain/settings/consciousness')
      .then((r) => r.json())
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);

  const toggle = async () => {
    if (!status || status.env_override) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/settings/consciousness', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      const next = await res.json();
      setStatus(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return <div style={{ padding: 24 }}>Loading...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>设置</h2>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>意识开关</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              {status.enabled
                ? '开 — Brain 会做情绪 / 反思 / 自驱 / 日记等活动（消耗 LLM token）'
                : '关 — Brain 只做任务派发 / 调度 / 监控（不消耗意识层 token）'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={loading || status.env_override}
            data-testid="consciousness-toggle"
            aria-pressed={status.enabled}
            style={{
              width: 56,
              height: 32,
              borderRadius: 16,
              border: 'none',
              background: status.enabled ? '#10b981' : '#d1d5db',
              cursor: status.env_override ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              position: 'relative',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 4,
                left: status.enabled ? 28 : 4,
                width: 24,
                height: 24,
                borderRadius: 12,
                background: '#fff',
                transition: 'left 0.15s',
              }}
            />
          </button>
        </div>

        {status.last_toggled_at && (
          <p style={{ fontSize: 12, color: '#9ca3af' }}>
            上次切换：{new Date(status.last_toggled_at).toLocaleString('zh-CN')}
          </p>
        )}

        {status.env_override && (
          <div
            style={{ marginTop: 12, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}
            data-testid="env-override-warning"
          >
            <p style={{ fontSize: 13, color: '#991b1b', fontWeight: 500 }}>⚠️ Plist 强制关闭</p>
            <p style={{ fontSize: 12, color: '#7f1d1d', marginTop: 4 }}>
              主机 plist 设置了 <code>CONSCIOUSNESS_ENABLED=false</code> 或 <code>BRAIN_QUIET_MODE=true</code>
              ，本界面无法控制。需 SSH 到主机 unset env 才能恢复 Dashboard 控制。
            </p>
          </div>
        )}

        {error && <p style={{ marginTop: 12, fontSize: 13, color: '#dc2626' }}>错误：{error}</p>}
      </div>
    </div>
  );
}
