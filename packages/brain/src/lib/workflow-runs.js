/**
 * workflow-runs — 流程运行总记录（runs 表，迁移 531，决策 ff2019e2）。
 *
 * 定时任务：调度器每 60s 无脑调用全部 job，"该不该真干活"由 handler 自 gate。
 * 自 gate 跳过的那一轮不是一次运行，不记；真干活、报错、超时的每一轮记一行。
 * 流程归属经闹钟总账（ops_schedule_entries kind='brain_job'，label=job 名）解析；总账里没有的照记，流程留空。
 */
import { randomUUID } from 'node:crypto';

/** handler 返回值是否表示"本轮自 gate 跳过"（仓库里现存的四种写法）。 */
export function isSelfSkipped(result) {
  if (!result || typeof result !== 'object') return false;
  return Boolean(result.skipped) || result.status === 'skipped' || result.triggered === false || result.inWindow === false;
}

/** 调度器一轮的结果 → runs.outcome。 */
export function schedulerOutcome({ timedOut, error, result }) {
  if (timedOut) return 'timeout';
  if (error) return 'fail';
  if (result && typeof result === 'object' && result.ok === false) return 'fail';
  return 'pass';
}

const INSERT_SCHEDULER_RUN = `
  INSERT INTO runs (run_id, workflow_id, trigger_kind, trigger_ref, schedule_entry_id, executor_kind, executor_id,
                    started_at, ended_at, outcome, error, detail, header_source)
  SELECT $1, e.workflow_id, 'schedule', $2, e.id, 'code', 'brain-scheduler', $3, $4, $5, $6, $7::jsonb, 'owner'
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT id, workflow_id FROM ops_schedule_entries
       WHERE kind = 'brain_job' AND label = $2
       ORDER BY active DESC, id LIMIT 1
    ) e ON true`;

// 每分钟真干活的 job 约 30 个，一天约 4 万行；汇总视图最长看 30 天，失败多留些供排查。
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const PRUNE_SQL = `
  DELETE FROM runs
   WHERE trigger_kind = 'schedule'
     AND ((outcome IN ('fail', 'timeout') AND started_at < now() - interval '90 days')
       OR (outcome NOT IN ('fail', 'timeout') AND started_at < now() - interval '30 days'))`;
let lastPruneAt = 0;

/** 保留期清理（每小时最多一次）。返回删除行数；未到间隔返回 null。 */
export async function pruneSchedulerRuns(db, now = Date.now()) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return null;
  lastPruneAt = now;
  return (await db.query(PRUNE_SQL)).rowCount;
}

/** 写一行定时任务运行记录。调用方负责吞错（运行记录是附带观测，不能拖垮 job）。 */
export async function recordSchedulerRun(db, { jobName, startedAt, endedAt, outcome, error = null, detail = null }) {
  await db.query(INSERT_SCHEDULER_RUN, [
    `sched:${jobName}:${randomUUID()}`, jobName, startedAt, endedAt, outcome,
    error ? String(error).slice(0, 2000) : null, detail === null ? null : JSON.stringify(detail),
  ]);
}
