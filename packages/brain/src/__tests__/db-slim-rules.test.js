// packages/brain/src/__tests__/db-slim-rules.test.js
import { describe, it, expect } from 'vitest';
import { SLIM_RULES, PROTECTED_TABLES } from '../db-slim-rules.js';

describe('db-slim-rules', () => {
  it('核心表绝不出现在任何规则里', () => {
    const ruleTables = SLIM_RULES.map((r) => r.table);
    for (const t of ['decisions', 'tasks', 'journeys', 'journey_features']) {
      expect(PROTECTED_TABLES).toContain(t);
      expect(ruleTables).not.toContain(t);
    }
  });

  it('9 条规则覆盖设计文档全部目标表', () => {
    expect(SLIM_RULES.map((r) => r.name)).toEqual([
      'memory_stream_expired',
      'graph_edge_snapshots_stale',
      'graph_snapshot_versions_stale',
      'cecelia_events_old',
      'alertness_metrics_old',
      'checkpoints_old',
      'checkpoint_writes_orphan',
      'checkpoint_blobs_orphan',
      'memory_stream_selfmodel_history',
    ]);
  });

  it('memory_stream 只删已过期行（与 migrations/173 逐字一致）', () => {
    const r = SLIM_RULES.find((x) => x.name === 'memory_stream_expired');
    expect(r.deleteWhere).toBe('expires_at IS NOT NULL AND expires_at < NOW()');
    expect(r.archiveWhere).toBe(r.deleteWhere);
  });

  it('graph 组：edges 在 versions 之前（FK RESTRICT 顺序）且同 txGroup', () => {
    const idxEdges = SLIM_RULES.findIndex((x) => x.name === 'graph_edge_snapshots_stale');
    const idxVers = SLIM_RULES.findIndex((x) => x.name === 'graph_snapshot_versions_stale');
    expect(idxEdges).toBeLessThan(idxVers);
    expect(SLIM_RULES[idxEdges].txGroup).toBe('graph');
    expect(SLIM_RULES[idxVers].txGroup).toBe('graph');
    // 保留集合 = active map_projection_runs 的 fact_revisions（判定点 b3d64d59：不含合同钉住）
    expect(SLIM_RULES[idxEdges].deleteWhere).toContain("r.status = 'active'");
    expect(SLIM_RULES[idxEdges].deleteWhere).toContain('jsonb_each_text(r.fact_revisions)');
    expect(SLIM_RULES[idxEdges].deleteWhere).not.toContain('harness_impact_contracts');
  });

  it('cecelia_events 保 30 天并带 cortex_analyses FK 断言', () => {
    const r = SLIM_RULES.find((x) => x.name === 'cecelia_events_old');
    expect(r.deleteWhere).toBe("created_at < NOW() - INTERVAL '30 days'");
    expect(r.preAssert.sql).toContain('cortex_analyses');
    expect(r.preAssert.expectZero).toBe(true);
  });

  it('alertness_metrics 用带索引的 timestamp 列，保 14 天', () => {
    const r = SLIM_RULES.find((x) => x.name === 'alertness_metrics_old');
    expect(r.deleteWhere).toBe('"timestamp" < NOW() - INTERVAL \'14 days\'');
  });

  it('checkpoints 用 jsonb ts 保 7 天；writes/blobs 归档谓词≠删除谓词', () => {
    const c = SLIM_RULES.find((x) => x.name === 'checkpoints_old');
    expect(c.deleteWhere).toBe("(checkpoint->>'ts')::timestamptz < NOW() - INTERVAL '7 days'");
    const w = SLIM_RULES.find((x) => x.name === 'checkpoint_writes_orphan');
    const b = SLIM_RULES.find((x) => x.name === 'checkpoint_blobs_orphan');
    // 删除时：孤儿 = 三键/thread 不在剩余 checkpoints
    expect(w.deleteWhere).toContain('NOT EXISTS');
    expect(b.deleteWhere).toContain('NOT EXISTS');
    // 归档时：checkpoints 还没删，用"将成孤儿"等价谓词
    expect(w.archiveWhere).not.toBe(w.deleteWhere);
    expect(w.archiveWhere).toContain("'7 days'");
    expect(b.archiveWhere).toContain("'7 days'");
  });

  it('self_model 历史规则：保留最新 30 条，其余归档删除', () => {
    const r = SLIM_RULES.find((x) => x.name === 'memory_stream_selfmodel_history');
    expect(r.table).toBe('memory_stream');
    expect(r.deleteWhere).toContain("source_type = 'self_model'");
    expect(r.deleteWhere).toContain('ORDER BY created_at DESC');
    expect(r.deleteWhere).toContain('LIMIT 30');
    expect(r.archiveWhere).toBe(r.deleteWhere);
  });

  it('每条规则字段齐全', () => {
    for (const r of SLIM_RULES) {
      expect(r.name).toBeTruthy();
      expect(r.table).toBeTruthy();
      expect(r.archiveWhere).toBeTruthy();
      expect(r.deleteWhere).toBeTruthy();
    }
  });
});
