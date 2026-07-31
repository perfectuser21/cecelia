import { LOG_ACTION } from './constants.js';

const VERIFIED_REMOTE_TRANSPORTS = new Set(['fleet-worker', 'remote-bridge']);
const VERIFIED_TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
]);
const CANONICAL_SHA = /^[a-f0-9]{40}$/;
const CANONICAL_BRANCH = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;

function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function taskBundle(attempt) {
  return asJson(attempt?.task_bundle) ?? {};
}

function verifiedPlannerArtifact(artifact, expected) {
  return (
    artifact
    && typeof artifact === 'object'
    && !Array.isArray(artifact)
    && artifact.type === 'git_artifact'
    && artifact.kind === 'planner_prd'
    && artifact.verification_status === 'verified'
    && artifact.path === expected.path
    && artifact.repo === expected.repo
    && artifact.branch === expected.branch
    && CANONICAL_SHA.test(artifact.head_sha ?? '')
  );
}

function serverVerificationMatches(proof, artifact) {
  return (
    proof
    && typeof proof === 'object'
    && !Array.isArray(proof)
    && proof.method === 'git_branch_head'
    && proof.artifact?.path === artifact.path
    && proof.artifact?.repo === artifact.repo
    && proof.artifact?.branch === artifact.branch
    && proof.artifact?.head_sha === artifact.head_sha
  );
}

/**
 * A remote planner cannot make its worker-local file visible to Brain. Its
 * authenticated, lease-fenced callback is therefore the durable artifact
 * receipt. Cross-check it against the exact terminal Attempt and the task's
 * logical sprint path; never trust a caller-supplied host worktree path.
 */
export function getVerifiedRemotePlannerPrdArtifact({
  runId,
  task,
  logRows,
  attemptRows,
}) {
  const payload = asJson(task?.payload) ?? {};
  const sprintDir = typeof payload.sprint_dir === 'string'
    ? payload.sprint_dir.replace(/\/+$/, '')
    : '';
  if (!sprintDir) return null;
  const expectedPath = `${sprintDir}/sprint-prd.md`;
  const attemptsById = new Map(
    attemptRows.map((attempt) => [String(attempt.id), attempt]),
  );

  for (const row of logRows) {
    if (row.action !== LOG_ACTION.ATTEMPT_CALLBACK) continue;
    const detail = asJson(row.detail);
    if (
      detail?.run_id !== runId
      || detail.role !== 'planner'
      || !VERIFIED_TERMINAL_STATUSES.has(detail.status)
      || !Number.isInteger(detail.lease_generation)
    ) {
      continue;
    }
    const attempt = attemptsById.get(String(detail.attempt_id));
    const bundle = taskBundle(attempt);
    const expectedBranch = bundle?.inputs?.planner_branch;
    const expectedRepo = bundle?.inputs?.workspace_spec?.repo;
    if (
      !attempt
      || attempt.run_id !== runId
      || attempt.role !== 'planner'
      || !VERIFIED_TERMINAL_STATUSES.has(attempt.status)
      || attempt.status !== detail.status
      || attempt.lease_generation !== detail.lease_generation
      || !VERIFIED_REMOTE_TRANSPORTS.has(attempt.execution_transport)
      || attempt.machine_attestation_status !== 'verified'
      || typeof attempt.actual_machine_id !== 'string'
      || !attempt.actual_machine_id
      || !CANONICAL_BRANCH.test(expectedBranch ?? '')
      || typeof expectedRepo !== 'string'
      || !expectedRepo
    ) {
      continue;
    }
    const artifact = Array.isArray(detail.artifacts)
      ? detail.artifacts.find((candidate) => verifiedPlannerArtifact(candidate, {
          path: expectedPath,
          repo: expectedRepo,
          branch: expectedBranch,
        }))
      : null;
    const attemptResult = asJson(attempt.result);
    const eventProof = detail.server_verification?.planner_git_artifact;
    const attemptProof = attemptResult?.server_verification?.planner_git_artifact;
    if (
      artifact
      && serverVerificationMatches(eventProof, artifact)
      && serverVerificationMatches(attemptProof, artifact)
    ) {
      return Object.freeze({ ...artifact });
    }
  }
  return null;
}

export function hasVerifiedRemotePlannerPrdReceipt(input) {
  return getVerifiedRemotePlannerPrdArtifact(input) != null;
}
