/**
 * Nightly Orchestrator — 夜间自驱任务编排引擎 v1
 *
 * 职责：
 *   在夜间窗口（20:00-08:00 UTC）自主调度待办任务，减少人工编排干预。
 *
 * 设计原则：
 *   - Self-Drive 负责"创建任务"（基于健康分析），Orchestrator 负责"调度执行"（基于任务队列）
 *   - v1 使用启发式评分（priority + KR对齐 + 任务龄），不调 LLM（成本控制）
 *   - 幂等：同一任务不会被重复派发（dispatched_by_orchestrator 标记）
 *   - 容量感知：从 capacity.js 读取当前可用 slots
 *
 * 调度节律：
 *   - 夜间窗口内每 30 分钟运行一次编排周期
 *   - 07:00 UTC 触发夜间总结报告（写入 daily_logs）
 */

import pool from './db.js';
import { getMaxStreams } from './capacity.js';
import { emit } from './event-bus.js';

// ── 配置 ──────────────────────────────────────────────────

/** 夜间窗口起始小时（UTC） */
const NIGHT_START_HOUR_UTC = parseInt(process.env.NIGHT_ORCHESTRATOR_START_UTC || '20', 10);
/** 夜间窗口结束小时（UTC），不含 */
const NIGHT_END_HOUR_UTC   = parseInt(process.env.NIGHT_ORCHESTRATOR_END_UTC   || '8', 10);
/** 每次编排周期的间隔（夜间，ms） */
const CYCLE_INTERVAL_MS = parseInt(process.env.NIGHT_ORCHESTRATOR_INTERVAL_MS || String(30 * 60 * 1000), 10);
/** 每次编排周期最多派发的任务数量（防止过载） */
const MAX_DISPATCH_PER_CYCLE = parseInt(process.env.NIGHT_ORCHESTRATOR_MAX_DISPATCH || '3', 10);
/** 早报触发小时（UTC） */
const MORNING_REPORT_HOUR_UTC = parseInt(process.env.NIGHT_ORCHESTRATOR_MORNING_UTC || '7', 10);

// ── 内部状态 ──────────────────────────────────────────────

let _timer = null;
let _running = false;
let _lastCycleAt = null;
let _cycleCount = 0;
let _dispatchedTonight = 0;
let _lastReportDate = null;

// ── 夜间窗口检测 ──────────────────────────────────────────

/**
 * 判断给定时间（默认 now）是否在夜间编排窗口内（20:00-08:00 UTC）。
 * 跨午夜段：NIGHT_START_HOUR_UTC > NIGHT_END_HOUR_UTC 时判断为"不在 END～START 之间"。
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isNightWindow(now = new Date()) {
  const hour = now.getUTCHours();
  if (NIGHT_START_HOUR_UTC > NIGHT_END_HOUR_UTC) {
    // 跨午夜：20:00-08:00 → true when hour >= 20 || hour < 8
    return hour >= NIGHT_START_HOUR_UTC || hour < NIGHT_END_HOUR_UTC;
  }
  // 日内段（不跨午夜）
  return hour >= NIGHT_START_HOUR_UTC && hour < NIGHT_END_HOUR_UTC;
}

// ── 任务队列读取 ──────────────────────────────────────────

/**
 * 读取待编排的任务队列：
 *   1. status = 'queued'
 *   2. 未被当前 orchestrator 周期派发（payload 不含 dispatched_by_orchestrator: today）
 *   3. task_type 在可执行范围内（非 harness 复合任务）
 *
 * @returns {Promise<Array>}
 */
async function getPendingBacklog() {
  const today = new Date().toISOString().split('T')[0];
  const result = await pool.query(`
    SELECT
      t.id,
      t.title,
      t.task_type,
      t.priority,
      t.payload,
      t.created_at,
      t.project_id,
      EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600 AS age_hours
    FROM tasks t
    WHERE t.status = 'queued'
      AND (
        t.payload->>'dispatched_by_orchestrator' IS NULL
        OR t.payload->>'dispatched_orchestrator_date' < $1
      )
      AND t.task_type NOT IN (
        'harness_planner', 'harness_contract_propose', 'harness_contract_review',
        'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_report',
        'sprint_planner', 'sprint_generate', 'sprint_evaluate'
      )
    ORDER BY
      CASE t.priority
        WHEN 'P0' THEN 0
        WHEN 'P1' THEN 1
        WHEN 'P2' THEN 2
        WHEN 'P3' THEN 3
        ELSE 4
      END ASC,
      t.created_at ASC
    LIMIT 20
  `, [today]);

  return result.rows;
}

// ── 任务评分 ──────────────────────────────────────────────

/**
 * 启发式评分（越高越优先调度）：
 *   - priority 权重：P0=100, P1=75, P2=50, P3=25
 *   - 任务龄加分：每小时 +0.5（最多 +24）
 *   - dev/review 类型加分 +10（KR 对齐）
 *
 * @param {Object} task
 * @returns {number} score
 */
export function scoreTask(task) {
  const priorityScore = { P0: 100, P1: 75, P2: 50, P3: 25 }[task.priority] ?? 30;
  const ageScore = Math.min(24, parseFloat(task.age_hours || 0) * 0.5);
  const typeScore = ['dev', 'review', 'code_review', 'qa'].includes(task.task_type) ? 10 : 0;
  return priorityScore + ageScore + typeScore;
}

// ── 容量计算 ──────────────────────────────────────────────

/**
 * 读取当前活跃任务数，计算可用 dispatch 槽位数。
 *
 * @returns {Promise<number>} 可派发的槽位数
 */
async function getAvailableSlots() {
  const maxStreams = getMaxStreams();

  const { rows } = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM tasks
    WHERE status = 'in_progress'
  `);
  const inProgress = parseInt(rows[0]?.cnt || 0, 10);
  const available = Math.max(0, Math.min(MAX_DISPATCH_PER_CYCLE, maxStreams - inProgress));
  return available;
}

// ── 派发标记 ──────────────────────────────────────────────

/**
 * 将任务标记为"已由 orchestrator 派发"，防止重复处理。
 * 不改变 task status（仍由 tick loop 实际拉起）。
 *
 * @param {string} taskId
 */
async function markDispatched(taskId) {
  const today = new Date().toISOString().split('T')[0];
  await pool.query(`
    UPDATE tasks
    SET payload = payload || $1::jsonb,
        updated_at = NOW()
    WHERE id = $2
  `, [
    JSON.stringify({
      dispatched_by_orchestrator: true,
      dispatched_orchestrator_date: today,
      orchestrator_dispatched_at: new Date().toISOString()
    }),
    taskId
  ]);
}

// ── 编排周期 ──────────────────────────────────────────────

/**
 * 执行一次夜间编排周期：
 *   1. 检查夜间窗口
 *   2. 读取待办队列
 *   3. 评分排序
 *   4. 按容量批量标记派发
 *   5. 发出事件
 *
 * @returns {Promise<Object>} 本次周期结果
 */
export async function runOrchestrationCycle() {
  const now = new Date();
  _cycleCount++;

  if (!isNightWindow(now)) {
    return { skipped: true, reason: 'outside_night_window', hour_utc: now.getUTCHours() };
  }

  const backlog = await getPendingBacklog();
  if (backlog.length === 0) {
    _lastCycleAt = now;
    return { dispatched: 0, reason: 'empty_backlog', cycle: _cycleCount };
  }

  // 评分 + 排序
  const scored = backlog
    .map(t => ({ ...t, score: scoreTask(t) }))
    .sort((a, b) => b.score - a.score);

  // 容量检查
  const slots = await getAvailableSlots();
  const toDispatch = scored.slice(0, slots);

  const dispatched = [];
  for (const task of toDispatch) {
    await markDispatched(task.id);
    dispatched.push({ id: task.id, title: task.title, task_type: task.task_type, score: task.score });
    _dispatchedTonight++;
  }

  _lastCycleAt = now;

  if (dispatched.length > 0) {
    await emit('nightly_orchestration_cycle', 'nightly-orchestrator', {
      cycle: _cycleCount,
      dispatched_count: dispatched.length,
      dispatched_ids: dispatched.map(d => d.id),
      available_slots: slots,
      backlog_size: backlog.length
    });

    console.log(`[NightlyOrchestrator] Cycle ${_cycleCount}: dispatched ${dispatched.length}/${backlog.length} tasks (slots=${slots})`);
  }

  return {
    cycle: _cycleCount,
    backlog_size: backlog.length,
    available_slots: slots,
    dispatched_count: dispatched.length,
    dispatched
  };
}

// ── 早报生成 ──────────────────────────────────────────────

/**
 * 生成夜间编排总结报告，写入 daily_logs。
 * 幂等：今日已写则更新。
 */
async function generateOvernightReport() {
  const today = new Date().toISOString().split('T')[0];

  if (_lastReportDate === today) {
    return { skipped: true, reason: 'already_generated_today' };
  }

  // 查询今夜被 orchestrator 派发的任务统计
  const { rows: dispatchedRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE payload->>'dispatched_orchestrator_date' = $1) AS dispatched_today,
      COUNT(*) FILTER (WHERE payload->>'dispatched_orchestrator_date' = $1 AND status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE payload->>'dispatched_orchestrator_date' = $1 AND status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE payload->>'dispatched_orchestrator_date' = $1 AND status = 'in_progress') AS in_progress
    FROM tasks
    WHERE payload->>'dispatched_by_orchestrator' = 'true'
  `, [today]);

  const stats = dispatchedRows[0] || {};
  const report = {
    date: today,
    generated_at: new Date().toISOString(),
    orchestrator: {
      cycles_run: _cycleCount,
      total_dispatched_tonight: _dispatchedTonight,
      tasks: {
        dispatched: parseInt(stats.dispatched_today || 0, 10),
        completed: parseInt(stats.completed || 0, 10),
        failed: parseInt(stats.failed || 0, 10),
        in_progress: parseInt(stats.in_progress || 0, 10)
      }
    }
  };

  // 写入 daily_logs
  const existing = await pool.query(
    `SELECT id FROM daily_logs WHERE date = $1 AND type = 'nightly_orchestration'`,
    [today]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE daily_logs SET summary = $2, agent = 'nightly-orchestrator' WHERE id = $1`,
      [existing.rows[0].id, JSON.stringify(report)]
    );
  } else {
    await pool.query(
      `INSERT INTO daily_logs (date, project_id, summary, type, agent) VALUES ($1, NULL, $2, 'nightly_orchestration', 'nightly-orchestrator')`,
      [today, JSON.stringify(report)]
    );
  }

  _lastReportDate = today;
  // 重置夜间统计
  _cycleCount = 0;
  _dispatchedTonight = 0;

  console.log(`[NightlyOrchestrator] Morning report generated for ${today}: ${report.orchestrator.tasks.dispatched} tasks dispatched`);

  await emit('nightly_orchestration_report', 'nightly-orchestrator', report);
  return { generated: true, report };
}

// ── 调度器 ──────────────────────────────────────────────

/**
 * 计算下次运行的延迟（ms）。
 * - 在夜间窗口内：CYCLE_INTERVAL_MS
 * - 在白天：计算到下次夜间窗口开始的时间
 */
function msUntilNextCycle() {
  const now = new Date();
  if (isNightWindow(now)) {
    return CYCLE_INTERVAL_MS;
  }
  // 计算到 NIGHT_START_HOUR_UTC 的剩余时间
  const next = new Date(now);
  next.setUTCHours(NIGHT_START_HOUR_UTC, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * 检查是否需要触发早报（07:00 UTC 的宽窗口：07:00-08:00）
 */
function shouldTriggerMorningReport(now = new Date()) {
  const hour = now.getUTCHours();
  const today = now.toISOString().split('T')[0];
  return hour === MORNING_REPORT_HOUR_UTC && _lastReportDate !== today;
}

/**
 * 安全运行编排周期（含早报逻辑）
 */
async function runCycleSafe() {
  if (_running) {
    console.log('[NightlyOrchestrator] Already running, skipping');
    return;
  }
  _running = true;

  try {
    const now = new Date();

    // 早报优先
    if (shouldTriggerMorningReport(now)) {
      await generateOvernightReport();
    }

    // 编排周期
    await runOrchestrationCycle();
  } catch (err) {
    console.error('[NightlyOrchestrator] Cycle error:', err.message);
  } finally {
    _running = false;
  }
}

/**
 * 启动夜间编排调度器。
 * - 每次运行后，根据是否在夜间窗口动态计算下次运行时间
 */
export function startNightlyOrchestratorScheduler() {
  if (_timer) {
    console.log('[NightlyOrchestrator] Scheduler already running');
    return false;
  }

  const scheduleNext = () => {
    const ms = msUntilNextCycle();
    _timer = setTimeout(async () => {
      await runCycleSafe();
      scheduleNext();
    }, ms);

    if (_timer.unref) {
      _timer.unref();
    }
  };

  scheduleNext();
  console.log(`[NightlyOrchestrator] Scheduler started (night: ${NIGHT_START_HOUR_UTC}:00-${NIGHT_END_HOUR_UTC}:00 UTC, interval: ${CYCLE_INTERVAL_MS / 60000}min)`);
  return true;
}

/**
 * 停止调度器
 */
export function stopNightlyOrchestratorScheduler() {
  if (!_timer) return false;
  clearTimeout(_timer);
  _timer = null;
  console.log('[NightlyOrchestrator] Scheduler stopped');
  return true;
}

/**
 * 获取当前状态（供 /api/brain/health 使用）
 */
export function getNightlyOrchestratorStatus() {
  return {
    scheduler_running: _timer !== null,
    in_night_window: isNightWindow(),
    night_window_utc: `${NIGHT_START_HOUR_UTC}:00-${NIGHT_END_HOUR_UTC}:00`,
    cycle_count: _cycleCount,
    dispatched_tonight: _dispatchedTonight,
    last_cycle_at: _lastCycleAt?.toISOString() || null,
    last_report_date: _lastReportDate
  };
}
