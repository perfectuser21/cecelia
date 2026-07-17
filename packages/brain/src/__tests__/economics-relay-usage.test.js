/**
 * [T1] economics-relay-usage — relay 回调 usage 落库 failing test
 *
 * sprint: 07162230-agent-economics
 * contract: B1, B2, B3, B4, B12
 *
 * 铁律：
 * - 不 mock updateInitiativeRunEvent，必须真实走 DB 落库断言
 * - 修复前 FAIL（cost_usd 落库 NULL / updateInitiativeRunEvent 未调用），修复后 PASS
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- DB mock（hoisted，确保路由 import 前注册）----
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));

// mock harness-thread-lookup（relay 分支不走 LangGraph）
vi.mock('../lib/harness-thread-lookup.js', () => ({
  lookupHarnessThread: vi.fn().mockResolvedValue(null),
}));

// mock notifier（Bark 告警）
vi.mock('../notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(undefined),
}));

let app;
let resetCallbackDedupe;

async function buildApp() {
  vi.resetModules();
  const mod = await import('../routes/harness-callback.js');
  resetCallbackDedupe = mod._resetCallbackDedupeForTests;
  const a = express();
  a.use(express.json());
  a.use('/api/brain', mod.default);
  return a;
}

describe('[T1] relay 回调 usage 落库', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    app = await buildApp();
    if (resetCallbackDedupe) resetCallbackDedupe();
  });

  afterEach(() => {
    if (resetCallbackDedupe) resetCallbackDedupe();
  });

  it('B1: relay 回调含 usage → 200 ack + UPDATE initiative_run_events 含 cost_usd/tokens_in/tokens_out', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // tasks 反查（exit_code 写入）
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }); // updateInitiativeRunEvent RETURNING

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-t01')
      .send({
        result: 'done',
        exit_code: 0,
        usage: {
          input_tokens: 5000,
          output_tokens: 2000,
          total_cost_usd: 0.035,
        },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    // [T1 FAIL POINT] 修复前：relay 分支不调用 updateInitiativeRunEvent，此断言 FAIL
    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    expect(
      updateCalls.length,
      '修复前 FAIL：relay 分支未调用 updateInitiativeRunEvent'
    ).toBeGreaterThan(0);

    const [updateSql, updateParams] = updateCalls[0];
    expect(updateSql).toMatch(/cost_usd/i);
    expect(updateSql).toMatch(/tokens_in/i);
    expect(updateSql).toMatch(/tokens_out/i);
    expect(updateParams).toContain(0.035);
    expect(updateParams).toContain(5000);
    expect(updateParams).toContain(2000);
  });

  it('B2: relay 回调不含 usage → 200 ack，不调用 updateInitiativeRunEvent', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-t02')
      .send({ result: 'done', exit_code: 0 })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    expect(updateCalls.length, '无 usage 时不应调用 updateInitiativeRunEvent').toBe(0);
  });

  it('B3: usage.total_cost_usd=0 → 写 0（区别于 NULL）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 43 }] });

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-t03')
      .send({
        result: 'done',
        exit_code: 0,
        usage: { input_tokens: 100, output_tokens: 50, total_cost_usd: 0 },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    // [T1 FAIL POINT] 修复前无调用
    expect(updateCalls.length).toBeGreaterThan(0);
    const [, params] = updateCalls[0];
    // cost_usd=0 须明确传入（非 null）
    expect(params).toContain(0);
  });

  it('B4: usage.total_cost_usd 为负数 → 不写负数（NULL 或跳过）', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-t04')
      .send({
        result: 'done',
        exit_code: 0,
        usage: { input_tokens: 100, output_tokens: 50, total_cost_usd: -1 },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    if (updateCalls.length > 0) {
      const [, params] = updateCalls[0];
      const hasNegative = params.some((p) => typeof p === 'number' && p < 0);
      expect(hasNegative, '负数 cost_usd 不得写入').toBe(false);
    }
    // 若直接跳过（不调用 UPDATE）也合法
  });

  it('B12: usage 写库失败 → non-fatal，仍返回 200 ack + console.warn', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // tasks 反查
      .mockRejectedValueOnce(new Error('PG simulated error')); // updateInitiativeRunEvent 失败

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-t05')
      .send({
        result: 'done',
        exit_code: 0,
        usage: { input_tokens: 100, output_tokens: 50, total_cost_usd: 0.001 },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);
    // [T1 FAIL POINT] 修复前无 updateInitiativeRunEvent → 不触发 warn
    expect(warnSpy, 'DB 失败须 console.warn（non-fatal）').toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
