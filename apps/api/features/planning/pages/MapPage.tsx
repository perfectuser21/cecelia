import { useCallback, useEffect, useMemo, useState } from 'react';

type MapState = 'green' | 'red' | 'gray' | 'unknown' | 'not_applicable';

interface MapNode {
  key: string;
  type: string;
  name: string;
  display_order: number | null;
  attributes: Record<string, unknown>;
  state: MapState;
  state_reason: string | null;
  state_details?: Record<string, unknown> | null;
}

interface MapEdge {
  from: string;
  to: string;
  type: string;
  attributes: Record<string, unknown>;
}

interface Envelope {
  scope_key: string;
  manifest_version: number;
  manifest_digest: string;
  projection_digest: string;
  fact_revisions: Record<string, string>;
  generated_at: string;
  freshness: { status: string; reason_code?: string };
}

interface MapResponse extends Envelope {
  shared_prerequisites: { applicable: boolean; reason?: string };
  nodes: MapNode[];
  edges: MapEdge[];
  summary: {
    value_streams: number;
    capabilities: number;
    boundaries: number;
    crosscuts: number;
    prerequisites: number;
  };
}

interface NodeResponse extends Envelope {
  node: MapNode;
  upstream: MapEdge[];
  downstream: MapEdge[];
  boundaries: MapEdge[];
  affected_nodes: MapNode[];
}

const stateStyles: Record<MapState, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-slate-100 text-slate-600',
  unknown: 'bg-amber-100 text-amber-800',
  not_applicable: 'bg-slate-100 text-slate-500',
};

function short(value: string | null | undefined) {
  return value ? value.slice(0, 12) : '—';
}

function compareNodes(left: MapNode, right: MapNode) {
  return (left.display_order ?? Number.MAX_SAFE_INTEGER)
    - (right.display_order ?? Number.MAX_SAFE_INTEGER)
    || left.key.localeCompare(right.key);
}

function StateBadge({ node }: { node: MapNode }) {
  return (
    <span className={`inline-flex flex-col rounded px-2 py-1 text-xs ${stateStyles[node.state]}`}>
      <span>{node.state}</span>
      {node.state !== 'green' && node.state_reason && <span>{node.state_reason}</span>}
    </span>
  );
}

function NodeButton({ node, onClick }: { node: MapNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${node.key} ${node.name}`}
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900"
    >
      <span>
        <span className="block font-mono text-xs text-slate-500">{node.key}</span>
        <span className="font-medium text-slate-900 dark:text-white">{node.name}</span>
      </span>
      <StateBadge node={node} />
    </button>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function collectDescendants(root: string, edges: MapEdge[], nodes: MapNode[]) {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const found = new Map<string, MapNode>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges.filter(({ from }) => from === current)) {
      const child = nodeByKey.get(edge.to);
      if (child && !found.has(child.key)) {
        found.set(child.key, child);
        queue.push(child.key);
      }
    }
  }
  return [...found.values()].sort(compareNodes);
}

export default function MapPage() {
  const [scope, setScope] = useState('cecelia');
  const [scopeInput, setScopeInput] = useState('cecelia');
  const [map, setMap] = useState<MapResponse | null>(null);
  const [health, setHealth] = useState<string>('读取中');
  const [selectedCapability, setSelectedCapability] = useState<NodeResponse | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<NodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMap = useCallback(async (nextScope: string) => {
    setError(null);
    setSelectedCapability(null);
    setSelectedEvidence(null);
    try {
      const [mapResult, healthResult] = await Promise.all([
        getJson<MapResponse>(`/api/brain/map?scope=${encodeURIComponent(nextScope)}`),
        getJson<{ overall: string }>(`/api/brain/map/health?scope=${encodeURIComponent(nextScope)}`),
      ]);
      setMap(mapResult);
      setHealth(healthResult.overall);
    } catch (loadError) {
      setMap(null);
      setHealth('degraded');
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => { void loadMap(scope); }, [loadMap, scope]);

  const openNode = useCallback(async (node: MapNode, level: 2 | 3) => {
    try {
      const detail = await getJson<NodeResponse>(
        `/api/brain/map/nodes/${encodeURIComponent(node.key)}?scope=${encodeURIComponent(scope)}`,
      );
      if (level === 2) {
        setSelectedCapability(detail);
        setSelectedEvidence(null);
      } else {
        setSelectedEvidence(detail);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [scope]);

  const streams = useMemo(() => map?.nodes.filter(({ type }) => type === 'value_stream').sort(compareNodes) ?? [], [map]);
  const capabilities = useMemo(() => map?.nodes.filter(({ type }) => type === 'capability').sort(compareNodes) ?? [], [map]);
  const crosscuts = useMemo(() => map?.nodes.filter(({ type }) => type === 'crosscut').sort(compareNodes) ?? [], [map]);
  const descendants = useMemo(() => (
    map && selectedCapability
      ? collectDescendants(selectedCapability.node.key, map.edges, map.nodes)
      : []
  ), [map, selectedCapability]);

  const capabilityForStream = useCallback((stream: MapNode) => {
    if (!map) return [];
    const directlyContained = new Set(map.edges
      .filter(({ from, type }) => from === stream.key && ['contains', 'owns'].includes(type))
      .map(({ to }) => to));
    const attributed = capabilities.filter(({ attributes }) => (
      attributes.value_stream_key === stream.key || attributes.value_stream === stream.key
    ));
    const selected = capabilities.filter(({ key }) => directlyContained.has(key));
    return [...new Map([...selected, ...attributed].map((node) => [node.key, node])).values()]
      .sort(compareNodes);
  }, [capabilities, map]);

  const ungroupedCapabilities = useMemo(() => {
    const grouped = new Set(streams.flatMap((stream) => capabilityForStream(stream).map(({ key }) => key)));
    return capabilities.filter(({ key }) => !grouped.has(key));
  }, [capabilities, capabilityForStream, streams]);

  const receipt = selectedEvidence?.node.state_details?.receipt as Record<string, unknown> | undefined;

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold">通用地图</h1>
          <p className="mt-1 text-sm text-slate-500">Manifest → Repo 事实 → 确定性投影 → 查询时状态</p>
        </div>
        <form
          className="ml-auto flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (scopeInput.trim()) setScope(scopeInput.trim());
          }}
        >
          <label className="sr-only" htmlFor="map-scope">Scope</label>
          <input id="map-scope" value={scopeInput} onChange={(event) => setScopeInput(event.target.value)} className="rounded border px-3 py-2 dark:bg-slate-900" />
          <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">加载</button>
        </form>
      </header>

      {error && <div role="alert" className="mb-5 rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}

      {map && (
        <>
          <section aria-label="投影元数据" className="mb-6 grid gap-3 rounded-xl border bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900 md:grid-cols-3 lg:grid-cols-6">
            <span>Manifest v{map.manifest_version}</span>
            <span>投影 {short(map.projection_digest)}</span>
            {Object.entries(map.fact_revisions).map(([repo, sha]) => <span key={repo}>{repo} {short(sha)}</span>)}
            <span>{map.freshness.status === 'fresh' ? '新鲜' : map.freshness.reason_code ?? 'unknown'}</span>
            <span>健康度 {health}</span>
            <span>生成于 {map.generated_at}</span>
          </section>

          <section className="mb-6 flex flex-wrap gap-3 text-sm">
            <span>{map.summary.value_streams} 条价值流</span>
            <span>{map.summary.capabilities} 个 Capability</span>
            <span>{map.summary.boundaries} 条边界</span>
            <span>{map.summary.crosscuts} 项横切件</span>
            <span>{map.summary.prerequisites} 项共享前置</span>
          </section>

          <section aria-labelledby="level-one" className="mb-8">
            <h2 id="level-one" className="mb-3 text-lg font-semibold">Level 1 · 价值流与 Capability</h2>
            <div className="grid gap-5 xl:grid-cols-2">
              {streams.map((stream) => (
                <article key={stream.key} className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <h3 className="mb-3 flex items-center justify-between font-semibold"><span>{stream.name}</span><StateBadge node={stream} /></h3>
                  <div className="space-y-2">
                    {capabilityForStream(stream).map((node) => <NodeButton key={node.key} node={node} onClick={() => void openNode(node, 2)} />)}
                  </div>
                </article>
              ))}
            </div>
            {ungroupedCapabilities.length > 0 && (
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {ungroupedCapabilities.map((node) => <NodeButton key={node.key} node={node} onClick={() => void openNode(node, 2)} />)}
              </div>
            )}
          </section>

          <section className="mb-8 grid gap-5 lg:grid-cols-2">
            <article className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <h2 className="mb-3 text-lg font-semibold">横切件</h2>
              <div className="space-y-2">{crosscuts.map((node) => <NodeButton key={node.key} node={node} onClick={() => void openNode(node, 3)} />)}</div>
            </article>
            <article className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <h2 className="mb-3 text-lg font-semibold">边界与共享前置</h2>
              <p className="font-medium">共享前置：{map.shared_prerequisites.applicable ? '适用' : '不适用'}</p>
              {map.shared_prerequisites.reason && <p className="mt-1 text-sm text-slate-500">{map.shared_prerequisites.reason}</p>}
              <ul className="mt-4 space-y-2 text-sm">
                {map.edges.filter(({ type }) => type === 'hands_off_to').map((edge) => (
                  <li key={`${edge.from}-${edge.to}`}>{edge.from} → {edge.to}：{String(edge.attributes.statement ?? edge.attributes.description ?? '边界交接')}</li>
                ))}
              </ul>
            </article>
          </section>

          {selectedCapability && (
            <section className="mb-8 rounded-xl border-2 border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30">
              <h2 className="mb-4 text-lg font-semibold">Level 2 · {selectedCapability.node.name}</h2>
              <div className="grid gap-5 lg:grid-cols-3">
                {['backbone', 'feature', 'assertion'].map((type) => (
                  <article key={type}>
                    <h3 className="mb-2 font-mono text-sm uppercase">{type}</h3>
                    <div className="space-y-2">
                      {descendants.filter((node) => node.type === type).map((node) => (
                        type === 'assertion'
                          ? <NodeButton key={node.key} node={node} onClick={() => void openNode(node, 3)} />
                          : <NodeButton key={node.key} node={node} onClick={() => undefined} />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <h3 className="mb-2 mt-5 font-semibold">事实锚点</h3>
              <ul className="space-y-1 text-sm">
                {descendants.filter(({ type }) => type === 'artifact').map((node) => <li key={node.key}>{String(node.attributes.stable_ref ?? node.name)}</li>)}
              </ul>
              <h3 className="mb-2 mt-5 font-semibold">相关边界</h3>
              <ul className="space-y-1 text-sm">
                {selectedCapability.boundaries.map((edge) => <li key={`${edge.from}-${edge.to}`}>{String(edge.attributes.statement ?? `${edge.from} → ${edge.to}`)}</li>)}
              </ul>
            </section>
          )}

          {selectedEvidence && (
            <section className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <h2 className="mb-4 text-lg font-semibold">Level 3 · 验收证据</h2>
              <dl className="grid gap-3 text-sm md:grid-cols-2">
                <div><dt className="text-slate-500">Assertion</dt><dd>{selectedEvidence.node.key} · {selectedEvidence.node.name}</dd></div>
                <div><dt className="text-slate-500">Verdict</dt><dd>{String(receipt?.verdict ?? selectedEvidence.node.state)}</dd></div>
                <div><dt className="text-slate-500">Reason code</dt><dd>{String(selectedEvidence.node.state_details?.reason_code ?? selectedEvidence.node.state_reason ?? 'unknown')}</dd></div>
                <div><dt className="text-slate-500">Revision</dt><dd className="break-all font-mono">{String(receipt?.source_sha ?? map.fact_revisions.cecelia ?? 'unknown')}</dd></div>
                <div><dt className="text-slate-500">Completed at</dt><dd>{String(receipt?.completed_at ?? 'unknown')}</dd></div>
              </dl>
            </section>
          )}
        </>
      )}
    </main>
  );
}
