/**
 * Capacity Formula - SLOTS 驱动的容量管控
 *
 * 以 Pool C 可用 SLOTS 为唯一输入，推导所有层级的 active 上限。
 * SLOTS 变化时（设备升降级），所有 cap 自动适配。
 *
 * 公式：
 *   Project:    max = ceil(SLOTS/2)     softMin = 1
 *   Initiative: max = SLOTS             softMin = ceil(SLOTS/3)
 *   Task:       queuedCap = SLOTS × 3  softMin = SLOTS
 */

/**
 * 从 SLOTS 数量计算各层级的容量限制。
 *
 * @param {number} slots - Pool C 可用 slot 数量（通常从 slot-allocator 获取）
 * @returns {Object} 各层级容量配置
 */
export function computeCapacity(slots) {
  const s = Math.max(1, Math.floor(slots)); // 至少 1

  return {
    slots: s,

    project: {
      max: Math.ceil(s / 2),
      softMin: 1,
      cooldownMs: 180_000,   // 3 分钟，Project 切换频率低
    },

    initiative: {
      max: s,
      softMin: Math.ceil(s / 3),
      cooldownMs: 120_000,   // 2 分钟
    },

    task: {
      queuedCap: s * 3,
      softMin: s,
      cooldownMs: 60_000,    // 1 分钟
    },
  };
}

/**
 * 检查某个层级是否已达容量上限。
 *
 * @param {number} currentActive - 当前 active 数量
 * @param {number} max - 该层最大 active 数量
 * @returns {boolean} true = 已满，不应再创建/激活
 */
export function isAtCapacity(currentActive, max) {
  return currentActive >= max;
}
