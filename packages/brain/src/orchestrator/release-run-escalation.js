import { createHash } from 'node:crypto';

function dedupKey(value) {
  return createHash('sha256').update(JSON.stringify([
    value.run_id,
    value.task_id,
    value.release_run_id ?? null,
    value.release_state ?? null,
    value.detail,
  ])).digest('hex');
}

export function createReleaseBlockedEscalator({ pool, raiseAlert }) {
  return async function escalateReleaseBlocked(value) {
    const key = dedupKey(value);
    const inserted = await pool.query(
      `INSERT INTO kernel_release_blocked_escalations
         (run_id, task_id, release_run_id, release_state, merge_sha,
          severity, detail, dedup_key, evidence)
       VALUES ($1, $2, $3, $4, $5, 'P0', $6, $7, $8::jsonb)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      [
        value.run_id,
        value.task_id,
        value.release_run_id ?? null,
        value.release_state ?? null,
        value.merge_sha ?? null,
        value.detail,
        key,
        JSON.stringify({ source: 'kernel_report_release_gate' }),
      ],
    );
    if (!inserted.rows[0]) return { deduped: true, dedup_key: key };
    await raiseAlert(
      'P0',
      `kernel_release_blocked_${value.release_run_id ?? value.run_id}`,
      `Kernel ReleaseRun BLOCKED: ${value.detail} `
        + `(run=${value.run_id}, release=${value.release_run_id ?? 'unmaterialized'})`,
    );
    return {
      deduped: false,
      escalation_id: inserted.rows[0].id,
      dedup_key: key,
    };
  };
}

export const __test__ = { dedupKey };
