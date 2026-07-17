/**
 * [T1] economics-relay-usage — relay 回调 usage 落库 failing test
 *
 * sprint: 07162230-agent-economics
 * contract: B1, B2, B3, B4, B12
 *
 * 铁律：
 * - 不 mock updateInitiativeRunEvent，必须真实走 DB 落库断言
 * - 修复前 FAIL（cost_usd 落库 NULL），修复后 PASS
 *
 * mock 范围：仅 pool（DB 层），不 mock business logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- DB mock（hoisted，确保路由 import 前注册）----
const mockRows = vi.hoisted(() => []);
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../packages/brain/src/db.js', () => ({ default: mockPool }));

// mock harness-thread-lookup（relay 分支不走 LangGraph，但 import 链可能引用）
vi.mock('../../packages/brain/src/lib/harness-thread-lookup.js', () => ({
  lookupHarnessThread: vi.fn().mockResolvedValue(null),
}));

// mock notifier（Bark 告警，relay ack 路径可能调用）
vi.mock('../../packages/brain/src/notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(undefined),
}));

// mock initiativeRunEvents — 不 mock，让真实逻辑跑
// 但 DB 层已被 mockPool 拦截，通过 mockPool.query 断言落库 SQL

let app;
let resetCallbackDedupe;

async function buildApp() {
  vi.resetModules();
  const { default: router, _resetCallbackDedupeForTests } = await import(
    '../../packages/brain/src/routes/harness-callback.js'
  );
  resetCallbackDedupe = _resetCallbackDedupeForTests;
  const a = express();
  a.use(express.json());
  a.use('/api/brain', router);
  return a;
}

describe('[T1] relay 回调 usage 落库（B1）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认 pool.query 返回空结果
    mockPool.query.mockResolvedValue({ rows: [] });
    app = await buildApp();
    if (resetCallbackDedupe) resetCallbackDedupe();
  });

  afterEach(() => {
    if (resetCallbackDedupe) resetCallbackDedupe();
  });

  it('B1: relay 回调含 usage → 200 ack + updateInitiativeRunEvent 调用含 cost_usd', async () => {
    // 模拟 initiative_run_events 最新行（id=42）
    // tasks 表反查返回空（不影响 ack）
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // tasks 反查（last_container_exit_code 写入）
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }); // updateInitiativeRunEvent RETURNING

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-test1')
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

    // 断言：必须有一次 UPDATE initiative_run_events 调用，且含 cost_usd / tokens_in / tokens_out
    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );

    // [T1 FAIL POINT] 修复前：relay 分支不调用 updateInitiativeRunEvent，此断言 FAIL
    expect(updateCalls.length, '必须调用 updateInitiativeRunEvent（UPDATE initiative_run_events）').toBeGreaterThan(0);

    const [updateSql, updateParams] = updateCalls[0];
    // 断言 SQL 包含 cost_usd 列
    expect(updateSql).toMatch(/cost_usd/i);
    // 断言参数中含 0.035
    expect(updateParams).toContain(0.035);
    // 断言 SQL 包含 tokens_in / tokens_out
    expect(updateSql).toMatch(/tokens_in/i);
    expect(updateSql).toMatch(/tokens_out/i);
    // 断言参数中含 token 值
    expect(updateParams).toContain(5000);
    expect(updateParams).toContain(2000);
  });

  it('B2: relay 回调不含 usage → 200 ack，不调用 updateInitiativeRunEvent', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-test2')
      .send({
        result: 'done',
        exit_code: 0,
        // 故意不含 usage 字段
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    // 不应调用 updateInitiativeRunEvent（无 usage = 无需写库）
    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    expect(updateCalls.length, '无 usage 时不应调用 updateInitiativeRunEvent').toBe(0);
  });

  it('B3: relay 回调含 usage.total_cost_usd=0 → 写 0（非 NULL）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 43 }] });

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-test3')
      .send({
        result: 'done',
        exit_code: 0,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_cost_usd: 0,
        },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    // [T1 FAIL POINT] 修复前无此调用
    expect(updateCalls.length).toBeGreaterThan(0);
    const [, updateParams] = updateCalls[0];
    // cost_usd=0 应明确写入（不是 NULL）
    expect(updateParams).toContain(0);
  });

  it('B4: relay 回调含负数 cost_usd → cost_usd 不写负数（写 NULL 或跳过）', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-test4')
      .send({
        result: 'done',
        exit_code: 0,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_cost_usd: -1,
        },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);

    // 若有 UPDATE 调用，cost_usd 参数不能为负数
    const updateCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE initiative_run_events/i.test(sql)
    );
    if (updateCalls.length > 0) {
      const [, updateParams] = updateCalls[0];
      // 负数不应出现在参数中
      const hasNegativeCost = updateParams.some(
        (p) => typeof p === 'number' && p < 0
      );
      expect(hasNegativeCost, 'cost_usd 不能写负数').toBe(false);
    }
    // 若完全不调用 UPDATE（跳过处理），也是合法行为
  });

  it('B12: relay 回调 usage 写库失败 → non-fatal，仍返回 200 ack', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // tasks 反查
      .mockRejectedValueOnce(new Error('PG connection error')); // updateInitiativeRunEvent 失败

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/brain/harness/callback/cecelia-relay-abcd1234-test5')
      .send({
        result: 'done',
        exit_code: 0,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_cost_usd: 0.001,
        },
      })
      .expect(200);

    expect(res.body.relayAck).toBe(true);
    // console.warn 应被调用（non-fatal 日志）
    // [T1 FAIL POINT] 修复前：无 updateInitiativeRunEvent 调用，也无 warn；
    //                修复后：PG 失败触发 warn，仍 200 ack
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
