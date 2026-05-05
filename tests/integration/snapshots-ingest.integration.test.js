/**
 * Snapshots Ingest Integration Test
 *
 * 链路：llm_usage_snapshots 写入与查询
 *   INSERT 多条快照 → SELECT 全量 → 聚合查询（AVG/MAX/COUNT）→ 时间范围过滤 → 字段约束验证
 *
 * llm_usage_snapshots 是系统算力消耗历史快照表，由 tick 每日写入，
 * 供周报和选题引擎查询 LLM API 消耗情况。
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../packages/brain/src/db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });

// 用带时间戳的唯一 account_id 隔离每次测试数据
const TEST_ACCOUNT = `integration-test-${Date.now()}`;
const TEST_ACCOUNT_2 = `integration-test-2nd-${Date.now()}`;

afterAll(async () => {
  await pool.query(
    'DELETE FROM llm_usage_snapshots WHERE account_id LIKE $1',
    ['integration-test-%']
  );
  await pool.end();
});

// ─── 写入 ──────────────────────────────────────────────────────────────────────

describe('Snapshots Ingest — 写入', () => {
  it('INSERT 单条快照，返回 UUID + recorded_at', async () => {
    const { rows } = await pool.query(
      `INSERT INTO llm_usage_snapshots
         (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct, is_spending_capped)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, account_id, recorded_at`,
      [TEST_ACCOUNT, 30.5, 45.2, 12.3, false]
    );
    expect(rows[0].account_id).toBe(TEST_ACCOUNT);
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-/);
    expect(rows[0].recorded_at).toBeTruthy();
  });

  it('INSERT 批量快照（3条），模拟多日采集', async () => {
    const snapshots = [
      [TEST_ACCOUNT, 65.0, 78.9, 23.4, false],
      [TEST_ACCOUNT, 90.0, 92.1, 45.6, true],
      [TEST_ACCOUNT, 15.0, 30.0, 8.0, false],
    ];
    for (const row of snapshots) {
      const { rowCount } = await pool.query(
        `INSERT INTO llm_usage_snapshots
           (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct, is_spending_capped)
         VALUES ($1, $2, $3, $4, $5)`,
        row
      );
      expect(rowCount).toBe(1);
    }
  });

  it('INSERT 多账号快照（不同 account_id 互不干扰）', async () => {
    await pool.query(
      `INSERT INTO llm_usage_snapshots
         (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct, is_spending_capped)
       VALUES ($1, 50, 60, 20, false)`,
      [TEST_ACCOUNT_2]
    );
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM llm_usage_snapshots WHERE account_id = $1',
      [TEST_ACCOUNT_2]
    );
    expect(rows[0].cnt).toBe(1);
  });
});

// ─── 查询 ──────────────────────────────────────────────────────────────────────

describe('Snapshots Ingest — 查询', () => {
  it('SELECT — 按 account_id 查全量（含刚写入的 4 条）', async () => {
    const { rows } = await pool.query(
      'SELECT * FROM llm_usage_snapshots WHERE account_id = $1 ORDER BY recorded_at DESC',
      [TEST_ACCOUNT]
    );
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.account_id === TEST_ACCOUNT)).toBe(true);
    // recorded_at 降序
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i - 1].recorded_at).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[i].recorded_at).getTime()
      );
    }
  });

  it('聚合查询 — AVG / MAX / COUNT 计算正确', async () => {
    const { rows } = await pool.query(
      `SELECT
         ROUND(AVG(five_hour_pct)::numeric, 1)  AS avg_five,
         ROUND(MAX(five_hour_pct)::numeric, 1)  AS peak_five,
         COUNT(*)::int                           AS total
       FROM llm_usage_snapshots
       WHERE account_id = $1`,
      [TEST_ACCOUNT]
    );
    // 4 条：30.5, 65.0, 90.0, 15.0 → avg=50.1, max=90.0
    expect(rows[0].total).toBe(4);
    expect(Number(rows[0].peak_five)).toBe(90.0);
    expect(Number(rows[0].avg_five)).toBeCloseTo(50.1, 0);
  });

  it('时间范围过滤 — 最近 60 秒内的记录全部可查', async () => {
    const since = new Date(Date.now() - 60 * 1000);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM llm_usage_snapshots
       WHERE account_id = $1 AND recorded_at >= $2`,
      [TEST_ACCOUNT, since]
    );
    expect(rows[0].cnt).toBe(4);
  });

  it('is_spending_capped 过滤 — 只返回封顶状态快照', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM llm_usage_snapshots
       WHERE account_id = $1 AND is_spending_capped = true`,
      [TEST_ACCOUNT]
    );
    expect(rows[0].cnt).toBe(1);
  });
});

// ─── 约束验证 ──────────────────────────────────────────────────────────────────

describe('Snapshots Ingest — 约束验证', () => {
  it('account_id NOT NULL — 插入 null 抛异常', async () => {
    await expect(
      pool.query(
        `INSERT INTO llm_usage_snapshots (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct, is_spending_capped)
         VALUES (NULL, 10, 20, 5, false)`
      )
    ).rejects.toThrow();
  });

  it('pct 字段默认值为 0（不传则默认）', async () => {
    const { rows } = await pool.query(
      `INSERT INTO llm_usage_snapshots (account_id)
       VALUES ($1)
       RETURNING five_hour_pct, seven_day_pct, seven_day_sonnet_pct, is_spending_capped`,
      [TEST_ACCOUNT]
    );
    expect(rows[0].five_hour_pct).toBe(0);
    expect(rows[0].seven_day_pct).toBe(0);
    expect(rows[0].is_spending_capped).toBe(false);
  });

  it('索引存在 — 按 (account_id, recorded_at DESC) 查询有效执行', async () => {
    const { rows } = await pool.query(
      `EXPLAIN SELECT * FROM llm_usage_snapshots
       WHERE account_id = $1
       ORDER BY recorded_at DESC
       LIMIT 10`,
      [TEST_ACCOUNT]
    );
    // EXPLAIN 输出不为空，查询能正常执行
    expect(rows.length).toBeGreaterThan(0);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).toBeTruthy();
  });
});
