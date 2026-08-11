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

/**
 * 计算 projection digest（确定性：同输入 → 同 digest）
 */
function computeProjectionDigest(nodes, edges, manifestDigest, factRevisions) {
  const payload = {
    manifest_digest: manifestDigest,
    fact_revisions: factRevisions,
    nodes: nodes.map((n) => ({ key: n.node_key, type: n.node_type, name: n.name })).sort((a, b) => a.key.localeCompare(b.key)),
    edges: edges.map((e) => ({ from: e.from_key, to: e.to_key, type: e.edge_type, key: e.edge_key })).sort((a, b) => (a.key || '').localeCompare(b.key || '')),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

/**
 * 从 manifest 生成节点和边（确定性）
 * @param {object} manifest - 已激活的 manifest 对象
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildStructuralProjection(manifest) {
  const nodes = [];
  const edges = [];

  // 1. Value Stream 节点
  for (const vs of manifest.value_streams) {
    nodes.push({
      node_key: vs.key,
      node_type: 'value_stream',
      name: vs.name,
      attributes: { perceiver: vs.perceiver, order: vs.order },
      source_refs: [],
      aliases: [],
      display_order: vs.order,
    });
  }

  // 2. Capability 节点 + contains 边
  for (const cap of manifest.capabilities) {
    nodes.push({
      node_key: cap.key,
      node_type: 'capability',
      name: cap.name,
      attributes: { value_stream_key: cap.value_stream_key, order: cap.order },
      source_refs: [],
      aliases: cap.aliases || [],
      display_order: cap.order,
    });
    // value_stream contains capability
    edges.push({
      edge_key: `${cap.value_stream_key}_contains_${cap.key}`,
      from_key: cap.value_stream_key,
      to_key: cap.key,
      edge_type: 'contains',
      attributes: {},
    });
  }

  // 3. Boundary 边（hands_off_to）
  for (const b of manifest.boundaries) {
    edges.push({
      edge_key: b.key,
      from_key: b.from,
      to_key: b.to,
      edge_type: 'hands_off_to',
      attributes: { statement: b.statement },
    });
  }

  // 4. Cross-cut 节点 + serves 边
  const vsByKey = new Map(manifest.value_streams.map((v) => [v.key, v]));
  for (const cc of manifest.crosscut_pool) {
    const ownerState = cc.owner ? 'assigned' : 'unassigned';
    nodes.push({
      node_key: cc.key,
      node_type: 'crosscut',
      name: cc.name,
      attributes: { owner: cc.owner || null, owner_state: ownerState },
      source_refs: [],
      aliases: cc.aliases || [],
      display_order: null,
    });

    // owned_by 边（有主管 Capability 时）
    if (cc.owner) {
      edges.push({
        edge_key: `${cc.key}_owned_by_${cc.owner}`,
        from_key: cc.key,
        to_key: cc.owner,
        edge_type: 'owned_by',
        attributes: {},
      });
    }

    // serves 边（针对每条 value stream）
    for (const vsKey of cc.serves) {
      if (vsByKey.has(vsKey)) {
        edges.push({
          edge_key: `${cc.key}_serves_${vsKey}`,
          from_key: cc.key,
          to_key: vsKey,
          edge_type: 'serves',
          attributes: {},
        });
      }
    }
  }

  // 5. Shared Prerequisites
  if (manifest.shared_prerequisites.applicable && manifest.shared_prerequisites.items.length > 0) {
    for (const item of manifest.shared_prerequisites.items) {
      nodes.push({
        node_key: `prereq_${item.key || crypto.randomBytes(4).toString('hex')}`,
        node_type: 'prerequisite',
        name: item.name || String(item.key),
        attributes: item,
        source_refs: [],
        aliases: [],
        display_order: null,
      });
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
 * @param {{ manifestId, manifestDigest, scopeKey, manifest }} opts
 * @returns {{ runId, projectionDigest, nodeCount, edgeCount }}
 */
export async function runProjection({ manifestId, manifestDigest, scopeKey, manifest }) {
  const factRevisions = await getFactRevisions(scopeKey);
  const { nodes, edges } = buildStructuralProjection(manifest);
  const projectionDigest = computeProjectionDigest(nodes, edges, manifestDigest, factRevisions);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 创建投影 run 记录
    const { rows: runRows } = await client.query(
      `INSERT INTO map_projection_runs
         (scope_key, manifest_id, manifest_digest, fact_revisions, projector_version, status)
       VALUES ($1, $2, $3, $4, $5, 'running')
       RETURNING id`,
      [scopeKey, manifestId, manifestDigest, JSON.stringify(factRevisions), PROJECTOR_VERSION]
    );
    const runId = runRows[0].id;

    // 写入节点
    for (const n of nodes) {
      await client.query(
        `INSERT INTO map_projection_nodes
           (run_id, scope_key, node_key, node_type, name, attributes, source_refs, aliases, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (run_id, node_key) DO NOTHING`,
        [
          runId, scopeKey, n.node_key, n.node_type, n.name,
          JSON.stringify(n.attributes), JSON.stringify(n.source_refs),
          n.aliases, n.display_order,
        ]
      );
    }

    // 写入边
    for (const e of edges) {
      await client.query(
        `INSERT INTO map_projection_edges
           (run_id, scope_key, edge_key, from_key, to_key, edge_type, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [runId, scopeKey, e.edge_key || null, e.from_key, e.to_key, e.edge_type, JSON.stringify(e.attributes)]
      );
    }

    // 标记 run 成功 + 更新统计
    await client.query(
      `UPDATE map_projection_runs
       SET status = 'success', projection_digest = $1,
           node_count = $2, edge_count = $3, completed_at = NOW()
       WHERE id = $4`,
      [projectionDigest, nodes.length, edges.length, runId]
    );

    // 原子切换 active run（旧 active → false，新 run → true）
    await client.query(
      `UPDATE map_projection_runs SET is_active = false WHERE scope_key = $1 AND is_active = true`,
      [scopeKey]
    );
    await client.query(
      `UPDATE map_projection_runs SET is_active = true WHERE id = $1`,
      [runId]
    );

    await client.query('COMMIT');
    return { runId, projectionDigest, nodeCount: nodes.length, edgeCount: edges.length };
  } catch (err) {
    await client.query('ROLLBACK');
    // 记录失败
    await pool.query(
      `UPDATE map_projection_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, err.runId]
    ).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 获取 scope_key 的当前 active projection run 信息
 */
export async function getActiveProjection(scopeKey) {
  const { rows } = await pool.query(
    `SELECT r.id, r.scope_key, r.manifest_id, r.manifest_digest, r.fact_revisions,
            r.projector_version, r.status, r.projection_digest, r.node_count, r.edge_count,
            r.created_at, r.completed_at
     FROM map_projection_runs r
     WHERE r.scope_key = $1 AND r.is_active = true
     LIMIT 1`,
    [scopeKey]
  );
  return rows[0] || null;
}

/**
 * 获取 active projection 的所有节点
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
    `SELECT n.* FROM map_projection_nodes n ${where} ORDER BY n.display_order NULLS LAST, n.node_key`,
    params
  );
  return rows;
}

/**
 * 获取 active projection 的所有边
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
    `SELECT e.* FROM map_projection_edges e ${where} ORDER BY e.edge_type, e.from_key, e.to_key`,
    params
  );
  return rows;
}
