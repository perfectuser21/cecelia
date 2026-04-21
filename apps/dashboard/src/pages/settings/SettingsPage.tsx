import { useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  last_toggled_at: string | null;
  env_override: boolean;
};

type Config = {
  key: 'consciousness' | 'muted';
  title: string;
  descriptionOn: string;
  descriptionOff: string;
  apiPath: string;
  envOverrideHint: string;
};

const CONFIGS: Config[] = [
  {
    key: 'consciousness',
    title: '意识开关',
    descriptionOn: '开 — Brain 会做情绪 / 反思 / 自驱 / 日记等活动（消耗 LLM token）',
    descriptionOff: '关 — Brain 只做任务派发 / 调度 / 监控（不消耗意识层 token）',
    apiPath: '/api/brain/settings/consciousness',
    envOverrideHint: '主机 plist 设置了 CONSCIOUSNESS_ENABLED=false 或 BRAIN_QUIET_MODE=true，本界面无法控制。需 SSH 到主机 unset env 才能恢复 Dashboard 控制。',
  },
  {
    key: 'muted',
    title: '飞书静默开关',
    descriptionOn: '开 — Brain 所有主动 outbound 飞书消息静默（对话回复不受影响）',
    descriptionOff: '关 — Brain 主动通知会发到飞书（告警 / 推送 / 日报）',
    apiPath: '/api/brain/settings/muted',
    envOverrideHint: '主机 plist 设置了 BRAIN_MUTED=true，本界面无法控制。需 sudo PlistBuddy Delete + launchctl bootout/bootstrap 才能恢复 Dashboard 控制。',
  },
];

function ToggleCard({ config }: { config: Config }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(config.apiPath)
      .then((r) => r.json())
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, [config.apiPath]);

  const toggle = async () => {
    if (!status || status.env_override) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(config.apiPath, {
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

  if (!status) return null;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{config.title}</h3>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {status.enabled ? config.descriptionOn : config.descriptionOff}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={loading || status.env_override}
          data-testid={`${config.key}-toggle`}
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
          data-testid={`${config.key}-env-override-warning`}
        >
          <p style={{ fontSize: 13, color: '#991b1b', fontWeight: 500 }}>⚠️ Plist 强制覆盖</p>
          <p style={{ fontSize: 12, color: '#7f1d1d', marginTop: 4 }}>{config.envOverrideHint}</p>
        </div>
      )}

      {error && <p style={{ marginTop: 12, fontSize: 13, color: '#dc2626' }}>错误：{error}</p>}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>设置</h2>
      {CONFIGS.map((c) => (
        <ToggleCard key={c.key} config={c} />
      ))}
    </div>
  );
}
