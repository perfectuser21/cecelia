import { useCallback, useEffect, useState } from 'react';

interface JanitorJob {
  id: string;
  name: string;
  enabled: boolean;
  last_run: {
    status: 'success' | 'failed' | 'skipped' | 'running';
    started_at: string;
    finished_at?: string;
    duration_ms?: number;
    freed_bytes?: number;
  } | null;
}

interface RunHistory {
  id: string;
  status: string;
  started_at: string;
  duration_ms?: number;
  output?: string;
  freed_bytes?: number;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return null;
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-500/20 text-emerald-400',
    failed:  'bg-red-500/20 text-red-400',
    skipped: 'bg-gray-500/20 text-gray-400',
    running: 'bg-blue-500/20 text-blue-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] ?? colors.skipped}`}>
      {status}
    </span>
  );
}

function JobCard({ job, onRefresh }: { job: JanitorJob; onRefresh: () => void }) {
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<RunHistory[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const runNow = async () => {
    setRunning(true);
    try {
      await fetch(`/api/brain/janitor/jobs/${job.id}/run`, { method: 'POST' });
      setTimeout(onRefresh, 1500);
    } finally {
      setRunning(false);
    }
  };

  const toggleEnabled = async () => {
    await fetch(`/api/brain/janitor/jobs/${job.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    onRefresh();
  };

  const loadHistory = async () => {
    if (history) { setShowHistory(v => !v); return; }
    const r = await fetch(`/api/brain/janitor/jobs/${job.id}/history?limit=10`);
    const d = await r.json();
    setHistory(d.history);
    setShowHistory(true);
  };

  const freed = formatBytes(job.last_run?.freed_bytes);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-200">{job.name}</span>
          {job.last_run && <StatusBadge status={job.last_run.status} />}
          {freed && <span className="text-xs text-gray-500">释放 {freed}</span>}
        </div>
        <button
          onClick={toggleEnabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            job.enabled ? 'bg-emerald-500' : 'bg-gray-600'
          }`}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            job.enabled ? 'translate-x-5' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {job.last_run && (
        <p className="text-xs text-gray-500 mb-3">
          上次: {new Date(job.last_run.started_at).toLocaleString('zh-CN')}
          {job.last_run.duration_ms != null && ` · ${job.last_run.duration_ms}ms`}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={runNow}
          disabled={running}
          className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50"
        >
          {running ? '执行中...' : '立即执行'}
        </button>
        <button
          onClick={loadHistory}
          className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
        >
          历史记录 {showHistory ? '▲' : '▼'}
        </button>
      </div>

      {showHistory && history && (
        <div className="mt-3 border-t border-gray-800 pt-3 space-y-1">
          {history.length === 0 && <p className="text-xs text-gray-500">暂无记录</p>}
          {history.map(run => (
            <div key={run.id} className="flex items-center gap-2 text-xs text-gray-500">
              <StatusBadge status={run.status} />
              <span>{new Date(run.started_at).toLocaleString('zh-CN')}</span>
              {run.freed_bytes != null && <span>{formatBytes(run.freed_bytes)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MaintenanceTab() {
  const [data, setData] = useState<{ jobs: JanitorJob[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/brain/janitor/jobs')
      .then(r => r.json())
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">加载中...</p>;

  return (
    <div className="max-w-lg">
      <h2 className="text-base font-semibold text-gray-200 mb-4">维护任务</h2>
      {data.jobs.map(job => (
        <JobCard key={job.id} job={job} onRefresh={refresh} />
      ))}
    </div>
  );
}
