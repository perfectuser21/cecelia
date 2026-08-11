/**
 * 账号 CAPPED 判定接线 + seven_day 硬过滤 —— TDD Red 合同测试。
 *
 * 契约锚点：contract-draft.md Golden Path Step 2/3。本 sprint 给
 * `expandUnresolvedAccountTargets(targets, opts?)` 增加「额度感知」可选入参：
 *   opts.isAccountCapped?(target): boolean   —— capped 谓词（数据源 account-usage.isSpendingCapped）
 *   opts.accountUsage?: { [accountId]: { five_hour_pct?, seven_day_pct? } }
 *   opts.sevenDayCapPct?: number             —— seven_day 硬过滤阈值，默认 SEVEN_DAY_CAP_PCT(=95)
 * 语义：opts 提供时，展开后候选先剔除 capped、再剔除 seven_day_pct >= 阈值（omelette 不参与），
 * 存活者按 five_hour_pct 升序（缺省按 0）稳定排序；opts 缺省时行为与既有静态白名单顺序完全一致。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：expandUnresolvedAccountTargets ↔ 额度/capped 过滤排序逻辑、
 * expandUnresolvedAccountTargets → resolveExecutionTarget 的候选接力。本测试真调这两个函数并断言
 * 真实返回，不 mock。仅注入 isAccountCapped/accountUsage 作为 account-usage 外层数据边界（非被改逻辑本身）。
 */
import { describe, it, expect } from 'vitest';
import {
  expandUnresolvedAccountTargets,
  resolveExecutionTarget,
} from '../../../packages/brain/src/orchestrator/preflight/execution-targets.js';
import {
  isAccountSevenDayCapped,
  SEVEN_DAY_CAP_PCT,
} from '../../../packages/brain/src/account-usage.js';

const unresolvedClaude = { provider: 'claude', account: null, machine: 'us-mac-m4' };

describe('账号 CAPPED 接线 + seven_day 硬过滤 [BEHAVIOR]', () => {
  it('B-01 核心红线：account1 CAPPED 时候选排除 account1 且解析出 account2', () => {
    const expanded = expandUnresolvedAccountTargets([unresolvedClaude], {
      isAccountCapped: (t) => t.account === 'account1',
      accountUsage: {
        account1: { five_hour_pct: 0, seven_day_pct: 100 },
        account2: { five_hour_pct: 20, seven_day_pct: 10 },
      },
    });
    expect(expanded.map((t) => t.account)).toEqual(['account2']);
    const resolved = resolveExecutionTarget({
      preferred_target: expanded[0],
      candidates: expanded,
    });
    expect(resolved.status).toBe('ok');
    expect(resolved.target.account).toBe('account2');
  });

  it('B-02 seven_day 硬过滤：seven_day=100/five_hour=0/omelette 缺失 → 被排除（当天事故复现）', () => {
    const expanded = expandUnresolvedAccountTargets([unresolvedClaude], {
      accountUsage: {
        account1: { five_hour_pct: 0, seven_day_pct: 100 }, // seven_day_omelette 字段刻意缺失
        account2: { five_hour_pct: 50, seven_day_pct: 12 },
      },
    });
    expect(expanded.map((t) => t.account)).toEqual(['account2']);
    // 单一事实源判定（account-usage 暴露的共用谓词，omelette 缺失也不按 0 当健康）
    expect(SEVEN_DAY_CAP_PCT).toBe(95);
    expect(isAccountSevenDayCapped({ five_hour_pct: 0, seven_day_pct: 100 })).toBe(true);
    expect(isAccountSevenDayCapped({ five_hour_pct: 0, seven_day_pct: 94 })).toBe(false);
  });

  it('B-03 次级排序：两账号 seven_day 均低仅 five_hour 不同 → 按 five_hour 升序（行为不变）', () => {
    const expanded = expandUnresolvedAccountTargets([unresolvedClaude], {
      accountUsage: {
        account1: { five_hour_pct: 50, seven_day_pct: 10 },
        account2: { five_hour_pct: 5, seven_day_pct: 20 },
      },
    });
    expect(expanded.map((t) => t.account)).toEqual(['account2', 'account1']);
  });

  it('B-04 降级铁律：不注入任何 opts → 保持白名单声明顺序（零回归）', () => {
    const expanded = expandUnresolvedAccountTargets([unresolvedClaude]);
    expect(expanded.map((t) => t.account)).toEqual(['account1', 'account2']);
  });

  it('B-05 降级铁律：isAccountCapped 抛错 → 不 crash，所有账号按可用处理', () => {
    let expanded;
    expect(() => {
      expanded = expandUnresolvedAccountTargets([unresolvedClaude], {
        isAccountCapped: () => { throw new Error('account-usage source down'); },
        accountUsage: {
          account1: { five_hour_pct: 10, seven_day_pct: 10 },
          account2: { five_hour_pct: 20, seven_day_pct: 20 },
        },
      });
    }).not.toThrow();
    expect([...expanded.map((t) => t.account)].sort()).toEqual(['account1', 'account2']);
  });
});
