// worker-pool-resource-health.test.js — 任务 5bf2512a：worker 池派发前查资源健康。
// 原「账号被风控→不预占不发射 / 账号健康→照常发射 / 健康表查询抛错→fail-safe 照常派」三条：
// 已随 Claude 通道退役删除（任务 76a160b3）——worker 池不再派发，健康闸在此处无接线点。
// 秋米（qiumi）手机出口的健康闸在 dispatcher.js，由 dispatcher-qiumi-device-health.test.js /
// lib/__tests__/qiumi-resource-health.test.js / dispatcher-resource-health.test.js 覆盖，不受影响。
import { describe, it, expect, vi } from 'vitest';
import { runWorkerPoolDispatch } from '../worker-pool-dispatch.js';

describe('worker 池 × 资源健康（Claude 通道已退役）', () => {
  it('引用账号的任务：不查 resource_health、不预占，返回 skipped=claude_channel_retired', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const r = await runWorkerPoolDispatch(pool, { execFn: vi.fn() });
    expect(r).toEqual({ skipped: 'claude_channel_retired', dispatched: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
