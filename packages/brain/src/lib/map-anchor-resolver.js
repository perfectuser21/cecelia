import { loadMapRepoAdapters } from './map-repo-adapter.js';
import { stableMapEdgeId, stableMapNodeId } from './map-projector.js';

const SUPPORTED_LEDGER_ADAPTER = 'legacy-ledger-v1';

function normalizePath(value) {
  return value.trim().replace(/^\.\//, '').split('#', 1)[0];
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sourceRef(source, id, field = undefined) {
  return [{ source, id, ...(field ? { field } : {}) }];
}

function mapNode(scopeKey, nodeType, nodeKey, name, refs, attributes) {
  return {
    node_id: stableMapNodeId(scopeKey, nodeType, nodeKey),
    node_type: nodeType,
    node_key: nodeKey,
    name,
    source_refs: refs,
    attributes,
  };
}

function mapEdge(scopeKey, edgeType, edgeKey, fromNodeId, toNodeId, refs, attributes = {}) {
  return {
    edge_id: stableMapEdgeId(scopeKey, edgeType, edgeKey),
    edge_type: edgeType,
    edge_key: edgeKey,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    source_refs: refs,
    attributes,
  };
}

function candidateKey(candidate) {
  if (candidate.kind === 'api') {
    return `${candidate.repo}:api:${candidate.method ?? '*'} ${candidate.identifier}`;
  }
  return `${candidate.repo}:${candidate.kind}:${candidate.identifier}`;
}

function buildFactIndex(facts) {
  const tests = (facts.tests ?? []).map((row) => ({
    repo: row.repo, kind: 'test', identifier: normalizePath(row.file_path), exists: true,
  }));
  const apis = (facts.apis ?? []).map((row) => ({
    repo: row.repo, kind: 'api', method: row.method, identifier: row.path, exists: true,
  }));
  const dbSchemas = (facts.dbSchemas ?? []).map((row) => ({
    repo: row.repo, kind: 'db_schema', identifier: row.table_name, exists: true,
  }));
  const graphFiles = (facts.graphEdges ?? []).flatMap((row) => [row.src_path, row.dst_path]
    .filter(Boolean)
    .map((path) => ({
      repo: row.repo, kind: 'graph', identifier: normalizePath(path), exists: true,
    })));
  return { tests, apis, dbSchemas, graphFiles };
}

function parseExplicitAnchor(field, rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return null;
  const value = rawValue.trim();
  if (field === 'unit_test_path') {
    return { kind: 'test', identifier: normalizePath(value), field };
  }
  if (value.startsWith('test:')) {
    return { kind: 'test', identifier: normalizePath(value.slice(5)), field };
  }
  if (value.startsWith('db:')) {
    return { kind: 'db_schema', identifier: value.slice(3).trim(), field };
  }
  if (value.startsWith('api:')) {
    const match = value.slice(4).trim().match(/^([A-Z]+)\s+(.+)$/);
    return match
      ? { kind: 'api', method: match[1], identifier: match[2], field }
      : { kind: 'api', identifier: value.slice(4).trim(), field };
  }
  if (value.startsWith('probe:')) {
    try {
      return { kind: 'api', identifier: new URL(value.slice(6)).pathname, field };
    } catch {
      return { kind: 'invalid', identifier: value, field };
    }
  }
  if (value.startsWith('script:')) {
    return { kind: 'graph', identifier: normalizePath(value.slice(7)), field };
  }
  if (field === 'workflow_ref' || field === 'guard_ref') {
    return { kind: 'graph', identifier: normalizePath(value), field };
  }
  return { kind: 'test', identifier: normalizePath(value), field };
}

function candidatesFor(anchor, index) {
  if (anchor.kind === 'test') {
    return index.tests.filter(({ identifier }) => identifier === anchor.identifier);
  }
  if (anchor.kind === 'api') {
    return index.apis.filter((candidate) => (
      candidate.identifier === anchor.identifier
      && (!anchor.method || candidate.method === anchor.method)
    ));
  }
  if (anchor.kind === 'db_schema') {
    return index.dbSchemas.filter(({ identifier }) => identifier === anchor.identifier);
  }
  if (anchor.kind === 'graph') {
    const byIdentity = new Map(index.graphFiles
      .filter(({ identifier }) => identifier === anchor.identifier)
      .map((candidate) => [candidateKey(candidate), candidate]));
    return [...byIdentity.values()];
  }
  return [];
}

function missingCandidate(anchor, repoAdapters) {
  if (repoAdapters.length !== 1 || anchor.kind === 'invalid') return null;
  return {
    repo: repoAdapters[0].repo,
    kind: anchor.kind,
    method: anchor.method,
    identifier: anchor.identifier,
    exists: false,
  };
}

function resolveAnchorTarget(anchor, index, repoAdapters) {
  const candidates = candidatesFor(anchor, index);
  if (candidates.length === 1) return { candidate: candidates[0] };
  if (candidates.length === 0) {
    const missing = missingCandidate(anchor, repoAdapters);
    if (missing) return { candidate: missing };
  }
  return {
    issue: {
      reason_code: anchor.kind === 'invalid' ? 'invalid_anchor' : 'ambiguous_anchor',
      anchor: anchor.identifier,
      field: anchor.field,
      candidates: uniqueSorted(candidates.map(candidateKey)),
    },
  };
}

function factRevisions(headers, repoAdapters) {
  const result = {};
  for (const { repo } of repoAdapters) {
    const revisions = uniqueSorted((headers ?? [])
      .filter((header) => header.repo === repo)
      .map((header) => header.source_revision)
      .filter(Boolean));
    if (revisions.length === 1) result[repo] = revisions[0];
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function dedupeAndSort(items, idField) {
  const byId = new Map(items.map((item) => [item[idField], item]));
  return [...byId.values()].sort((left, right) => left[idField].localeCompare(right[idField]));
}

export function resolveMapAnchors({
  scopeKey,
  capabilityKeys,
  repoAdapters,
  features,
  facts,
}) {
  const capabilities = new Set(capabilityKeys);
  const index = buildFactIndex(facts);
  const nodes = [];
  const edges = [];
  const issues = [];

  for (const feature of [...features].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!capabilities.has(feature.capability_key)) {
      issues.push({
        reason_code: 'capability_not_in_manifest',
        feature_id: feature.id,
        capability_key: feature.capability_key,
      });
      continue;
    }
    const featureRefs = sourceRef('legacy-ledger', feature.id);
    const featureNode = mapNode(
      scopeKey,
      'feature',
      feature.id,
      feature.name,
      featureRefs,
      { capability_key: feature.capability_key },
    );
    nodes.push(featureNode);
    edges.push(mapEdge(
      scopeKey,
      'implements',
      `${feature.id}:${feature.capability_key}`,
      featureNode.node_id,
      stableMapNodeId(scopeKey, 'capability', feature.capability_key),
      featureRefs,
    ));

    const artifactsByKey = new Map();
    for (const field of ['unit_test_path', 'workflow_ref', 'guard_ref']) {
      const anchor = parseExplicitAnchor(field, feature[field]);
      if (!anchor) continue;
      const resolved = resolveAnchorTarget(anchor, index, repoAdapters);
      if (resolved.issue) {
        issues.push({ ...resolved.issue, feature_id: feature.id });
        continue;
      }
      const candidate = resolved.candidate;
      const key = candidateKey(candidate);
      let artifact = artifactsByKey.get(key);
      if (!artifact) {
        artifact = mapNode(
          scopeKey,
          'artifact',
          key,
          candidate.kind === 'api'
            ? `${candidate.method ?? '*'} ${candidate.identifier}`
            : candidate.identifier,
          [{ source: 'fact-snapshot', repo: candidate.repo, kind: candidate.kind }],
          {
            repo: candidate.repo,
            fact_kind: candidate.kind,
            stable_ref: candidate.identifier,
            ...(candidate.method ? { method: candidate.method } : {}),
            target_exists: candidate.exists,
          },
        );
        artifactsByKey.set(key, artifact);
        nodes.push(artifact);
        edges.push(mapEdge(
          scopeKey,
          'implements',
          `${key}:${feature.id}`,
          artifact.node_id,
          featureNode.node_id,
          sourceRef('legacy-ledger', feature.id, field),
        ));
      }
    }

    for (const assertion of [...(feature.assertions ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const assertionRefs = sourceRef('journey-step-link', assertion.id, 'assertion_ref');
      const assertionAnchor = parseExplicitAnchor('assertion_ref', assertion.assertion_ref);
      let target = null;
      if (assertionAnchor && !assertion.assertion_ref.startsWith('manual:')) {
        const resolved = resolveAnchorTarget(assertionAnchor, index, repoAdapters);
        if (resolved.issue) issues.push({ ...resolved.issue, assertion_id: assertion.id });
        else target = resolved.candidate;
      }
      const assertionNode = mapNode(
        scopeKey,
        'assertion',
        assertion.id,
        assertion.assertion_ref || `assertion:${assertion.id}`,
        assertionRefs,
        {
          feature_id: feature.id,
          assertion_ref: assertion.assertion_ref,
          assertion_revision: assertion.assertion_revision,
          na_reason: assertion.na_reason,
          target_exists: target?.exists ?? false,
          ...(target ? {
            repo: target.repo,
            fact_kind: target.kind,
            stable_ref: target.identifier,
          } : {}),
        },
      );
      nodes.push(assertionNode);
      edges.push(mapEdge(
        scopeKey,
        'proves',
        `${assertion.id}:${feature.id}`,
        assertionNode.node_id,
        featureNode.node_id,
        assertionRefs,
      ));
      if (target) {
        const key = candidateKey(target);
        const artifact = artifactsByKey.get(key);
        if (artifact) {
          edges.push(mapEdge(
            scopeKey,
            'affects',
            `${key}:${assertion.id}`,
            artifact.node_id,
            assertionNode.node_id,
            assertionRefs,
          ));
        }
      }
    }
  }

  return {
    nodes: dedupeAndSort(nodes, 'node_id'),
    edges: dedupeAndSort(edges, 'edge_id'),
    issues: issues.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    fact_revisions: factRevisions(facts.headers, repoAdapters),
  };
}

async function loadLedgerFeatures(client, scopeKey, capabilityKeys) {
  const { rows: features } = await client.query(
    `SELECT f.id, f.name, f.unit_test_path, f.workflow_ref, f.guard_ref,
            j.capability_code AS capability_key
       FROM journey_features f
       JOIN journeys j ON j.id = f.journey_id
      WHERE j.biz_area = $1
        AND j.capability_code = ANY($2::text[])
      ORDER BY f.id ASC`,
    [scopeKey, capabilityKeys],
  );
  const { rows: assertions } = await client.query(
    `SELECT l.id, l.feature_id, l.assertion_ref, l.assertion_revision, l.na_reason
       FROM journey_step_links l
       JOIN journey_features f ON f.id = l.feature_id
       JOIN journeys j ON j.id = f.journey_id
      WHERE j.biz_area = $1
        AND j.capability_code = ANY($2::text[])
        AND l.assertion_ref IS NOT NULL
      ORDER BY l.id ASC`,
    [scopeKey, capabilityKeys],
  );
  const byFeature = new Map();
  for (const assertion of assertions) {
    const list = byFeature.get(assertion.feature_id) ?? [];
    list.push(assertion);
    byFeature.set(assertion.feature_id, list);
  }
  return features.map((feature) => ({
    ...feature,
    assertions: byFeature.get(feature.id) ?? [],
  }));
}

async function loadFacts(client, repos) {
  const headers = await client.query(
    `SELECT kind, repo, source_revision, scanner_version, scanned_at, row_count
       FROM fact_snapshot_headers WHERE repo = ANY($1::text[])
      ORDER BY repo, kind`,
    [repos],
  );
  const tests = await client.query(
    `SELECT repo, file_path FROM test_registry
      WHERE repo = ANY($1::text[]) ORDER BY repo, file_path`,
    [repos],
  );
  const apis = await client.query(
    `SELECT repo, method, path FROM api_registry
      WHERE repo = ANY($1::text[]) ORDER BY repo, method, path`,
    [repos],
  );
  const dbSchemas = await client.query(
    `SELECT repo, table_name FROM db_schema_registry
      WHERE repo = ANY($1::text[]) ORDER BY repo, table_name`,
    [repos],
  );
  const graphEdges = await client.query(
    `SELECT repo, src_path, dst_path FROM graph_edges
      WHERE repo = ANY($1::text[]) ORDER BY repo, src_path, dst_path`,
    [repos],
  );
  return {
    headers: headers.rows,
    tests: tests.rows,
    apis: apis.rows,
    dbSchemas: dbSchemas.rows,
    graphEdges: graphEdges.rows,
  };
}

export async function loadMapAnchorProjection(client, { scopeKey, capabilityKeys }) {
  const repoAdapters = await loadMapRepoAdapters(client, scopeKey);
  const adapterKeys = new Set(repoAdapters.map(({ adapter_key }) => adapter_key));
  const unsupported = [...adapterKeys].filter((key) => key !== SUPPORTED_LEDGER_ADAPTER);
  if (unsupported.length > 0 && !adapterKeys.has(SUPPORTED_LEDGER_ADAPTER)) {
    return resolveMapAnchors({
      scopeKey, capabilityKeys, repoAdapters, features: [], facts: await loadFacts(
        client, repoAdapters.map(({ repo }) => repo),
      ),
    });
  }
  const ledgerPartitions = uniqueSorted(repoAdapters
    .filter(({ adapter_key: adapterKey }) => adapterKey === SUPPORTED_LEDGER_ADAPTER)
    .map(({ adapter_config: config }) => config?.ledger_partition)
    .filter(Boolean));
  const featureGroups = [];
  for (const partition of ledgerPartitions) {
    featureGroups.push(await loadLedgerFeatures(client, partition, capabilityKeys));
  }
  const facts = await loadFacts(client, repoAdapters.map(({ repo }) => repo));
  const features = featureGroups.flat();
  return resolveMapAnchors({ scopeKey, capabilityKeys, repoAdapters, features, facts });
}
