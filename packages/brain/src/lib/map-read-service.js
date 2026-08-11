import { withConsistentSnapshot } from './consistent-read.js';
import { loadMapImpactRadius } from './map-impact-radius.js';
import { projectMapManifest } from './map-projection-store.js';
import { loadMapRepoAdapters } from './map-repo-adapter.js';
import { loadMapNodeStates } from './map-state-resolver.js';
import { computeFreshness } from './registry-freshness.js';

const REQUIRED_FACT_KINDS = ['api', 'db_schema', 'graph', 'test'];

export class MapReadError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = 'MapReadError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function lexical(left, right) {
  return String(left).localeCompare(String(right));
}

function factKey(fact) {
  return [
    fact.repo,
    fact.fact_kind,
    fact.method ?? '',
    fact.stable_ref,
  ].join('\u0000');
}

export function findUnclaimedFacts(facts, nodes) {
  const claimed = new Set(nodes
    .filter(({ node_type: nodeType }) => nodeType === 'artifact')
    .map(({ attributes = {} }) => factKey({
      repo: attributes.repo,
      fact_kind: attributes.fact_kind,
      stable_ref: attributes.stable_ref,
      method: attributes.method,
    })));
  return facts
    .filter((fact) => !claimed.has(factKey(fact)))
    .sort((left, right) => lexical(factKey(left), factKey(right)));
}

export function summarizeMapFreshness(headers, now, repos) {
  const summary = {};
  for (const repo of repos) {
    const snapshots = REQUIRED_FACT_KINDS.map((kind) => {
      const header = headers.find((item) => item.repo === repo && item.kind === kind) ?? null;
      return { kind, ...computeFreshness(header, now) };
    });
    const revisions = [...new Set(snapshots
      .map(({ source_revision: revision }) => revision)
      .filter(Boolean))];
    const fresh = snapshots.every(({ status }) => status === 'fresh') && revisions.length === 1;
    summary[repo] = {
      status: fresh ? 'fresh' : 'unknown',
      reason_code: fresh ? 'snapshots_fresh' : 'snapshot_incomplete_or_stale',
      source_revision: revisions.length === 1 ? revisions[0] : null,
      snapshots,
    };
  }
  const fresh = repos.length > 0 && Object.values(summary)
    .every(({ status }) => status === 'fresh');
  return {
    status: fresh ? 'fresh' : 'unknown',
    reason_code: fresh ? 'snapshots_fresh' : 'snapshot_incomplete_or_stale',
    repos: summary,
  };
}

export function buildMapEnvelope({
  scopeKey,
  manifestVersion,
  projectionRun,
  freshness,
  now,
}) {
  return {
    scope_key: scopeKey,
    manifest_version: manifestVersion?.version ?? null,
    manifest_digest: manifestVersion?.digest ?? null,
    projection_digest: projectionRun?.projection_digest ?? null,
    fact_revisions: projectionRun?.fact_revisions ?? {},
    generated_at: now.toISOString(),
    freshness,
  };
}

async function loadActiveManifest(client, scopeKey, { optional = false, lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, scope_key, version, source_decision_id, manifest, digest,
            status, created_at, activated_at
       FROM map_manifest_versions
      WHERE scope_key=$1 AND status='active'${lock ? ' FOR KEY SHARE' : ''}`,
    [scopeKey],
  );
  if (!rows[0] && !optional) {
    throw new MapReadError(
      'MAP_MANIFEST_NOT_FOUND',
      `No active map manifest exists for scope ${scopeKey}`,
      404,
    );
  }
  return rows[0] ?? null;
}

async function loadActiveProjection(client, scopeKey, { optional = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, scope_key, manifest_version_id, manifest_digest, fact_revisions,
            projector_version, projection_digest, status, error, created_at, activated_at
       FROM map_projection_runs
      WHERE scope_key=$1 AND status='active'`,
    [scopeKey],
  );
  if (!rows[0] && !optional) {
    throw new MapReadError(
      'MAP_PROJECTION_NOT_FOUND',
      `No active map projection exists for scope ${scopeKey}`,
      404,
    );
  }
  return rows[0] ?? null;
}

async function loadHeaders(client, repos) {
  if (repos.length === 0) return [];
  const { rows } = await client.query(
    `SELECT kind, repo, source_revision, scanner_version, scanned_at, row_count
       FROM fact_snapshot_headers
      WHERE repo=ANY($1::text[])
      ORDER BY repo, kind`,
    [repos],
  );
  return rows;
}

async function loadProjectionGraph(client, runId) {
  const nodes = await client.query(
    `SELECT node_id, node_type, node_key, name, source_refs, attributes
       FROM map_projection_nodes WHERE run_id=$1
      ORDER BY node_type, node_key`,
    [runId],
  );
  const edges = await client.query(
    `SELECT e.edge_id, e.edge_type, e.edge_key, e.from_node_id, e.to_node_id,
            e.source_refs, e.attributes,
            source.node_key AS from_key, target.node_key AS to_key
       FROM map_projection_edges e
       JOIN map_projection_nodes source
         ON source.run_id=e.run_id AND source.node_id=e.from_node_id
       JOIN map_projection_nodes target
         ON target.run_id=e.run_id AND target.node_id=e.to_node_id
      WHERE e.run_id=$1
      ORDER BY e.edge_type, e.edge_key`,
    [runId],
  );
  return { nodes: nodes.rows, edges: edges.rows };
}

function publicNode(node, resolved) {
  return {
    id: node.node_id,
    key: node.node_key,
    type: node.node_type,
    name: node.name,
    source_refs: node.source_refs,
    attributes: node.attributes,
    display_order: node.attributes?.order ?? null,
    state: resolved?.status ?? 'unknown',
    state_reason: resolved?.reason_code ?? 'state_evidence_missing',
    state_details: resolved ?? null,
  };
}

function publicEdge(edge) {
  return {
    id: edge.edge_id,
    key: edge.edge_key,
    from: edge.from_key,
    to: edge.to_key,
    type: edge.edge_type,
    source_refs: edge.source_refs,
    attributes: edge.attributes,
  };
}

async function loadMapContext(client, { scopeKey, now }) {
  const manifestVersion = await loadActiveManifest(client, scopeKey);
  const stateResult = await loadMapNodeStates(client, { scopeKey, now });
  const projectionRun = stateResult.projection_run;
  const adapters = await loadMapRepoAdapters(client, scopeKey);
  const repos = adapters.map(({ repo }) => repo);
  const freshness = summarizeMapFreshness(stateResult.headers, now, repos);
  const graph = await loadProjectionGraph(client, projectionRun.id);
  const stateById = new Map(stateResult.states.map((item) => [item.node_id, item]));
  const nodes = graph.nodes.map((node) => publicNode(node, stateById.get(node.node_id)));
  const edges = graph.edges.map(publicEdge);
  return { manifestVersion, projectionRun, adapters, freshness, nodes, edges };
}

export async function readMap(client, { scopeKey, now }) {
  const context = await loadMapContext(client, { scopeKey, now });
  return {
    ...buildMapEnvelope({ scopeKey, ...context, now }),
    shared_prerequisites: context.manifestVersion.manifest.shared_prerequisites,
    nodes: context.nodes,
    edges: context.edges,
    summary: {
      value_streams: context.nodes.filter(({ type }) => type === 'value_stream').length,
      capabilities: context.nodes.filter(({ type }) => type === 'capability').length,
      boundaries: context.edges.filter(({ type }) => type === 'hands_off_to').length,
      crosscuts: context.nodes.filter(({ type }) => type === 'crosscut').length,
      prerequisites: context.nodes.filter(({ type }) => type === 'prerequisite').length,
    },
  };
}

export async function readNode(client, { scopeKey, nodeKey, now }) {
  const map = await readMap(client, { scopeKey, now });
  const node = map.nodes.find((item) => (
    item.key === nodeKey || item.attributes?.aliases?.includes(nodeKey)
  ));
  if (!node) {
    throw new MapReadError('MAP_NODE_NOT_FOUND', `Map node does not exist: ${nodeKey}`, 404);
  }
  const upstream = map.edges.filter(({ to }) => to === node.key);
  const downstream = map.edges.filter(({ from }) => from === node.key);
  const boundaries = [...upstream, ...downstream]
    .filter(({ type }) => type === 'hands_off_to');
  const servedNodes = downstream
    .filter(({ type }) => type === 'serves')
    .map(({ to }) => map.nodes.find(({ key }) => key === to))
    .filter(Boolean);
  return {
    ...Object.fromEntries(Object.entries(map).filter(([key]) => (
      !['nodes', 'edges', 'summary', 'shared_prerequisites'].includes(key)
    ))),
    node,
    upstream,
    downstream,
    boundaries,
    affected_nodes: servedNodes,
  };
}

export async function readRadius(client, input) {
  const { scopeKey, now } = input;
  const manifestVersion = await loadActiveManifest(client, scopeKey);
  const projectionRun = await loadActiveProjection(client, scopeKey);
  const adapters = await loadMapRepoAdapters(client, scopeKey);
  const headers = await loadHeaders(client, adapters.map(({ repo }) => repo));
  const freshness = summarizeMapFreshness(headers, now, adapters.map(({ repo }) => repo));
  const radius = await loadMapImpactRadius(client, input);
  return {
    ...buildMapEnvelope({ scopeKey, manifestVersion, projectionRun, freshness, now }),
    ...radius,
    freshness,
  };
}

export async function readHealth(client, { scopeKey, now }) {
  const manifestVersion = await loadActiveManifest(client, scopeKey, { optional: true });
  const projectionRun = await loadActiveProjection(client, scopeKey, { optional: true });
  const adapters = await loadMapRepoAdapters(client, scopeKey).catch(() => []);
  const headers = await loadHeaders(client, adapters.map(({ repo }) => repo));
  const freshness = summarizeMapFreshness(headers, now, adapters.map(({ repo }) => repo));
  let stateStatus = 'degraded';
  if (manifestVersion && projectionRun) {
    try {
      await loadMapNodeStates(client, { scopeKey, now });
      stateStatus = 'ok';
    } catch {
      stateStatus = 'degraded';
    }
  }
  const layers = {
    manifest: { status: manifestVersion ? 'ok' : 'missing' },
    facts: { status: freshness.status === 'fresh' ? 'ok' : 'degraded' },
    projection: { status: projectionRun ? 'ok' : 'missing' },
    state_resolver: { status: stateStatus },
  };
  const healthy = Object.values(layers).every(({ status }) => status === 'ok');
  return {
    ...buildMapEnvelope({ scopeKey, manifestVersion, projectionRun, freshness, now }),
    overall: healthy ? 'healthy' : 'degraded',
    layers,
  };
}

async function loadAllFacts(client, repos) {
  const tests = await client.query(
    'SELECT repo, file_path AS stable_ref FROM test_registry WHERE repo=ANY($1::text[])',
    [repos],
  );
  const apis = await client.query(
    'SELECT repo, method, path AS stable_ref FROM api_registry WHERE repo=ANY($1::text[])',
    [repos],
  );
  const schemas = await client.query(
    'SELECT repo, table_name AS stable_ref FROM db_schema_registry WHERE repo=ANY($1::text[])',
    [repos],
  );
  const graph = await client.query(
    `SELECT DISTINCT repo, stable_ref FROM (
       SELECT repo, src_path AS stable_ref FROM graph_edges WHERE repo=ANY($1::text[])
       UNION
       SELECT repo, dst_path AS stable_ref FROM graph_edges WHERE repo=ANY($1::text[])
     ) facts WHERE stable_ref IS NOT NULL`,
    [repos],
  );
  return [
    ...tests.rows.map((fact) => ({ ...fact, fact_kind: 'test' })),
    ...apis.rows.map((fact) => ({ ...fact, fact_kind: 'api' })),
    ...schemas.rows.map((fact) => ({ ...fact, fact_kind: 'db_schema' })),
    ...graph.rows.map((fact) => ({ ...fact, fact_kind: 'graph' })),
  ];
}

export async function readUnclaimed(client, { scopeKey, now }) {
  const manifestVersion = await loadActiveManifest(client, scopeKey);
  const projectionRun = await loadActiveProjection(client, scopeKey);
  const adapters = await loadMapRepoAdapters(client, scopeKey);
  const repos = adapters.map(({ repo }) => repo);
  const headers = await loadHeaders(client, repos);
  const freshness = summarizeMapFreshness(headers, now, repos);
  const { nodes } = await loadProjectionGraph(client, projectionRun.id);
  const facts = await loadAllFacts(client, repos);
  const unclaimed = findUnclaimedFacts(facts, nodes);
  return {
    ...buildMapEnvelope({ scopeKey, manifestVersion, projectionRun, freshness, now }),
    unclaimed_count: unclaimed.length,
    unclaimed,
  };
}

export async function rebuild(pool, { scopeKey, now }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const manifestVersion = await loadActiveManifest(client, scopeKey, { lock: true });
    const result = await projectMapManifest({ client, manifestVersion, mode: 'rebuild' });
    const adapters = await loadMapRepoAdapters(client, scopeKey);
    const repos = adapters.map(({ repo }) => repo);
    const headers = await loadHeaders(client, repos);
    const freshness = summarizeMapFreshness(headers, now, repos);
    await client.query('COMMIT');
    return {
      ...buildMapEnvelope({
        scopeKey,
        manifestVersion,
        projectionRun: result.projection_run,
        freshness,
        now,
      }),
      rebuilt: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const mapReadServices = {
  readMap,
  readNode,
  readRadius,
  readHealth,
  readUnclaimed,
  rebuild,
};

export async function runConsistentMapRead(pool, reader) {
  return withConsistentSnapshot(pool, reader);
}
