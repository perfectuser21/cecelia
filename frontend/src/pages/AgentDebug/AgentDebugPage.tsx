import { useEffect, useState } from 'react';

type AgentStatus = 'online' | 'offline' | 'loading';

export default function AgentDebugPage() {
  const [status, setStatus] = useState<AgentStatus>('loading');

  useEffect(() => {
    fetch('/api/brain/health')
      .then((r) => (r.ok ? 'online' : 'offline'))
      .catch(() => 'offline')
      .then((s) => setStatus(s as AgentStatus));
  }, []);

  const dotColor = { online: 'bg-green-500', offline: 'bg-red-500', loading: 'bg-yellow-400' }[status];
  const label = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : '检测中...';

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Agent 调试面板</h1>
      <div
        data-testid="agent-status-bar"
        className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm w-fit"
      >
        <div
          className={`w-3 h-3 rounded-full ${dotColor} ${status === 'loading' ? 'animate-pulse' : ''}`}
        />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Agent Brain: {label}
        </span>
      </div>
    </div>
  );
}
