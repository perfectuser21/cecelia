/**
 * topic-selection-stats.test.ts
 *
 * 测试 /api/brain/topics/stats 的核心统计逻辑：
 * - approval_rate = approved / (approved + rejected)，不计 auto_promoted
 * - 无人工审核时 approval_rate = null
 * - meets_target = approval_rate >= 0.7
 * - getContentGapContext 导出为函数
 */

import { describe, it, expect } from 'vitest';

// ── 抽出 stats 纯计算逻辑（与路由解耦测试）────────────────────────────────────

function computeApprovalRate(approved: number, rejected: number): number | null {
  const humanReviewed = approved + rejected;
  if (humanReviewed === 0) return null;
  return Math.round((approved / humanReviewed) * 100) / 100;
}

function buildStatsResult(row: {
  total: number;
  approved: number;
  rejected: number;
  auto_promoted: number;
  pending: number;
  reviewed: number;
}) {
  const { approved, rejected } = row;
  const approval_rate = computeApprovalRate(approved, rejected);
  return {
    ...row,
    approval_rate,
    target_approval_rate: 0.7,
    meets_target: approval_rate !== null ? approval_rate >= 0.7 : null,
  };
}

describe('topic stats — approval_rate 计算', () => {
  it('全部通过 → approval_rate = 1.0', () => {
    const result = buildStatsResult({
      total: 5, approved: 5, rejected: 0, auto_promoted: 0, pending: 0, reviewed: 5,
    });
    expect(result.approval_rate).toBe(1.0);
    expect(result.meets_target).toBe(true);
  });

  it('3通过 1拒绝 → approval_rate = 0.75，meets_target = true', () => {
    const result = buildStatsResult({
      total: 4, approved: 3, rejected: 1, auto_promoted: 0, pending: 0, reviewed: 4,
    });
    expect(result.approval_rate).toBe(0.75);
    expect(result.meets_target).toBe(true);
  });

  it('1通过 2拒绝 → approval_rate = 0.33，meets_target = false', () => {
    const result = buildStatsResult({
      total: 3, approved: 1, rejected: 2, auto_promoted: 0, pending: 0, reviewed: 3,
    });
    expect(result.approval_rate).toBe(0.33);
    expect(result.meets_target).toBe(false);
  });

  it('仅 auto_promoted（无人工审核）→ approval_rate = null', () => {
    const result = buildStatsResult({
      total: 5, approved: 0, rejected: 0, auto_promoted: 5, pending: 0, reviewed: 5,
    });
    expect(result.approval_rate).toBeNull();
    expect(result.meets_target).toBeNull();
  });

  it('全部 pending → approval_rate = null', () => {
    const result = buildStatsResult({
      total: 3, approved: 0, rejected: 0, auto_promoted: 0, pending: 3, reviewed: 0,
    });
    expect(result.approval_rate).toBeNull();
  });

  it('精确到两位小数：2/3 → 0.67', () => {
    const result = buildStatsResult({
      total: 3, approved: 2, rejected: 1, auto_promoted: 0, pending: 0, reviewed: 3,
    });
    expect(result.approval_rate).toBe(0.67);
  });
});

describe('getContentGapContext 导出', () => {
  it('topic-selector 导出 getContentGapContext 函数', async () => {
    // 动态导入确保模块可加载（不连真实 DB，只验证导出）
    const mod = await import('../topic-selector.js');
    expect(typeof mod.getContentGapContext).toBe('function');
  });
});
