/**
 * MapPage — Universal Map Projection Engine Dashboard
 * PRD: Universal Map Projection Engine, 刀4
 *
 * Level 1: 全局地图（Value Stream + Capability + Boundary + Cross-cut）
 * Level 2: Capability 下钻（Backbone / Feature / Assertion）
 * Level 3: 证据下钻（receipt / revision / PASS/FAIL）
 *
 * 数据只来自 Unified Map API（/api/brain/map）
 * 页面不提供直接编辑颜色或逐项登记按钮
 */

import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';

const BRAIN_API = '';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface MapNode {
  key: string;
  type: 'value_stream' | 'capability' | 'crosscut' | 'prerequisite' | 'backbone' | 'feature' | 'artifact' | 'assertion';
  name: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  display_order: number | null;
  state: 'green' | 'red' | 'gray' | 'unknown' | 'not_applicable';
  state_reason: string | null;
}

interface MapEdge {
  key: string | null;
  from: string;
  to: string;
  type: string;
  attributes: Record<string, unknown>;
}

interface MapData {
  scope_key: string;
  manifest_version: number;
  manifest_digest: string;
  projection_digest: string | null;
  fact_revisions: Record<string, string>;
  freshness: Record<string, unknown>;
  nodes: MapNode[];
  edges: MapEdge[];
  summary: {
    value_streams: number;
    capabilities: number;
    crosscuts: number;
    prerequisites: number;
    boundaries: number;
  };
  generated_at: string;
}

interface NodeDetail {
  node: MapNode;
  state: string;
  state_reason: string | null;
  state_details: Record<string, unknown>;
  upstream: MapEdge[];
  downstream: MapEdge[];
  boundaries: Array<{ from: string; to: string; statement: string }>;
}

interface HealthData {
  layers: {
    manifest: { status: string; version: number | null; digest: string | null; activated_at: string | null };
    facts: { status: string; detail: Record<string, unknown> };
    projection: { status: string; node_count: number; edge_count: number; completed_at: string | null };
    state_resolver: { status: string };
  };
  overall: string;
  generated_at: string;
}

// ─── 状态颜色映射 ─────────────────────────────────────────────────────────────

function stateColor(state: string): string {
  switch (state) {
    case 'green': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'red': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    case 'gray': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    case 'unknown': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'not_applicable': return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
    default: return 'bg-gray-100 text-gray-500';
  }
}

function stateDot(state: string): string {
  switch (state) {
    case 'green': return 'bg-green-500';
    case 'red': return 'bg-red-500';
    case 'gray': return 'bg-gray-400';
    case 'unknown': return 'bg-yellow-400';
    case 'not_applicable': return 'bg-slate-300';
    default: return 'bg-gray-400';
  }
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${stateColor(state)}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${stateDot(state)}`} />
      {state}
    </span>
  );
}

function FreshnessTag({ fresh, ageSeconds }: { fresh: boolean; ageSeconds: number }) {
  if (fresh) {
    return <span className="text-xs text-green-600 dark:text-green-400">新鲜</span>;
  }
  const hours = Math.round(ageSeconds / 3600);
  return <span className="text-xs text-yellow-600 dark:text-yellow-400">陈旧 {hours}h</span>;
}

function NodeCard({ node, onClick }: { node: MapNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors bg-white dark:bg-gray-800 group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-gray-400 dark:text-gray-500">{node.key}</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{node.name}</p>
          {node.aliases.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              别名: {node.aliases.join(', ')}
            </p>
          )}
        </div>
        <StateBadge state={node.state} />
      </div>
    </button>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export default function MapPage() {
  const [scope, setScope] = useState('cecelia');
  const [scopeInput, setScopeInput] = useState('cecelia');
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'map' | 'health'>('map');

  const fetchMap = useCallback(async (scopeKey: string) => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    try {
      const [mapRes, healthRes] = await Promise.all([
        fetch(`${BRAIN_API}/api/brain/map?scope=${encodeURIComponent(scopeKey)}`),
        fetch(`${BRAIN_API}/api/brain/map/health?scope=${encodeURIComponent(scopeKey)}`),
      ]);
      if (!mapRes.ok) {
        const err = await mapRes.json().catch(() => ({ error: mapRes.statusText }));
        throw new Error(err.error || mapRes.statusText);
      }
      const [mapJson, healthJson] = await Promise.all([mapRes.json(), healthRes.json().catch(() => null)]);
      setMapData(mapJson);
      setHealthData(healthJson);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMap(scope);
  }, [scope, fetchMap]);

  const openNodeDetail = useCallback(async (nodeKey: string) => {
    try {
      const res = await fetch(`${BRAIN_API}/api/brain/map/nodes/${encodeURIComponent(nodeKey)}?scope=${encodeURIComponent(scope)}`);
      if (!res.ok) return;
      const detail = await res.json();
      setSelectedNode(detail);
    } catch (_) { /* ignore */ }
  }, [scope]);

  // 按 value_stream 分组 capabilities
  const valueStreams = mapData?.nodes.filter((n) => n.type === 'value_stream').sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99)) ?? [];
  const capabilities = mapData?.nodes.filter((n) => n.type === 'capability') ?? [];
  const crosscuts = mapData?.nodes.filter((n) => n.type === 'crosscut') ?? [];
  const prerequisites = mapData?.nodes.filter((n) => n.type === 'prerequisite') ?? [];

  const boundaryEdges = mapData?.edges.filter((e) => e.type === 'hands_off_to') ?? [];

  function getCapabilitiesFor(vsKey: string) {
    return capabilities
      .filter((c) => c.attributes.value_stream_key === vsKey)
      .sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99));
  }

  function getBoundariesFor(nodeKey: string) {
    return boundaryEdges.filter((e) => e.from === nodeKey || e.to === nodeKey);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
      {/* 顶部控制栏 */}
      <div className="mb-6 flex flex-wrap gap-4 items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">承诺地图</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Universal Map Projection Engine</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={scopeInput}
            onChange={(e) => setScopeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setScope(scopeInput); } }}
            placeholder="scope key"
            className="px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-white w-40"
          />
          <button
            onClick={() => setScope(scopeInput)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            加载
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('map')}
            className={`px-3 py-1.5 text-sm rounded-lg ${activeTab === 'map' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            地图
          </button>
          <button
            onClick={() => setActiveTab('health')}
            className={`px-3 py-1.5 text-sm rounded-lg ${activeTab === 'health' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            健康度
          </button>
        </div>
      </div>

      {/* 加载 / 错误 */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <p className="text-xs text-red-500 dark:text-red-400 mt-1">
            提示：需要先通过 POST /api/brain/map/manifests + activate 完成首次 manifest 激活
          </p>
        </div>
      )}

      {/* Metadata bar */}
      {mapData && !loading && (
        <div className="mb-4 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
          <span>scope: <strong className="text-gray-700 dark:text-gray-300">{mapData.scope_key}</strong></span>
          <span>manifest v{mapData.manifest_version}</span>
          <span>digest: {mapData.manifest_digest?.slice(0, 12)}…</span>
          {mapData.projection_digest && <span>proj: {mapData.projection_digest.slice(0, 12)}…</span>}
          {Object.entries(mapData.fact_revisions).map(([repo, sha]) => (
            <span key={repo}>{repo}@{String(sha).slice(0, 8)}</span>
          ))}
          <span className="ml-auto">{new Date(mapData.generated_at).toLocaleTimeString('zh-CN')}</span>
        </div>
      )}

      {/* Summary bar */}
      {mapData && !loading && (
        <div className="mb-6 flex flex-wrap gap-4">
          {[
            { label: '价值流', count: mapData.summary.value_streams },
            { label: 'Capability', count: mapData.summary.capabilities },
            { label: '横切件', count: mapData.summary.crosscuts },
            { label: '边界', count: mapData.summary.boundaries },
          ].map(({ label, count }) => (
            <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{count}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 健康度 Tab */}
      {activeTab === 'health' && healthData && (
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(healthData.layers).map(([key, layer]) => (
            <div key={key} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="font-medium text-gray-900 dark:text-white capitalize mb-2">{key.replace('_', ' ')}</h3>
              <StateBadge state={('status' in layer) ? String((layer as any).status) : 'unknown'} />
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                {Object.entries(layer as Record<string, unknown>).filter(([k]) => k !== 'status').map(([k, v]) => (
                  <div key={k}><span className="font-mono">{k}:</span> {typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v ?? '—')}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 地图 Tab */}
      {activeTab === 'map' && mapData && !loading && (
        <div className="flex gap-6">
          {/* 主面板 */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Value Stream 泳道 */}
            {valueStreams.map((vs) => {
              const caps = getCapabilitiesFor(vs.key);
              return (
                <div key={vs.key} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400">{vs.key}</span>
                        <h2 className="font-semibold text-gray-900 dark:text-white">{vs.name}</h2>
                        <StateBadge state={vs.state} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        感知者：{String(vs.attributes.perceiver ?? '—')}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">{caps.length} capabilities</span>
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {caps.map((cap) => {
                      const boundaries = getBoundariesFor(cap.key);
                      return (
                        <div key={cap.key} className="relative">
                          <NodeCard node={cap} onClick={() => openNodeDetail(cap.key)} />
                          {boundaries.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {boundaries.map((b, i) => (
                                <div key={i} className="text-xs text-purple-600 dark:text-purple-400 pl-1">
                                  ⇢ {b.from === cap.key ? b.to : b.from}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Cross-cut 横切件 */}
            {crosscuts.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-purple-200 dark:border-purple-800/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-purple-100 dark:border-purple-800/30">
                  <h2 className="font-semibold text-purple-700 dark:text-purple-300">横切件（{crosscuts.length}）</h2>
                  <p className="text-xs text-purple-500 dark:text-purple-400 mt-0.5">不计入 Capability 数，各自有独立守卫状态</p>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {crosscuts.map((cc) => (
                    <NodeCard key={cc.key} node={cc} onClick={() => openNodeDetail(cc.key)} />
                  ))}
                </div>
              </div>
            )}

            {/* Shared Prerequisites */}
            {prerequisites.length > 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <h2 className="font-semibold text-gray-900 dark:text-white mb-3">共享前置</h2>
                <div className="grid grid-cols-2 gap-3">
                  {prerequisites.map((p) => (
                    <NodeCard key={p.key} node={p} onClick={() => openNodeDetail(p.key)} />
                  ))}
                </div>
              </div>
            ) : mapData.nodes.length > 0 ? (
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  共享前置：<strong>不适用</strong>
                </p>
              </div>
            ) : null}
          </div>

          {/* 侧边详情面板 */}
          {selectedNode && (
            <div className="w-80 flex-shrink-0">
              <div className="sticky top-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-xs text-gray-400">{selectedNode.node.key}</p>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{selectedNode.node.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize mt-0.5">{selectedNode.node.type}</p>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
                  >
                    ×
                  </button>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">当前状态</p>
                  <StateBadge state={selectedNode.state} />
                  {selectedNode.state_reason && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{selectedNode.state_reason}</p>
                  )}
                </div>

                {selectedNode.node.aliases.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">历史别名</p>
                    <div className="flex flex-wrap gap-1">
                      {selectedNode.node.aliases.map((a) => (
                        <span key={a} className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300">{a}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.boundaries.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">边界声明</p>
                    <div className="space-y-2">
                      {selectedNode.boundaries.map((b, i) => (
                        <div key={i} className="text-xs bg-purple-50 dark:bg-purple-900/20 rounded p-2">
                          <p className="font-mono text-purple-600 dark:text-purple-400">{b.from} → {b.to}</p>
                          <p className="text-gray-600 dark:text-gray-300 mt-0.5">{b.statement}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.upstream.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">上游 ({selectedNode.upstream.length})</p>
                    <div className="space-y-1">
                      {selectedNode.upstream.map((e, i) => (
                        <button key={i} onClick={() => openNodeDetail(e.from)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline block">
                          ← {e.from} <span className="text-gray-400">({e.type})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.downstream.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">下游 ({selectedNode.downstream.length})</p>
                    <div className="space-y-1">
                      {selectedNode.downstream.map((e, i) => (
                        <button key={i} onClick={() => openNodeDetail(e.to)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline block">
                          → {e.to} <span className="text-gray-400">({e.type})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(selectedNode.state_details).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">状态证据</p>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-x-auto text-gray-600 dark:text-gray-300 max-h-48">
                      {JSON.stringify(selectedNode.state_details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
