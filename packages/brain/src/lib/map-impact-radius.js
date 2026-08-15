import {
  buildAdjacency,
  isTestPath,
  normalizePath,
  reachable,
} from './graph-query.js';
import { loadMapRepoAdapters } from './map-repo-adapter.js';
import { computeFreshness } from './registry-freshness.js';

export class MapImpactRadiusError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MapImpactRadiusError';
    this.code = code;
    this.details = details;
  }
}

function lexical(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(lexical);
}

function traverseBusiness(startIds, edges, mode) {
  const reached = new Set(startIds);
  let frontier = [...startIds];
  while (frontier.length > 0) {
    const next = [];
    for (const nodeId of frontier) {
      const neighbors = [];
      for (const edge of edges) {
        if (mode === 'crosscut') {
          if (edge.from_node_id === nodeId && ['serves', 'contains'].includes(edge.edge_type)) {
            neighbors.push(edge.to_node_id);
          }
        } else {
          if (edge.from_node_id === nodeId
            && ['implements', 'proves', 'affects'].includes(edge.edge_type)) {
            neighbors.push(edge.to_node_id);
          }
          if (edge.to_node_id === nodeId
            && ['contains', 'serves', 'implements', 'proves', 'affects'].includes(edge.edge_type)) {
            neighbors.push(edge.from_node_id);
          }
        }
      }
      for (const neighbor of neighbors) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return reached;
}

export function computeMapImpactRadius({
  repo,
  changedFiles = [],
  startNodeKeys = [],
  graphEdges = [],
  nodes = [],
  edges = [],
  maxDepth = 10,
}) {
  const repoGraphEdges = graphEdges.filter((edge) => edge.repo === repo);
  const normalizedFiles = uniqueSorted(changedFiles.map(normalizePath).filter(Boolean));
  const reachedFiles = uniqueSorted(reachable(
    buildAdjacency(repoGraphEdges),
    normalizedFiles,
    { dir: 'rev', maxDepth },
  ));
  const reachedFileSet = new Set(reachedFiles);
  const artifacts = nodes.filter((node) => (
    node.node_type === 'artifact'
    && node.attributes?.repo === repo
    && reachedFileSet.has(normalizePath(node.attributes?.stable_ref))
  ));
  const nodeByKey = new Map(nodes.map((node) => [node.node_key, node]));
  const explicitStarts = uniqueSorted(startNodeKeys)
    .map((nodeKey) => nodeByKey.get(nodeKey))
    .filter(Boolean);

  const impacted = traverseBusiness(
    artifacts.map(({ node_id: nodeId }) => nodeId),
    edges,
    'artifact',
  );
  for (const start of explicitStarts) {
    const mode = start.node_type === 'crosscut' ? 'crosscut' : 'artifact';
    for (const nodeId of traverseBusiness([start.node_id], edges, mode)) impacted.add(nodeId);
  }

  const impactedFeatureIds = new Set(nodes
    .filter((node) => node.node_type === 'feature' && impacted.has(node.node_id))
    .map(({ node_id: nodeId }) => nodeId));
  const assertionIds = new Set(nodes
    .filter((node) => node.node_type === 'assertion' && impacted.has(node.node_id))
    .map(({ node_id: nodeId }) => nodeId));
  for (const edge of edges) {
    if (edge.edge_type === 'proves' && impactedFeatureIds.has(edge.to_node_id)) {
      assertionIds.add(edge.from_node_id);
    }
  }
  const businessTypes = new Set([
    'value_stream', 'capability', 'crosscut', 'prerequisite', 'backbone', 'feature',
  ]);
  const affectedBusinessNodes = nodes
    .filter((node) => impacted.has(node.node_id) && businessTypes.has(node.node_type))
    .map(({ node_id, node_type, node_key, name }) => ({ node_id, node_type, node_key, name }))
    .sort((left, right) => lexical(left.node_key, right.node_key));
  const mustRunAssertions = nodes
    .filter((node) => assertionIds.has(node.node_id))
    .map((node) => ({
      node_key: node.node_key,
      assertion_ref: node.attributes?.assertion_ref ?? null,
      assertion_revision: Number(node.attributes?.assertion_revision),
      journey_step_link_id: node.node_key,
    }))
    .filter(({ assertion_ref: assertionRef }) => Boolean(assertionRef))
    .sort((left, right) => lexical(left.node_key, right.node_key));

  return {
    repo,
    input_files: normalizedFiles,
    reached_files: reachedFiles,
    affected_tests: reachedFiles.filter(isTestPath),
    affected_artifacts: artifacts
      .map((node) => ({
        node_id: node.node_id,
        node_key: node.node_key,
        stable_ref: node.attributes.stable_ref,
      }))
      .sort((left, right) => lexical(left.node_id, right.node_id)),
    affected_business_nodes: affectedBusinessNodes,
    must_run_assertions: mustRunAssertions,
  };
}

export async function loadMapImpactRadius(client, {
  scopeKey,
  repo,
  changedFiles = [],
  startNodeKeys = [],
  maxDepth = 10,
  now = new Date(),
  projectionRunId = null,
}) {
  if (!client?.query) {
    throw new MapImpactRadiusError(
      'MAP_RADIUS_CLIENT_INVALID',
      'Map impact radius requires a PostgreSQL client',
    );
  }
  const adapters = await loadMapRepoAdapters(client, scopeKey);
  if (!adapters.some((adapter) => adapter.repo === repo)) {
    throw new MapImpactRadiusError(
      'MAP_RADIUS_REPO_NOT_CONFIGURED',
      `Repository ${repo} is not configured for map scope ${scopeKey}`,
      { scope_key: scopeKey, repo },
    );
  }
  const { rows: runs } = await client.query(
    `SELECT id, scope_key, fact_revisions, projection_digest, activated_at
       FROM map_projection_runs
      WHERE scope_key=$1
        ${projectionRunId ? 'AND id=$2' : "AND status='active'"}`,
    projectionRunId ? [scopeKey, projectionRunId] : [scopeKey],
  );
  if (!runs[0]) {
    throw new MapImpactRadiusError(
      'MAP_RADIUS_PROJECTION_NOT_FOUND',
      `No active map projection exists for scope ${scopeKey}`,
      { scope_key: scopeKey },
    );
  }
  const run = runs[0];
  const { rows: nodes } = await client.query(
    `SELECT node_id, node_type, node_key, name, source_refs, attributes
       FROM map_projection_nodes WHERE run_id=$1 ORDER BY node_id`,
    [run.id],
  );
  const { rows: edges } = await client.query(
    `SELECT edge_id, edge_type, edge_key, from_node_id, to_node_id, source_refs, attributes
       FROM map_projection_edges WHERE run_id=$1 ORDER BY edge_id`,
    [run.id],
  );
  const projectionRevision = run.fact_revisions?.[repo] ?? null;
  if (typeof projectionRevision !== 'string' || projectionRevision.trim() === '') {
    throw new MapImpactRadiusError(
      'MAP_RADIUS_GRAPH_SNAPSHOT_NOT_FOUND',
      `Projection ${run.id} has no graph fact revision for repository ${repo}`,
      { scope_key: scopeKey, repo, projection_run_id: run.id },
    );
  }
  const { rows: snapshotRows } = await client.query(
    `SELECT snapshot.source_revision AS snapshot_revision,
            snapshot.scanner_version, snapshot.scanned_at, snapshot.row_count,
            edge.repo, edge.src_path, edge.dst_path, edge.edge_type
       FROM graph_snapshot_versions AS snapshot
       LEFT JOIN graph_edge_snapshots AS edge
         ON edge.repo=snapshot.repo
        AND edge.source_revision=snapshot.source_revision
      WHERE snapshot.repo=$1 AND snapshot.source_revision=$2
      ORDER BY edge.src_path, edge.dst_path, edge.edge_type`,
    [repo, projectionRevision],
  );
  const snapshot = snapshotRows[0];
  if (!snapshot || snapshot.snapshot_revision !== projectionRevision) {
    throw new MapImpactRadiusError(
      'MAP_RADIUS_GRAPH_SNAPSHOT_NOT_FOUND',
      `No immutable graph snapshot exists for repository ${repo} at ${projectionRevision}`,
      {
        scope_key: scopeKey,
        repo,
        projection_run_id: run.id,
        projection_source_revision: projectionRevision,
      },
    );
  }
  const graphEdges = snapshotRows
    .filter((row) => row.src_path !== null && row.dst_path !== null)
    .map((row) => ({
      repo,
      src_path: row.src_path,
      dst_path: row.dst_path,
      edge_type: row.edge_type,
    }));
  const expectedEdgeCount = Number(snapshot.row_count);
  if (!Number.isInteger(expectedEdgeCount) || expectedEdgeCount !== graphEdges.length) {
    throw new MapImpactRadiusError(
      'MAP_RADIUS_GRAPH_SNAPSHOT_INCOMPLETE',
      `Immutable graph snapshot ${repo}@${projectionRevision} is incomplete`,
      {
        scope_key: scopeKey,
        repo,
        projection_run_id: run.id,
        projection_source_revision: projectionRevision,
        expected_edge_count: expectedEdgeCount,
        actual_edge_count: graphEdges.length,
      },
    );
  }
  const freshness = computeFreshness({
    kind: 'graph',
    repo,
    source_revision: snapshot.snapshot_revision,
    scanner_version: snapshot.scanner_version,
    scanned_at: snapshot.scanned_at,
    row_count: snapshot.row_count,
  }, now);
  const radius = computeMapImpactRadius({
    repo,
    changedFiles,
    startNodeKeys,
    graphEdges,
    nodes,
    edges,
    maxDepth,
  });
  return {
    scope_key: scopeKey,
    projection_run_id: run.id,
    projection_digest: run.projection_digest,
    fact_revisions: run.fact_revisions,
    projection_source_revision: projectionRevision,
    freshness,
    ...radius,
  };
}
