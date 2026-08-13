import { z } from 'zod';
import { parseBaseRepo } from './github-pr-discovery.js';

const CANONICAL_SHA = /^[a-f0-9]{40}$/;
const TASK_BRANCH = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;
const ATTEMPT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const WORKSPACE_REPOSITORIES = Object.freeze([
  'perfectuser21/cecelia',
  'perfectuser21/zenithjoy-workspace',
]);

const shaSchema = (field) => z.string().regex(
  CANONICAL_SHA,
  `${field} must be a 40-character lowercase Git SHA`,
);

const branchSchema = z.string()
  .regex(TASK_BRANCH, 'branch must be a canonical cp-* task branch')
  .refine(
    (value) => !value.includes('..') && !value.endsWith('.lock'),
    'branch contains a forbidden Git ref sequence',
  );

const workspaceSpecSchema = z.object({
  repo: z.enum(WORKSPACE_REPOSITORIES),
  base_sha: shaSchema('base_sha'),
  branch: branchSchema,
  expected_head_sha: shaSchema('expected_head_sha').nullable(),
  mode: z.enum(['read-only', 'read-write']),
  run_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  // A frozen baseline is an invariant, not a starting suggestion: the Attempt
  // must never import another lineage (latest main, a competing candidate) on
  // top of the SHA the server pinned. Every layer below re-reads this bit.
  frozen_baseline: z.boolean().default(false),
  source_attempt_id: z.string().regex(ATTEMPT_ID, 'source_attempt_id must be a UUID').optional(),
}).strict();

export function parseWorkspaceSpec(value, expected = {}) {
  const parsed = workspaceSpecSchema.parse(value);
  if (expected.runId && parsed.run_id !== expected.runId) {
    throw new Error('workspace_run_id_mismatch');
  }
  if (expected.attemptId && parsed.attempt_id !== expected.attemptId) {
    throw new Error('workspace_attempt_id_mismatch');
  }
  if (expected.mode && parsed.mode !== expected.mode) {
    throw new Error('workspace_mode_mismatch');
  }
  return Object.freeze(parsed);
}

export function buildWorkspaceSpec(value) {
  return parseWorkspaceSpec(value);
}

export function createWorkspaceSpecResolver({ resolveRepoHead } = {}) {
  if (typeof resolveRepoHead !== 'function') {
    throw new Error('workspace_resolver_invalid_head_resolver');
  }

  return async function resolveWorkspaceSpec({
    action,
    role,
    readOnly,
    attemptId,
    ctx,
    bundle,
  } = {}) {
    const payload = ctx?.observed?.task?.payload ?? {};
    const requestedRepo = payload.base_repo;
    const repo = requestedRepo == null || requestedRepo === ''
      ? 'perfectuser21/cecelia'
      : parseBaseRepo(requestedRepo);
    if (!WORKSPACE_REPOSITORIES.includes(repo)) {
      throw new Error('workspace_repo_not_supported');
    }

    const inputs = bundle?.inputs ?? {};
    const generatorFix = action === 'spawn:generator-fix';
    const candidate = (['evaluator', 'judge', 'publisher'].includes(role) || generatorFix)
      && inputs.candidate && typeof inputs.candidate === 'object'
      ? inputs.candidate
      : null;
    if (candidate && candidate.repo !== repo) {
      throw new Error('workspace_candidate_repo_mismatch');
    }
    if (
      generatorFix
      && !candidate
      && (
        typeof inputs.pr_branch !== 'string'
        || typeof inputs.pr_head_sha !== 'string'
      )
    ) {
      throw new Error('generator_fix_workspace_evidence_missing');
    }
    const immutableRoleSha = candidate?.head_sha ?? (generatorFix
      ? inputs.pr_head_sha
      : role === 'reviewer'
        ? inputs.contract_sha
        : (role === 'evaluator' || role === 'judge')
          ? inputs.pr_head_sha
          : null);
    const plannerBaseSha = role === 'proposer'
      ? inputs.planner_head_sha
      : null;
    // A task that pins payload.base_sha has chosen an exact baseline instead of
    // latest main — that is the observable, server-side signal for a frozen or
    // comparison run. Ordinary dev leaves it unset and keeps latest-main rebase.
    const frozenBaseline = CANONICAL_SHA.test(String(payload.base_sha ?? ''));
    const baseSha = plannerBaseSha
      ?? immutableRoleSha
      ?? payload.base_sha
      ?? await resolveRepoHead(repo);
    const branch = (
      candidate?.branch
      ??
      (generatorFix ? inputs.pr_branch : null)
      ?? (role === 'evaluator' || role === 'judge' ? inputs.pr_branch : null)
      ?? (role === 'reviewer' ? inputs.contract_branch : null)
      ?? inputs.propose_branch
      ?? payload.branch_name
      ?? payload.branch
      ?? `cp-fleet-${role}-${String(attemptId).slice(0, 8)}`
    );

    return buildWorkspaceSpec({
      repo,
      base_sha: baseSha,
      branch,
      expected_head_sha: immutableRoleSha ?? null,
      mode: readOnly ? 'read-only' : 'read-write',
      run_id: ctx?.runId,
      attempt_id: attemptId,
      frozen_baseline: candidate != null || frozenBaseline,
      ...(candidate?.source_attempt_id
        ? { source_attempt_id: candidate.source_attempt_id }
        : {}),
    });
  };
}

export const __test__ = {
  workspaceSpecSchema,
};
