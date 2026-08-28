// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：capability preflight ↔ attempt-store 失败目标查询
//
// r40/r45/r50/r51 实证：listFailedExecutionTargets 按 attempt 终身记仇——修复期前的陈旧失败
// 仍把仅有的执行目标拉黑，preflight 走向 all_execution_targets_exhausted 死等。本步骤守卫落在
// 「preflight 收集 failed_targets」这条真实的边上：真 attempt-store 查询（不 mock 被改模块），
// 只用 stub pool 捕获实际发往 Postgres 的 SQL 文本与绑定参数，逐字锁定时效窗口谓词。
//
// 决策 109dd8eb：守卫用真零件跑，不许把被改模块 vi.mock 掉。
import { describe, it, expect } from 'vitest';

import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function stubPool(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

describe('F1/step3 preflight failed_targets 时效窗口豁免（真 attempt-store 边）', () => {
  it('默认 2 小时窗口经 created_at make_interval 过滤且第三参数为 2', async () => {
    delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    const pool = stubPool();
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const [sql, params] = [pool.calls[0].sql, pool.calls[0].params];
    expect(sql).toMatch(/created_at\s*>=\s*NOW\(\)\s*-\s*make_interval\s*\(\s*hours\s*=>\s*\$3\s*\)/i);
    expect(params).toEqual([RUN_ID, 'generator', 2]);
  });

  it('HARNESS_FAILED_TARGET_TTL_HOURS 覆盖窗口小时数进第三参数（记仇窗口可配）', async () => {
    const original = process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    process.env.HARNESS_FAILED_TARGET_TTL_HOURS = '5';
    try {
      const pool = stubPool();
      await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
      expect(pool.calls[0].params).toEqual([RUN_ID, 'generator', 5]);
    } finally {
      if (original === undefined) delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
      else process.env.HARNESS_FAILED_TARGET_TTL_HOURS = original;
    }
  });

  it('窗口内失败记录仍映射为执行目标（记仇语义不变）', async () => {
    delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
    const pool = stubPool([
      // r80: 行携 error_code / failure_class（供上层 filterBlacklistableTargets 过滤合同故障）
      {
        provider: 'claude',
        account_id: 'account1',
        requested_machine_id: 'us-mac-m4',
        error_code: 'provider_exit',
        failure_class: null,
      },
    ]);
    const targets = await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    expect(targets).toEqual([{
      provider: 'claude',
      account: 'account1',
      machine: 'us-mac-m4',
      error_code: 'provider_exit',
      failure_class: null,
    }]);
  });
});
