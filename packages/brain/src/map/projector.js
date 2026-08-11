/**
 * Deterministic Map Projector
 * PRD: Universal Map Projection Engine, 刀2
 *
 * 从 active manifest + fact snapshots 生成统一节点/边投影。
 * - 输入相同 → digest 相同（确定性）
 * - 原子切换 active run（读者不得看到半张图）
 * - 通用内核：不出现领域硬编码
 */

import crypto from 'crypto';
import pool from '../db.js';

const PROJECTOR_VERSION = '1.0.0';

function stableNodeId(scopeKey, nodeType, nodeKey) {
  return crypto.createHash('sha256').update(`${scopeKey}:${nodeType}:${nodeKey}`).digest('hex');
}

function stableEdgeId(scopeKey, edgeType, edgeKey) {
  return crypto.createHash('sha256').update(`${scopeKey}:${edgeType}:${edgeKey}`).digest('hex');
}

/**
 * 计算 projection digest（确定性：同输入 → 同 digest）
 */
function computeProjectionDigest(nodes, edges, manifestDigest, factRevisions) {
  const payload = {
    manifest_digest: manifestDigest,
    fact_revisions: factRevisions,
    nodes: nodes.map((n) => ({ id: n.node_id, type: n.node_type, key: n.node_key })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.map((e) => ({ id: e.edge_id, type: e.edge_type, key: e.edge_key })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

/**
 * 从 manifest 生成节点和边（确定性）
 * @param {object} manifest - 已激活的 manifest 对象
 * @param {string} scopeKey - scope 标识
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildStructuralProjection(manifest, scopeKey) {
  const nodes = [];
  const edges = [];
  const nodeIdByKey = new Map();

  function registerNode(nodeType, nodeKey, name, attributes = {}) {
    const nodeId = stableNodeId(scopeKey, nodeType, nodeKey);
    nodes.push({
      node_id: nodeId,
      node_type: nodeType,
      node_key: nodeKey,
      name,
      attributes: JSON.stringify(attributes),
      source_refs: JSON.stringify([]),
    });
    nodeIdByKey.set(nodeKey, nodeId);
    return nodeId;
  }

  function resolveNodeId(key) {
    return nodeIdByKey.get(key) || stableNodeId(scopeKey, 'unknown', key);
  }

  // 1. Value Stream 节点
  for (const vs of manifest.value_streams) {
    registerNode('value_stream', vs.key, vs.name, { perceiver: vs.perceiver, order: vs.order });
  }

  // 2. Capability 节点 + contains 边
  for (const cap of manifest.capabilities) {
    const capId = registerNode('capability', cap.key, cap.name, { value_stream_key: cap.value_stream_key, order: cap.order });
    const edgeKey = `${cap.value_stream_key}_contains_${cap.key}`;
    edges.push({
      edge_id: stableEdgeId(scopeKey, 'contains', edgeKey),
      edge_key: edgeKey,
      edge_type: 'contains',
      from_node_id: resolveNodeId(cap.value_stream_key),
      to_node_id: capId,
      source_refs: JSON.stringify([]),
      attributes: JSON.stringify({}),
    });
  }

  // 3. Boundary 边（hands_off_to）
  for (const b of manifest.boundaries) {
    const edgeId = stableEdgeId(scopeKey, 'hands_off_to', b.key);
    edges.push({
      edge_id: edgeId,
      edge_key: b.key,
      edge_type: 'hands_off_to',
      from_node_id: resolveNodeId(b.from),
      to_node_id: resolveNodeId(b.to),
      source_refs: JSON.stringify([]),
      attributes: JSON.stringify({ statement: b.statement }),
    });
  }

  // 4. Cross-cut 节点 + owned_by / serves 边
  for (const cc of manifest.crosscut_pool) {
    const ccId = registerNode('crosscut', cc.key, cc.name, { owner: cc.owner || null });

    if (cc.owner) {
      const edgeKey = `${cc.key}_owned_by_${cc.owner}`;
      edges.push({
        edge_id: stableEdgeId(scopeKey, 'owned_by', edgeKey),
        edge_key: edgeKey,
        edge_type: 'owned_by',
        from_node_id: ccId,
        to_node_id: resolveNodeId(cc.owner),
        source_refs: JSON.stringify([]),
        attributes: JSON.stringify({}),
      });
    }

    for (const vsKey of (cc.serves || [])) {
      const edgeKey = `${cc.key}_serves_${vsKey}`;
      edges.push({
        edge_id: stableEdgeId(scopeKey, 'serves', edgeKey),
        edge_key: edgeKey,
        edge_type: 'serves',
        from_node_id: ccId,
        to_node_id: resolveNodeId(vsKey),
        source_refs: JSON.stringify([]),
        attributes: JSON.stringify({}),
      });
    }
  }

  // 5. Shared Prerequisites
  if (manifest.shared_prerequisites?.applicable && manifest.shared_prerequisites.items?.length > 0) {
    for (const item of manifest.shared_prerequisites.items) {
      const nodeKey = `prereq_${item.key || crypto.randomBytes(4).toString('hex')}`;
      registerNode('prerequisite', nodeKey, item.name || String(item.key || 'prereq'), item);
    }
  }

  return { nodes, edges };
}

/**
 * 获取各 repo 的当前 git HEAD SHA（用于事实版本记录）
 */
async function getFactRevisions(scopeKey) {
  const revisions = {};
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT repo, MAX(source_revision) AS revision
       FROM graph_edges
       WHERE repo = $1 AND source_revision IS NOT NULL
       GROUP BY repo`,
      [scopeKey]
    );
    for (const r of rows) {
      if (r.revision) revisions[r.repo] = r.revision;
    }
  } catch {
    // 忽略：fact revisions 缺失时 freshness 会标为 unknown
  }
  return revisions;
}

/**
 * 运行投影器（原子切换 active run）
 * 使用 migration 405 schema: manifest_version_id, status='building'/'active', activated_at
 * @param {{ manifestId, manifestDigest, scopeKey, manifest }} opts
 * @returns {{ runId, projectionDigest, nodeCount, edgeCount }}
 */
export async function runProjection({ manifestId, manifestDigest, scopeKey, manifest }) {
  const factRevisions = await getFactRevisions(scopeKey);
  const { nodes, edges } = buildStructuralProjection(manifest, scopeKey);
  const projectionDigest = computeProjectionDigest(nodes, edges, manifestDigest, factRevisions);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 创建投影 run 记录（migration 405: manifest_version_id, 'building' status）
    const { rows: runRows } = await client.query(
      `INSERT INTO map_projection_runs
         (scope_key, manifest_version_id, manifest_digest, fact_revisions, projector_version, projection_digest, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'building')
       RETURNING id`,
      [scopeKey, manifestId, manifestDigest, JSON.stringify(factRevisions), PROJECTOR_VERSION, projectionDigest]
    );
    const runId = runRows[0].id;

    // 写入节点（migration 405: node_id TEXT, PRIMARY KEY(run_id, node_id)）
    for (const n of nodes) {
      await client.query(
        `INSERT INTO map_projection_nodes
           (run_id, node_id, node_type, node_key, name, source_refs, attributes)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         ON CONFLICT (run_id, node_type, node_key) DO NOTHING`,
        [runId, n.node_id, n.node_type, n.node_key, n.name, n.source_refs, n.attributes]
      );
    }

    // 写入边（migration 405: edge_id TEXT, from_node_id, to_node_id）
    for (const e of edges) {
      await client.query(
        `INSERT INTO map_projection_edges
           (run_id, edge_id, edge_type, edge_key, from_node_id, to_node_id, source_refs, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
         ON CONFLICT (run_id, edge_type, edge_key) DO NOTHING`,
        [runId, e.edge_id, e.edge_type, e.edge_key, e.from_node_id, e.to_node_id, e.source_refs, e.attributes]
      );
    }

    // 原子切换 active run（旧 active → superseded，新 run → active + activated_at）
    await client.query(
      `UPDATE map_projection_runs SET status = 'superseded' WHERE scope_key = $1 AND status = 'active'`,
      [scopeKey]
    );
    await client.query(
      `UPDATE map_projection_runs SET status = 'active', activated_at = NOW() WHERE id = $1`,
      [runId]
    );

    await client.query('COMMIT');
    return { runId, projectionDigest, nodeCount: nodes.length, edgeCount: edges.length };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try {
      await pool.query(
        `UPDATE map_projection_runs SET status = 'failed', error = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ message: err.message }), err.runId]
      );
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 获取 scope_key 的当前 active projection run 信息
 * migration 405 schema: status='active', manifest_version_id, activated_at
 */
export async function getActiveProjection(scopeKey) {
  const { rows } = await pool.query(
    `SELECT r.id, r.scope_key, r.manifest_version_id, r.manifest_digest, r.fact_revisions,
            r.projector_version, r.status, r.projection_digest,
            r.created_at, r.activated_at
     FROM map_projection_runs r
     WHERE r.scope_key = $1 AND r.status = 'active'
     LIMIT 1`,
    [scopeKey]
  );
  return rows[0] || null;
}

/**
 * 获取 active projection 的所有节点（migration 405 schema）
 */
export async function getProjectionNodes(scopeKey, nodeType = null) {
  const run = await getActiveProjection(scopeKey);
  if (!run) return [];
  const params = [run.id];
  let where = 'WHERE n.run_id = $1';
  if (nodeType) {
    where += ' AND n.node_type = $2';
    params.push(nodeType);
  }
  const { rows } = await pool.query(
    `SELECT n.run_id, n.node_id, n.node_type, n.node_key, n.name, n.source_refs, n.attributes
     FROM map_projection_nodes n ${where}
     ORDER BY n.node_type, n.node_key`,
    params
  );
  return rows;
}

/**
 * 获取 active projection 的所有边（migration 405 schema）
 */
export async function getProjectionEdges(scopeKey, edgeType = null) {
  const run = await getActiveProjection(scopeKey);
  if (!run) return [];
  const params = [run.id];
  let where = 'WHERE e.run_id = $1';
  if (edgeType) {
    where += ' AND e.edge_type = $2';
    params.push(edgeType);
  }
  const { rows } = await pool.query(
    `SELECT e.run_id, e.edge_id, e.edge_type, e.edge_key, e.from_node_id, e.to_node_id, e.attributes
     FROM map_projection_edges e ${where}
     ORDER BY e.edge_type, e.edge_key`,
    params
  );
  return rows;
}
