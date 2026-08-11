/**
 * resolveExecutionTarget 消费 account-usage CAPPED 判定回归测试（issue 7c9f427e）。
 *
 * 契约锚点：contract-draft.md ## Response Schema —— resolveExecutionTarget 新增可选入参
 * is_account_capped：CAPPED 的 target 与 exhausted 同等跳过（preferred 短路 + 候选 .find 均要求
 * !capped）；全部 CAPPED/exhausted → blocked all_execution_targets_exhausted（不静默假死）；
 * is_account_capped 抛错/未注入 → 降级静态白名单顺序不 crash。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：resolveExecutionTarget ↔ 候选/exhausted/capped 选择逻辑
 * ——本测试真调该函数并断言真实 target，不 mock 该函数。允许注入 is_account_capped（代表
 * account-usage 外层独立依赖边界，非被改的选择逻辑本身）。
 */
import { describe, it, expect } from 'vitest';
import { resolveExecutionTarget } from './execution-targets.js';

const account1 = { provider: 'claude', account: 'account1', machine: 'us-mac-m4' };
const account2 = { provider: 'claude', account: 'account2', machine: 'us-mac-m4' };

describe('resolveExecutionTarget 消费 account-usage CAPPED 活数据', () => {
  it('CAPPED 的 preferred 账号被跳过，轮换到 account2', () => {
    const result = resolveExecutionTarget({
      preferred_target: account1,
      candidates: [account1, account2],
      is_account_capped: (t) => t.account === 'account1',
    });
    expect(result.status).toBe('ok');
    expect(result.target.account).toBe('account2');
  });

  it('两账号均 CAPPED → blocked 不静默假死', () => {
    const result = resolveExecutionTarget({
      candidates: [account1, account2],
      is_account_capped: () => true,
    });
    expect(result.status).toBe('blocked');
    expect(result.fallback_reason).toBe('all_execution_targets_exhausted');
  });

  it('is_account_capped 抛错时降级为静态白名单顺序，不 crash', () => {
    const result = resolveExecutionTarget({
      preferred_target: account1,
      candidates: [account1, account2],
      is_account_capped: () => { throw new Error('unreachable'); },
    });
    expect(result.status).toBe('ok');
    expect(result.target.account).toBe('account1');
  });

  it('未注入 is_account_capped 时行为与既有静态顺序一致（preferred healthy）', () => {
    const result = resolveExecutionTarget({
      preferred_target: account1,
      candidates: [account1, account2],
    });
    expect(result.status).toBe('ok');
    expect(result.target.account).toBe('account1');
    expect(result.fallback_reason).toBe('preferred_target_healthy');
  });
});
