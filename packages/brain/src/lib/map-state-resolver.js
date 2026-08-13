import { computeFreshness } from './registry-freshness.js';
import { loadMapRepoAdapters } from './map-repo-adapter.js';

export class MapStateResolverError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MapStateResolverError';
    this.code = code;
    this.details = details;
  }
}

function state(status, reasonCode, details = {}) {
  return { status, reason_code: reasonCode, ...details };
}

function receiptTime(receipt) {
  const value = new Date(receipt?.completed_at ?? 0).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function selectCurrentReceipt(receipts, assertionRevision) {
  const ordered = [...(receipts ?? [])].sort((left, right) => (
    receiptTime(right) - receiptTime(left)
  ));
  return ordered.find((receipt) => Number(receipt.assertion_revision) === Number(assertionRevision))
    ?? ordered[0]
    ?? null;
}

export function resolveEvidenceState({
  approvedAnchor,
  targetExists,
  notApplicableReason = null,
  snapshot,
  receiptRequired,
  assertionRevision = null,
  receipt = null,
  repo = null,
  certification = null,
  now = new Date(),
}) {
  if (notApplicableReason) {
    return state('not_applicable', 'not_applicable', { reason: notApplicableReason });
  }
  if (!approvedAnchor) return state('gray', 'anchor_missing');

  const freshness = computeFreshness(snapshot, now);
  const provenance = {
    source_revision: freshness.source_revision,
    last_success_at: freshness.last_success_at,
    freshness,
  };
  if (freshness.status !== 'fresh') {
    return state('unknown', freshness.reason_code, provenance);
  }
  if (!targetExists) {
    return state('gray', 'anchor_target_missing', provenance);
  }
  if (!receiptRequired) {
    return state('green', 'anchor_target_present', provenance);
  }
  if (!receipt) return state('unknown', 'receipt_missing', provenance);
  if (Number(receipt.assertion_revision) !== Number(assertionRevision)) {
    return state('unknown', 'assertion_revision_mismatch', {
      ...provenance,
      expected_assertion_revision: assertionRevision,
      receipt_assertion_revision: receipt.assertion_revision,
    });
  }
  if (repo && receipt.source_repo !== repo) {
    return state('unknown', 'receipt_repo_mismatch', {
      ...provenance,
      expected_repo: repo,
      receipt_repo: receipt.source_repo,
    });
  }
  if (receipt.source_sha !== freshness.source_revision) {
    return state('unknown', 'receipt_revision_mismatch', {
      ...provenance,
      receipt_source_revision: receipt.source_sha ?? null,
    });
  }
  // F1 可信认证闸（fail-closed）——只有携带认证上下文的断言（Capability 投影读路径）才施加。
  // 四前提缺任一即非绿：step-link 绑定 / signed GP contract 存在 / receipt 绑定 GP identity / receipt 绑定 Impact。
  if (certification) {
    if (!certification.stepLinkBound) {
      return state('unknown', 'step_link_unbound', provenance);
    }
    if (!certification.signedContract) {
      return state('unknown', 'gp_contract_unsigned', provenance);
    }
    if (
      receipt.gp_contract_id !== certification.signedContract.id
      || receipt.gp_contract_hash !== certification.signedContract.content_hash
    ) {
      return state('unknown', 'receipt_gp_contract_unbound', provenance);
    }
    if (!receipt.impact_contract_id) {
      return state('unknown', 'receipt_impact_contract_unbound', provenance);
    }
  }
  if (receipt.verdict === 'PASS') {
    return state('green', 'receipt_pass', { ...provenance, receipt });
  }
  if (receipt.verdict === 'FAIL') {
    return state('red', 'receipt_fail', { ...provenance, receipt });
  }
  return state('unknown', 'receipt_verdict_invalid', { ...provenance, receipt });
}

export function aggregateMapStates(children) {
  if (!children?.length) return state('gray', 'children_missing');
  const applicable = children.filter(({ status }) => status !== 'not_applicable');
  if (applicable.length === 0) return state('not_applicable', 'children_not_applicable');
  // 冒泡失败子节点的具体 reason_code（认证闸原因码需从断言一路带到 capability）；
  // 子节点无 reason_code 时回落通用码，保持既有聚合契约不变。
  const redChild = applicable.find(({ status: childStatus }) => childStatus === 'red');
  if (redChild) {
    return state('red', redChild.reason_code ?? 'child_red');
  }
  const unknownChild = applicable.find(({ status: childStatus }) => childStatus === 'unknown');
  if (unknownChild) {
    return state('unknown', unknownChild.reason_code ?? 'child_unknown');
  }
  if (applicable.every(({ status: childStatus }) => childStatus === 'green')) {
    return state('green', 'children_green');
  }
  return state('gray', 'children_incomplete');
}

export function aggregateFeatureEvidence({ artifactStates = [], assertionStates = [] }) {
  const applicableAssertions = assertionStates.filter(({ status }) => status !== 'not_applicable');
  if (applicableAssertions.length === 0) {
    if (assertionStates.length > 0) {
      return state('not_applicable', 'assertions_not_applicable');
    }
    const artifactState = aggregateMapStates(artifactStates);
    if (artifactState.status === 'green') {
      return state('unknown', 'receipt_missing');
    }
    return artifactState;
  }
  return aggregateMapStates([...artifactStates, ...assertionStates]);
}

function factIdentity(repo, value) {
  return `${repo}\u0000${value}`;
}

async function loadCurrentFacts(client, repos) {
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
    test: new Set(tests.rows.map((row) => factIdentity(row.repo, row.file_path))),
    api: new Set(apis.rows.map((row) => factIdentity(row.repo, `${row.method} ${row.path}`))),
    apiPath: new Set(apis.rows.map((row) => factIdentity(row.repo, row.path))),
    db_schema: new Set(dbSchemas.rows.map((row) => factIdentity(row.repo, row.table_name))),
    graph: new Set(graphEdges.rows.flatMap((row) => [row.src_path, row.dst_path]
      .filter(Boolean)
      .map((path) => factIdentity(row.repo, path)))),
  };
}

function targetExists(attributes, facts) {
  const { repo, fact_kind: kind, stable_ref: reference, method } = attributes ?? {};
  if (!repo || !kind || !reference) return false;
  if (kind === 'api') {
    return method
      ? facts.api.has(factIdentity(repo, `${method} ${reference}`))
      : facts.apiPath.has(factIdentity(repo, reference));
  }
  return facts[kind]?.has(factIdentity(repo, reference)) ?? false;
}

/**
 * 认证上下文（fail-closed 闸的两个前提）——按 journey_step_link_id 聚合：
 *  - stepLinkBound: 实时 journey_step_links 行的 feature_id 与 assertion_ref 均绑定
 *  - signedContract: 该 link 所属 journey 的 golden_path 存在 status='signed' 合同版本（id + content_hash）
 * 读实时表（非投影快照），使 step-link 解绑 / 合同撤签能被查询时现算捕获。
 */
async function loadCertificationContext(client, linkIds) {
  const byLink = new Map();
  if (!linkIds?.length) return byLink;
  const { rows } = await client.query(
    `SELECT l.id AS link_id, l.feature_id, l.assertion_ref,
            gpc.id AS gp_contract_id, gpc.content_hash AS gp_contract_hash
       FROM journey_step_links l
       LEFT JOIN golden_paths gp ON gp.journey_id = l.journey_id
       LEFT JOIN golden_path_contract_versions gpc
         ON gpc.golden_path_id = gp.id AND gpc.status = 'signed'
      WHERE l.id = ANY($1::uuid[])`,
    [linkIds],
  );
  for (const row of rows) {
    const entry = byLink.get(row.link_id) ?? {
      stepLinkBound: Boolean(row.feature_id && row.assertion_ref),
      signedContract: null,
    };
    if (!entry.signedContract && row.gp_contract_id) {
      entry.signedContract = { id: row.gp_contract_id, content_hash: row.gp_contract_hash };
    }
    byLink.set(row.link_id, entry);
  }
  return byLink;
}

function groupReceipts(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.journey_step_link_id) ?? [];
    list.push(row);
    grouped.set(row.journey_step_link_id, list);
  }
  return grouped;
}

function incomingChildren(node, edges, states, edgeTypes) {
  return edges
    .filter((edge) => edge.to_node_id === node.node_id && edgeTypes.has(edge.edge_type))
    .map((edge) => states.get(edge.from_node_id))
    .filter(Boolean);
}

function outgoingChildren(node, edges, states, edgeTypes) {
  return edges
    .filter((edge) => edge.from_node_id === node.node_id && edgeTypes.has(edge.edge_type))
    .map((edge) => states.get(edge.to_node_id))
    .filter(Boolean);
}

function stateRecord(node, resolved) {
  return {
    node_id: node.node_id,
    node_type: node.node_type,
    node_key: node.node_key,
    ...resolved,
  };
}

export async function loadMapNodeStates(client, { scopeKey, now = new Date() }) {
  if (!client?.query) {
    throw new MapStateResolverError(
      'MAP_STATE_CLIENT_INVALID',
      'Map state resolver requires a PostgreSQL client',
    );
  }
  const { rows: runs } = await client.query(
    `SELECT id, scope_key, manifest_version_id, manifest_digest, fact_revisions,
            projector_version, projection_digest, activated_at
       FROM map_projection_runs
      WHERE scope_key=$1 AND status='active'`,
    [scopeKey],
  );
  if (!runs[0]) {
    throw new MapStateResolverError(
      'MAP_STATE_PROJECTION_NOT_FOUND',
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
  const adapters = await loadMapRepoAdapters(client, scopeKey);
  const repos = adapters.map(({ repo }) => repo);
  const { rows: headers } = await client.query(
    `SELECT kind, repo, source_revision, scanner_version, scanned_at, row_count
       FROM fact_snapshot_headers
      WHERE repo = ANY($1::text[]) ORDER BY repo, kind`,
    [repos],
  );
  const headerByKindRepo = new Map(headers.map((header) => (
    [`${header.repo}:${header.kind}`, header]
  )));
  const facts = await loadCurrentFacts(client, repos);
  const assertionIds = nodes
    .filter(({ node_type: nodeType }) => nodeType === 'assertion')
    .map(({ node_key: nodeKey }) => nodeKey)
    .filter((nodeKey) => /^[0-9a-f-]{36}$/i.test(nodeKey));
  let receiptRows = [];
  if (assertionIds.length > 0) {
    const receiptResult = await client.query(
      `SELECT journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
              source_repo, source_sha, verdict, exit_code, started_at, completed_at,
              scenario_count, scenario_evidence, output_digest, output_tail,
              gp_contract_id, gp_contract_hash, impact_contract_id, impact_contract_hash
         FROM journey_assertion_receipts
        WHERE journey_step_link_id = ANY($1::uuid[])
        ORDER BY journey_step_link_id, completed_at DESC, created_at DESC`,
      [assertionIds],
    );
    receiptRows = receiptResult.rows;
  }
  const receipts = groupReceipts(receiptRows);
  const certificationByLink = await loadCertificationContext(client, assertionIds);
  const resolvedById = new Map();

  for (const node of nodes.filter(({ node_type: nodeType }) => nodeType === 'artifact')) {
    const attributes = node.attributes ?? {};
    resolvedById.set(node.node_id, resolveEvidenceState({
      approvedAnchor: Boolean(attributes.repo && attributes.fact_kind && attributes.stable_ref),
      targetExists: targetExists(attributes, facts),
      snapshot: headerByKindRepo.get(`${attributes.repo}:${attributes.fact_kind}`) ?? null,
      receiptRequired: false,
      repo: attributes.repo,
      now,
    }));
  }
  for (const node of nodes.filter(({ node_type: nodeType }) => nodeType === 'assertion')) {
    const attributes = node.attributes ?? {};
    const assertionRevision = Number(attributes.assertion_revision);
    const receipt = selectCurrentReceipt(receipts.get(node.node_key), assertionRevision);
    resolvedById.set(node.node_id, resolveEvidenceState({
      approvedAnchor: Boolean(attributes.assertion_ref),
      targetExists: targetExists(attributes, facts),
      notApplicableReason: attributes.na_reason,
      snapshot: headerByKindRepo.get(`${attributes.repo}:${attributes.fact_kind}`) ?? null,
      receiptRequired: true,
      assertionRevision,
      receipt,
      repo: attributes.repo,
      certification: certificationByLink.get(node.node_key)
        ?? { stepLinkBound: false, signedContract: null },
      now,
    }));
  }

  for (const node of nodes.filter(({ node_type: nodeType }) => nodeType === 'feature')) {
    const artifactStates = incomingChildren(
      node,
      edges,
      resolvedById,
      new Set(['implements']),
    );
    const assertionStates = incomingChildren(
      node,
      edges,
      resolvedById,
      new Set(['proves']),
    );
    resolvedById.set(node.node_id, aggregateFeatureEvidence({
      artifactStates,
      assertionStates,
    }));
  }
  for (const node of nodes.filter(({ node_type: nodeType }) => nodeType === 'capability')) {
    const children = incomingChildren(node, edges, resolvedById, new Set(['implements']));
    resolvedById.set(node.node_id, aggregateMapStates(children));
  }
  for (const node of nodes.filter(({ node_type: nodeType }) => nodeType === 'value_stream')) {
    const children = outgoingChildren(node, edges, resolvedById, new Set(['contains']));
    resolvedById.set(node.node_id, aggregateMapStates(children));
  }
  for (const node of nodes) {
    if (!resolvedById.has(node.node_id)) {
      resolvedById.set(node.node_id, state('gray', 'state_evidence_missing'));
    }
  }

  return {
    scope_key: scopeKey,
    projection_run: run,
    states: nodes.map((node) => stateRecord(node, resolvedById.get(node.node_id))),
    headers,
  };
}
