/**
 * token-budget-planner.test.js
 *
 * 测试动态 Token 预算调度器的核心逻辑：
 *   - calculateBudgetState() 四种 state
 *   - 30% 用户预留 (USER_RESERVE_PCT)
 *   - getExecutorAffinity() 降级矩阵
 *   - shouldDowngrade() 降级决策
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateBudgetState,
  getExecutorAffinity,
  shouldDowngrade,
  accountRemainingPct,
  hoursToReset,
  USER_RESERVE_PCT,
  AUTONOMOUS_PCT,
  POOL_C_SCALE,
} from '../token-budget-planner.js';

// Mock account-usage.js
vi.mock('../account-usage.js', () => ({
  getAccountUsage: vi.fn(),
}));

import { getAccountUsage } from '../account-usage.js';

// ============================================================
// 工具函数：构造测试账号数据
// ============================================================

function makeAccount(id, sevenDayPct, sevenDaySonnetPct = null, hoursUntilReset = 72) {
  const now = Date.now();
  const seven_day_resets_at = new Date(now + hoursUntilReset * 3600000).toISOString();
  return {
    account_id: id,
    five_hour_pct: 0,
    seven_day_pct: sevenDayPct,
    seven_day_sonnet_pct: sevenDaySonnetPct ?? sevenDayPct,
    resets_at: null,
    seven_day_resets_at,
    extra_used: false,
  };
}

function makeUsage(...accounts) {
  const result = {};
  for (const a of accounts) result[a.account_id] = a;
  return result;
}

// ============================================================
// USER_RESERVE_PCT / AUTONOMOUS_PCT
// ============================================================

describe('USER_RESERVE_PCT', () => {
  it('用户预留 30%，自主任务 70%', () => {
    expect(USER_RESERVE_PCT).toBe(0.30);
    expect(AUTONOMOUS_PCT).toBe(0.70);
  });
});

// ============================================================
// accountRemainingPct
// ============================================================

describe('accountRemainingPct()', () => {
  it('seven_day_pct=20, 72h to reset → time-weighted remaining', () => {
    // rawRemaining=80, periodFraction=72/168=0.43, effective=80/0.43=100(capped)
    const a = makeAccount('a1', 20, 20);
    expect(accountRemainingPct(a)).toBe(100);
  });

  it('seven_day_sonnet_pct > seven_day_pct → 使用更高者 + 时间加权', () => {
    // rawRemaining=40, periodFraction=72/168=0.43, effective=40/0.43=93
    const a = makeAccount('a1', 30, 60);
    expect(accountRemainingPct(a)).toBeCloseTo(93, 0);
  });

  it('no reset time → raw remaining (no time weighting)', () => {
    const a = { account_id: 'a1', seven_day_pct: 60, seven_day_sonnet_pct: 60 };
    expect(accountRemainingPct(a)).toBe(40);
  });

  it('full 168h remaining → raw remaining (periodFraction=1)', () => {
    const a = makeAccount('a1', 50, 50, 168);
    // periodFraction=168/168=1, not < 1, so returns rawRemaining=50
    expect(accountRemainingPct(a)).toBe(50);
  });

  it('reset 在 2 小时内 → 视为 100%', () => {
    const now = Date.now();
    const a = {
      ...makeAccount('a1', 95, 95),
      seven_day_resets_at: new Date(now + 1 * 3600000).toISOString(),
    };
    expect(accountRemainingPct(a)).toBe(100);
  });

  it('24h to reset, used 53% → effective remaining abundant', () => {
    // rawRemaining=47, periodFraction=24/168=0.14, effective=47/0.14=100(capped)
    const a = makeAccount('a1', 53, 53, 24);
    expect(accountRemainingPct(a)).toBe(100);
  });
});

// ============================================================
// calculateBudgetState — 四种状态
// ============================================================

describe('calculateBudgetState()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('state=abundant：时间加权后充裕（72h reset, 用了 20%）', async () => {
    // rawRemaining=80, periodFraction=72/168=0.43, effective=100(capped) → abundant
    const usage = makeUsage(
      makeAccount('a1', 20),
      makeAccount('a2', 20),
      makeAccount('a3', 20),
    );
    const result = await calculateBudgetState(usage);
    expect(result.state).toBe('abundant');
    expect(result.pool_c_scale).toBe(1.0);
  });

  it('state=moderate：满周期 168h + 用了 55%（无时间加权加成）', async () => {
    // 168h → periodFraction=1 → 不触发时间加权 → rawRemaining=45 → moderate
    const usage = makeUsage(
      makeAccount('a1', 55, null, 168),
      makeAccount('a2', 55, null, 168),
      makeAccount('a3', 55, null, 168),
    );
    const result = await calculateBudgetState(usage);
    expect(result.state).toBe('moderate');
    expect(result.pool_c_scale).toBe(0.7);
  });

  it('state=tight：满周期 168h + 用了 80%', async () => {
    // 168h → rawRemaining=20 → tight
    const usage = makeUsage(
      makeAccount('a1', 80, null, 168),
      makeAccount('a2', 80, null, 168),
      makeAccount('a3', 80, null, 168),
    );
    const result = await calculateBudgetState(usage);
    expect(result.state).toBe('tight');
    expect(result.pool_c_scale).toBe(0.3);
  });

  it('state=critical：几乎耗尽', async () => {
    // rawRemaining≈2, periodFraction=0.43, effective=2/0.43=5 → critical (<10)
    const usage = makeUsage(
      makeAccount('a1', 100),
      makeAccount('a2', 100),
      makeAccount('a3', 95),
    );
    const result = await calculateBudgetState(usage);
    expect(result.state).toBe('critical');
    expect(result.pool_c_scale).toBe(0.0);
  });

  it('离 reset 近 → 时间加权让 moderate 变 abundant', async () => {
    // 用了 53%，离 reset 24h → rawRemaining=47, effective=47/0.14=100 → abundant
    const usage = makeUsage(
      makeAccount('a1', 53, null, 24),
      makeAccount('a2', 53, null, 24),
      makeAccount('a3', 53, null, 24),
    );
    const result = await calculateBudgetState(usage);
    expect(result.state).toBe('abundant');
    expect(result.pool_c_scale).toBe(1.0);
  });

  it('无账号数据 → 保守降级 moderate', async () => {
    const result = await calculateBudgetState({});
    expect(result.state).toBe('moderate');
    expect(result.budget_breakdown.fallback).toBe(true);
  });

  it('getAccountUsage 抛错 → 保守降级 moderate', async () => {
    getAccountUsage.mockRejectedValue(new Error('network error'));
    const result = await calculateBudgetState(null);
    expect(result.state).toBe('moderate');
  });

  it('混合账号：部分耗尽部分充足（满周期）', async () => {
    // 满周期 168h，无时间加权：a1=100%(剩0), a2=20%(剩80), a3=20%(剩80)
    // 平均 = (0+80+80)/3 ≈ 53.3% → moderate
    const usage = makeUsage(
      makeAccount('a1', 100, null, 168),
      makeAccount('a2', 20, null, 168),
      makeAccount('a3', 20, null, 168),
    );
    const result = await calculateBudgetState(usage);
    expect(result.state).toBe('moderate');
    expect(result.avg_remaining_pct).toBeCloseTo(53.3, 0);
  });
});

// ============================================================
// getExecutorAffinity — 降级矩阵
// ============================================================

describe('getExecutorAffinity()', () => {
  it('dev → claude primary，codex fallback，可降级', () => {
    const a = getExecutorAffinity('dev');
    expect(a.primary).toBe('claude');
    expect(a.fallback).toBe('codex');
    expect(a.no_downgrade).toBe(false);
  });

  it('architecture_design → claude primary，no_downgrade=true', () => {
    const a = getExecutorAffinity('architecture_design');
    expect(a.primary).toBe('claude');
    expect(a.fallback).toBeNull();
    expect(a.no_downgrade).toBe(true);
  });

  it('strategy_session → no_downgrade=true', () => {
    expect(getExecutorAffinity('strategy_session').no_downgrade).toBe(true);
  });

  it('initiative_plan → no_downgrade=true', () => {
    expect(getExecutorAffinity('initiative_plan').no_downgrade).toBe(true);
  });

  it('codex_dev → codex primary，no_downgrade=true', () => {
    const a = getExecutorAffinity('codex_dev');
    expect(a.primary).toBe('codex');
    expect(a.no_downgrade).toBe(true);
  });

  it('explore → minimax primary', () => {
    expect(getExecutorAffinity('explore').primary).toBe('minimax');
  });

  it('未知 task_type → 默认 claude primary，codex fallback', () => {
    const a = getExecutorAffinity('unknown_type');
    expect(a.primary).toBe('claude');
    expect(a.fallback).toBe('codex');
    expect(a.no_downgrade).toBe(false);
  });

  it('code_review → 可降级到 codex', () => {
    const a = getExecutorAffinity('code_review');
    expect(a.fallback).toBe('codex');
    expect(a.no_downgrade).toBe(false);
  });
});

// ============================================================
// shouldDowngrade — 降级决策
// ============================================================

describe('shouldDowngrade()', () => {
  it('abundant + dev → 不降级', () => {
    expect(shouldDowngrade('dev', 'abundant')).toBe(false);
  });

  it('moderate + dev → 不降级', () => {
    expect(shouldDowngrade('dev', 'moderate')).toBe(false);
  });

  it('tight + dev → 降级', () => {
    expect(shouldDowngrade('dev', 'tight')).toBe(true);
  });

  it('critical + dev → 降级', () => {
    expect(shouldDowngrade('dev', 'critical')).toBe(true);
  });

  it('tight + architecture_design → 不降级（no_downgrade=true）', () => {
    expect(shouldDowngrade('architecture_design', 'tight')).toBe(false);
  });

  it('critical + strategy_session → 不降级', () => {
    expect(shouldDowngrade('strategy_session', 'critical')).toBe(false);
  });

  it('critical + initiative_plan → 不降级', () => {
    expect(shouldDowngrade('initiative_plan', 'critical')).toBe(false);
  });

  it('tight + code_review → 降级', () => {
    expect(shouldDowngrade('code_review', 'tight')).toBe(true);
  });

  it('tight + codex_dev → 不降级（已是 Codex）', () => {
    expect(shouldDowngrade('codex_dev', 'tight')).toBe(false);
  });

  it('tight + explore → 不降级（MiniMax 任务）', () => {
    expect(shouldDowngrade('explore', 'tight')).toBe(false);
  });
});

// ============================================================
// POOL_C_SCALE
// ============================================================

describe('POOL_C_SCALE', () => {
  it('四种状态都有定义', () => {
    expect(POOL_C_SCALE.abundant).toBe(1.0);
    expect(POOL_C_SCALE.moderate).toBe(0.7);
    expect(POOL_C_SCALE.tight).toBe(0.3);
    expect(POOL_C_SCALE.critical).toBe(0.0);
  });
});
