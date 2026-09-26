/**
 * org-unit-promotion.js — Area→department 自动升格判定（决策 de1e9ba9，复用存活法则 ca3c6755）。
 *
 * 存活法则：7 天试用期内，连续 3 天无交卷证据即判不合格（对称地，连续达标则合格）。
 * 本函数只判定，不查库、不接调度、不自动建 department 行——调用方自行统计最近若干天的
 * "有无交卷证据" 后传入 { recentDays: [{ date, hasEvidence }, ...] }。升格执行（读 Area 活跃
 * 数据接线 + 定时评估 job + 建 department 行）留给下一棒。
 */

export const SURVIVAL_TRIAL_DAYS = 7;
export const SURVIVAL_MAX_GAP_DAYS = 3;

/**
 * @param {string} areaId
 * @param {{ recentDays: Array<{ date: string, hasEvidence: boolean }> }} opsStats
 * @returns {{ eligible: boolean, reason: string }}
 */
export function evaluateAreaForPromotion(areaId, opsStats) {
  if (!areaId) return { eligible: false, reason: 'areaId is required' };

  const recentDays = opsStats?.recentDays;
  if (!Array.isArray(recentDays) || recentDays.length === 0) {
    return { eligible: false, reason: 'no ops evidence data provided（recentDays 为空）' };
  }

  const sorted = [...recentDays].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sorted.length < SURVIVAL_TRIAL_DAYS) {
    return {
      eligible: false,
      reason: `试用期数据不足：需要 ${SURVIVAL_TRIAL_DAYS} 天，现有 ${sorted.length} 天`,
    };
  }

  const window = sorted.slice(-SURVIVAL_TRIAL_DAYS);
  let consecutiveGap = 0;
  let maxGap = 0;
  for (const day of window) {
    consecutiveGap = day.hasEvidence ? 0 : consecutiveGap + 1;
    maxGap = Math.max(maxGap, consecutiveGap);
  }

  if (maxGap >= SURVIVAL_MAX_GAP_DAYS) {
    return {
      eligible: false,
      reason: `最近 ${SURVIVAL_TRIAL_DAYS} 天内出现连续 ${maxGap} 天无交卷证据（阈值 ${SURVIVAL_MAX_GAP_DAYS} 天），存活法则判定不合格`,
    };
  }

  return {
    eligible: true,
    reason: `最近 ${SURVIVAL_TRIAL_DAYS} 天试用期内最长无证据间隔 ${maxGap} 天，未达降级阈值 ${SURVIVAL_MAX_GAP_DAYS} 天，符合升格条件`,
  };
}
