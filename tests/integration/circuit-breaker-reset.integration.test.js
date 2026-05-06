/**
 * Circuit Breaker Reset Integration Test (W7.2 / Bug #D)
 *
 * 链路：POST /api/brain/circuit-breaker/:key/reset
 *   pre-seed circuit_breaker_states 行 → 调 reset 端点 →
 *   验证内存 Map state=CLOSED + DB 行 state=CLOSED / failures=0 / opened_at=NULL
 *
 * 路由：packages/brain/src/routes/goals.js
 *   POST /api/brain/circuit-breaker/:key/reset
 *
 * 模块：packages/brain/src/circuit-breaker.js
 *   resetBreaker(key) — 同步内存 + UPSERT DB
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../packages/brain/src/db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const TEST_KEY = `integration-test-cb-${Date.now()}`;

let app;
let circuitBreaker;

beforeAll(async () => {
  // 1) 确保 schema 存在（防 CI 跳号）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS circuit_breaker_states (
      key             TEXT        PRIMARY KEY,
      state           TEXT        NOT NULL CHECK (state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
      failures        INTEGER     NOT NULL DEFAULT 0,
      last_failure_at TIMESTAMPTZ,
      opened_at       TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 2) 加载 circuit-breaker 模块（暴露内存 Map 控制点）+ 路由
  circuitBreaker = await import('../../packages/brain/src/circuit-breaker.js');
  const { default: goalsRouter } = await import('../../packages/brain/src/routes/goals.js');

  app = express();
  app.use(express.json());
  app.use('/api/brain', goalsRouter);
});

afterAll(async () => {
  await pool.query('DELETE FROM circuit_breaker_states WHERE key = $1', [TEST_KEY]);
  // 顺便清理内存（防止其它 integration 测试看到该 key）
  if (circuitBreaker?.reset) circuitBreaker.reset(TEST_KEY);
  await pool.end();
});

beforeEach(async () => {
  // 每个 case 前清干净
  await pool.query('DELETE FROM circuit_breaker_states WHERE key = $1', [TEST_KEY]);
  if (circuitBreaker?.reset) circuitBreaker.reset(TEST_KEY);
});

describe('POST /api/brain/circuit-breaker/:key/reset', () => {
  it('pre-seed OPEN → reset → 内存 Map + DB 行均为 CLOSED', async () => {
    // 1) Pre-seed: DB 行设为 OPEN，模拟 cecelia-run 长期熔断
    const openedAt = new Date(Date.now() - 60_000); // 1 min ago
    await pool.query(
      `INSERT INTO circuit_breaker_states (key, state, failures, last_failure_at, opened_at, updated_at)
       VALUES ($1, 'OPEN', 12, NOW(), $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         state='OPEN', failures=12, opened_at=EXCLUDED.opened_at, updated_at=NOW()`,
      [TEST_KEY, openedAt]
    );

    // 2) 让内存 Map 也带上 OPEN 状态（loadFromDB 是 Brain 启动路径，这里直接走 recordFailure 不合适，
    //    用 reset+手工 _persist 模式难，简单点：调 loadFromDB 加载 DB 行到内存）
    await circuitBreaker.loadFromDB();
    const before = circuitBreaker.getState(TEST_KEY);
    expect(before.state).toBe('OPEN');
    expect(before.failures).toBe(12);

    // 3) 调 reset 端点
    const res = await request(app)
      .post(`/api/brain/circuit-breaker/${encodeURIComponent(TEST_KEY)}/reset`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.key).toBe(TEST_KEY);
    expect(res.body.state.state).toBe('CLOSED');
    expect(res.body.state.failures).toBe(0);

    // 4) 验内存
    const after = circuitBreaker.getState(TEST_KEY);
    expect(after.state).toBe('CLOSED');
    expect(after.failures).toBe(0);
    expect(after.openedAt).toBeNull();
    expect(after.lastFailureAt).toBeNull();

    // 5) 验 DB 行（UPSERT 后行还在，state=CLOSED）
    const { rows } = await pool.query(
      'SELECT state, failures, opened_at, last_failure_at FROM circuit_breaker_states WHERE key = $1',
      [TEST_KEY]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].state).toBe('CLOSED');
    expect(rows[0].failures).toBe(0);
    expect(rows[0].opened_at).toBeNull();
    expect(rows[0].last_failure_at).toBeNull();
  });

  it('从未触发过的新 key → reset 也成功（idempotent，DB 写入 CLOSED 行）', async () => {
    // 没 pre-seed，DB 无行，内存无 entry
    const { rows: before } = await pool.query(
      'SELECT 1 FROM circuit_breaker_states WHERE key = $1',
      [TEST_KEY]
    );
    expect(before.length).toBe(0);

    const res = await request(app)
      .post(`/api/brain/circuit-breaker/${encodeURIComponent(TEST_KEY)}/reset`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.state.state).toBe('CLOSED');

    // 内存 + DB 都为 CLOSED
    expect(circuitBreaker.getState(TEST_KEY).state).toBe('CLOSED');
    const { rows: after } = await pool.query(
      'SELECT state, failures FROM circuit_breaker_states WHERE key = $1',
      [TEST_KEY]
    );
    expect(after.length).toBe(1);
    expect(after[0].state).toBe('CLOSED');
    expect(after[0].failures).toBe(0);
  });
});
