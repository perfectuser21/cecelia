/**
 * Area Scheduler — 业务线公平调度（YARN Fair Scheduler 模型）
 *
 * 每条 Area 线有 min/max/weight 三个参数：
 * - min: 保底 slot 数（即使其他线空闲也优先满足）
 * - max: 弹性上限（不能超过）
 * - weight: 超出 min 后按权重分配弹性 slot
 *
 * 调度算法（每次 tick dispatch）：
 * 1. 计算每条线的"保底欠债" = max(0, min - running)
 * 2. 欠债 > 0 的线优先派发（按欠债大小排序）
 * 3. 欠债都满足后，剩余 slot 按 weight 比例分
 * 4. running >= max 的线不再派发
 * 5. 队列为空的线释放保底份额给其他线借用
 *
 * 配置存 brain_config 表（key='area_slots'），前台可调。
 */

import pool from './db.js';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_AREA_SLOTS = {
  cecelia:    { min: 3, max: 8,  weight: 3 },
  zenithjoy:  { min: 7, max: 12, weight: 5 },
  investment: { min: 2, max: 6,  weight: 2 },
};

// 未归属到任何 Area 的任务，归入 default 线
const DEFAULT_LINE = 'zenithjoy';

// ============================================================
// Core
// ============================================================

/**
 * 从 brain_config 读取 area_slots 配置。
 * @returns {Promise<Object>} { cecelia: {min,max,weight}, ... }
 */
async function getAreaConfig() {
  try {
    const result = await pool.query(
      `SELECT value FROM brain_config WHERE key = 'area_slots'`
    );
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].value);
    }
  } catch {
    // fallback
  }
  return DEFAULT_AREA_SLOTS;
}

/**
 * 获取每条 Area 线当前运行中的任务数和排队数。
 * @returns {Promise<Object>} { cecelia: {running, queued}, ... }
 */
async function getAreaTaskCounts() {
  const result = await pool.query(`
    SELECT
      COALESCE(g.domain, '${DEFAULT_LINE}') as area,
      count(*) FILTER (WHERE t.status = 'in_progress') as running,
      count(*) FILTER (WHERE t.status = 'queued') as queued
    FROM tasks t
    LEFT JOIN goals g ON t.goal_id = g.id
    WHERE t.status IN ('in_progress', 'queued')
    GROUP BY COALESCE(g.domain, '${DEFAULT_LINE}')
  `);

  const counts = {};
  for (const row of result.rows) {
    counts[row.area] = {
      running: parseInt(row.running) || 0,
      queued: parseInt(row.queued) || 0,
    };
  }
  return counts;
}

/**
 * 选择下一个应该派发任务的 Area 线。
 *
 * @param {number} availableSlots - 当前可用的总 slot 数
 * @returns {Promise<{area: string|null, goalIds: string[], reason: string}>}
 */
export async function selectAreaForDispatch(availableSlots = 1) {
  const config = await getAreaConfig();
  const counts = await getAreaTaskCounts();

  // 构建每条线的状态
  const lines = [];
  for (const [area, cfg] of Object.entries(config)) {
    const c = counts[area] || { running: 0, queued: 0 };
    lines.push({
      area,
      min: cfg.min,
      max: cfg.max,
      weight: cfg.weight,
      running: c.running,
      queued: c.queued,
      deficit: Math.max(0, cfg.min - c.running), // 保底欠债
      atMax: c.running >= cfg.max,
      hasWork: c.queued > 0,
    });
  }

  // 也考虑未归属的任务
  if (counts[''] || counts[null]) {
    const unassigned = counts[''] || counts[null] || { running: 0, queued: 0 };
    if (unassigned.queued > 0) {
      // 未归属任务算入 DEFAULT_LINE
      const defaultLine = lines.find(l => l.area === DEFAULT_LINE);
      if (defaultLine) {
        defaultLine.queued += unassigned.queued;
        defaultLine.running += unassigned.running;
        defaultLine.hasWork = defaultLine.queued > 0;
      }
    }
  }

  // 过滤掉已达上限或无任务的线
  const eligible = lines.filter(l => !l.atMax && l.hasWork);

  if (eligible.length === 0) {
    return { area: null, goalIds: [], reason: 'no_eligible_area' };
  }

  // 第一优先：保底欠债（deficit > 0 的线优先，按 deficit 降序）
  const deficitLines = eligible.filter(l => l.deficit > 0).sort((a, b) => b.deficit - a.deficit);
  if (deficitLines.length > 0) {
    const selected = deficitLines[0];
    const goalIds = await getGoalIdsForArea(selected.area);
    return {
      area: selected.area,
      goalIds,
      reason: `deficit=${selected.deficit} (min=${selected.min}, running=${selected.running})`,
    };
  }

  // 第二优先：弹性分配（按 weight / running 比值，值越高越饥饿）
  const weighted = eligible.map(l => ({
    ...l,
    hunger: l.weight / Math.max(l.running, 1), // 权重高但运行少 = 更饥饿
  })).sort((a, b) => b.hunger - a.hunger);

  const selected = weighted[0];
  const goalIds = await getGoalIdsForArea(selected.area);
  return {
    area: selected.area,
    goalIds,
    reason: `elastic weight=${selected.weight} running=${selected.running} hunger=${selected.hunger.toFixed(2)}`,
  };
}

/**
 * 获取某个 Area 下所有活跃 goal 的 ID。
 * @param {string} area - domain 值（cecelia/zenithjoy/investment）
 * @returns {Promise<string[]>}
 */
async function getGoalIdsForArea(area) {
  const result = await pool.query(
    `SELECT id FROM (
       SELECT id, metadata FROM objectives WHERE status IN ('ready', 'in_progress', 'decomposing')
       UNION ALL
       SELECT id, metadata FROM key_results WHERE status IN ('ready', 'in_progress', 'decomposing')
     ) g WHERE g.metadata->>'domain' = $1`,
    [area]
  );
  return result.rows.map(r => r.id);
}

/**
 * 获取调度状态（供 API 展示）。
 */
export async function getAreaSchedulerStatus() {
  const config = await getAreaConfig();
  const counts = await getAreaTaskCounts();

  const lines = {};
  for (const [area, cfg] of Object.entries(config)) {
    const c = counts[area] || { running: 0, queued: 0 };
    lines[area] = {
      ...cfg,
      running: c.running,
      queued: c.queued,
      deficit: Math.max(0, cfg.min - c.running),
      utilization: c.running / cfg.max,
    };
  }

  return { lines, config_source: 'brain_config.area_slots' };
}

export { getAreaConfig, getAreaTaskCounts, DEFAULT_AREA_SLOTS };
