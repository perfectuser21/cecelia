import { z } from 'zod';

export const TASK_CONTRACT_VERSION = '1.0';
export const RESULT_CONTRACT_VERSION = '1.0';

export const ROLE_VALUES = [
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'evaluator',
  'judge',
  'reporter',
];

const EXECUTOR_STATUSES = [
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
];

const PROVIDER_NATIVE_INSTRUCTION = /(?:\bTask\s+tool\b|Skill\s*\(|\bspawn_agent\b)/i;

const skillSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  content: z.string().min(1),
});

const taskBundleSchema = z.object({
  contract_version: z.literal(TASK_CONTRACT_VERSION),
  run_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  hop: z.number().int().positive(),
  phase: z.string().min(1),
  role: z.enum(ROLE_VALUES),
  objective: z.string().min(1),
  skill: skillSchema.nullable().optional(),
  inputs: z.object({
    task_id: z.string().min(1),
    sprint_dir: z.string().min(1),
    worktree_path: z.string().min(1),
    artifacts: z.array(z.unknown()).default([]),
  }).passthrough(),
  constraints: z.object({
    read_only: z.boolean(),
    fresh_session: z.boolean(),
    timeout_seconds: z.number().int().positive(),
  }).passthrough(),
  expected_output: z.string().min(1),
});

const decisionSchema = z.object({
  outcome: z.string().min(1),
  reason: z.string().min(1),
}).passthrough();

const harnessResultSchema = z.object({
  contract_version: z.literal(RESULT_CONTRACT_VERSION),
  attempt_id: z.string().uuid(),
  status: z.enum(EXECUTOR_STATUSES),
  summary: z.string(),
  artifacts: z.array(z.unknown()).default([]),
  checks: z.array(z.unknown()).default([]),
  decision: decisionSchema.nullable(),
  error: z.unknown().nullable(),
  provider_metadata: z.object({
    provider: z.string().min(1),
    session_id: z.string().min(1).nullable().optional(),
  }).passthrough(),
});

export function parseTaskBundle(value) {
  const parsed = taskBundleSchema.parse(value);
  if (PROVIDER_NATIVE_INSTRUCTION.test(parsed.objective)) {
    throw new Error('provider_native_instruction: TaskBundle objective must not name provider tools');
  }
  return parsed;
}

export function parseHarnessResult(value, role) {
  const parsed = harnessResultSchema.parse(value);
  if (['reviewer', 'evaluator', 'judge'].includes(role) && !parsed.decision) {
    throw new Error(`decision is required for adversarial role ${role}`);
  }
  return parsed;
}

export function toKernelStatus(status) {
  const mapping = {
    completed: 'DONE',
    completed_with_concerns: 'DONE_WITH_CONCERNS',
    needs_context: 'NEEDS_CONTEXT',
    blocked: 'BLOCKED',
  };
  if (mapping[status]) return mapping[status];
  if (status === 'failed' || status === 'cancelled') {
    throw new Error(`executor_terminal:${status}`);
  }
  throw new Error(`invalid_executor_status:${String(status)}`);
}

export const __test__ = {
  taskBundleSchema,
  harnessResultSchema,
  PROVIDER_NATIVE_INSTRUCTION,
};
