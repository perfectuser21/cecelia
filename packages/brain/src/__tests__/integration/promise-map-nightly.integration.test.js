/**
 * S4 保鲜对账 proven-to-fire（MJ5 刀4 验火，350 seed 数据上实弹）
 * PRD §六：故意违规一次，亲眼看报红——没见过报红的守卫不算守卫。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildNightlyAssertions } from '../../promise-map-nightly.js';
let pool;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

describe('S4 保鲜对账 proven-to-fire', () => {
  it('首跑六断言全绿（seed 后的干净账本）', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 起点隔离：本地开发库常留着过期快照/历史 openclaw 行，会让"全绿"用例
      // 随库状态漂。事务内清空，ROLLBACK 后原样恢复。
      await client.query('DELETE FROM fact_snapshot_headers');
      await client.query(`DELETE FROM skill_registry WHERE location='openclaw' OR name LIKE 'openclaw/%'`);
      await client.query(`DELETE FROM ops_skills WHERE source='openclaw'`);
      // A5 需要至少一份新鲜快照——空表按设计判 fail（"扫描链从未成功跑过"），故 seed。
      await client.query(
        `INSERT INTO fact_snapshot_headers (kind,repo,source_revision,scanner_version,scanned_at,row_count)
         VALUES ('api','__nightly_probe__','deadbeef','itest', NOW(), 1)`);
      const results = await buildNightlyAssertions(client);
      expect(results).toHaveLength(6);
      for (const r of results) expect(r.ok, `${r.key}: ${r.detail}`).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('proven-to-fire ⑤：快照停更 >24h → A5 报红并点名 repo', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM fact_snapshot_headers');
      await client.query(
        `INSERT INTO fact_snapshot_headers (kind,repo,source_revision,scanner_version,scanned_at,row_count)
         VALUES ('api','__stale_probe__','deadbeef','itest', NOW() - INTERVAL '200 hours', 1)`);
      const results = await buildNightlyAssertions(client);
      const a5 = results.find(r => r.key === 'fact_snapshot_freshness');
      expect(a5.ok).toBe(false);
      expect(a5.detail).toContain('__stale_probe__');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('proven-to-fire ⑥：账本与运行舱投影分叉 → A6 报红且落 skill_drift_alerts', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM skill_registry WHERE location='openclaw' OR name LIKE 'openclaw/%'`);
      await client.query(`DELETE FROM ops_skills WHERE source='openclaw'`);
      // 账本有 1 条 openclaw，运行舱投影 0 条 → 必分叉
      await client.query(
        `INSERT INTO skill_registry (name,description,location,status)
         VALUES ('__drift_probe__','itest','openclaw','active')`);
      const results = await buildNightlyAssertions(client);
      const a6 = results.find(r => r.key === 'skill_ledger_consistency');
      expect(a6.ok).toBe(false);
      expect(a6.detail).toMatch(/账实分叉/);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM skill_drift_alerts
          WHERE skill_name='__skill_ledger_count__' AND drift_date=CURRENT_DATE`);
      expect(rows[0].n).toBeGreaterThan(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('proven-to-fire ③a：故意造一条无锚 merge 记录 → A2 报红', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [t] } = await client.query(
        `INSERT INTO tasks (title, task_type, status, created_at, payload)
         VALUES ('[test] 无锚merge探针','dev','completed', NOW(), '{}'::jsonb) RETURNING id`);
      await client.query(
        `INSERT INTO dev_records (task_id, pr_title, pr_url, branch, merged_at)
         VALUES ($1,'[test] probe','https://test/pr/0','cp-test-probe', NOW())`, [t.id]);
      const results = await buildNightlyAssertions(client);
      const a2 = results.find(r => r.key === 'zero_unanchored_merges');
      expect(a2.ok).toBe(false);
      expect(a2.detail).toMatch(/无锚 merge/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('proven-to-fire ③a-豁免：同样的 merge 但任务是豁免类型 → A2 不误伤', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [t] } = await client.query(
        `INSERT INTO tasks (title, task_type, status, created_at, payload)
         VALUES ('[test] 豁免探针','ci_patrol','completed', NOW(), '{}'::jsonb) RETURNING id`);
      await client.query(
        `INSERT INTO dev_records (task_id, pr_title, pr_url, branch, merged_at)
         VALUES ($1,'[test] exempt probe','https://test/pr/1','cp-test-exempt', NOW())`, [t.id]);
      const results = await buildNightlyAssertions(client);
      const a2 = results.find(r => r.key === 'zero_unanchored_merges');
      expect(a2.ok).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('proven-to-fire ③b：故意造一个无链接底座件 → A3 报红', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO journey_features (name, kind, thickness, status, "group")
         VALUES ('[test] 孤儿底座探针','feature','thin','planned','家③横切件池')`);
      const results = await buildNightlyAssertions(client);
      const a3 = results.find(r => r.key === 'ledger_integrity');
      expect(a3.ok).toBe(false);
      expect(a3.detail).toMatch(/底座件无链接/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
