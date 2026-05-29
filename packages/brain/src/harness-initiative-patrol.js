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
 * 不变量：
 *   - 只读 initiative_runs / initiative_run_events，绝不 UPDATE/DELETE harness 状态（留诊断）
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

// 单次扫描上限，防止异常数据导致大查询
const MAX_SCAN = 50;

/**
 * 判断单个 initiative_run 是否卡在 Planner 或 GAN 轮次。
 *
 * 优先判 GAN 轮次（更具体）：若最近一条 proposer/reviewer 事件仍 in-flight 且超 20min。
 * 否则若 phase 在 Planner 阶段且最后活动超 15min。
 *
 * @param {import('pg').Pool} dbPool
 * @param {{ initiative_id: string, phase: string, started_at: any, updated_at: any }} run
 * @returns {Promise<{stuck: boolean, kind?: string, elapsedMs?: number, thresholdMs?: number, detail?: string}>}
 */
async function checkInitiativeStuck(dbPool, run) {
  const now = Date.now();

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

  const result = await dbPool.query(
    `INSERT INTO tasks (title, description, status, priority, task_type, trigger_source, domain, payload)
     VALUES ($1, $2, 'queued', 'P1', 'harness_intervention', 'brain_auto', 'agent_ops', $3)
     RETURNING id`,
    [
      title,
      description,
      JSON.stringify({
        initiative_id: initiativeId,
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
  const runs = await dbPool.query(
    `SELECT id, initiative_id, phase, started_at, updated_at, completed_at
       FROM initiative_runs
      WHERE completed_at IS NULL
        AND phase NOT IN ('done', 'failed')
      ORDER BY started_at ASC
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
  createInterventionTask as _createInterventionTask,
  PLANNER_PHASES,
  GAN_NODES,
};

export default { runHarnessInitiativePatrol, PLANNER_STUCK_MS, GAN_ROUND_STUCK_MS };
