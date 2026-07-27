/**
 * harness-initiative-patrol.js — Harness Initiative 卡住巡航（WS4）
 *
 * 与 pipeline-patrol（扫 .dev-mode 文件）和 harness-watchdog（扫 deadline_at 逾期）平级，
 * 专门盯 harness pipeline 内部两个最易卡死的环节：
 *
 *   1. Planner（阶段 A）停留超过 15 分钟无进展
 *   2. GAN 每轮（proposer ↔ reviewer 对抗）单轮进行中超过 20 分钟
 *
 * 检测到卡住后，在 tasks 表创建 harness_intervention 类型任务，交由本机人工/agent 干预。
 *
 * 两代运行时（2026-07-27 刀3）：
 *   - 旧 one-session relay：阶段事件写 initiative_run_events（node/status/created_at）
 *   - Kernel v1（tasks.payload.harness_runtime='kernel-v1'）：每个 planner/proposer/reviewer/
 *     generator/evaluator/judge 写一条 harness_attempts 行（唯一键 run_id+hop），
 *     packages/brain/src/orchestrator/ 全目录对 initiative_run_events 零引用。
 *   所以 Kernel run 的 GAN 轮次活性必须从 harness_attempts 推导，否则永久退化为仅 Planner 检测
 *   （2026-07-26 实证：Kernel run 连做 5 轮 Reviewer 后卡在第 6 轮，全程无人告警）。
 *
 * 不变量：
 *   - 只读 initiative_runs / initiative_run_events / harness_attempts / tasks，
 *     绝不 UPDATE/DELETE harness 状态（留诊断）
 *   - 防重：同一 initiative 已有 queued/in_progress/pending 的 harness_intervention 任务则跳过
 *   - 失败非致命：单条检测/创建异常吞掉并打 console.error，不冒泡到调用方
 */

import pool from './db.js';

// Planner（阶段 A）卡住阈值：15 分钟
export const PLANNER_STUCK_MS = 15 * 60 * 1000;
// GAN 每轮卡住阈值：20 分钟
export const GAN_ROUND_STUCK_MS = 20 * 60 * 1000;

// Planner 阶段对应的 phase 取值（v2 graph='A_contract'，旧 graph/watchdog='A_planning'）
const PLANNER_PHASES = ['A_contract', 'A_planning'];
// GAN 对抗节点（proposer ↔ reviewer 多轮）
const GAN_NODES = ['proposer', 'reviewer'];
// 视为"轮次仍进行中"的事件状态（已 completed/failed 的轮次不算卡住）
const GAN_INFLIGHT_STATUS = ['pending', 'running'];

// ─── Kernel v1（harness_attempts）侧常量 ─────────────────────────────────
// tasks.payload.harness_runtime 取该值 = Kernel v1 运行时（见 harness-skill-relay.js）
const KERNEL_RUNTIME = 'kernel-v1';
// GAN 对抗角色（harness_attempts.role），对应旧 relay 的 GAN_NODES
const KERNEL_GAN_ROLES = ['proposer', 'reviewer'];
// Planner 角色（阶段 A）；Kernel run 的 initiative_runs.phase 全程停在 'planning'，
// 不走 phase 判据，只按 role 判。
const KERNEL_PLANNER_ROLES = ['planner'];
// harness_attempts 非终态状态（终态见 orchestrator/attempt-store.js TERMINAL_STATUSES）。
// generator/evaluator/judge 长跑合法，故意不纳入卡死判据，避免误报。
const KERNEL_INFLIGHT_STATUS = ['queued', 'starting', 'running'];

// 单次扫描上限，防止异常数据导致大查询
const MAX_SCAN = 50;

/** run 是否 Kernel v1 运行时（主扫描 SQL 从 tasks.payload 取出 harness_runtime） */
function isKernelRun(run) {
  return run?.harness_runtime === KERNEL_RUNTIME;
}

/**
 * Kernel v1 卡死判据：取该 run 最新一跳 harness_attempts（run_id + 最大 hop），
 * 按 role 套用原有阈值语义。
 *
 *   - proposer/reviewer 仍 in-flight 且超 GAN_ROUND_STUCK_MS(20min) → gan_round
 *   - planner        仍 in-flight 且超 PLANNER_STUCK_MS(15min)      → planner
 *   - 其余 role（generator/evaluator/judge/reporter）长跑合法 → 不判卡死
 *
 * 轮次起点用 started_at（缺失回落 created_at），与旧 relay 用事件 created_at 同义。
 * 查询失败非致命：吞掉打 console.error，退化为不卡（不冒泡到主循环）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {{ id: string, initiative_id: string }} run
 * @param {number} now
 */
async function checkKernelAttemptStuck(dbPool, run, now) {
  let attempt = null;
  try {
    const q = await dbPool.query(
      `SELECT hop, role, status, created_at, started_at
         FROM harness_attempts
        WHERE run_id = $1
        ORDER BY hop DESC
        LIMIT 1`,
      [run.id]
    );
    attempt = q.rows?.[0] || null;
  } catch (err) {
    console.error(
      `[harness-initiative-patrol] 读 harness_attempts 失败 (run=${run.id}) (non-fatal): ${err.message}`
    );
    return { stuck: false };
  }

  if (!attempt) return { stuck: false };
  if (!KERNEL_INFLIGHT_STATUS.includes(attempt.status)) return { stuck: false };

  const roundStart = attempt.started_at || attempt.created_at;
  if (!roundStart) return { stuck: false };
  const elapsedMs = now - new Date(roundStart).getTime();

  if (KERNEL_GAN_ROLES.includes(attempt.role) && elapsedMs > GAN_ROUND_STUCK_MS) {
    return {
      stuck: true,
      kind: 'gan_round',
      elapsedMs,
      thresholdMs: GAN_ROUND_STUCK_MS,
      detail: `GAN 轮次进行中 (kernel-v1 hop=${attempt.hop} ${attempt.role}=${attempt.status})`,
    };
  }

  if (KERNEL_PLANNER_ROLES.includes(attempt.role) && elapsedMs > PLANNER_STUCK_MS) {
    return {
      stuck: true,
      kind: 'planner',
      elapsedMs,
      thresholdMs: PLANNER_STUCK_MS,
      detail: `Planner 阶段停留 (kernel-v1 hop=${attempt.hop} ${attempt.role}=${attempt.status})`,
    };
  }

  return { stuck: false };
}

/**
 * 判断单个 initiative_run 是否卡在 Planner 或 GAN 轮次。
 *
 * Kernel v1（harness_runtime='kernel-v1'）走 harness_attempts 推导；
 * 旧 one-session relay 行为一字不变：优先判 GAN 轮次（更具体）——若最近一条
 * proposer/reviewer 事件仍 in-flight 且超 20min；否则若 phase 在 Planner 阶段
 * 且最后活动超 15min。
 *
 * @param {import('pg').Pool} dbPool
 * @param {{ id: string, initiative_id: string, phase: string, started_at: any, updated_at: any, harness_runtime?: string }} run
 * @returns {Promise<{stuck: boolean, kind?: string, elapsedMs?: number, thresholdMs?: number, detail?: string}>}
 */
async function checkInitiativeStuck(dbPool, run) {
  const now = Date.now();

  // 0) Kernel v1：阶段活性只在 harness_attempts 里，initiative_run_events 对它恒空
  //    （查了必然走 catch/空分支 → 永久退化）。判完直接返回，不再落旧路径。
  if (isKernelRun(run)) {
    return checkKernelAttemptStuck(dbPool, run, now);
  }

  // 1) GAN 每轮卡住：查最近一条 proposer/reviewer 事件
  let ganEvent = null;
  try {
    const ev = await dbPool.query(
      `SELECT node, status, created_at
         FROM initiative_run_events
        WHERE initiative_id = $1
          AND node = ANY($2)
        ORDER BY created_at DESC
        LIMIT 1`,
      [run.initiative_id, GAN_NODES]
    );
    ganEvent = ev.rows[0] || null;
  } catch {
    // initiative_run_events 表缺失或查询失败 → 退化为仅 Planner 检测
  }

  if (ganEvent && GAN_INFLIGHT_STATUS.includes(ganEvent.status) && ganEvent.created_at) {
    const elapsedMs = now - new Date(ganEvent.created_at).getTime();
    if (elapsedMs > GAN_ROUND_STUCK_MS) {
      return {
        stuck: true,
        kind: 'gan_round',
        elapsedMs,
        thresholdMs: GAN_ROUND_STUCK_MS,
        detail: `GAN 轮次进行中 (${ganEvent.node}=${ganEvent.status})`,
      };
    }
  }

  // 2) Planner 卡住：阶段 A 停留无进展
  if (PLANNER_PHASES.includes(run.phase)) {
    const lastActivity = run.updated_at || run.started_at;
    if (lastActivity) {
      const elapsedMs = now - new Date(lastActivity).getTime();
      if (elapsedMs > PLANNER_STUCK_MS) {
        return {
          stuck: true,
          kind: 'planner',
          elapsedMs,
          thresholdMs: PLANNER_STUCK_MS,
          detail: `Planner 阶段停留 (phase=${run.phase})`,
        };
      }
    }
  }

  return { stuck: false };
}

/**
 * 在 tasks 表创建 harness_intervention 任务（带防重）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {{initiativeId: string, phase: string, kind: string, elapsedMs: number, thresholdMs: number, detail: string}} info
 * @returns {Promise<{created: boolean, taskId?: string, reason?: string}>}
 */
async function createInterventionTask(dbPool, info) {
  const { initiativeId, phase, kind, elapsedMs, thresholdMs, detail } = info;

  // 防重：同一 initiative 已有未结束（queued/in_progress/pending）的 harness_intervention 任务则跳过
  const dedup = await dbPool.query(
    `SELECT id FROM tasks
      WHERE task_type = 'harness_intervention'
        AND payload->>'initiative_id' = $1
        AND status IN ('queued', 'in_progress', 'pending')
      LIMIT 1`,
    [initiativeId]
  );
  if (dedup.rows.length > 0) {
    return { created: false, reason: `dedup: 已有任务 ${dedup.rows[0].id}` };
  }

  const elapsedMin = Math.round(elapsedMs / 60000);
  const thresholdMin = Math.round(thresholdMs / 60000);
  const kindLabel = kind === 'gan_round' ? 'GAN 轮次' : 'Planner';
  const title = `[Stuck] Harness Intervention: ${initiativeId} (${kindLabel})`;
  const description = [
    `Harness Initiative Patrol 检测到卡住：`,
    `- Initiative: ${initiativeId}`,
    `- 阶段: ${phase}`,
    `- 卡点: ${detail}`,
    `- 停留: ${elapsedMin} 分钟（阈值 ${thresholdMin} 分钟）`,
    ``,
    `请诊断该 harness initiative 为何停滞，并恢复或终止它。`,
  ].join('\n');

  // Slice5: 查该 initiative 在飞容器塞进 payload，否则 handleIntervention 永远 no_container_id→纯
  // alert（读不到 docker logs 无法真诊断）。thread_id 格式 harness-task:<initiativeId>:...，取最近
  // 一条未终态的容器。查询失败/无容器 → null 降级，仍建任务（intervention 至少能 alert）。
  let containerId = null;
  try {
    const cr = await dbPool.query(
      `SELECT container_id FROM walking_skeleton_thread_lookup
        WHERE thread_id LIKE 'harness-task:' || $1 || ':%'
          AND status NOT IN ('completed', 'failed')
        ORDER BY created_at DESC
        LIMIT 1`,
      [initiativeId]
    );
    containerId = cr.rows[0]?.container_id || null;
  } catch (err) {
    console.warn(`[harness-initiative-patrol] 查在飞容器失败 initiative=${initiativeId} (non-fatal): ${err.message}`);
  }

  const result = await dbPool.query(
    `INSERT INTO tasks (title, description, status, priority, task_type, trigger_source, domain, payload)
     VALUES ($1, $2, 'queued', 'P1', 'harness_intervention', 'brain_auto', 'agent_ops', $3)
     RETURNING id`,
    [
      title,
      description,
      JSON.stringify({
        initiative_id: initiativeId,
        container_id: containerId,
        phase,
        kind,
        elapsed_ms: elapsedMs,
        threshold_ms: thresholdMs,
        detected_at: new Date().toISOString(),
      }),
    ]
  );

  const taskId = result.rows[0]?.id;
  console.log(`[harness-initiative-patrol] 创建 intervention 任务: ${title} (id: ${taskId})`);
  return { created: true, taskId };
}

/**
 * Harness Initiative Patrol 主函数。
 *
 * 扫描所有未完成的 initiative_runs，检测 Planner / GAN 轮次卡住，
 * 必要时创建 harness_intervention 任务。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{scanned: number, stuck: number, intervened: number, details: Array}>}
 */
export async function runHarnessInitiativePatrol(dbPool = pool) {
  const result = { scanned: 0, stuck: 0, intervened: 0, details: [] };

  // 扫卡住的 initiative：未完成且未进入终态
  //
  // Kernel v1 的 run 行也写 orchestrator_version='v2'（见 harness-skill-relay.js
  // _spawnKernelRuntime），会被原来的 v2 排除条件整体滤掉 → GAN 轮次卡死零覆盖。
  // 这里按 tasks.payload.harness_runtime 把 kernel-v1 单独捞回来：
  //   - 非 kernel 的 v2（skill-relay）仍归 harness-relay-watchdog 独占管辖，行为不变
  //   - relay-watchdog 的 kernel 分支只处理 lease 过期/进程死亡（attempt 级存活），
  //     "轮次跑太久但心跳还活着"对它不可见，正是本巡检要补的洞
  const runs = await dbPool.query(
    `SELECT r.id, r.initiative_id, r.phase, r.started_at, r.updated_at, r.completed_at,
            t.payload->>'harness_runtime' AS harness_runtime
       FROM initiative_runs r
       LEFT JOIN tasks t ON t.id = r.current_task_id
      WHERE r.completed_at IS NULL
        AND r.phase NOT IN ('done', 'failed')
        AND (
              r.orchestrator_version IS DISTINCT FROM 'v2'
              OR t.payload->>'harness_runtime' = '${KERNEL_RUNTIME}'
            )
      ORDER BY r.started_at ASC
      LIMIT ${MAX_SCAN}`
  );
  result.scanned = runs.rows.length;

  for (const run of runs.rows) {
    let stuckCheck;
    try {
      stuckCheck = await checkInitiativeStuck(dbPool, run);
    } catch (err) {
      console.error(
        `[harness-initiative-patrol] 检测失败 (initiative=${run.initiative_id}) (non-fatal): ${err.message}`
      );
      continue;
    }
    if (!stuckCheck.stuck) continue;

    result.stuck++;
    const detail = {
      initiativeId: run.initiative_id,
      phase: run.phase,
      kind: stuckCheck.kind,
      elapsedMs: stuckCheck.elapsedMs,
    };

    try {
      const created = await createInterventionTask(dbPool, {
        initiativeId: run.initiative_id,
        phase: run.phase,
        kind: stuckCheck.kind,
        elapsedMs: stuckCheck.elapsedMs,
        thresholdMs: stuckCheck.thresholdMs,
        detail: stuckCheck.detail,
      });
      detail.intervened = created.created;
      detail.taskId = created.taskId;
      detail.skipReason = created.reason;
      if (created.created) result.intervened++;
    } catch (err) {
      detail.error = err.message;
      console.error(
        `[harness-initiative-patrol] 创建 intervention 任务失败 (initiative=${run.initiative_id}) (non-fatal): ${err.message}`
      );
    }

    result.details.push(detail);
  }

  return result;
}

export {
  // 测试用内部函数
  checkInitiativeStuck as _checkInitiativeStuck,
  checkKernelAttemptStuck as _checkKernelAttemptStuck,
  createInterventionTask as _createInterventionTask,
  PLANNER_PHASES,
  GAN_NODES,
  KERNEL_RUNTIME,
  KERNEL_GAN_ROLES,
  KERNEL_PLANNER_ROLES,
  KERNEL_INFLIGHT_STATUS,
};

export default { runHarnessInitiativePatrol, PLANNER_STUCK_MS, GAN_ROUND_STUCK_MS };
