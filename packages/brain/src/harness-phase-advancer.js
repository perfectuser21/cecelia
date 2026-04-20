import { nextRunnableTask as defaultNextRunnableTask } from './harness-dag.js';
import {
  checkAllTasksCompleted as defaultCheckAllTasksCompleted,
  runPhaseCIfReady as defaultRunPhaseCIfReady,
} from './harness-initiative-runner.js';

const ACTIVE_PHASES = ['A_contract', 'B_task_loop', 'C_final_e2e'];
const MAX_RUNS_PER_TICK = 50;
const RUNNING_STATUSES = new Set(['queued', 'running', 'in_progress']);

/**
 * Brain tick 内钩子：扫描活跃 initiative_runs 并晋级 phase。
 *
 * @param {object} pool                pg Pool
 * @param {object} [deps]              测试注入
 * @param {Function} [deps.nextRunnableTask]
 * @param {Function} [deps.checkAllTasksCompleted]
 * @param {Function} [deps.runPhaseCIfReady]
 * @returns {Promise<{advanced:number, errors:Array<{runId,error}>}>}
 */
export async function advanceHarnessInitiatives(pool, deps = {}) {
  const nextRunnableTask = deps.nextRunnableTask || defaultNextRunnableTask;
  const checkAllTasksCompleted = deps.checkAllTasksCompleted || defaultCheckAllTasksCompleted;
  const runPhaseCIfReady = deps.runPhaseCIfReady || defaultRunPhaseCIfReady;

  const client = await pool.connect();
  let advanced = 0;
  const errors = [];

  try {
    const { rows: runs } = await client.query(
      `SELECT id, initiative_id, phase, current_task_id, contract_id
       FROM initiative_runs
       WHERE phase = ANY ($1::text[])
         AND (updated_at IS NULL OR updated_at < NOW() - INTERVAL '5 seconds')
       ORDER BY updated_at NULLS FIRST
       LIMIT $2`,
      [ACTIVE_PHASES, MAX_RUNS_PER_TICK]
    );

    for (const run of runs) {
      try {
        const changed = await advanceSingleRun(run, client, {
          nextRunnableTask, checkAllTasksCompleted, runPhaseCIfReady, pool,
        });
        if (changed) advanced += 1;
      } catch (err) {
        console.error(`[harness-advance] run=${run.id} error: ${err.message}`);
        errors.push({ runId: run.id, error: err.message });
      }
    }
  } finally {
    client.release();
  }

  return { advanced, errors };
}

async function advanceSingleRun(run, client, deps) {
  if (run.phase === 'A_contract') {
    const { rows } = await client.query(
      `SELECT status FROM initiative_contracts WHERE id = $1::uuid`,
      [run.contract_id]
    );
    if (rows[0]?.status === 'approved') {
      await client.query(
        `UPDATE initiative_runs SET phase='B_task_loop', updated_at=NOW() WHERE id=$1::uuid`,
        [run.id]
      );
      return true;
    }
    return false;
  }

  if (run.phase === 'B_task_loop') {
    if (run.current_task_id) {
      const { rows } = await client.query(
        `SELECT status FROM tasks WHERE id = $1::uuid`,
        [run.current_task_id]
      );
      if (rows[0] && RUNNING_STATUSES.has(rows[0].status)) return false;
    }

    const next = await deps.nextRunnableTask(run.initiative_id, { client });
    if (next) {
      await client.query(
        `UPDATE initiative_runs SET current_task_id=$1::uuid, updated_at=NOW() WHERE id=$2::uuid`,
        [next.id, run.id]
      );
      await client.query(
        `UPDATE tasks SET status='queued', updated_at=NOW()
         WHERE id=$1::uuid AND status <> 'queued'`,
        [next.id]
      );
      return true;
    }

    const stat = await deps.checkAllTasksCompleted(run.initiative_id, client);
    if (stat && stat.all) {
      await deps.runPhaseCIfReady(run.initiative_id, { pool: deps.pool });
      return true;
    }
    return false;
  }

  // C_final_e2e: runPhaseCIfReady 内部自管，这里不动
  return false;
}
