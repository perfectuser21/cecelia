import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function invalidAuthority() {
  const error = new Error('planner_recovery_ground_truth_invalid');
  error.code = 'planner_recovery_ground_truth_invalid';
  return error;
}

export async function loadPlannerRecoveryPrdAuthority(pool, { run, taskId }) {
  if (run?.created_source !== 'planner_recovery') return null;
  if (
    !UUID_PATTERN.test(run.planner_recovery_receipt_id ?? '')
    || !UUID_PATTERN.test(run.predecessor_run_id ?? '')
    || !UUID_PATTERN.test(taskId ?? '')
  ) {
    throw invalidAuthority();
  }
  const result = await pool.query(
    `SELECT receipt.*,
            consumption.successor_task_id,
            predecessor.initiative_id,
            predecessor.current_task_id AS predecessor_task_id,
            predecessor.phase AS predecessor_phase,
            predecessor.orchestrator_version,
            predecessor.record_trust_status,
            source_task.status AS source_task_status
       FROM planner_recovery_receipts receipt
       JOIN planner_recovery_consumptions consumption
         ON consumption.receipt_id=receipt.id
       JOIN initiative_runs predecessor
         ON predecessor.id=receipt.predecessor_run_id
       JOIN tasks source_task
         ON source_task.id=receipt.source_task_id
      WHERE receipt.id=$1::uuid
        AND consumption.successor_task_id=$2::uuid`,
    [run.planner_recovery_receipt_id, taskId],
  );
  const receipt = result.rows[0];
  const changedFiles = asArray(receipt?.changed_files);
  if (
    result.rows.length !== 1
    || receipt.predecessor_run_id !== run.predecessor_run_id
    || receipt.successor_task_id !== taskId
    || receipt.source_task_id !== receipt.predecessor_task_id
    || receipt.initiative_id !== run.initiative_id
    || receipt.predecessor_phase !== 'failed'
    || receipt.orchestrator_version !== 'v2'
    || receipt.record_trust_status !== 'trusted'
    || receipt.source_task_status !== 'failed'
    || receipt.verification_method !== 'remote_exact_commit_blob'
    || !SHA_PATTERN.test(receipt.base_sha ?? '')
    || !SHA_PATTERN.test(receipt.head_sha ?? '')
    || !DIGEST_PATTERN.test(receipt.content_sha256 ?? '')
    || !DIGEST_PATTERN.test(receipt.changed_files_digest ?? '')
    || Buffer.byteLength(receipt.content ?? '') !== Number(receipt.byte_length)
    || sha256(Buffer.from(receipt.content ?? '')) !== receipt.content_sha256
    || changedFiles?.length !== 1
    || changedFiles[0] !== receipt.prd_path
    || sha256(JSON.stringify(changedFiles)) !== receipt.changed_files_digest
  ) {
    throw invalidAuthority();
  }
  const artifact = Object.freeze({
    type: 'git_artifact',
    kind: 'planner_prd',
    path: receipt.prd_path,
    repo: receipt.repo,
    branch: receipt.resolved_branch,
    base_sha: receipt.base_sha,
    head_sha: receipt.head_sha,
    content_sha256: receipt.content_sha256,
    verification_status: 'verified',
  });
  return Object.freeze({
    artifact,
    evidence: Object.freeze({
      source: 'planner_recovery_receipt',
      receipt_id: receipt.id,
      artifact,
    }),
  });
}
