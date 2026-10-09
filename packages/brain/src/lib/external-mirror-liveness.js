/**
 * external-mirror-liveness — 外部 run 镜像的活性判据（任务 0004aceb，决策 3c98fb36 阶段1）。
 *
 * 外部 run 镜像 = 在执行机上由 wall-report / Notion ssh 直派起跑、Brain 行只是账本镜像的活：
 *   - workflow_run（Notion ssh 直派）
 *   - device_job 且 payload.source='cron'（ZenithJoy brain-device-job-mirror 为 cron/wf-run 采收批建）
 * 与 workflow-run-lost-deadline / commander-watchdog 的 RUN_TYPES_SQL 同一语义。
 *
 * 这类活从不 claim、Brain 从不 spawn：executor.probeTaskLiveness 的三条 spawn 证据（activeProcesses /
 * /tmp/cecelia-{id}.log / error_message）恒空，认领新鲜度分支（要求 claimed_by）也接不住。
 * 09-30 实证 1e84cbad 五次被 no_spawn_evidence 回队并清 started_at → lost-deadline（按起跑 4h+30m）永远算不到、
 * commander-watchdog（起跑 ≥15min）判据被重置；wall-report 阶段回执又设回 in_progress → 振荡。
 *
 * 活性以镜像心跳为准：task_runs 阶段回执 / commander 心跳 / 行更新 / 起跑 的最新者，年龄**在 SQL 内算**
 * （tasks.started_at/updated_at 是无时区列、容器 TZ=Asia/Shanghai，JS 解析会漂 8 小时——时区案 2026-09-15）。
 * 心跳陈旧也不回队，只留痕 task_events external_liveness_stale（每陈旧窗口一次），出路归 lost-deadline / commander-watchdog。
 */
import { TASK_TYPE_REGISTRY } from './task-type-registry.js';

/** 镜像心跳陈旧阈值（wall-report 阶段回执 ≤5 分钟一次；真机单阶段实测可达 40 分钟，留痕不处置故取 30 分钟）。 */
export const EXTERNAL_HEARTBEAT_STALE_MS = (() => {
  const n = Number(process.env.EXTERNAL_HEARTBEAT_STALE_MS);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
})();

const ISO_TS_GUARD = String.raw`^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}`;

/**
 * 外部 run 镜像类型，从注册表派生（铁律 76cb816c，task-type-registry.guard 禁手抄）：
 *   - 无条件镜像：workflow 型 + 执行面在外部 + Brain 侧无看门狗（watchdog='none'）→ 当前 = workflow_run
 *     （content-pipeline 同为 workflow+external 但 watchdog='external-worker'，由 ZJ pipeline-worker 管，不纳入）
 *   - 条件镜像：真机 surface（device）→ 当前 = device_job，仅 payload.source='cron' 的采收镜像单算
 */
export const EXTERNAL_RUN_MIRROR_UNCONDITIONAL_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY)
    .filter(([, e]) => e.db && e.kind === 'workflow' && e.surface === 'external' && e.watchdog === 'none')
    .map(([k]) => k),
);
export const EXTERNAL_RUN_MIRROR_DEVICE_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && e.surface === 'device').map(([k]) => k),
);
export const EXTERNAL_RUN_MIRROR_TASK_TYPES = Object.freeze([
  ...EXTERNAL_RUN_MIRROR_UNCONDITIONAL_TASK_TYPES,
  ...EXTERNAL_RUN_MIRROR_DEVICE_TASK_TYPES,
]);
const RUN_MIRROR_TYPES_SQL_LIST = EXTERNAL_RUN_MIRROR_TASK_TYPES.map((t) => `'${t}'`).join(', ');

/**
 * 计算镜像最近活动年龄（秒）的 SQL 表达式，别名由调用方给；非 run 类型返回 NULL。
 * 必须与 `FROM tasks` 同查询使用（引用 tasks.* 列）。payload 时间串先过 ISO 形状守卫再 ::timestamptz，
 * 单条脏值不得炸掉整轮探针。
 */
export const EXTERNAL_ACTIVITY_AGE_SQL = `
  CASE WHEN tasks.task_type IN (${RUN_MIRROR_TYPES_SQL_LIST}) THEN
    EXTRACT(EPOCH FROM (NOW() - GREATEST(
      tasks.created_at::timestamptz,
      COALESCE(tasks.started_at::timestamptz, tasks.created_at::timestamptz),
      COALESCE(tasks.updated_at::timestamptz, tasks.created_at::timestamptz),
      COALESCE(tasks.claimed_at::timestamptz, tasks.created_at::timestamptz),
      COALESCE((SELECT MAX(GREATEST(r.started_at, COALESCE(r.ended_at, r.started_at)))
                  FROM task_runs r WHERE r.task_id = tasks.id), tasks.created_at::timestamptz),
      COALESCE(CASE WHEN tasks.payload->>'commander_heartbeat_at' ~ '${ISO_TS_GUARD}'
                    THEN (tasks.payload->>'commander_heartbeat_at')::timestamptz END, tasks.created_at::timestamptz),
      COALESCE(CASE WHEN tasks.payload->>'executed_at' ~ '${ISO_TS_GUARD}'
                    THEN (tasks.payload->>'executed_at')::timestamptz END, tasks.created_at::timestamptz)
    )))
  END`;

/** 外部 run 镜像谓词：无条件镜像类型（workflow_run），或真机类型（device_job）且 payload.source='cron'。 */
export function isExternalRunMirror(task) {
  if (!task) return false;
  if (EXTERNAL_RUN_MIRROR_UNCONDITIONAL_TASK_TYPES.includes(task.task_type)) return true;
  return EXTERNAL_RUN_MIRROR_DEVICE_TASK_TYPES.includes(task.task_type) && task.payload?.source === 'cron';
}

/** 从探针查询行取镜像活动年龄（毫秒）；列缺失/不可解析 → null（调用方按「未知」处理，只留痕不处置）。 */
export function externalActivityAgeMs(row) {
  const raw = row?.external_activity_age_sec;
  if (raw === null || raw === undefined || raw === '') return null;
  const sec = Number(raw);
  return Number.isFinite(sec) ? Math.max(0, sec * 1000) : null;
}

/**
 * 陈旧留痕账本：同一任务在一个陈旧窗口内只记一次 external_liveness_stale；心跳恢复即清；
 * 任务离开 in_progress 后由 prune 回收，避免 Map 无界增长。
 */
export function createStaleLedger(windowMs = EXTERNAL_HEARTBEAT_STALE_MS) {
  const noted = new Map();
  return {
    noted,
    windowMs,
    clear() {
      noted.clear();
    },
    /** 陈旧（ageMs > windowMs，或年龄未知）且本窗口未记过 → true（并登记）。 */
    shouldNote(taskId, ageMs, now = Date.now()) {
      const stale = ageMs === null || ageMs > windowMs;
      if (!stale) {
        noted.delete(taskId);
        return false;
      }
      const last = noted.get(taskId);
      if (last !== undefined && now - last < windowMs) return false;
      noted.set(taskId, now);
      return true;
    },
    /** 只保留仍在 in_progress 的任务。 */
    prune(liveIds) {
      for (const id of noted.keys()) {
        if (!liveIds.has(id)) noted.delete(id);
      }
    },
  };
}
