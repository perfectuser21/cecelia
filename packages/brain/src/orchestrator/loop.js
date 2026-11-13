import { kernelRuntimeRetiredError } from '../lib/kernel-retirement.js';
import { derive } from './derive.js';
import { deriveCounters } from './counters.js';
import { collectGroundTruth } from './ground-truth.js';

function payloadOf(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function resolveObservation(pool, taskId, runId) {
  if (!runId) {
    const { rows } = await pool.query(
      `SELECT id FROM initiative_runs
        WHERE current_task_id = $1 AND orchestrator_version = 'v2'
        ORDER BY created_at DESC LIMIT 1`, [taskId],
    );
    if (!rows[0]) throw new Error(`runLoop: task ${taskId} has no v2 initiative_runs row`);
    runId = rows[0].id;
  }
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const payload = payloadOf(rows[0]?.payload);
  const sprintDir = String(payload.sprint_dir ?? '').replace(/\/$/, '');
  return {
    runId,
    prdPath: sprintDir ? `${sprintDir}/sprint-prd.md` : 'sprint-prd.md',
    callbackResultPath: payload.callback_result_path ?? '.brain-result.json',
  };
}

/** 历史 Kernel 只留单次观察，不续租、恢复、派发或收账。 */
export async function runLoop(deps, { taskId, runId, dryRun = false }) {
  if (!dryRun) throw kernelRuntimeRetiredError();
  const collect = deps.collectGroundTruth ?? collectGroundTruth;
  const coordinates = collect === collectGroundTruth
    ? await resolveObservation(deps.pool, taskId, runId)
    : { runId };
  const observed = await collect(deps, { taskId, ...coordinates });
  const counters = deriveCounters(observed.decisionLog, { proposeBranchMaxRn: observed.proposeBranchRn });
  const decision = derive({
    ...observed,
    noProgress: counters.noProgress,
    noProgressReason: counters.noProgressReason,
    counters: { ...counters, ganCostUsd: Number(observed.run.cost_usd ?? 0) },
  });
  (deps.log ?? console.log)(`[orchestrator][dry-run] run=${coordinates.runId} phase=${decision.phase} action=${decision.action} reason=${decision.reason}`);
  return { exitReason: 'dry_run', hops: 0, decision };
}
