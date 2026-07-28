import { z } from 'zod';
import { createHash } from 'node:crypto';
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
const isNormalizedRelativePath = (value) => (
  !value.startsWith('/')
  && !/[\r\n\\]/.test(value)
  && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
);
const boundedPathSchema = z.string().min(1).max(1024).refine(
  isNormalizedRelativePath,
  'path must be normalized and relative',
);
const branchSchema = z.string().min(1).max(255).regex(
  /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/,
);
const boundedTextSchema = z.string().max(32768);
const failedStepSchema = z.string().max(8192);
const webUrlSchema = z.string().min(1).max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'URL must use http(s) without embedded credentials');
const evidenceLocationSchema = z.string().min(1).max(4096).refine((value) => {
  if (isNormalizedRelativePath(value)) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'evidence location must be an http(s) URL or normalized relative path');
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
const pullRequestSchema = (states) => z.object({
  type: z.literal('pull_request'),
  url: webUrlSchema,
  number: z.number().int().positive(),
  head_ref: branchSchema,
  head_sha: gitShaSchema,
  state: z.enum(states),
}).strict();
const openPullRequestSchema = pullRequestSchema(['OPEN']);
const reporterPullRequestSchema = pullRequestSchema(['OPEN', 'MERGED']);

const plannerRoleResultSchema = z.object({
  kind: z.literal('planner'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    verdict: z.enum(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']),
    branch: branchSchema,
    sprint_dir: boundedPathSchema,
    planner_branch: branchSchema,
    review_required: z.boolean(),
    status: z.enum(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']),
  }).strict(),
  verified: z.object({
    branch: branchSchema,
    sprint_dir: boundedPathSchema,
    planner_branch: branchSchema,
    prd_sha256: sha256DigestSchema,
    effective_review_required: z.boolean(),
  }).strict(),
}).strict();

const proposerRoleResultSchema = z.object({
  kind: z.literal('proposer'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    propose_branch: branchSchema,
    workstream_count: z.literal(1),
    task_plan_path: boundedPathSchema,
  }).strict(),
  verified: z.object({
    propose_branch: branchSchema,
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
    judgments_written: z.number().int().min(0).max(10000),
    feedback: boundedTextSchema,
  }).strict(),
  verified: z.object({
    contract_sha: gitShaSchema,
    verdict: z.enum(['APPROVED', 'REVISION']),
    rubric_scores: rubricScoresSchema,
    judgments_written: z.number().int().min(0).max(10000),
  }).strict(),
}).strict();

const generatorClaimSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('DONE'),
    pr_url: webUrlSchema,
  }).strict(),
  z.object({
    verdict: z.literal('FIXED'),
    pr_url: webUrlSchema,
    fixes: z.array(z.string().min(1).max(4096)).min(1).max(100),
  }).strict(),
  z.object({
    verdict: z.literal('FAILED'),
    pr_url: webUrlSchema,
    reason: boundedTextSchema.min(1),
  }).strict(),
]);
const generatorRoleResultSchema = z.object({
  kind: z.literal('generator'),
  raw_sha256: rawSha256Schema,
  claimed: generatorClaimSchema,
  verified: z.object({
    pull_request: openPullRequestSchema,
  }).strict(),
}).strict();

const evaluatorRoleResultSchema = z.object({
  kind: z.literal('evaluator'),
  raw_sha256: rawSha256Schema,
  claimed: z.object({
    verdict: z.enum(['PASS', 'FAIL']),
    task_id: z.string().min(1).max(128),
    attempt_id: z.string().uuid(),
    failed_step: failedStepSchema.nullable().optional(),
    log_excerpt: boundedTextSchema.nullable().optional(),
    behavior_tests: z.array(behaviorTestSchema).max(256).optional(),
    unverifiable: z.array(z.object({
      item: z.string().min(1).max(8192),
      reason: z.string().min(1).max(8192),
    }).strict()).max(256).optional(),
    verification_level: z.enum(['L1', 'L2', 'L3']).optional(),
    screenshots: z.array(evidenceLocationSchema).max(256).optional(),
    cascade_assertions: z.array(cascadeAssertionSchema).max(256).optional(),
    notes: boundedTextSchema.optional(),
    feedback: boundedTextSchema.optional(),
    segment_eval: z.string().min(1).max(128).optional(),
  }).strict(),
  verified: z.object({
    contract_sha: gitShaSchema,
    pull_request: openPullRequestSchema,
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
    pr_url: webUrlSchema,
    screenshots: z.array(boundedPathSchema).max(256),
    concerns: boundedTextSchema,
  }).strict(),
  verified: z.object({
    pull_request: reporterPullRequestSchema,
    report: artifactDigestSchema,
    learning: artifactDigestSchema,
    screenshots: z.array(artifactDigestSchema).max(256),
    learnings_inserted: z.number().int().min(0).max(100000),
  }).strict(),
}).strict();

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
  ).join(',')}}`;
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

export function computeRoleResultRawSha256(claimed) {
  return createHash('sha256').update(stableJson(claimed)).digest('hex');
}

function parityIssue(context, message, path = []) {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

const roleResultSchema = z.discriminatedUnion('kind', [
  plannerRoleResultSchema,
  proposerRoleResultSchema,
  reviewerRoleResultSchema,
  generatorRoleResultSchema,
  evaluatorRoleResultSchema,
  reporterRoleResultSchema,
]).superRefine((value, context) => {
  const { claimed, verified } = value;
  if (value.raw_sha256 !== computeRoleResultRawSha256(claimed)) {
    parityIssue(context, 'role_result claimed raw_sha256 mismatch', ['raw_sha256']);
  }
  if (value.kind === 'planner') {
    if (claimed.status !== claimed.verdict) {
      parityIssue(context, 'planner status/verdict parity mismatch', ['claimed', 'status']);
    }
    for (const key of ['branch', 'sprint_dir', 'planner_branch']) {
      if (claimed[key] !== verified[key]) {
        parityIssue(context, `planner ${key} parity mismatch`, ['verified', key]);
      }
    }
    if (claimed.review_required && !verified.effective_review_required) {
      parityIssue(context, 'planner review_required monotonic downgrade', [
        'verified',
        'effective_review_required',
      ]);
    }
  } else if (value.kind === 'proposer') {
    if (claimed.propose_branch !== verified.propose_branch) {
      parityIssue(context, 'proposer branch parity mismatch', ['verified', 'propose_branch']);
    }
    if (claimed.task_plan_path !== verified.artifacts.task_plan.path) {
      parityIssue(context, 'proposer task plan parity mismatch', [
        'verified',
        'artifacts',
        'task_plan',
        'path',
      ]);
    }
    const suffixes = {
      contract_draft: '/contract-draft.md',
      contract_dod: '/contract-dod.md',
      task_plan: '/task-plan.json',
      contract_tests: '/tests',
    };
    for (const [key, suffix] of Object.entries(suffixes)) {
      if (!verified.artifacts[key].path.endsWith(suffix)) {
        parityIssue(context, `proposer ${key} artifact path mismatch`, [
          'verified',
          'artifacts',
          key,
          'path',
        ]);
      }
    }
  } else if (value.kind === 'reviewer') {
    if (claimed.verdict !== verified.verdict) {
      parityIssue(context, 'reviewer verdict parity mismatch', ['verified', 'verdict']);
    }
    if (!sameJson(claimed.rubric_scores, verified.rubric_scores)) {
      parityIssue(context, 'reviewer rubric parity mismatch', ['verified', 'rubric_scores']);
    }
    if (claimed.judgments_written !== verified.judgments_written) {
      parityIssue(context, 'reviewer judgments parity mismatch', [
        'verified',
        'judgments_written',
      ]);
    }
    if (claimed.verdict === 'REVISION' && claimed.judgments_written !== 0) {
      parityIssue(context, 'REVISION reviewer cannot claim judgment writes', [
        'claimed',
        'judgments_written',
      ]);
    }
    if (
      claimed.verdict === 'APPROVED'
      && (
        claimed.judgments_written < 1
        || verified.judgments_written < 1
      )
    ) {
      parityIssue(
        context,
        'APPROVED reviewer role_result requires an observed judgment write',
        ['verified', 'judgments_written'],
      );
    }
  } else if (value.kind === 'generator') {
    if (claimed.pr_url !== verified.pull_request.url) {
      parityIssue(context, 'generator PR URL parity mismatch', [
        'verified',
        'pull_request',
        'url',
      ]);
    }
  } else if (value.kind === 'evaluator') {
    const claimedTests = claimed.behavior_tests ?? [];
    if (!sameJson(claimedTests, verified.behavior_tests)) {
      parityIssue(context, 'evaluator behavior_tests parity mismatch', [
        'verified',
        'behavior_tests',
      ]);
    }
    if (
      claimed.verdict === 'PASS'
      && (
        claimedTests.length === 0
        || claimedTests.some((test) => test.exit_code !== 0)
      )
    ) {
      parityIssue(context, 'evaluator PASS requires observed passing behavior tests', [
        'claimed',
        'behavior_tests',
      ]);
    }
    for (const [index, assertion] of (claimed.cascade_assertions ?? []).entries()) {
      if (assertion.ran !== (assertion.result !== 'skip')) {
        parityIssue(context, 'evaluator cascade ran/result parity mismatch', [
          'claimed',
          'cascade_assertions',
          index,
        ]);
      }
    }
  } else if (value.kind === 'reporter') {
    if (claimed.pr_url !== verified.pull_request.url) {
      parityIssue(context, 'reporter PR URL parity mismatch', [
        'verified',
        'pull_request',
        'url',
      ]);
    }
    if (claimed.report_path !== verified.report.path) {
      parityIssue(context, 'reporter path parity mismatch', ['verified', 'report', 'path']);
    }
    if (!sameJson(claimed.screenshots, verified.screenshots.map(({ path }) => path))) {
      parityIssue(context, 'reporter screenshots parity mismatch', ['verified', 'screenshots']);
    }
  }
});

const harnessResultSchema = z.object({
  contract_version: z.literal(RESULT_CONTRACT_VERSION),
  attempt_id: z.string().uuid(),
  status: z.enum(EXECUTOR_STATUSES),
  summary: z.string().refine(
    (value) => Buffer.byteLength(value) <= 8192,
    'summary exceeds byte limit',
  ),
  artifacts: z.array(z.unknown()).default([]),
  checks: z.array(z.unknown()).default([]),
  decision: decisionSchema.nullable(),
  error: z.unknown().nullable(),
  provider_metadata: z.object({
    provider: z.string().min(1).max(64),
    session_id: z.string().min(1).max(512).nullable().optional(),
  }).passthrough(),
  role_result: roleResultSchema.optional(),
});

function expectedRoleEnvelope(roleResult) {
  const { kind, claimed, verified } = roleResult;
  if (kind === 'planner') {
    return {
      status: {
        DONE: 'completed',
        DONE_WITH_CONCERNS: 'completed_with_concerns',
        NEEDS_CONTEXT: 'needs_context',
        BLOCKED: 'blocked',
      }[claimed.status],
      artifacts: [{
        type: 'planner_prd',
        path: verified.sprint_dir,
        sha256: verified.prd_sha256,
        branch: verified.branch,
      }],
      checks: [],
      decision: {
        outcome: claimed.verdict,
        reason: '',
        review_required: verified.effective_review_required,
      },
    };
  }
  if (kind === 'proposer') {
    return {
      status: 'completed',
      artifacts: Object.entries(verified.artifacts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, artifact]) => ({
          type,
          ...artifact,
          branch: verified.propose_branch,
          head_sha: verified.head_sha,
        })),
      checks: [],
      decision: null,
    };
  }
  if (kind === 'reviewer') {
    return {
      status: 'completed',
      artifacts: [],
      checks: Object.entries(verified.rubric_scores).map(([name, score]) => ({
        name,
        score,
      })),
      decision: {
        outcome: verified.verdict,
        reason: claimed.feedback,
        contract_sha: verified.contract_sha,
        judgments_written: verified.judgments_written,
      },
    };
  }
  if (kind === 'generator') {
    return {
      status: claimed.verdict === 'FAILED' ? 'completed_with_concerns' : 'completed',
      artifacts: [verified.pull_request],
      checks: [],
      decision: {
        outcome: claimed.verdict,
        reason: claimed.reason ?? (claimed.fixes ? claimed.fixes.join('; ') : ''),
        pr_head_sha: verified.pull_request.head_sha,
      },
    };
  }
  if (kind === 'evaluator') {
    const unverifiable = claimed.unverifiable ?? [];
    return {
      status: unverifiable.length > 0 ? 'completed_with_concerns' : 'completed',
      artifacts: [{
        type: 'evaluation_target',
        url: verified.pull_request.url,
        number: verified.pull_request.number,
        head_ref: verified.pull_request.head_ref,
        head_sha: verified.pull_request.head_sha,
        contract_sha: verified.contract_sha,
      }],
      checks: verified.behavior_tests,
      decision: {
        outcome: claimed.verdict,
        reason: claimed.feedback ?? claimed.log_excerpt ?? claimed.failed_step ?? '',
        pr_head_sha: verified.pull_request.head_sha,
        contract_sha: verified.contract_sha,
        unverifiable,
      },
    };
  }
  return {
    status: claimed.verdict === 'DONE_WITH_CONCERNS'
      ? 'completed_with_concerns'
      : 'completed',
    artifacts: [
      verified.pull_request,
      { type: 'harness_report', ...verified.report },
      { type: 'learning', ...verified.learning },
      ...verified.screenshots.map((screenshot) => ({
        type: 'screenshot',
        ...screenshot,
      })),
    ],
    checks: [{
      type: 'learnings_inserted',
      count: verified.learnings_inserted,
    }],
    decision: {
      outcome: claimed.verdict,
      reason: claimed.concerns,
    },
  };
}

function assertOuterRoleResultParity(parsed, authority) {
  const roleResult = parsed.role_result;
  if (!roleResult) return;
  if (authority?.attemptId && authority.attemptId !== parsed.attempt_id) {
    throw new Error('role_result authority attempt_id mismatch');
  }
  const assertPullRequestAuthority = (verifiedPullRequest, {
    required,
    workspaceHead = false,
  } = {}) => {
    const supplied = authority?.pullRequest ?? {};
    const requiredFields = ['url', 'head_ref', 'head_sha', 'state'];
    const hasCompleteAuthority = requiredFields.every(
      (key) => typeof supplied[key] === 'string' && supplied[key].length > 0,
    );
    if (required && !hasCompleteAuthority) {
      throw new Error(`role_result ${roleResult.kind} PR authority is required`);
    }
    const presentEntries = [];
    if (hasCompleteAuthority) {
      let url;
      try {
        url = new URL(supplied.url);
      } catch {
        throw new Error(`role_result ${roleResult.kind} PR authority is required`);
      }
      const numberMatch = (
        !url.search
        && !url.hash
        && !url.username
        && !url.password
        && ['http:', 'https:'].includes(url.protocol)
      )
        ? url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)$/)
        : null;
      const numberFromUrl = numberMatch ? Number(numberMatch[1]) : null;
      if (!Number.isSafeInteger(numberFromUrl)) {
        throw new Error(`role_result ${roleResult.kind} PR authority is required`);
      }
      if (
        supplied.number != null
        && (!Number.isInteger(supplied.number) || supplied.number !== numberFromUrl)
      ) {
        throw new Error(`role_result ${roleResult.kind} PR number authority mismatch`);
      }
      presentEntries.push(
        ['type', 'pull_request'],
        ['url', supplied.url],
        ['number', numberFromUrl],
        ['head_ref', supplied.head_ref],
        ['head_sha', supplied.head_sha],
        ['state', supplied.state],
      );
    } else if (!required) {
      for (const [key, value] of Object.entries(supplied)) {
        if (value != null) presentEntries.push([key, value]);
      }
    }
    for (const [key, expectedValue] of presentEntries) {
      if (verifiedPullRequest[key] !== expectedValue) {
        throw new Error(`role_result ${roleResult.kind} PR ${key} authority mismatch`);
      }
    }
    if (
      workspaceHead
      && authority?.workspaceExpectedHeadSha
      && verifiedPullRequest.head_sha !== authority.workspaceExpectedHeadSha
    ) {
      throw new Error(`role_result ${roleResult.kind} workspace head authority mismatch`);
    }
  };
  if (roleResult.kind === 'planner') {
    if (!authority?.sprintDir) {
      throw new Error('role_result planner sprint authority is required');
    }
    if (roleResult.claimed.sprint_dir !== authority.sprintDir) {
      throw new Error('role_result planner sprint authority mismatch');
    }
  }
  if (roleResult.kind === 'proposer') {
    if (!authority?.proposerBranch || !authority?.sprintDir) {
      throw new Error('role_result proposer branch/sprint authority is required');
    }
    if (roleResult.verified.propose_branch !== authority.proposerBranch) {
      throw new Error('role_result proposer branch authority mismatch');
    }
    if (!roleResult.claimed.task_plan_path.startsWith(`${authority.sprintDir}/`)) {
      throw new Error('role_result proposer sprint authority mismatch');
    }
    if (
      authority.workspaceExpectedHeadSha
      && roleResult.verified.head_sha !== authority.workspaceExpectedHeadSha
    ) {
      throw new Error('role_result proposer workspace head authority mismatch');
    }
  }
  if (roleResult.kind === 'reviewer') {
    if (!authority?.contractSha) {
      throw new Error('role_result reviewer contract authority is required');
    }
    if (roleResult.verified.contract_sha !== authority.contractSha) {
      throw new Error('role_result reviewer contract_sha authority mismatch');
    }
    if (
      authority.workspaceExpectedHeadSha
      && roleResult.verified.contract_sha !== authority.workspaceExpectedHeadSha
    ) {
      throw new Error('role_result reviewer workspace head authority mismatch');
    }
  }
  if (roleResult.kind === 'evaluator') {
    if (!authority?.taskId) {
      throw new Error('role_result evaluator task authority is required');
    }
    if (authority.taskId !== roleResult.claimed.task_id) {
      throw new Error('role_result evaluator task_id authority mismatch');
    }
    if (roleResult.claimed.attempt_id !== parsed.attempt_id) {
      throw new Error('role_result evaluator attempt_id parity mismatch');
    }
    if (!authority?.contractSha) {
      throw new Error('role_result evaluator contract authority is required');
    }
    if (roleResult.verified.contract_sha !== authority.contractSha) {
      throw new Error('role_result evaluator contract_sha authority mismatch');
    }
    assertPullRequestAuthority(roleResult.verified.pull_request, {
      required: true,
      workspaceHead: true,
    });
  }
  if (roleResult.kind === 'generator') {
    assertPullRequestAuthority(roleResult.verified.pull_request, {
      required: authority?.attemptKind === 'fix',
      workspaceHead: authority?.attemptKind === 'fix',
    });
  }
  if (roleResult.kind === 'reporter') {
    if (!authority?.taskId) {
      throw new Error('role_result reporter task authority is required');
    }
    if (authority.taskId !== roleResult.claimed.task_id) {
      throw new Error('role_result reporter task_id authority mismatch');
    }
    if (!authority?.sprintDir) {
      throw new Error('role_result reporter sprint authority is required');
    }
    if (!roleResult.claimed.report_path.startsWith(`${authority.sprintDir}/`)) {
      throw new Error('role_result reporter sprint authority mismatch');
    }
    assertPullRequestAuthority(roleResult.verified.pull_request, { required: true });
  }

  const expected = expectedRoleEnvelope(roleResult);
  const concernUpgradeAllowed = expected.status === 'completed';
  if (
    parsed.status !== expected.status
    && !(concernUpgradeAllowed && parsed.status === 'completed_with_concerns')
  ) {
    throw new Error(
      `role_result lifecycle parity mismatch: outer=${parsed.status} expected=${expected.status}`,
    );
  }
  if (parsed.error !== null) {
    throw new Error('role_result outer error parity mismatch');
  }
  for (const key of ['artifacts', 'checks', 'decision']) {
    if (!sameJson(parsed[key], expected[key])) {
      throw new Error(`role_result outer ${key} parity mismatch`);
    }
  }
}

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
    assertOuterRoleResultParity(parsed, expectedIdentity);
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
