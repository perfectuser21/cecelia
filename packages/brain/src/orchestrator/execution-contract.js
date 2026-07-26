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

// Keep transport parsing permissive because legacy role Skills emit useful
// metadata alongside either `outcome` or `verdict`. Adversarial roles are
// normalized and validated in parseHarnessResult below.
const decisionSchema = z.object({}).passthrough();

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

export function parseHarnessResult(value, role, expectedOutput = null) {
  const parsed = harnessResultSchema.parse(value);
  if (expectedOutput === 'harness-result/canary-v1') {
    // Every executor terminal state must reach persistence. Only the exact
    // successful state is subject to the stricter canary proof envelope.
    if (parsed.status !== 'completed') return parsed;
    if (parsed.decision?.outcome !== 'CANARY_OK') {
      throw new Error('canary result requires status completed and decision outcome CANARY_OK');
    }
    if (parsed.artifacts.length !== 0 || parsed.checks.length !== 0 || parsed.error !== null) {
      throw new Error('canary result requires empty artifacts, empty checks, and null error');
    }
    return parsed;
  }
  const decisionRequired = ['completed', 'completed_with_concerns'].includes(parsed.status);
  const adversarialRole = ['reviewer', 'evaluator', 'judge'].includes(role);
  if (decisionRequired && adversarialRole && !parsed.decision) {
    throw new Error(`decision is required for adversarial role ${role}`);
  }
  if (decisionRequired && adversarialRole && parsed.decision) {
    const outcome = parsed.decision.outcome ?? parsed.decision.verdict;
    if (typeof outcome !== 'string' || !outcome.trim()) {
      throw new Error(`decision outcome is required for adversarial role ${role}`);
    }
    const reason = parsed.decision.reason ?? parsed.decision.feedback ?? parsed.summary;
    return {
      ...parsed,
      decision: {
        ...parsed.decision,
        outcome: outcome.trim(),
        reason: String(reason ?? '').trim(),
      },
    };
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
