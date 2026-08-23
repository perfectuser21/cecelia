import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';

// 冻结测试（TDD Red）：listFailedExecutionTargets 时效窗口豁免
// r40/r45/r50/r51 实证：该查询按 attempt 终身记仇，修复期前的陈旧失败仍拉黑执行目标。
// 本 sprint 让查询只统计最近 N 小时（默认 2h，可由 HARNESS_FAILED_TARGET_TTL_HOURS 配置）内的失败记录。
//
// 注：本 attempt runtime_resources.postgres=false，沿用 repo 既有 attempt-store 测试范式——
// 以 mock pool 断言实际发往 Postgres 的 SQL 文本与绑定参数（时效窗口在 SQL 里表达，逐字锁定）。
// 真实 Postgres 对 make_interval / created_at 窗口的运行时过滤属接缝，登记进未覆盖真实链路清单。

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function poolReturning(rows) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

describe('listFailedExecutionTargets 时效窗口豁免', () => {
  const ORIGINAL_TTL = process.env.HARNESS_FAILED_TARGET_TTL_HOURS;

  afterEach(() => {
    if (ORIGINAL_TTL === undefined) delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    else process.env.HARNESS_FAILED_TARGET_TTL_HOURS = ORIGINAL_TTL;
    vi.restoreAllMocks();
  });

  it('默认 2 小时窗口经 created_at make_interval 过滤且第三参数为 2', async () => {
    delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    const pool = poolReturning([]);
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/created_at\s*>=\s*NOW\(\)\s*-\s*make_interval\s*\(\s*hours\s*=>\s*\$3\s*\)/i);
    expect(params).toEqual([RUN_ID, 'generator', 2]);
  });

  it('HARNESS_FAILED_TARGET_TTL_HOURS 覆盖窗口小时数进第三参数', async () => {
    process.env.HARNESS_FAILED_TARGET_TTL_HOURS = '5';
    const pool = poolReturning([]);
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, 'generator', 5]);
  });

  it('非法 HARNESS_FAILED_TARGET_TTL_HOURS 回退默认 2 小时', async () => {
    process.env.HARNESS_FAILED_TARGET_TTL_HOURS = 'not-a-number';
    const pool = poolReturning([]);
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, 'generator', 2]);
  });

  it('窗口边界采用窗口内含语义使用大于等于比较', async () => {
    delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    const pool = poolReturning([]);
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/created_at\s*>=/i);
    expect(sql).not.toMatch(/created_at\s*>\s*NOW/i);
  });

  it('窗口内失败记录仍映射为执行目标保持记仇语义不变', async () => {
    delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    const pool = poolReturning([
      { provider: 'claude', account_id: 'account1', requested_machine_id: 'us-mac-m4' },
    ]);
    const targets = await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    expect(targets).toEqual([{ provider: 'claude', account: 'account1', machine: 'us-mac-m4' }]);
  });
});
