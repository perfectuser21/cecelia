import { z } from 'zod';
import { parseWorkspaceSpec } from './workspace-spec.js';
import {
  parseCommanderBundle,
  parseCommanderDirective,
} from './commander-contract.js';

export const TASK_CONTRACT_VERSION = '1.0';
export const RESULT_CONTRACT_VERSION = '1.0';
export const RESULT_CHANNEL_VERSION = 'attempt-result-file/v1';
export const RESULT_CHANNEL_ROOT = '/tmp/cecelia-prompts';
export const RESULT_CHANNEL_MAX_BYTES = 1024 * 1024;

export const ROLE_VALUES = [
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'evaluator',
  'judge',
  'reporter',
  'commander',
];

const EXECUTOR_STATUSES = [
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
];

const PROVIDER_UNAVAILABLE_CODES = new Set([
  'http_500',
  'http_502',
  'http_503',
  'http_504',
  'provider_unavailable',
]);

const PROVIDER_NATIVE_INSTRUCTION = /(?:\bTask\s+tool\b|Skill\s*\(|\bspawn_agent\b)/i;

const skillSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  content: z.string().min(1),
});

const resultChannelBindingsSchema = z.object({
  task_id: z.string().min(1).regex(/^[^\r\n]+$/),
  run_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  role: z.enum(ROLE_VALUES),
}).strict();

const resultChannelDescriptorSchema = z.object({
  version: z.literal(RESULT_CHANNEL_VERSION),
  path: z.string().min(1),
  max_bytes: z.number().int().positive().max(RESULT_CHANNEL_MAX_BYTES),
  bindings: resultChannelBindingsSchema,
}).strict();

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
    worktree_path: z.string().min(1).optional(),
    execution_surface: z.literal('fleet-worker').optional(),
    workspace_spec: z.unknown().optional(),
    artifacts: z.array(z.unknown()).default([]),
  }).passthrough(),
  constraints: z.object({
    read_only: z.boolean(),
    fresh_session: z.boolean(),
    timeout_seconds: z.number().int().positive(),
  }).passthrough(),
  expected_output: z.string().min(1),
  result_channel: z.unknown().optional(),
});

// Keep transport parsing permissive because legacy role Skills emit useful
// metadata alongside either `outcome` or `verdict`. Adversarial roles are
// normalized and validated in parseHarnessResult below.
const decisionSchema = z.object({}).passthrough();

const gitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const boundedPathSchema = z.string().min(1).max(1024);
const boundedTextSchema = z.string().max(32768);
const rubricScoresSchema = z.object({
  dod_machineability: z.number().min(0).max(10),
  scope_match_prd: z.number().min(0).max(10),
  test_is_red: z.number().min(0).max(10),
  internal_consistency: z.number().min(0).max(10),
  risk_registered: z.number().min(0).max(10),
  verification_oracle_completeness: z.number().min(0).max(10),
  ci_workflow_alignment: z.number().min(0).max(10),
}).strict();
const artifactDigestSchema = z.object({
  path: boundedPathSchema,
  sha256: sha256DigestSchema,
}).strict();
const behaviorTestSchema = z.object({
  command: z.string().min(1).max(16384),
  exit_code: z.number().int().min(0).max(255),
  log_tail: z.string().max(32768),
  verification_level: z.enum(['L1', 'L2', 'L3']).optional(),
  action: z.string().min(1).max(8192).optional(),
  expected: z.string().min(1).max(8192).optional(),
}).strict();
const cascadeAssertionSchema = z.object({
  link_id: z.string().min(1).max(128),
  assertion_ref: z.string().max(8192),
  ran: z.boolean(),
  result: z.enum(['pass', 'fail', 'skip']),
}).strict();

const plannerRoleResultSchema = z.object({
  kind: z.literal('planner'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    verdict: z.enum(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']),
    branch: z.string().min(1).max(255),
    sprint_dir: boundedPathSchema,
    planner_branch: z.string().min(1).max(255),
    review_required: z.boolean(),
    status: z.enum(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']),
  }).strict(),
  verified: z.object({
    branch: z.string().min(1).max(255),
    sprint_dir: boundedPathSchema,
    planner_branch: z.string().min(1).max(255),
    prd_sha256: sha256DigestSchema,
    effective_review_required: z.boolean(),
  }).strict(),
}).strict();

const proposerRoleResultSchema = z.object({
  kind: z.literal('proposer'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    propose_branch: z.string().min(1).max(255),
    workstream_count: z.literal(1),
    task_plan_path: boundedPathSchema,
  }).strict(),
  verified: z.object({
    propose_branch: z.string().min(1).max(255),
    head_sha: gitShaSchema,
    artifacts: z.object({
      contract_draft: artifactDigestSchema,
      contract_dod: artifactDigestSchema,
      task_plan: artifactDigestSchema,
      contract_tests: artifactDigestSchema,
    }).strict(),
  }).strict(),
}).strict();

const reviewerRoleResultSchema = z.object({
  kind: z.literal('reviewer'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    verdict: z.enum(['APPROVED', 'REVISION']),
    rubric_scores: rubricScoresSchema,
    judgments_written: z.number().int().nonnegative(),
    feedback: boundedTextSchema,
  }).strict(),
  verified: z.object({
    contract_sha: gitShaSchema,
    verdict: z.enum(['APPROVED', 'REVISION']),
    rubric_scores: rubricScoresSchema,
    judgments_written: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const generatorClaimSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('DONE'),
    pr_url: z.string().url(),
  }).strict(),
  z.object({
    verdict: z.literal('FIXED'),
    pr_url: z.string().url(),
    fixes: z.array(z.string().min(1).max(4096)).min(1).max(100),
  }).strict(),
  z.object({
    verdict: z.literal('FAILED'),
    pr_url: z.string().url(),
    reason: boundedTextSchema.min(1),
  }).strict(),
]);
const generatorRoleResultSchema = z.object({
  kind: z.literal('generator'),
  raw_sha256: rawSha256Schema,
  claimed: generatorClaimSchema,
  verified: z.object({
    pull_request: z.object({
      type: z.literal('pull_request'),
      url: z.string().url(),
      number: z.number().int().positive(),
      head_ref: z.string().min(1).max(255),
      head_sha: gitShaSchema,
      state: z.literal('OPEN'),
    }).strict(),
  }).strict(),
}).strict();

const evaluatorRoleResultSchema = z.object({
  kind: z.literal('evaluator'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    verdict: z.enum(['PASS', 'FAIL']),
    task_id: z.string().min(1).max(128),
    attempt_id: z.string().uuid(),
    failed_step: boundedTextSchema.nullable().optional(),
    log_excerpt: boundedTextSchema.nullable().optional(),
    behavior_tests: z.array(behaviorTestSchema).max(256).optional(),
    unverifiable: z.array(z.object({
      item: z.string().min(1).max(8192),
      reason: z.string().min(1).max(8192),
    }).strict()).max(256).optional(),
    verification_level: z.enum(['L1', 'L2', 'L3']).optional(),
    screenshots: z.array(z.string().url().max(4096)).max(256).optional(),
    cascade_assertions: z.array(cascadeAssertionSchema).max(256).optional(),
    notes: boundedTextSchema.optional(),
  }).strict(),
  verified: z.object({
    pr_head_sha: gitShaSchema,
    behavior_tests: z.array(behaviorTestSchema).max(256),
  }).strict(),
}).strict();

const reporterRoleResultSchema = z.object({
  kind: z.literal('reporter'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    verdict: z.enum(['DONE', 'DONE_WITH_CONCERNS']),
    task_id: z.string().min(1).max(128),
    report_path: boundedPathSchema,
    pr_url: z.string().url(),
    screenshots: z.array(boundedPathSchema).max(256),
    concerns: boundedTextSchema,
  }).strict(),
  verified: z.object({
    pull_request_url: z.string().url(),
    report: artifactDigestSchema,
    learning: artifactDigestSchema,
    screenshots: z.array(artifactDigestSchema).max(256),
    learnings_inserted: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const roleResultSchema = z.discriminatedUnion('kind', [
  plannerRoleResultSchema,
  proposerRoleResultSchema,
  reviewerRoleResultSchema,
  generatorRoleResultSchema,
  evaluatorRoleResultSchema,
  reporterRoleResultSchema,
]).superRefine((value, context) => {
  if (
    value.kind === 'reviewer'
    && value.claimed.verdict === 'APPROVED'
    && (
      value.claimed.judgments_written < 1
      || value.verified.judgments_written < 1
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'APPROVED reviewer role_result requires an observed judgment write',
      path: ['verified', 'judgments_written'],
    });
  }
});

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
  role_result: roleResultSchema.optional(),
});

function resultPathForAttempt(attemptId) {
  return `${RESULT_CHANNEL_ROOT}/${attemptId}.result.json`;
}

export function parseResultChannelDescriptor(value, expected = {}) {
  const parsed = resultChannelDescriptorSchema.parse(value);
  if (parsed.path !== resultPathForAttempt(parsed.bindings.attempt_id)) {
    throw new Error('result_channel_path_mismatch');
  }
  const expectedBindings = [
    ['taskId', 'task_id'],
    ['runId', 'run_id'],
    ['attemptId', 'attempt_id'],
    ['role', 'role'],
  ];
  for (const [expectedKey, bindingKey] of expectedBindings) {
    if (
      expected[expectedKey] !== undefined
      && parsed.bindings[bindingKey] !== expected[expectedKey]
    ) {
      throw new Error(`result_channel_${bindingKey}_mismatch`);
    }
  }
  return Object.freeze({
    ...parsed,
    bindings: Object.freeze(parsed.bindings),
  });
}

export function buildResultChannelDescriptor({
  taskId,
  runId,
  attemptId,
  role,
}) {
  return parseResultChannelDescriptor({
    version: RESULT_CHANNEL_VERSION,
    path: resultPathForAttempt(attemptId),
    max_bytes: RESULT_CHANNEL_MAX_BYTES,
    bindings: {
      task_id: taskId,
      run_id: runId,
      attempt_id: attemptId,
      role,
    },
  }, {
    taskId,
    runId,
    attemptId,
    role,
  });
}

export function parseTaskBundle(value) {
  const parsed = taskBundleSchema.parse(value);
  const hasResultChannel = Object.hasOwn(parsed, 'result_channel');
  if (parsed.inputs.execution_surface === 'fleet-worker') {
    if (!parsed.inputs.workspace_spec) {
      throw new Error('workspace_spec_required');
    }
    parsed.inputs.workspace_spec = parseWorkspaceSpec(parsed.inputs.workspace_spec, {
      runId: parsed.run_id,
      attemptId: parsed.attempt_id,
      mode: parsed.constraints.read_only ? 'read-only' : 'read-write',
    });
    if (!hasResultChannel) {
      throw new Error('result_channel_required');
    }
  } else if (!parsed.inputs.worktree_path) {
    throw new Error('worktree_path_required_for_legacy_execution');
  }
  if (hasResultChannel) {
    parsed.result_channel = parseResultChannelDescriptor(parsed.result_channel, {
      taskId: parsed.inputs.task_id,
      runId: parsed.run_id,
      attemptId: parsed.attempt_id,
      role: parsed.role,
    });
  }
  if (PROVIDER_NATIVE_INSTRUCTION.test(parsed.objective)) {
    throw new Error('provider_native_instruction: TaskBundle objective must not name provider tools');
  }
  if (parsed.role === 'commander') {
    if (!parsed.inputs.commander_bundle) {
      throw new Error('commander_bundle_required');
    }
    const commanderBundle = parseCommanderBundle(parsed.inputs.commander_bundle);
    if (commanderBundle.run_id !== parsed.run_id) {
      throw new Error('commander_bundle_run_id_mismatch');
    }
    if (commanderBundle.commander_attempt_id !== parsed.attempt_id) {
      throw new Error('commander_bundle_attempt_id_mismatch');
    }
    if (parsed.expected_output !== 'commander-directive/v1') {
      throw new Error('commander_expected_output_mismatch');
    }
    parsed.inputs.commander_bundle = commanderBundle;
  }
  return parsed;
}

export function parseHarnessResult(
  value,
  role,
  expectedOutput = null,
  expectedIdentity = {},
) {
  const parsed = harnessResultSchema.parse(value);
  if (parsed.role_result) {
    if (parsed.role_result.kind !== role) {
      throw new Error(`role_result kind mismatch: result=${parsed.role_result.kind} attempt=${role}`);
    }
    const roleExpectedOutput = `harness-result/${parsed.role_result.kind}-v1`;
    if (expectedOutput && expectedOutput !== roleExpectedOutput) {
      throw new Error(
        `role_result expected_output mismatch: result=${roleExpectedOutput} expected=${expectedOutput}`,
      );
    }
  }
  const failureClass = (() => {
    if (['blocked', 'needs_context'].includes(parsed.status)) {
      return 'semantic_refusal';
    }
    if (!['failed', 'cancelled'].includes(parsed.status)) return null;
    const errorCode = parsed.error && typeof parsed.error === 'object'
      ? String(parsed.error.code ?? '').trim().toLowerCase()
      : '';
    return PROVIDER_UNAVAILABLE_CODES.has(errorCode)
      ? 'infrastructure_blocked'
      : 'runner_failure';
  })();
  const classified = failureClass == null
    ? parsed
    : { ...parsed, failure_class: failureClass };
  if (role === 'commander' || expectedOutput === 'commander-directive/v1') {
    if (role !== 'commander' || expectedOutput !== 'commander-directive/v1') {
      throw new Error('commander_transport_contract_mismatch');
    }
    if (
      expectedIdentity.attemptId
      && classified.attempt_id !== expectedIdentity.attemptId
    ) {
      throw new Error('commander_result_attempt_id_mismatch');
    }
    if (classified.status !== 'completed') {
      if (classified.decision !== null) {
        throw new Error('non_success_commander_result_must_not_carry_directive');
      }
      return classified;
    }
    if (!classified.decision) {
      throw new Error('commander_result_requires_directive');
    }
    const directive = parseCommanderDirective(classified.decision);
    if (expectedIdentity.runId && directive.run_id !== expectedIdentity.runId) {
      throw new Error('commander_directive_run_id_mismatch');
    }
    if (
      expectedIdentity.eventCursor !== undefined
      && directive.event_cursor !== expectedIdentity.eventCursor
    ) {
      throw new Error('commander_directive_event_cursor_mismatch');
    }
    if (
      classified.artifacts.length !== 0
      || classified.checks.length !== 0
      || classified.error !== null
    ) {
      throw new Error(
        'commander result requires empty artifacts, empty checks, and null error',
      );
    }
    return { ...classified, decision: directive };
  }
  if (expectedOutput === 'harness-result/canary-v1') {
    // Every executor terminal state must reach persistence. Only the exact
    // successful state is subject to the stricter canary proof envelope.
    if (classified.status !== 'completed') return classified;
    if (classified.decision?.outcome !== 'CANARY_OK') {
      throw new Error('canary result requires status completed and decision outcome CANARY_OK');
    }
    if (
      classified.artifacts.length !== 0
      || classified.checks.length !== 0
      || classified.error !== null
    ) {
      throw new Error('canary result requires empty artifacts, empty checks, and null error');
    }
    return classified;
  }
  const decisionRequired = ['completed', 'completed_with_concerns'].includes(classified.status);
  const adversarialRole = ['reviewer', 'evaluator', 'judge'].includes(role);
  if (decisionRequired && adversarialRole && !classified.decision) {
    throw new Error(`decision is required for adversarial role ${role}`);
  }
  if (decisionRequired && adversarialRole && classified.decision) {
    const outcome = classified.decision.outcome ?? classified.decision.verdict;
    if (typeof outcome !== 'string' || !outcome.trim()) {
      throw new Error(`decision outcome is required for adversarial role ${role}`);
    }
    const reason = classified.decision.reason
      ?? classified.decision.feedback
      ?? classified.summary;
    return {
      ...classified,
      decision: {
        ...classified.decision,
        outcome: outcome.trim(),
        reason: String(reason ?? '').trim(),
      },
    };
  }
  return classified;
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
  roleResultSchema,
  resultChannelDescriptorSchema,
  PROVIDER_NATIVE_INSTRUCTION,
};
