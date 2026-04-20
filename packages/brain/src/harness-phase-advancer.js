/**
 * Harness v2 — Phase Advancer（tick 驱动的阶段推进器）
 *
 * PRD: docs/design/harness-v2-prd.md §3.1 阶段 A/B/C
 * Milestone: v2 E2E 缺口修复 3/4
 *
 * 背景：harness-initiative-runner 只负责"一次性入口动作"（Phase A 规划 +
 *      Phase C 终点判决）。没有模块周期性地把 initiative_runs.phase 往前推。
 *      合同 approved 之后不会自动进 B，所有子 Task completed 之后也没人
 *      触发 runPhaseCIfReady。本模块由 tick.js 每轮调用一次，推进所有
 *      活跃 initiative_runs 的 phase。
 *
 * 语义：
 *   - A_contract → B_task_loop：最新 contract.status='approved' 时切换
 *   - B_task_loop 内部：
 *       · current_task_id 仍 running/queued → 跳过本轮
 *       · current_task_id completed/failed/cancelled（或为空）→
 *           nextRunnableTask → 写 current_task_id + 保底 UPDATE 为 queued
 *       · 无下一可运行 task + 所有子 Task completed → 调 runPhaseCIfReady
 *   - C_final_e2e：不在本模块推进（由 runPhaseCIfReady 内部管理）
 *
 * 幂等：用 updated_at 时间窗口过滤（默认跳过最近 2s 被动过的行），
 *      防止相邻 tick 重叠处理同一行。
 */

import pool from './db.js';
import { nextRunnableTask } from './harness-dag.js';
import {
  checkAllTasksCompleted,
  runPhaseCIfReady,
} from './harness-initiative-runner.js';

const DEFAULT_GUARD_SECONDS = 2;
const ACTIVE_TASK_STATUSES = new Set(['queued', 'in_progress', 'assigned']);

/**
 * 推进所有活跃 initiative_runs 的 phase（A→B / B 内部拉下一任务 / B→C）。
 *
 * @param {object} poolArg                     pg pool（或 { connect() } 形状的 mock）
 * @param {object} [opts]
 * @param {number} [opts.guardSeconds=2]       updated_at 时间窗口（秒）
 * @param {Function} [opts.runPhaseC]          runPhaseCIfReady 替换（测试注入）
 * @returns {Promise<Array<{
 *   runId: string,
 *   initiativeId: string,
 *   status: 'A_to_B'|'A_pending'|'B_busy'|'B_picked'|'B_waiting'|'B_to_C'|'no_parent_task'|'error',
 *   currentTaskId?: string,
 *   contractId?: string,
 *   remaining?: number,
 *   phaseC?: object,
 *   error?: string,
 * }>>}
 */
export async function advanceHarnessInitiatives(poolArg, opts = {}) {
  const dbPool = poolArg || pool;
  const guardSeconds = Number.isFinite(opts.guardSeconds)
    ? opts.guardSeconds
    : DEFAULT_GUARD_SECONDS;
  const runPhaseC = opts.runPhaseC || runPhaseCIfReady;

  const client = await dbPool.connect();
  const results = [];
  try {
    const { rows } = await client.query(
      `SELECT id AS run_id, initiative_id, contract_id, phase, current_task_id
       FROM initiative_runs
       WHERE phase IN ('A_contract','B_task_loop')
         AND updated_at < NOW() - ($1 || ' seconds')::interval
       ORDER BY updated_at ASC`,
      [String(guardSeconds)]
    );

    for (const row of rows) {
      try {
        if (row.phase === 'A_contract') {
          results.push(await advancePhaseA(row, client));
        } else if (row.phase === 'B_task_loop') {
          results.push(await advancePhaseB(row, client, dbPool, runPhaseC));
        }
      } catch (err) {
        console.error(
          `[harness-phase-advancer] run=${row.run_id} phase=${row.phase} error: ${err.message}`
        );
        results.push({
          runId: row.run_id,
          initiativeId: row.initiative_id,
          status: 'error',
          error: err.message,
        });
      }
    }
  } finally {
    client.release();
  }
  return results;
}

// ─── Phase A → B ─────────────────────────────────────────────────────────────

async function advancePhaseA(run, client) {
  const q = await client.query(
    `SELECT id FROM initiative_contracts
     WHERE initiative_id = $1::uuid AND status = 'approved'
     ORDER BY version DESC LIMIT 1`,
    [run.initiative_id]
  );
  if (q.rows.length === 0) {
    return {
      runId: run.run_id,
      initiativeId: run.initiative_id,
      status: 'A_pending',
    };
  }
  const contractId = q.rows[0].id;

  // phase='A_contract' 条件写回，防止与其他 writer 竞态
  await client.query(
    `UPDATE initiative_runs
     SET phase='B_task_loop', contract_id=$1::uuid, updated_at=NOW()
     WHERE id=$2::uuid AND phase='A_contract'`,
    [contractId, run.run_id]
  );
  return {
    runId: run.run_id,
    initiativeId: run.initiative_id,
    status: 'A_to_B',
    contractId,
  };
}

// ─── Phase B 内部推进 ────────────────────────────────────────────────────────

async function advancePhaseB(run, client, dbPool, runPhaseC) {
  // 先找到 harness_initiative parent task（子任务的 payload.parent_task_id 锚点）
  const parentQ = await client.query(
    `SELECT id FROM tasks
     WHERE task_type='harness_initiative'
       AND (id = $1::uuid OR payload->>'initiative_id' = $1::text)
     ORDER BY created_at ASC
     LIMIT 1`,
    [run.initiative_id]
  );
  if (parentQ.rows.length === 0) {
    return {
      runId: run.run_id,
      initiativeId: run.initiative_id,
      status: 'no_parent_task',
    };
  }
  const parentTaskId = parentQ.rows[0].id;

  // current_task 仍 active → 跳过
  if (run.current_task_id) {
    const curQ = await client.query(
      `SELECT status FROM tasks WHERE id=$1::uuid`,
      [run.current_task_id]
    );
    const st = curQ.rows[0]?.status;
    if (st && ACTIVE_TASK_STATUSES.has(st)) {
      return {
        runId: run.run_id,
        initiativeId: run.initiative_id,
        status: 'B_busy',
        currentTaskId: run.current_task_id,
      };
    }
  }

  // 取依赖全绿的下一 queued task
  const next = await nextRunnableTask(parentTaskId, { client });
  if (next) {
    await client.query(
      `UPDATE initiative_runs
       SET current_task_id=$1::uuid, updated_at=NOW()
       WHERE id=$2::uuid AND phase='B_task_loop'`,
      [next.id, run.run_id]
    );
    // PRD 要求保底 UPDATE tasks SET status='queued'（抵御外部 writer 误改）
    await client.query(
      `UPDATE tasks SET status='queued'
       WHERE id=$1::uuid AND status<>'queued' AND status<>'in_progress'`,
      [next.id]
    );
    return {
      runId: run.run_id,
      initiativeId: run.initiative_id,
      status: 'B_picked',
      currentTaskId: next.id,
    };
  }

  // 无可运行 task：若所有子 Task 完成 → 触发 Phase C 判决
  const taskStatus = await checkAllTasksCompleted(parentTaskId, client);
  if (taskStatus.all) {
    const phaseC = await runPhaseC(parentTaskId, { pool: dbPool });
    return {
      runId: run.run_id,
      initiativeId: run.initiative_id,
      status: 'B_to_C',
      phaseC,
    };
  }

  return {
    runId: run.run_id,
    initiativeId: run.initiative_id,
    status: 'B_waiting',
    remaining: taskStatus.remaining,
  };
}
