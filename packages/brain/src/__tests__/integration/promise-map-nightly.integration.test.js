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
  it('首跑四断言全绿（seed 后的干净账本）', async () => {
    const results = await buildNightlyAssertions(pool);
    expect(results).toHaveLength(4);
    for (const r of results) expect(r.ok, `${r.key}: ${r.detail}`).toBe(true);
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
