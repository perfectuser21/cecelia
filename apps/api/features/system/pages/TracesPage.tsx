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
    totalCost?: number;
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

/** 从 Langfuse 的各种包装格式里提取可读文本 */
function extractText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const key of ['text', 'prompt', 'content', 'message']) {
      if (typeof obj[key] === 'string') return (obj[key] as string).trim() || null;
    }
    if (Array.isArray(obj.choices) && obj.choices.length > 0) {
      const msg = (obj.choices[0] as any)?.message?.content;
      if (typeof msg === 'string') return msg.trim() || null;
    }
  }
  return JSON.stringify(value, null, 2);
}

function parseAgentName(traceName: string): string {
  const m = traceName.match(/llm-call-(.+)/);
  return m ? m[1] : traceName;
}

function TextBlock({ text, maxLines = 8 }: { text: string; maxLines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.split('\n').length > maxLines || text.length > 800;
  const display = isLong && !expanded ? text.slice(0, 800) + (text.length > 800 ? '…' : '') : text;
  return (
    <div>
      <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto whitespace-pre-wrap break-words leading-relaxed">
        {display}
      </pre>
      {isLong && (
        <button
          type="button"
          className="text-xs text-blue-500 mt-1 hover:underline"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? '收起' : '展开全部'}
        </button>
      )}
    </div>
  );
}

function Section({ label, value }: { label: string; value: unknown }) {
  const text = extractText(value);
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      {text ? <TextBlock text={text} /> : <span className="text-gray-400 text-xs">—</span>}
    </div>
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

  const meta = detail?.trace?.metadata as Record<string, unknown> | null | undefined;
  const agentId = (meta?.agentId as string) || (detail ? parseAgentName(detail.trace.name) : '');
  const model = (meta?.model as string) || null;
  const elapsedMs = meta?.elapsedMs as number | undefined;

  return (
    <div className="flex h-full">
      {/* 主表格 */}
      <div className={`flex-1 p-6 overflow-auto transition-all ${selectedId ? 'mr-[520px]' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Langfuse Traces</h1>
          <div className="text-sm text-gray-500 flex items-center gap-2">
            {lastUpdated && <span>更新于 {lastUpdated.toLocaleTimeString()}</span>}
            <span>·</span>
            <span>{traces.length} 条</span>
            <button
              type="button"
              className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
              onClick={load}
              disabled={loading}
            >
              {loading ? '刷新中…' : '刷新'}
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
              <tr className="border-b text-left text-gray-500 text-xs">
                <th className="py-2 pr-4 font-medium">时间</th>
                <th className="py-2 pr-4 font-medium">Agent</th>
                <th className="py-2 pr-4 font-medium">模型</th>
                <th className="py-2 pr-4 font-medium">耗时</th>
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
                  <td className="py-2 pr-4 font-mono text-xs text-gray-500">{formatTime(t.timestamp)}</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded text-xs font-medium">
                      {parseAgentName(t.name)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{t.model || '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-500">{formatLatency(t.latencyMs)}</td>
                  <td className="py-2 pr-4 text-blue-500 text-xs">
                    {selectedId === t.id ? '收起' : '详情 →'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 侧边详情抽屉 */}
      {selectedId && (
        <div className="fixed right-0 top-0 h-full w-[520px] bg-white border-l shadow-xl z-50 flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-sm font-semibold">
                  {agentId || 'Trace'}
                </span>
                {model && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                    {model.replace('claude-', '').replace(/-\d{8,}$/, '')}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none ml-2 shrink-0"
              >
                ✕
              </button>
            </div>
            {detail && (
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                <span>{formatTime(detail.trace.timestamp)}</span>
                <span>·</span>
                <span>{formatLatency(elapsedMs ?? (detail.trace.latency ? detail.trace.latency * 1000 : null))}</span>
                {detail.trace.totalCost != null && detail.trace.totalCost > 0 && (
                  <>
                    <span>·</span>
                    <span>${detail.trace.totalCost.toFixed(5)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
            {detailLoading && (
              <div className="text-center text-gray-400 py-10">加载中…</div>
            )}
            {detailError && !detailLoading && (
              <div className="p-3 rounded border border-red-300 bg-red-50 text-red-800 text-xs">
                加载失败: {detailError}
              </div>
            )}
            {detail && !detailLoading && (
              <>
                <Section label="Prompt" value={detail.trace.input} />
                <Section label="Output" value={detail.trace.output} />

                {detail.observations.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      LLM 调用 ({detail.observations.length})
                    </div>
                    <div className="space-y-3">
                      {detail.observations.map((obs) => {
                        const obsInput = extractText(obs.input);
                        const obsOutput = extractText(obs.output);
                        const obsMeta = obs.metadata as Record<string, unknown> | null | undefined;
                        const tokens = obsMeta?.usage as Record<string, unknown> | null | undefined;
                        return (
                          <div key={obs.id} className="border rounded-lg overflow-hidden text-xs">
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${obs.type === 'GENERATION' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                {obs.type || 'SPAN'}
                              </span>
                              <span className="font-medium text-gray-700">{obs.name || obs.id}</span>
                              {obs.model && (
                                <span className="text-gray-400 ml-auto">
                                  {obs.model.replace('claude-', '').replace(/-\d{8,}$/, '')}
                                </span>
                              )}
                            </div>
                            <div className="divide-y">
                              {obsInput && (
                                <div className="px-3 py-2">
                                  <div className="text-gray-400 mb-1">Prompt</div>
                                  <TextBlock text={obsInput} maxLines={6} />
                                </div>
                              )}
                              {obsOutput && (
                                <div className="px-3 py-2">
                                  <div className="text-gray-400 mb-1">Response</div>
                                  <TextBlock text={obsOutput} maxLines={6} />
                                </div>
                              )}
                              {tokens && (
                                <div className="px-3 py-1.5 text-gray-400 flex gap-3">
                                  {typeof tokens.input === 'number' && <span>in: {tokens.input}t</span>}
                                  {typeof tokens.output === 'number' && <span>out: {tokens.output}t</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

{/* 在 Langfuse 中打开（经 TCP proxy 本机代理，无需 Tailscale） */}
                {detail.trace.id && (
                  <div className="pt-2 border-t">
                    <a
                      href={`http://${window.location.hostname}:3001/trace/${detail.trace.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline text-xs"
                    >
                      在 Langfuse 中打开 ↗
                    </a>
                  </div>
                )}              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
