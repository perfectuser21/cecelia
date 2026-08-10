/**
 * alertness-blocking-states.integration.test.js
 *
 * 真 Postgres + 真 express router 端到端——健康检查红线（PRD 需求 3）。
 * GET /api/brain/alertness 在存在活跃阻断状态位时，必须返回非空 blocking_states 且不报 healthy。
 *
 * 事故实证：tick_draining 卡 2h20m 期间 /api/brain/alertness 仍报 level=1 CALM / "System is healthy"，
 * 健康检查完全看不见静默停摆。本文件把「返回 healthy/CALM 且无阻断标记」钉成失败。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pool from '../../db.js';
import tickRouter from '../../routes/tick.js';
import { drainTick, cancelDrain, _resetDrainState } from '../../drain.js';

const DRAIN_KEY = 'tick_draining';
const VITALS_KEY = 'machine_vitals_stale_alert';

const app = express();
app.use(express.json());
app.use('/api/brain', tickRouter);

beforeEach(async () => {
  _resetDrainState();
  await pool.query(`DELETE FROM working_memory WHERE key = ANY($1)`, [[DRAIN_KEY, VITALS_KEY]]);
});

afterAll(async () => {
  _resetDrainState();
  await pool.query(`DELETE FROM working_memory WHERE key = ANY($1)`, [[DRAIN_KEY, VITALS_KEY]]);
  await pool.end();
});

describe('GET /api/brain/alertness — 阻断位可见性红线', () => {
  it('drain 生效 → blocking_states 非空含 draining+时长，且 blocked=true / healthy=false', async () => {
    await drainTick();

    const res = await request(app).get('/api/brain/alertness');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blocking_states)).toBe(true);
    expect(res.body.blocking_states.length).toBeGreaterThan(0);

    const drain = res.body.blocking_states.find((s) => s.key === 'tick_draining');
    expect(drain).toBeTruthy();
    expect(typeof drain.duration_ms).toBe('number');

    // 健康检查红线：不得报 healthy，必须带阻断标记
    expect(res.body.blocked).toBe(true);
    expect(res.body.healthy).toBe(false);

    await cancelDrain();
  });

  it('无阻断位 → blocking_states 为空、healthy=true', async () => {
    const res = await request(app).get('/api/brain/alertness');
    expect(res.status).toBe(200);
    expect(res.body.blocking_states).toEqual([]);
    expect(res.body.blocked).toBe(false);
    expect(res.body.healthy).toBe(true);
  });
});
