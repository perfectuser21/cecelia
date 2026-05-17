/**
 * PR LOC 阈值 SSOT — Phase 8.3
 *
 * 行业对齐（SmartBear 2006 IBM/Cisco study + Microsoft Research 2013 + Google Engineering Practices）：
 * - 软阈值 200 行：review 质量峰值区间
 * - 硬阈值 400 行：review bug 发现率显著下降的拐点
 *
 * 所有读 PR 行数阈值的代码（capacity-budget API / proxy B-2 / harness-planner
 * workstream 拆分）都必须从这里读，不得硬编码。
 */
export const PR_LOC_THRESHOLD = {
  soft: 200,
  hard: 400,
  source: 'industry-aligned-smartbear-microsoft-2006',
};
