import { z } from 'zod';

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

export const __test__ = {
  workspaceSpecSchema,
};
