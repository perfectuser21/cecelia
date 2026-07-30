import { z } from 'zod';
import { parseBaseRepo } from './github-pr-discovery.js';

const CANONICAL_SHA = /^[a-f0-9]{40}$/;
const TASK_BRANCH = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;

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
  repo: z.literal('perfectuser21/cecelia'),
  base_sha: shaSchema('base_sha'),
  branch: branchSchema,
  expected_head_sha: shaSchema('expected_head_sha').nullable(),
  mode: z.enum(['read-only', 'read-write']),
  run_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
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
    if (repo !== 'perfectuser21/cecelia') {
      throw new Error('workspace_repo_not_supported');
    }

    const inputs = bundle?.inputs ?? {};
    const generatorFix = action === 'spawn:generator-fix';
    if (
      generatorFix
      && (
        typeof inputs.pr_branch !== 'string'
        || typeof inputs.pr_head_sha !== 'string'
      )
    ) {
      throw new Error('generator_fix_workspace_evidence_missing');
    }
    const immutableRoleSha = generatorFix
      ? inputs.pr_head_sha
      : role === 'reviewer'
        ? inputs.contract_sha
        : (role === 'evaluator' || role === 'judge')
          ? inputs.pr_head_sha
          : null;
    const baseSha = immutableRoleSha
      ?? payload.base_sha
      ?? await resolveRepoHead(repo);
    const branch = (
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
    });
  };
}

export const __test__ = {
  workspaceSpecSchema,
};
