/**
 * ops-scheduler-liveness — Brain 自己的 scheduler job 入运行舱（决策 69cd802f，task 50a2c256）。
 *
 * 起因：2026-09-24 notion-gtd-sync 内层 30s 循环卡死 8.4h，运行舱与 Notion 驾驶舱全绿——
 * 48 个 JOBS 是 Brain 自己的 workflow，却从未进 ops_workflows，活性判定只对表里的行生效。
 * 入图不靠手填：这里把 working_memory 里的调度哨兵翻译成 ops_workflows(source='scheduler') 行。
 *
 * 三条纪律：
 *  1. 活性只认 handler 自报的 liveness_at（立即返回型 handler 的哨兵 `at` 每分钟都新，内层死了也新）；
 *     没自报的才退回哨兵 `at`。尺子用声明间隔（classifyDeclaredLiveness），不走冷启动门槛。
 *  2. 只写机器列。人工列（owner/note/priority/starred/enable_intent/dispatch）永不出现在 SET 里。
 *  3. 降噪：liveness / last_run_status 没变、last_run_at 前进不足 10 分钟就不刷 updated_at——
 *     否则 48 行每分钟都"变更"，把 pushOpsWorkflows 的 LIMIT 50 吃光并让 Notion 每轮 PATCH 48 页。
 *
 * JOBS 经 opts.jobs 注入，不 import scheduler-jobs.js（会成环：scheduler-jobs → 本模块 → scheduler-jobs；
 * 仓库先例 routes/sentinel.js 同样"不 import，避免拖入 handler 依赖链"）。
 */
import { classifyDeclaredLiveness } from './ops-liveness.js';
import { writeHeartbeat } from './ops-collector.js';
import { raise as defaultRaise } from './alerting.js';

export const SCHEDULER_SOURCE = 'scheduler';
export const SCHEDULER_MACHINE = 'us-vps';
const SENTINEL_PREFIX = 'scheduler_job_last_run:';
const DEFAULT_INTERVAL_SEC = 60; // 调度轮 LOOP_INTERVAL_MS

function statusOf(rec) {
  if (!rec) return null;
  if (rec.timedOut) return 'timeout';
  return rec.ok ? 'success' : 'error';
}

/** scheduler-jobs handler（needsPool:true）。opts.jobs 必传（注入 JOBS）；now/raise 供测试。 */
export async function runSchedulerLiveness(pool, { jobs = [], now = Date.now(), raise = defaultRaise } = {}) {
  const collectedAt = new Date(now).toISOString();
  const { rows } = await pool.query(
    `SELECT key, value_json FROM working_memory WHERE key LIKE $1`,
    [`${SENTINEL_PREFIX}%`],
  );
  const sentinels = new Map();
  for (const r of rows) {
    let rec = r.value_json;
    if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { rec = null; } }
    sentinels.set(String(r.key).slice(SENTINEL_PREFIX.length), rec);
  }

  let flippedDead = 0; let recovered = 0;
  for (const job of jobs) {
    const rec = sentinels.get(job.name) ?? null;
    const intervalSec = Number.isFinite(job.livenessIntervalSec) && job.livenessIntervalSec > 0
      ? job.livenessIntervalSec : DEFAULT_INTERVAL_SEC;
    // 纪律 1：自报优先；超时/失败的哨兵不算活
    const lastRunAt = rec?.liveness_at ?? (rec?.ok ? rec.at : null) ?? null;
    const lv = classifyDeclaredLiveness({ lastRunAt, intervalSec, now });
    const meta = {
      kind: 'scheduler_job', description: job.description ?? '', timeoutMs: job.timeoutMs ?? null,
      livenessIntervalSec: intervalSec, last_error: rec?.error ?? null,
    };
    // 纪律 2：SET 里只有机器列。纪律 3：WHERE 降噪。RETURNING 带旧 liveness 供翻转告警
    //（RETURNING 里的子查询读的是本语句开始前的快照，拿到的是更新前的值）。
    // 下标固定（测试按下标断言）：[0]wf_id [1]machine [2]meta [3]last_run_at [4]last_run_status
    // [5]baseline_interval_sec [6]liveness [7]silent_sec [8]warn_after_sec [9]dead_after_sec [10]liveness_at/updated_at
    const { rows: changed } = await pool.query(
      `INSERT INTO ops_workflows (source, wf_id, name, active, machine, meta,
         last_run_at, last_run_status, baseline_interval_sec, liveness, silent_sec,
         warn_after_sec, dead_after_sec, liveness_at, updated_at)
       VALUES ('${SCHEDULER_SOURCE}', $1, $1, FALSE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       ON CONFLICT (source, wf_id) DO UPDATE SET
         name=EXCLUDED.name, active=FALSE, machine=EXCLUDED.machine, meta=EXCLUDED.meta,
         last_run_at=EXCLUDED.last_run_at, last_run_status=EXCLUDED.last_run_status,
         baseline_interval_sec=EXCLUDED.baseline_interval_sec, liveness=EXCLUDED.liveness,
         silent_sec=EXCLUDED.silent_sec, warn_after_sec=EXCLUDED.warn_after_sec,
         dead_after_sec=EXCLUDED.dead_after_sec, liveness_at=EXCLUDED.liveness_at, updated_at=EXCLUDED.updated_at
       WHERE ops_workflows.liveness IS DISTINCT FROM EXCLUDED.liveness
          OR ops_workflows.last_run_status IS DISTINCT FROM EXCLUDED.last_run_status
          OR ops_workflows.last_run_at IS NULL
          OR EXCLUDED.last_run_at - ops_workflows.last_run_at >= interval '10 minutes'
       RETURNING wf_id, liveness,
         (SELECT o.liveness FROM ops_workflows o WHERE o.source='${SCHEDULER_SOURCE}' AND o.wf_id=$1) AS prev_liveness`,
      [job.name, SCHEDULER_MACHINE, JSON.stringify(meta), lastRunAt, statusOf(rec), intervalSec,
        lv.liveness, lv.silent_sec, lv.warn_after_sec, lv.dead_after_sec, collectedAt],
    );
    const row = changed[0];
    if (!row) continue;
    // 只在翻转时告警：ok/warn/cold → dead 一次，dead → 非 dead 一次
    if (row.liveness === 'dead' && row.prev_liveness !== 'dead') {
      flippedDead += 1;
      try {
        await raise('P1', `scheduler_job_dead_${job.name}`,
          `🔴 调度 job ${job.name} 失联：最后一轮 ${lastRunAt ?? '从未'}，静默 ${lv.silent_sec ?? '?'}s ≥ ${lv.dead_after_sec}s（尺子 ${intervalSec}s）`);
      } catch (e) {
        console.warn(`[scheduler-liveness] 告警失败 ${job.name}: ${e.message}`);
      }
    } else if (row.prev_liveness === 'dead' && row.liveness !== 'dead') {
      recovered += 1;
      try {
        await raise('P2', `scheduler_job_recovered_${job.name}`, `🟢 调度 job ${job.name} 恢复（${row.liveness}）`);
      } catch (e) {
        console.warn(`[scheduler-liveness] 告警失败 ${job.name}: ${e.message}`);
      }
    }
  }
  await writeHeartbeat(pool, SCHEDULER_SOURCE, SCHEDULER_MACHINE, 'ok', null, null, collectedAt);
  return { ok: true, jobs: jobs.length, flippedDead, recovered };
}
