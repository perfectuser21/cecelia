/**
 * TracesPage — 中台 Langfuse trace 列表 + 侧边详情抽屉
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

interface Observation {
  id: string;
  name?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
}

interface TraceDetail {
  trace: {
    id: string;
    name: string;
    timestamp: string;
    input?: unknown;
    output?: unknown;
    metadata?: unknown;
    latency?: number;
  };
  observations: Observation[];
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

function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-gray-400 text-xs">—</span>;
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
      {str}
    </pre>
  );
}

export default function TracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brain/langfuse/recent?limit=${LIMIT}`);
      const body = await res.json();
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

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError(null);
    fetch(`/api/brain/langfuse/trace/${selectedId}`)
      .then(r => r.json())
      .then(body => {
        if (body.success) setDetail(body.data);
        else setDetailError(body.error || 'fetch_failed');
      })
      .catch((e: any) => setDetailError(e?.message || 'fetch_failed'))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  return (
    <div className="flex h-full">
      {/* 主表格 */}
      <div className={`flex-1 p-6 overflow-auto transition-all ${selectedId ? 'mr-[480px]' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Langfuse Traces</h1>
          <div className="text-sm text-gray-500 flex items-center gap-2">
            {lastUpdated && <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
            <span>·</span>
            <span>{traces.length} traces</span>
            <button
              type="button"
              className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
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
                    暂无 trace
                  </td>
                </tr>
              )}
              {traces.map((t) => (
                <tr
                  key={t.id}
                  className={`border-b hover:bg-gray-50 cursor-pointer ${selectedId === t.id ? 'bg-blue-50' : ''}`}
                  onClick={() => setSelectedId(selectedId === t.id ? null : t.id)}
                >
                  <td className="py-2 pr-4 font-mono text-xs">{formatTime(t.timestamp)}</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{t.name}</span>
                  </td>
                  <td className="py-2 pr-4 text-gray-500 text-xs">{t.model || '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{formatLatency(t.latencyMs)}</td>
                  <td className="py-2 pr-4">
                    <span className="text-blue-600 text-xs">
                      {selectedId === t.id ? '收起 ✕' : '查看详情 →'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 侧边详情抽屉 */}
      {selectedId && (
        <div className="fixed right-0 top-0 h-full w-[480px] bg-white border-l shadow-xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h2 className="font-semibold text-base truncate">
              {detail?.trace?.name || 'Trace 详情'}
            </h2>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
            {detailLoading && (
              <div className="text-center text-gray-400 py-10">加载中...</div>
            )}
            {detailError && !detailLoading && (
              <div className="p-3 rounded border border-red-300 bg-red-50 text-red-800 text-xs">
                加载失败: {detailError}
              </div>
            )}
            {detail && !detailLoading && (
              <>
                {/* 基本信息 */}
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div><span className="font-medium">Time:</span> {formatTime(detail.trace.timestamp)}</div>
                  <div><span className="font-medium">Latency:</span> {formatLatency(detail.trace.latency ? detail.trace.latency * 1000 : null)}</div>
                  <div className="col-span-2 font-mono text-gray-400 break-all">ID: {detail.trace.id}</div>
                </div>

                {/* Input */}
                <div>
                  <div className="font-medium text-gray-700 mb-1">Input</div>
                  <JsonBlock value={detail.trace.input} />
                </div>

                {/* Output */}
                <div>
                  <div className="font-medium text-gray-700 mb-1">Output</div>
                  <JsonBlock value={detail.trace.output} />
                </div>

                {/* Metadata */}
                {detail.trace.metadata && (
                  <div>
                    <div className="font-medium text-gray-700 mb-1">Metadata</div>
                    <JsonBlock value={detail.trace.metadata} />
                  </div>
                )}

                {/* Observations / Spans */}
                {detail.observations.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-700 mb-2">
                      Observations ({detail.observations.length})
                    </div>
                    <div className="space-y-2">
                      {detail.observations.map((obs) => (
                        <div key={obs.id} className="border rounded p-2 text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{obs.type || 'SPAN'}</span>
                            <span className="font-medium">{obs.name || obs.id}</span>
                            {obs.model && <span className="text-gray-400">{obs.model}</span>}
                          </div>
                          {obs.input !== undefined && (
                            <div className="mt-1">
                              <span className="text-gray-500">Input: </span>
                              <JsonBlock value={obs.input} />
                            </div>
                          )}
                          {obs.output !== undefined && (
                            <div className="mt-1">
                              <span className="text-gray-500">Output: </span>
                              <JsonBlock value={obs.output} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
