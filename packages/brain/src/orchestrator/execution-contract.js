import { z } from 'zod';
import { parseWorkspaceSpec } from './workspace-spec.js';
import {
  parseCommanderBundle,
  parseCommanderDirective,
} from './commander-contract.js';

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
  'provider_timeout',
  'provider_unavailable',
]);

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
    worktree_path: z.string().min(1).optional(),
    execution_surface: z.literal('fleet-worker').optional(),
    workspace_spec: z.unknown().optional(),
    runtime_resources: z.object({
      // F8（复审）：postgres 恢复原必填语义——放宽成 optional 没有必要，
      // 所有写 runtime_resources 的调用方（preflightGate postgres 分支、
      // dispatcher 对 proposer/reviewer 的默认注入）都会显式给出这个字段。
      postgres: z.boolean(),
      // node_deps（案卷式 GAN 运行时依赖，r17 实证 ajv 缺失）：fleet workspace
      // clone 后是否自动 npm ci。可选——只有 dispatcher 显式声明的角色（当前
      // proposer/reviewer）才会带这个字段，其余角色沿用旧的 {postgres} 独占形状。
      node_deps: z.boolean().optional(),
    }).strict().optional(),
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
// rubric_scores 显式声明（案卷式 GAN，issue ce42f68f）：7 维分数结构化落库，
// 不再靠 reason 文本里的自然语言分数——其余字段维持 passthrough 兼容旧 Skill。
// P3-5（review CHANGES REQUESTED）：record(number) 曾经对混合形状 400 拒绝
// 整个 callback——一个字段格式问题不该炸掉整条终态回调。放宽为
// record(unknown) 在 transport 层无条件接住，数值过滤挪到落库前
// （attempt-store.js numericRubricScores），只留 number 项写入 DB。
const decisionSchema = z.object({
  // strict output 要求"声明即必填"，非 GAN 角色只能填 null——必须用 nullish
  // 同时放行 null 与 undefined。用 optional() 会拒绝 null，整条回调 400、
  // 容器白干、attempt 卡 running 到租约过期（r38 实证回归）。
  rubric_scores: z.record(z.unknown()).nullish(),
}).passthrough();

// 案卷式 GAN 出口字段（design doc §数据流1）。r17 教训：zod 对象 schema 默认
// strip 未声明字段——case_file 必须在顶层逐字段显式声明，不能指望顶层
// passthrough（那会放行任意垃圾字段）。blockers 内部条目形状因角色而异
// （reviewer 带 why_not_found_earlier/prd_gap，proposer 带 closure），
// 用 passthrough 只做"是对象"级校验，字段语义交给案卷落库/展示层。
const caseFileBlockerSchema = z.object({}).passthrough();
const caseFileSchema = z.object({
  blockers: z.array(caseFileBlockerSchema).default([]),
  feedback_md: z.string().optional(),
}).nullish();

const harnessResultSchema = z.object({
  contract_version: z.literal(RESULT_CONTRACT_VERSION),
  attempt_id: z.string().uuid(),
  status: z.enum(EXECUTOR_STATUSES),
  summary: z.string(),
  artifacts: z.array(z.unknown()).default([]),
  checks: z.array(z.unknown()).default([]),
  decision: decisionSchema.nullable(),
  error: z.unknown().nullable(),
  failure_class: z.enum([
    'infrastructure_blocked',
    'semantic_refusal',
    'runner_failure',
    'needs_context',
  ]).optional(),
  provider_metadata: z.object({
    provider: z.string().min(1),
    session_id: z.string().min(1).nullable().optional(),
  }).passthrough(),
  case_file: caseFileSchema,
});

export function parseTaskBundle(value) {
  const parsed = taskBundleSchema.parse(value);
  if (parsed.inputs.execution_surface === 'fleet-worker') {
    if (!parsed.inputs.workspace_spec) {
      throw new Error('workspace_spec_required');
    }
    parsed.inputs.workspace_spec = parseWorkspaceSpec(parsed.inputs.workspace_spec, {
      runId: parsed.run_id,
      attemptId: parsed.attempt_id,
      mode: parsed.constraints.read_only ? 'read-only' : 'read-write',
    });
  } else if (!parsed.inputs.worktree_path) {
    throw new Error('worktree_path_required_for_legacy_execution');
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
  const failureClass = (() => {
    if (parsed.status === 'needs_context') {
      return 'needs_context';
    }
    if (parsed.status === 'blocked') {
      return parsed.failure_class === 'infrastructure_blocked'
        ? 'infrastructure_blocked'
        : 'semantic_refusal';
    }
    if (!['failed', 'cancelled'].includes(parsed.status)) return null;
    if (parsed.failure_class) return parsed.failure_class;
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
  PROVIDER_NATIVE_INSTRUCTION,
};
