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
    envOverrideHint:
      '主机 plist 设置了 CONSCIOUSNESS_ENABLED=false 或 BRAIN_QUIET_MODE=true，本界面无法控制。需 SSH 到主机 unset env 才能恢复 Dashboard 控制。',
  },
  {
    key: 'muted',
    title: '飞书静默开关',
    descriptionOn: '开 — Brain 所有主动 outbound 飞书消息静默（对话回复不受影响）',
    descriptionOff: '关 — Brain 主动通知会发到飞书（告警 / 推送 / 日报）',
    apiPath: '/api/brain/settings/muted',
    envOverrideHint:
      '主机 plist 设置了 BRAIN_MUTED=true，本界面无法控制。需 sudo PlistBuddy Delete + launchctl bootout/bootstrap 才能恢复 Dashboard 控制。',
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
      .catch((e: Error) => setError(e.message));
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
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-gray-200">{config.title}</p>
          <p className="text-xs text-gray-400 mt-1">
            {status.enabled ? config.descriptionOn : config.descriptionOff}
          </p>
          {status.last_toggled_at && (
            <p className="text-xs text-gray-600 mt-1">
              上次切换：{new Date(status.last_toggled_at).toLocaleString('zh-CN')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={loading || status.env_override}
          data-testid={`${config.key}-toggle`}
          aria-pressed={status.enabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            status.enabled ? 'bg-emerald-500' : 'bg-gray-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              status.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {status.env_override && (
        <div
          className="mt-2 p-3 bg-red-950/50 border border-red-800/50 rounded"
          data-testid={`${config.key}-env-override-warning`}
        >
          <p className="text-xs text-red-400 font-medium">⚠️ Plist 强制覆盖</p>
          <p className="text-xs text-red-500/70 mt-1">{config.envOverrideHint}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-2">错误：{error}</p>}
    </div>
  );
}

export default function BrainSystemTab() {
  return (
    <div className="max-w-lg">
      <h2 className="text-base font-semibold text-gray-200 mb-4">Brain 系统</h2>
      {CONFIGS.map((c) => (
        <ToggleCard key={c.key} config={c} />
      ))}
    </div>
  );
}
