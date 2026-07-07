/**
 * scheduler-jobs.js — 声明式定时任务注册表（作战循环 P1-PR1）
 *
 * Wave 2（2026-05-04）后 executeTick 死掉的定时任务的恢复通道。
 * 调度模型：统一 60s 轮询 + 模块自 gate —— 每轮无脑调用所有 job，
 * "该不该真正执行"由各 handler 内置窗口/幂等逻辑决定（triggerArchReview
 * 自带 4h 窗口+recent 去重+guard；maybeTriggerStrategySession 自带
 * active_goals gate+24h 冷却）。注册表只负责：错误隔离、timeout、观测哨兵。
 * 哨兵只作观测（死人开关/战报查"最近一跑"），幂等由模块自 gate 负责。
 */
import { triggerArchReview } from './daily-review-scheduler.js';
import { maybeTriggerStrategySession } from './active-goals-zero-trigger.js';
import { runConversationDigest } from './conversation-digest.js';
import { runCaptureDigestion } from './capture-digestion.js';
import { scheduleDailyBackup } from './daily-backup-scheduler.js';
import { maybeGenerateBattleReport } from './battle-report.js';

const LOOP_INTERVAL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const SENTINEL_KEY_PREFIX = 'scheduler_job_last_run:';

export const JOBS = [
  { name: 'arch-review', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: triggerArchReview, description: '架构巡检（自带4h窗口+guard）' },
  { name: 'strategy-trigger', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeTriggerStrategySession, description: '战略会应急触发（自带active_goals gate+24h冷却）' },
  { name: 'conversation-digest', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runConversationDigest, description: '对话提炼' },
  { name: 'capture-digestion', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runCaptureDigestion, description: 'capture 消化（想法箱进箱通道）' },
  { name: 'daily-backup', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: scheduleDailyBackup, description: '每日 DB 备份任务创建（自带窗口+当日去重；作战史单库保命符）' },
  { name: 'battle-report', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeGenerateBattleReport, description: '作战日报（北京06:00窗口+当日去重自 gate）' },
];

function raceWithTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __schedulerTimedOut: true }), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarize(result) {
  if (result == null) return null;
  try {
    const s = JSON.stringify(result);
    return s.length > 500 ? s.slice(0, 500) : s;
  } catch {
    return String(result).slice(0, 200);
  }
}

async function writeSentinelRaw(pool, key, record) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [key, JSON.stringify(record)],
    );
  } catch (e) {
    console.warn(`[scheduler-jobs] sentinel write failed for ${key}:`, e.message);
  }
}

function writeSentinel(pool, jobName, record) {
  return writeSentinelRaw(pool, `${SENTINEL_KEY_PREFIX}${jobName}`, record);
}

/**
 * 单发全部 job（供 loop 与测试）。单 job 失败/超时不影响其他 job。
 * @returns {Promise<Array<{name:string, at:string, ok:boolean}>>}
 */
export async function runSchedulerJobsOnce(pool, jobs = JOBS) {
  const results = [];
  for (const job of jobs) {
    const at = new Date().toISOString();
    let record;
    try {
      const invocation = job.needsPool ? job.handler(pool) : job.handler();
      const result = await raceWithTimeout(Promise.resolve(invocation), job.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (result && result.__schedulerTimedOut) {
        console.warn(`[scheduler-jobs] ${job.name} timed out after ${job.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
        record = { at, ok: false, timedOut: true };
      } else {
        record = { at, ok: true, detail: summarize(result) };
      }
    } catch (e) {
      console.warn(`[scheduler-jobs] ${job.name} failed:`, e.message);
      record = { at, ok: false, error: e.message };
    }
    await writeSentinel(pool, job.name, record);
    results.push({ name: job.name, ...record });
  }
  return results;
}

let loopTimer = null;
let running = false;

/** 启动 60s 轮询 loop（幂等：重复调用返回同一 timer）。 */
export function startSchedulerJobsLoop(pool) {
  if (loopTimer) return loopTimer;
  // 供死人开关比对：预期 job 数写库，加 job 自动同步，哨兵脚本无需硬编码
  writeSentinelRaw(pool, 'scheduler_jobs_expected', { count: JOBS.length });
  loopTimer = setInterval(() => {
    // 重入守卫：一轮 job 最长可达 ~20min（4×5min timeout），慢 handler 会让
    // 60s tick 叠加并发调用同一 handler，踩中各模块自 gate 的先查后写(TOCTOU)竞态。
    if (running) return;
    running = true;
    runSchedulerJobsOnce(pool)
      .catch((e) => console.warn('[scheduler-jobs] loop iteration failed:', e.message))
      .finally(() => { running = false; });
  }, LOOP_INTERVAL_MS);
  if (typeof loopTimer.unref === 'function') loopTimer.unref();
  console.log(`[scheduler-jobs] started (${LOOP_INTERVAL_MS / 1000}s loop, ${JOBS.length} jobs)`);
  return loopTimer;
}

/** 停止 loop（测试用）。 */
export function stopSchedulerJobsLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  running = false;
}
