// map_manifest_versions / map_projection_runs / map_projection_nodes 的真实结构见
// packages/brain/migrations/402_map_manifest_versions.sql、405_map_projection_core.sql。
//
// - map_manifest_versions.status 有唯一部分索引 idx_map_manifest_one_active_per_scope
//   （WHERE status = 'active'），同一 scope_key 同一时刻最多一条 active，按 activated_at
//   取最新即可定位"当前生效"的 manifest。
// - map_projection_runs 同理，status='active' 每个 scope_key 唯一。
// - map_projection_nodes 的主键是 (run_id, node_id)，节点行永远挂在某次具体的
//   projection run 下；被 superseded 的旧 run 产生的节点不会自动清掉（要等 run 行被
//   删除触发 ON DELETE CASCADE）。所以统计"当前有几个 Value Stream / Capability"时
//   必须显式 WHERE run_id = <active run 的 id>，否则会把历史上所有跑过的 run（含已废弃）
//   的节点一起计入，数字会随着 projection 重跑次数不断虚高，不是给 Notion AI 看的
//   "当前系统状态"快照。
export async function getMapSummary(pool, queryFn) {
  const manifestResult = await queryFn(
    pool,
    `SELECT id, scope_key, digest
     FROM map_manifest_versions
     WHERE status = 'active'
     ORDER BY activated_at DESC
     LIMIT 1`,
    []
  );

  const runResult = await queryFn(
    pool,
    `SELECT id, status
     FROM map_projection_runs
     WHERE status = 'active'
     ORDER BY activated_at DESC
     LIMIT 1`,
    []
  );

  const activeRunId = runResult.rows[0]?.id ?? null;

  const countsResult = await queryFn(
    pool,
    `SELECT node_type, COUNT(*) AS count
     FROM map_projection_nodes
     WHERE run_id = $1
     GROUP BY node_type`,
    [activeRunId]
  );

  const node_counts = {};
  for (const row of countsResult.rows) {
    node_counts[row.node_type] = Number(row.count);
  }

  return {
    active_manifest_id: manifestResult.rows[0]?.id ?? null,
    projection_status: runResult.rows[0]?.status ?? 'none',
    node_counts,
  };
}
