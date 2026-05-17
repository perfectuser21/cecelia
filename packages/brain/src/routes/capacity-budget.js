/**
 * Capacity Budget API — 动态产能模型
 *
 * 基于过去 7 天实际完成的 PR 数量和 slot·天数，计算 pr_per_slot_per_day。
 * 冷启动使用理论值 25，随数据积累自校准（confidence: theoretical → low → medium → high）。
 *
 * GET /capacity-budget  — 返回当前产能预算（供 /decomp 和 /decomp-check 使用）
 */

import { Router } from 'express';
import pool from '../db.js';
import { getTotalEffectiveSlots, getFleetStatus } from '../fleet-resource-cache.js';
import { getMaxStreams } from '../capacity.js';
import { PR_LOC_THRESHOLD } from '../constants/pr-thresholds.js';

const router = Router();

// 理论值常量（冷启动 fallback）
const THEORETICAL_PR_PER_SLOT_PER_DAY = 25; // 基于 40min/PR, 24h, 70% 效率
const THEORETICAL_PR_DURATION_MIN = 40;

// confidence 阈值
const CONFIDENCE_THRESHOLDS = {
  low: 10,      // >= 10 样本
  medium: 50,   // >= 50 样本
  high: 200,    // >= 200 样本
};

// Area 默认权重（用户未配置时的 fallback）
const DEFAULT_AREA_WEIGHTS = {
  cecelia: 0.5,
  zenithjoy: 0.4,
  investment: 0.1,
};

/**
 * 从数据库查询过去 N 天的实际产能数据
 * 只统计 task_type='dev' 且有 started_at + completed_at 的任务
 */
async function queryHistoricalCapacity(days = 7) {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as completed_prs,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as avg_duration_min,
        MIN(started_at) as earliest,
        MAX(completed_at) as latest
      FROM tasks
      WHERE task_type = 'dev'
        AND status = 'completed'
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_at > NOW() - make_interval(days => $1)
        AND EXTRACT(EPOCH FROM (completed_at - started_at)) > 60
        AND EXTRACT(EPOCH FROM (completed_at - started_at)) < 7200
    `, [days]);
    return {
      completed_prs: parseInt(rows[0]?.completed_prs || '0', 10),
      avg_duration_min: parseFloat(rows[0]?.avg_duration_min || '0'),
      earliest: rows[0]?.earliest,
      latest: rows[0]?.latest,
    };
  } catch {
    return { completed_prs: 0, avg_duration_min: 0, earliest: null, latest: null };
  }
}

/**
 * 计算 confidence level
 */
function getConfidence(sampleSize) {
  if (sampleSize >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (sampleSize >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  if (sampleSize >= CONFIDENCE_THRESHOLDS.low) return 'low';
  return 'theoretical';
}

/**
 * 计算动态产能预算
 */
async function computeCapacityBudget() {
  // 1. 获取当前 slot 数
  const fleetSlots = getTotalEffectiveSlots();
  const localSlots = getMaxStreams();
  const totalSlots = fleetSlots > 0 ? fleetSlots : localSlots;

  // 2. 查询历史数据
  const history = await queryHistoricalCapacity(7);
  const sampleSize = history.completed_prs;
  const confidence = getConfidence(sampleSize);

  // 3. 计算 pr_per_slot_per_day
  let prPerSlotPerDay;
  let avgPrDurationMin;

  if (sampleSize >= CONFIDENCE_THRESHOLDS.low) {
    const slotDays = Math.max(1, totalSlots * 7);
    prPerSlotPerDay = Math.round((sampleSize / slotDays) * 10) / 10;
    avgPrDurationMin = Math.round(history.avg_duration_min * 10) / 10;
  } else {
    prPerSlotPerDay = THEORETICAL_PR_PER_SLOT_PER_DAY;
    avgPrDurationMin = THEORETICAL_PR_DURATION_MIN;
  }

  // 4. 推算各时间窗口的产能
  const dailyCapacity = Math.round(totalSlots * prPerSlotPerDay);
  const weeklyCapacity = dailyCapacity * 7;
  const monthlyCapacity = dailyCapacity * 30;

  // 5. Area 级别分配
  const areas = {};
  for (const [areaName, weight] of Object.entries(DEFAULT_AREA_WEIGHTS)) {
    const areaSlots = Math.round(totalSlots * weight * 10) / 10;
    areas[areaName] = {
      weight,
      slots: areaSlots,
      daily_pr: Math.round(areaSlots * prPerSlotPerDay),
      weekly_pr: Math.round(areaSlots * prPerSlotPerDay * 7),
      monthly_pr: Math.round(areaSlots * prPerSlotPerDay * 30),
    };
  }

  // 6. 各层级的 PR 预算（基于固定时间框架）
  const layerBudgets = {
    task: { time_frame: '40min', pr_count: 1 },
    initiative: {
      time_frame: '0.5-1 天',
      pr_count_per_slot: Math.round(prPerSlotPerDay * 0.75),
    },
    scope: {
      time_frame: '2-3 天',
      pr_count_per_slot: Math.round(prPerSlotPerDay * 2.5),
    },
    project: {
      time_frame: '1 周',
      pr_count_per_slot: Math.round(prPerSlotPerDay * 7),
    },
    kr: {
      time_frame: '1 个月',
      pr_count_total: monthlyCapacity,
    },
  };

  // 7. Fleet 详情
  const fleet = getFleetStatus();

  return {
    total_slots: totalSlots,
    pr_per_slot_per_day: prPerSlotPerDay,
    avg_pr_duration_min: avgPrDurationMin,
    confidence,
    sample_size: sampleSize,
    calibration_window_days: 7,
    last_calibrated: history.latest || null,
    daily_capacity: dailyCapacity,
    weekly_capacity: weeklyCapacity,
    monthly_capacity: monthlyCapacity,
    areas,
    layer_budgets: layerBudgets,
    pr_loc_threshold: PR_LOC_THRESHOLD,
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
