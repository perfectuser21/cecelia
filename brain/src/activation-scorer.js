/**
 * Activation Scorer - 优先级评分系统
 *
 * 决定哪些 pending/inactive 的 project/initiative 应该被激活到 active。
 * 分数高的优先获得 active 空位。
 *
 * 评分维度：
 *   - priority 权重：P0=300, P1=200, P2=100
 *   - aging 防饿死：pending 每天 +2，最多 +200
 *   - progress bonus：做到 30%-70% 的 +40（优先完成半成品）
 *   - dependency bonus：被别人依赖的 +80
 *   - user_pinned：手动置顶 +999
 *   - cooldown 防抖：刚切换状态的在冷却期内返回 -Infinity
 */

const PRIORITY_WEIGHTS = { P0: 300, P1: 200, P2: 100 };
const AGING_MAX = 200;
const AGING_PER_DAY = 2;
const PROGRESS_BONUS = 40;
const DEPENDENCY_BONUS = 80;
const USER_PIN_BONUS = 999;
const DEADLINE_URGENCY_MAX = 150;
const DEADLINE_WINDOW_DAYS = 7;

/**
 * 计算一个实体（project/initiative）的激活分数。
 *
 * @param {Object} entity - 实体对象
 * @param {string} entity.priority - 优先级 P0/P1/P2
 * @param {Date|string} entity.created_at - 创建时间
 * @param {Date|string} entity.updated_at - 最后更新时间（用于 cooldown）
 * @param {number} [entity.progress] - 进度 0-1（可选）
 * @param {number} [entity.dependency_count] - 被依赖数量（可选）
 * @param {boolean} [entity.user_pinned] - 是否被用户置顶（可选）
 * @param {Date|string} [entity.deadline] - 截止日期（可选）
 * @param {number} cooldownMs - 冷却时间（毫秒），刚切换状态的不参与
 * @param {Date} [now] - 当前时间（用于测试注入）
 * @returns {number} 激活分数，-Infinity 表示在冷却期内
 */
export function computeActivationScore(entity, cooldownMs, now = new Date()) {
  // cooldown 检查：刚切换状态的不选
  if (entity.updated_at) {
    const updatedAt = new Date(entity.updated_at);
    const elapsedMs = now.getTime() - updatedAt.getTime();
    if (elapsedMs < cooldownMs) {
      return -Infinity;
    }
  }

  let score = 0;

  // 1. priority 权重
  score += PRIORITY_WEIGHTS[entity.priority] || 0;

  // 2. aging 防饿死
  if (entity.created_at) {
    const daysPending = (now.getTime() - new Date(entity.created_at).getTime()) / (24 * 60 * 60 * 1000);
    score += Math.min(AGING_MAX, Math.floor(daysPending * AGING_PER_DAY));
  }

  // 3. progress bonus（做到一半优先完成）
  const progress = entity.progress || 0;
  if (progress > 0.3 && progress < 0.7) {
    score += PROGRESS_BONUS;
  }

  // 4. dependency bonus
  if (entity.dependency_count && entity.dependency_count > 0) {
    score += DEPENDENCY_BONUS;
  }

  // 5. user_pinned
  if (entity.user_pinned) {
    score += USER_PIN_BONUS;
  }

  // 6. deadline urgency
  if (entity.deadline) {
    const deadlineDate = new Date(entity.deadline);
    const daysUntil = (deadlineDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysUntil <= 0) {
      // 已超期，加满分
      score += DEADLINE_URGENCY_MAX;
    } else if (daysUntil < DEADLINE_WINDOW_DAYS) {
      // 7天窗口内线性增长：越近越高
      score += Math.round(DEADLINE_URGENCY_MAX * (1 - daysUntil / DEADLINE_WINDOW_DAYS));
    }
    // 7天以外不加分
  }

  return score;
}

export {
  PRIORITY_WEIGHTS,
  AGING_MAX,
  AGING_PER_DAY,
  PROGRESS_BONUS,
  DEPENDENCY_BONUS,
  USER_PIN_BONUS,
  DEADLINE_URGENCY_MAX,
  DEADLINE_WINDOW_DAYS,
};
