import { ValidationError } from './map-nodes-edges.js';

/** 与HTTP地图入口相同：scope由调用方明确指定，不猜全局最新。 */
export async function getActiveMapIdentity(pool, queryFn, { scope } = {}) {
  if (typeof scope !== 'string' || !scope.trim()) throw new ValidationError('scope 必须是非空字符串');
  const result = await queryFn(pool, `SELECT m.id AS active_manifest_id,
      r.id AS active_run_id, r.status AS projection_status
    FROM map_manifest_versions m
    LEFT JOIN map_projection_runs r ON r.scope_key = m.scope_key
      AND r.manifest_version_id = m.id AND r.manifest_digest = m.digest AND r.status = 'active'
    WHERE m.scope_key = $1 AND m.status = 'active'`, [scope]);
  const row = result.rows[0];
  return { scope_key: scope, active_manifest_id: row?.active_manifest_id ?? null,
    active_run_id: row?.active_run_id ?? null, projection_status: row?.projection_status ?? 'none' };
}

export async function getMapSummary(pool, queryFn, options) {
  const identity = await getActiveMapIdentity(pool, queryFn, options);
  if (!identity.active_run_id) return { ...identity, node_counts: {}, no_active_run: true };
  // 已发布run中的节点不可变；身份先选定后只读取该run，不混入后续激活的其它scope。
  const result = await queryFn(pool, `SELECT node_type, COUNT(*) AS count
    FROM map_projection_nodes WHERE run_id = $1 GROUP BY node_type`, [identity.active_run_id]);
  return { ...identity, node_counts: Object.fromEntries(result.rows.map(row => [row.node_type, Number(row.count)])) };
}
