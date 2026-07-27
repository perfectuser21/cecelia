import { z } from 'zod';

const workspaceSpecSchema = z.object({
  repo: z.string().min(1),
  base_sha: z.string().min(1),
  branch: z.string().min(1),
  expected_head_sha: z.string().min(1).nullable(),
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
