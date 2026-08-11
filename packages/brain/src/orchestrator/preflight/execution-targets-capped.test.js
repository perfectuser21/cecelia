/**
 * resolveExecutionTarget × account-usage CAPPED 消费（Brain issue 7c9f427e, P0）。
 *
 * 根因：resolveExecutionTarget 只查 per-run exhausted_targets，不消费 account-usage
 * 的 CAPPED 活数据 → 静态白名单 claude 首位恒为 account1，account1 7d=100% CAPPED
 * 时仍被选中 → 每个新 run 从空 exhausted 开始必撞 account1 429。
 *
 * 本测试锚定：resolveExecutionTarget 接受 is_account_capped 判定（由调用方从
 * account-usage 单一事实源注入），CAPPED 账号被跳过；判定不可达/抛错时降级为
 * 静态白名单顺序不 crash（PRD 边界情况）。
 *
 * DB-free 纯单元测试：is_account_capped 由测试直接注入，不 import account-usage.js
 * （后者 import db.js，会把 Postgres 依赖拖进纯函数测试）。
 */
import { describe, expect, it } from 'vitest';

import { resolveExecutionTarget } from './execution-targets.js';

const A1 = { provider: 'claude', account: 'account1', machine: 'us-mac-m4' };
const A2 = { provider: 'claude', account: 'account2', machine: 'us-mac-m4' };

describe('resolveExecutionTarget account-usage CAPPED 消费', () => {
  it('CAPPED 的 preferred 账号被跳过，选下一个未 CAPPED 的 claude 账号', () => {
    const result = resolveExecutionTarget({
      preferred_target: A1,
      candidates: [A1, A2],
      exhausted_targets: [],
      is_account_capped: (t) => t.account === 'account1',
    });
    expect(result.status).toBe('ok');
    expect(result.target).toEqual(A2);
  });

  it('CAPPED 账号即使未 exhausted 也不被选为候选（跳过语义）', () => {
    const result = resolveExecutionTarget({
      preferred_target: A2,
      candidates: [A2, A1],
      exhausted_targets: [],
      is_account_capped: (t) => t.account === 'account1',
    });
    expect(result.status).toBe('ok');
    expect(result.target).toEqual(A2);
  });

  it('claude 两账号均 CAPPED → blocked all_execution_targets_exhausted（不静默假死）', () => {
    const result = resolveExecutionTarget({
      preferred_target: A1,
      candidates: [A1, A2],
      exhausted_targets: [],
      is_account_capped: () => true,
    });
    expect(result.status).toBe('blocked');
    expect(result.fallback_reason).toBe('all_execution_targets_exhausted');
  });

  it('account-usage 判定抛错时降级为静态白名单顺序，不 crash', () => {
    const result = resolveExecutionTarget({
      preferred_target: A1,
      candidates: [A1, A2],
      exhausted_targets: [],
      is_account_capped: () => { throw new Error('account-usage unreachable'); },
    });
    expect(result.status).toBe('ok');
    expect(result.target).toEqual(A1);
  });

  it('未注入 is_account_capped 时行为不变（默认无人 CAPPED，回归保护）', () => {
    const result = resolveExecutionTarget({
      preferred_target: A1,
      candidates: [A1, A2],
      exhausted_targets: [],
    });
    expect(result.status).toBe('ok');
    expect(result.target).toEqual(A1);
  });
});
