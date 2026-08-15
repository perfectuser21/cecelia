import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const SUCCESS_STATUSES = new Set(['completed', 'completed_with_concerns']);
const REMOTE_TRANSPORTS = new Set(['fleet-worker', 'remote-bridge']);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;
const METHOD = 'remote_exact_commit_blob';

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function evidenceError(message) {
  const error = new Error(message);
  error.code = 'planner_recovery_receipt_evidence_invalid';
  error.httpStatus = 409;
  return error;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

function expectedReceipt(terminalAttempt, result, exactEvidence) {
  const bundle = asObject(terminalAttempt.task_bundle);
  const inputs = asObject(bundle.inputs);
  const workspace = asObject(inputs.workspace_spec);
  const summary = asObject(result?.server_verification)?.planner_recovery_receipt;
  const changedFiles = exactEvidence?.changed_files;
  const expectedPath = `${inputs.sprint_dir}/sprint-prd.md`;
  const verifiedAt = canonicalTimestamp(exactEvidence?.verified_at);
  const valid = (
    UUID_PATTERN.test(terminalAttempt.id ?? '')
    && UUID_PATTERN.test(terminalAttempt.run_id ?? '')
    && UUID_PATTERN.test(inputs.task_id ?? '')
    && Number.isInteger(terminalAttempt.hop)
    && terminalAttempt.hop >= 1
    && Number.isInteger(terminalAttempt.lease_generation)
    && terminalAttempt.lease_generation >= 0
    && terminalAttempt.status === result.status
    && isDeepStrictEqual(terminalAttempt.result, result)
    && REMOTE_TRANSPORTS.has(terminalAttempt.execution_transport)
    && terminalAttempt.machine_attestation_status === 'verified'
    && typeof terminalAttempt.requested_machine_id === 'string'
    && terminalAttempt.requested_machine_id.length > 0
    && terminalAttempt.actual_machine_id === terminalAttempt.requested_machine_id
    && exactEvidence
    && typeof exactEvidence.content === 'string'
    && exactEvidence.content.trim().length > 0
    && Buffer.byteLength(exactEvidence.content) === exactEvidence.byte_length
    && exactEvidence.byte_length <= 512 * 1024
    && digest(Buffer.from(exactEvidence.content)) === exactEvidence.content_sha256
    && DIGEST_PATTERN.test(exactEvidence.content_sha256 ?? '')
    && Array.isArray(changedFiles)
    && changedFiles.length === 1
    && changedFiles[0] === expectedPath
    && digest(JSON.stringify(changedFiles)) === exactEvidence.changed_files_digest
    && DIGEST_PATTERN.test(exactEvidence.changed_files_digest ?? '')
    && exactEvidence.repo === workspace.repo
    && REPO_PATTERN.test(exactEvidence.repo ?? '')
    && exactEvidence.base_sha === workspace.base_sha
    && SHA_PATTERN.test(exactEvidence.base_sha ?? '')
    && SHA_PATTERN.test(exactEvidence.head_sha ?? '')
    && exactEvidence.prd_path === expectedPath
    && exactEvidence.resolved_branch === inputs.planner_branch
    && /^sprints\/[A-Za-z0-9._/-]+\/sprint-prd[.]md$/.test(expectedPath)
    && !/(^\/|\\|\/\/|(^|\/)\.[.]?(\/|$))/.test(expectedPath)
    && BRANCH_PATTERN.test(exactEvidence.resolved_branch ?? '')
    && exactEvidence.verification_method === METHOD
    && verifiedAt
    && summary?.head_sha === exactEvidence.head_sha
    && summary?.content_sha256 === exactEvidence.content_sha256
    && summary?.byte_length === exactEvidence.byte_length
    && summary?.changed_files_digest === exactEvidence.changed_files_digest
    && summary?.verification_method === METHOD
  );
  if (!valid) throw evidenceError('planner recovery receipt evidence is incomplete or inconsistent');
  return {
    predecessor_run_id: terminalAttempt.run_id,
    source_task_id: inputs.task_id,
    planner_attempt_id: terminalAttempt.id,
    attempt_hop: terminalAttempt.hop,
    lease_generation: terminalAttempt.lease_generation,
    repo: exactEvidence.repo,
    base_sha: exactEvidence.base_sha,
    head_sha: exactEvidence.head_sha,
    prd_path: exactEvidence.prd_path,
    resolved_branch: exactEvidence.resolved_branch,
    content: exactEvidence.content,
    content_sha256: exactEvidence.content_sha256,
    byte_length: exactEvidence.byte_length,
    changed_files: [...changedFiles],
    changed_files_digest: exactEvidence.changed_files_digest,
    verification_method: METHOD,
    verified_at: verifiedAt,
  };
}

function normalizeRow(row) {
  return {
    predecessor_run_id: row.predecessor_run_id,
    source_task_id: row.source_task_id,
    planner_attempt_id: row.planner_attempt_id,
    attempt_hop: Number(row.attempt_hop),
    lease_generation: Number(row.lease_generation),
    repo: row.repo,
    base_sha: row.base_sha,
    head_sha: row.head_sha,
    prd_path: row.prd_path,
    resolved_branch: row.resolved_branch,
    content: row.content,
    content_sha256: row.content_sha256,
    byte_length: Number(row.byte_length),
    changed_files: typeof row.changed_files === 'string'
      ? JSON.parse(row.changed_files)
      : row.changed_files,
    changed_files_digest: row.changed_files_digest,
    verification_method: row.verification_method,
    verified_at: row.verified_at instanceof Date
      ? row.verified_at.toISOString()
      : row.verified_at,
  };
}

export async function persistPlannerRecoveryReceipt(
  db,
  { terminalAttempt, result, exactEvidence },
) {
  if (terminalAttempt?.role !== 'planner' || !SUCCESS_STATUSES.has(result?.status)) return null;
  if (!REMOTE_TRANSPORTS.has(terminalAttempt.execution_transport)) return null;
  if (!SUCCESS_STATUSES.has(terminalAttempt.status)) {
    throw evidenceError('planner recovery receipt requires a successful terminal Attempt');
  }
  const expected = expectedReceipt(terminalAttempt, result, exactEvidence);
  const values = [
    expected.predecessor_run_id,
    expected.source_task_id,
    expected.planner_attempt_id,
    expected.attempt_hop,
    expected.lease_generation,
    expected.repo,
    expected.base_sha,
    expected.head_sha,
    expected.prd_path,
    expected.resolved_branch,
    expected.content,
    expected.content_sha256,
    expected.byte_length,
    JSON.stringify(expected.changed_files),
    expected.changed_files_digest,
    expected.verification_method,
    expected.verified_at,
  ];
  const receipt = await db.query(
    `WITH inserted AS (
       INSERT INTO planner_recovery_receipts (
         predecessor_run_id, source_task_id, planner_attempt_id,
         attempt_hop, lease_generation, repo, base_sha, head_sha, prd_path,
         resolved_branch, content, content_sha256, byte_length, changed_files,
         changed_files_digest, verification_method, verified_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14::jsonb, $15, $16, $17::timestamptz
       )
       ON CONFLICT (planner_attempt_id) DO NOTHING
       RETURNING *
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT * FROM planner_recovery_receipts
      WHERE planner_attempt_id = $3::uuid
        AND NOT EXISTS (SELECT 1 FROM inserted)
     LIMIT 1`,
    values,
  );
  const row = receipt.rows[0];
  if (!row || !isDeepStrictEqual(normalizeRow(row), expected)) {
    throw evidenceError('planner recovery receipt retry conflicts with sealed evidence');
  }
  return row;
}
