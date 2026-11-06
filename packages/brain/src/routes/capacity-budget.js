/**
 * Capacity Budget API — 动态产能模型
 *
 * GET /capacity-budget — 返回当前机器状态与分区槽位。
 * 旧拆解链依赖的 PR 吞吐预测已退役。
 */

import { Router } from 'express';
import { getTotalEffectiveSlots, getFleetStatus } from '../fleet-resource-cache.js';
import { getMaxStreams } from '../capacity.js';
import { PR_LOC_THRESHOLD } from '../constants/pr-thresholds.js';
import { getMachineVitals } from '../machine-vitals.js';

const router = Router();

// Area 默认权重（用户未配置时的 fallback）
const DEFAULT_AREA_WEIGHTS = {
  cecelia: 0.5,
  zenithjoy: 0.4,
  investment: 0.1,
};

/**
 * 计算动态产能预算
 */
async function computeCapacityBudget() {
  // 1. 获取当前 slot 数
  const fleetSlots = getTotalEffectiveSlots();
  const localSlots = getMaxStreams();
  const totalSlots = fleetSlots > 0 ? fleetSlots : localSlots;

  // 保留调用方仍使用的区域槽位，不再凭理论值预测 PR 数量。
  const areas = {};
  for (const [areaName, weight] of Object.entries(DEFAULT_AREA_WEIGHTS)) {
    areas[areaName] = {
      weight,
      slots: Math.round(totalSlots * weight * 10) / 10,
    };
  }

  // 7. Fleet 详情
  const fleet = getFleetStatus();

  return {
    total_slots: totalSlots,
    areas,
    pr_loc_threshold: PR_LOC_THRESHOLD,
    machine_vitals: getMachineVitals(),
    fleet: fleet.map(s => ({
      id: s.id,
      online: s.online,
      effective_slots: s.effectiveSlots,
      physical_capacity: s.physicalCapacity,
      pressure: s.pressure,
    })),
  };
}

router.get('/capacity-budget', async (_req, res) => {
  try {
    const budget = await computeCapacityBudget();
    res.json(budget);
  } catch (err) {
    console.error('[capacity-budget] 计算失败:', err.message);
    res.status(500).json({ error: '产能预算计算失败', detail: err.message });
  }
});

export default router;
