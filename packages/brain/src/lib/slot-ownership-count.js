import pool from '../db.js';
import { deterministicScriptSql } from './code-script-policy.js';
import { CODEX_SLOT_TASK_TYPES, TASK_TYPE_REGISTRY, isExternalWorkerTask } from './task-type-registry.js';
import { nativeAgentOwnerSql } from './native-agent-authority.js';

export async function countCeceliaInProgress() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM tasks
      WHERE status = 'in_progress'
      AND (payload->>'decomposition' IS NOT NULL
           OR payload->>'requires_cortex' = 'true')
    `);
    return parseInt(result.rows[0].count, 10);
  } catch {
    return 0;
  }
}

export async function getQueueDepth() {
  try {
    const r = await pool.query("SELECT COUNT(*) FROM tasks WHERE status='queued'");
    return parseInt(r.rows[0].count, 10);
  } catch {
    return 0;
  }
}

export async function countCodexInProgress() {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM tasks WHERE status = 'in_progress'
       AND (task_type = ANY($1::text[]) OR payload->>'executor' = 'codex')`,
      [[...CODEX_SLOT_TASK_TYPES]],
    );
    return parseInt(result.rows[0].count, 10);
  } catch {
    return 0;
  }
}

const externalWorkerTypes = Object.keys(TASK_TYPE_REGISTRY).filter(task_type => isExternalWorkerTask({ task_type }));

// Baseline and exclusion candidates share one PostgreSQL snapshot. Revalidation may
// only retain that original exclusion set, never subtract newly appearing tasks.
function ownershipQuery() {
  const sameClaim = `l.source='claim' AND l.claimer=tasks.claimed_by
    AND l.claimed_at=tasks.claimed_at AND l.released_at IS NULL`;
  return `WITH scoped AS (
    SELECT tasks.id,
      jsonb_build_object('id',tasks.id,'executor_kind',tasks.executor_kind,'task_type',tasks.task_type,
        'claimer',tasks.claimed_by,'claim_epoch',tasks.claimed_at::text,
        'lease_source',l.source,'lease_claimer',l.claimer,'lease_epoch',l.claimed_at::text,
        'lease_until',l.lease_until::text,'released_at',l.released_at::text) AS identity,
      COALESCE(length(trim(tasks.claimed_by))>0 AND tasks.claimed_at IS NOT NULL
        AND NOT COALESCE(tasks.payload ? 'invocation',false)
        AND NOT ${nativeAgentOwnerSql('tasks.id')}
        AND ((tasks.executor_kind='headed-session'
          AND (l.task_id IS NULL OR l.released_at IS NOT NULL OR (${sameClaim})))
          OR (tasks.executor_kind='external-worker' AND tasks.task_type=ANY($1::text[])
            AND (${sameClaim}) AND l.lease_until>clock_timestamp())),false) AS independent
    FROM tasks LEFT JOIN task_leases l ON l.task_id=tasks.id
    WHERE tasks.status='in_progress'
      AND tasks.payload->>'decomposition' IS NULL
      AND (tasks.payload->>'requires_cortex' IS NULL OR tasks.payload->>'requires_cortex'!='true')
      AND NOT ${deterministicScriptSql('tasks')}
      AND ($2::uuid[] IS NULL OR tasks.id=ANY($2::uuid[]))
  ) SELECT count(*) AS count,
    COALESCE(jsonb_agg(identity) FILTER (WHERE independent),'[]'::jsonb) AS independent_tasks FROM scoped`;
}

async function runtimeOwners() {
  try {
    const { getActiveProcesses } = await import('../executor.js');
    const { getTaskLaunchIds } = await import('../drain.js');
    const processes = getActiveProcesses();
    if (!Array.isArray(processes)) throw Error('registry observation unavailable');
    return { ok: true, ids: new Set([...processes.map(entry => entry.taskId), ...getTaskLaunchIds()]) };
  } catch {
    return { ok: false };
  }
}

/** Only proven independent ownership subtracts from the original per-Task baseline. */
export async function countAutoDispatchInProgress() {
  const before = await runtimeOwners();
  let baseline;
  try {
    baseline = (await pool.query(ownershipQuery(), [externalWorkerTypes, null])).rows[0];
    if (!baseline || !Number.isSafeInteger(Number(baseline.count)) || Number(baseline.count) < 0) {
      throw Error('automatic pool baseline unavailable');
    }
  } catch (cause) {
    throw new Error('automatic pool ownership observation unavailable', { cause });
  }
  const used = Number(baseline.count);
  const candidates = baseline.independent_tasks ?? [];
  if (!before.ok || !Array.isArray(candidates) || candidates.length > used || candidates.length === 0) return used;
  try {
    const ids = candidates.map(item => item.id);
    const checked = (await pool.query(ownershipQuery(), [externalWorkerTypes, ids])).rows[0];
    if (!Array.isArray(checked?.independent_tasks)) return used;
    const after = await runtimeOwners();
    if (!after.ok) return used;
    const stable = new Set(checked.independent_tasks.map(item => JSON.stringify(item)));
    const excluded = candidates.filter(item => stable.has(JSON.stringify(item))
      && !before.ids.has(item.id) && !after.ids.has(item.id)).length;
    return used - excluded;
  } catch {
    // The baseline is known, but independent ownership is not: retain every slot.
    return used;
  }
}
