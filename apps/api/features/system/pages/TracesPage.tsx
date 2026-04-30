/**
 * TracesPage — 中台 Langfuse trace 列表
 *
 * 显示最近 50 条 LLM 调用 trace，30s polling 刷新。
 * 数据源：GET /api/brain/langfuse/recent?limit=50（中台代理 Langfuse public API）
 * 跳转：每条 trace 一键跳 Langfuse 详情页查完整堆栈。
 */
import { useEffect, useState, useCallback } from 'react';

interface Trace {
  id: string;
  name: string;
  timestamp: string;
  latencyMs: number | null;
  model: string | null;
  langfuseUrl: string;
}

interface ApiResp {
  success: boolean;
  data: Trace[];
  count?: number;
  error?: string;
}

const POLL_INTERVAL_MS = 30_000;
const LIMIT = 50;

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function TracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brain/langfuse/recent?limit=${LIMIT}`);
      const body: ApiResp = await res.json();
      if (body.success) {
        setTraces(body.data || []);
        setError(null);
      } else {
        setError(body.error || 'unknown_error');
        setTraces(body.data || []);
      }
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Langfuse Traces</h1>
        <div className="text-sm text-gray-500">
          {lastUpdated && <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
          <span className="mx-2">·</span>
          <span>{traces.length} traces</span>
          <button
            type="button"
            className="ml-3 px-3 py-1 rounded border text-sm hover:bg-gray-50"
            onClick={load}
            disabled={loading}
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          Langfuse 取数错误: <code>{error}</code>
          （服务地址：<a href="http://100.86.118.99:3000" target="_blank" rel="noreferrer" className="underline">http://100.86.118.99:3000</a>）
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-600">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Latency</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-400">
                  暂无 trace。请检查 Langfuse 服务: http://100.86.118.99:3000
                </td>
              </tr>
            )}
            {traces.map((t) => (
              <tr key={t.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-4 font-mono text-xs">{formatTime(t.timestamp)}</td>
                <td className="py-2 pr-4">
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{t.name}</span>
                </td>
                <td className="py-2 pr-4 text-gray-500 text-xs">{t.model || '—'}</td>
                <td className="py-2 pr-4 font-mono text-xs">{formatLatency(t.latencyMs)}</td>
                <td className="py-2 pr-4">
                  <a
                    href={t.langfuseUrl.replace(/^https?:\/\/[^/]+/, `http://${window.location.hostname}:3001`)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline text-xs"
                  >
                    查看详情 ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
