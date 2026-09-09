// packages/brain/src/db-slim-rules.js
/**
 * db-slim 清理规则（SSOT）。
 * 设计：docs/superpowers/specs/2026-09-09-db-slim-design.md
 * archiveWhere：归档时可评估的谓词（删除动作发生前）
 * deleteWhere：删除时评估的谓词（同 txGroup 内可依赖前序删除）
 * txGroup：同组规则按声明顺序在关联事务序列里执行，中断后必须重跑至完成
 */

export const PROTECTED_TABLES = ['decisions', 'tasks', 'journeys', 'journey_features'];

const GRAPH_STALE = (alias) => `NOT EXISTS (
  SELECT 1 FROM map_projection_runs r,
       jsonb_each_text(r.fact_revisions) kv
  WHERE r.status = 'active'
    AND kv.key = ${alias}.repo
    AND kv.value = ${alias}.source_revision
)`;

export const SLIM_RULES = [
  {
    name: 'memory_stream_expired',
    table: 'memory_stream',
    archiveWhere: 'expires_at IS NOT NULL AND expires_at < NOW()',
    deleteWhere: 'expires_at IS NOT NULL AND expires_at < NOW()',
  },
  {
    name: 'graph_edge_snapshots_stale',
    table: 'graph_edge_snapshots',
    txGroup: 'graph',
    archiveWhere: GRAPH_STALE('graph_edge_snapshots'),
    deleteWhere: GRAPH_STALE('graph_edge_snapshots'),
  },
  {
    name: 'graph_snapshot_versions_stale',
    table: 'graph_snapshot_versions',
    txGroup: 'graph',
    archiveWhere: GRAPH_STALE('graph_snapshot_versions'),
    deleteWhere: GRAPH_STALE('graph_snapshot_versions'),
  },
  {
    name: 'cecelia_events_old',
    table: 'cecelia_events',
    archiveWhere: "created_at < NOW() - INTERVAL '30 days'",
    deleteWhere: "created_at < NOW() - INTERVAL '30 days'",
    preAssert: {
      sql: `SELECT count(*)::int AS n FROM cortex_analyses c
            JOIN cecelia_events e ON e.id = c.event_id
            WHERE e.created_at < NOW() - INTERVAL '30 days'`,
      expectZero: true,
    },
  },
  {
    name: 'alertness_metrics_old',
    table: 'alertness_metrics',
    archiveWhere: '"timestamp" < NOW() - INTERVAL \'14 days\'',
    deleteWhere: '"timestamp" < NOW() - INTERVAL \'14 days\'',
  },
  {
    name: 'checkpoints_old',
    table: 'checkpoints',
    txGroup: 'ckpt',
    archiveWhere: "(checkpoint->>'ts')::timestamptz < NOW() - INTERVAL '7 days'",
    deleteWhere: "(checkpoint->>'ts')::timestamptz < NOW() - INTERVAL '7 days'",
  },
  {
    name: 'checkpoint_writes_orphan',
    table: 'checkpoint_writes',
    txGroup: 'ckpt',
    archiveWhere: `EXISTS (
      SELECT 1 FROM checkpoints c
      WHERE c.thread_id = checkpoint_writes.thread_id
        AND c.checkpoint_ns = checkpoint_writes.checkpoint_ns
        AND c.checkpoint_id = checkpoint_writes.checkpoint_id
        AND (c.checkpoint->>'ts')::timestamptz < NOW() - INTERVAL '7 days'
    )`,
    deleteWhere: `NOT EXISTS (
      SELECT 1 FROM checkpoints c
      WHERE c.thread_id = checkpoint_writes.thread_id
        AND c.checkpoint_ns = checkpoint_writes.checkpoint_ns
        AND c.checkpoint_id = checkpoint_writes.checkpoint_id
    )`,
  },
  {
    name: 'checkpoint_blobs_orphan',
    table: 'checkpoint_blobs',
    txGroup: 'ckpt',
    archiveWhere: `NOT EXISTS (
      SELECT 1 FROM checkpoints c
      WHERE c.thread_id = checkpoint_blobs.thread_id
        AND (c.checkpoint->>'ts')::timestamptz >= NOW() - INTERVAL '7 days'
    )`,
    deleteWhere: `NOT EXISTS (
      SELECT 1 FROM checkpoints c
      WHERE c.thread_id = checkpoint_blobs.thread_id
    )`,
  },
  {
    name: 'memory_stream_selfmodel_history',
    table: 'memory_stream',
    archiveWhere: `source_type = 'self_model' AND id NOT IN (
      SELECT id FROM memory_stream
      WHERE source_type = 'self_model'
      ORDER BY created_at DESC
      LIMIT 30
    )`,
    deleteWhere: `source_type = 'self_model' AND id NOT IN (
      SELECT id FROM memory_stream
      WHERE source_type = 'self_model'
      ORDER BY created_at DESC
      LIMIT 30
    )`,
  },
];
