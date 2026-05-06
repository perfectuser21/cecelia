/**
 * Circuit Breaker Reset Integration Test (W7.2 Bug #D)
 *
 * 链路：POST /api/brain/circuit-breaker/:key/reset → resetBreaker(key) →
 *   内存 Map 置 CLOSED + DB UPDATE state='CLOSED'
 *
 * 关键点：内存 + DB 双重一致性。重置前 pre-seed OPEN 行 + loadFromDB() 装入内存，
 *   重置后两边都必须是 CLOSED（这是修 cecelia-run 长期 OPEN 问题的根据）。
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });

const TEST_KEY_PREFIX = `cb-reset-test-${process.hrtime.bigint()}`;
const createdKeys = new Set();

let app;
let cb; // circuit-breaker module（同一个 process 实例，内存 Map 跨 it 共享）

beforeAll(async () => {
  cb = await import('../../circuit-breaker.js');
  const { default: goalsRouter } = await import(
    '../../routes/goals.js'
  );
  app = express();
  app.use(express.json());
  app.use('/api/brain', goalsRouter);
});

afterAll(async () => {
  if (createdKeys.size) {
    await pool.query(
      'DELETE FROM circuit_breaker_states WHERE key = ANY($1::text[])',
      [Array.from(createdKeys)]
    );
  }
  await pool.end();
});

async function seedOpen(key, failures = 22) {
  createdKeys.add(key);
  const openedAt = new Date();
  const lastFailureAt = new Date(openedAt.getTime() - 1000);
  await pool.query(
    `INSERT INTO circuit_breaker_states (key, state, failures, last_failure_at, opened_at, updated_at)
     VALUES ($1, 'OPEN', $2, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET
       state='OPEN', failures=$2, last_failure_at=$3, opened_at=$4, updated_at=NOW()`,
    [key, failures, lastFailureAt, openedAt]
  );
}

async function readDb(key) {
  const r = await pool.query(
    'SELECT state, failures, last_failure_at, opened_at FROM circuit_breaker_states WHERE key=$1',
    [key]
  );
  return r.rows[0] || null;
}

describe('Circuit Breaker Reset — POST /api/brain/circuit-breaker/:key/reset', () => {
  it('pre-seed OPEN → reset 后内存 + DB 都 CLOSED（核心场景）', async () => {
    const key = `${TEST_KEY_PREFIX}-open-to-closed`;
    await seedOpen(key, 22);

    // 装入内存：模拟 Brain 启动从 DB 恢复
    await cb.loadFromDB();
    const before = cb.getState(key);
    expect(before.state).toBe('OPEN');
    expect(before.failures).toBe(22);

    // 调 reset API
    const res = await request(app)
      .post(`/api/brain/circuit-breaker/${encodeURIComponent(key)}/reset`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.key).toBe(key);
    expect(res.body.state.state).toBe('CLOSED');
    expect(res.body.state.failures).toBe(0);
    expect(res.body.state.lastFailureAt).toBeNull();
    expect(res.body.state.openedAt).toBeNull();

    // 验证内存
    const after = cb.getState(key);
    expect(after.state).toBe('CLOSED');
    expect(after.failures).toBe(0);
    expect(after.lastFailureAt).toBeNull();
    expect(after.openedAt).toBeNull();

    // 验证 DB（关键：UPDATE 而非 DELETE，留行做审计）
    const dbRow = await readDb(key);
    expect(dbRow).not.toBeNull();
    expect(dbRow.state).toBe('CLOSED');
    expect(dbRow.failures).toBe(0);
    expect(dbRow.last_failure_at).toBeNull();
    expect(dbRow.opened_at).toBeNull();
  });

  it('未知 key → 创建 CLOSED 行（不报错）', async () => {
    const key = `${TEST_KEY_PREFIX}-fresh`;
    createdKeys.add(key);

    const dbBefore = await readDb(key);
    expect(dbBefore).toBeNull();

    const res = await request(app)
      .post(`/api/brain/circuit-breaker/${encodeURIComponent(key)}/reset`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.state.state).toBe('CLOSED');

    const dbAfter = await readDb(key);
    expect(dbAfter.state).toBe('CLOSED');
    expect(dbAfter.failures).toBe(0);
  });

  it('反复 reset 幂等 — 内存 + DB 终态稳定 CLOSED', async () => {
    const key = `${TEST_KEY_PREFIX}-idempotent`;
    await seedOpen(key, 8);
    await cb.loadFromDB();

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`/api/brain/circuit-breaker/${encodeURIComponent(key)}/reset`)
        .expect(200);
      expect(res.body.state.state).toBe('CLOSED');
    }

    expect(cb.getState(key).state).toBe('CLOSED');
    const dbRow = await readDb(key);
    expect(dbRow.state).toBe('CLOSED');
    expect(dbRow.failures).toBe(0);
  });
});
