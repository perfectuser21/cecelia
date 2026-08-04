import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseTaskBundle } from './execution-contract.js';
import { generateCallbackSecret, hashCallbackSecret } from './callback-auth.js';
import {
  errorMessage,
  failurePersistenceError,
  sanitizeDiagnostic,
} from './failure-persistence.js';
import { deriveCapabilityRequirements } from './preflight/requirements.js';
import { HARNESS_BUNDLE_MAX_BYTES } from './constants.js';

const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_EVALUATOR_FEEDBACK_CHECKS = 20;
const RUNTIME_RESULT_ROLES = new Set(['reviewer', 'evaluator', 'judge', 'reporter']);

const ACTION_SPECS = Object.freeze({
  'spawn:planner': {
    role: 'planner', skill: 'harness-planner', readOnly: false,
    expectedOutput: 'harness-result/planner-v1',
  },
  'spawn:proposer': {
    role: 'proposer', skill: 'harness-contract-proposer', readOnly: false,
    expectedOutput: 'harness-result/proposer-v1',
  },
  'spawn:reviewer': {
    role: 'reviewer', skill: 'harness-contract-reviewer', readOnly: true,
    expectedOutput: 'harness-result/reviewer-v1',
  },
  'spawn:canary': {
    role: 'reporter', skill: null, readOnly: true,
    canary: true,
    objective: 'Perform no filesystem or network work. Return status completed with empty artifacts and checks, decision outcome CANARY_OK, and null error.',
    expectedOutput: 'harness-result/canary-v1',
  },
  'spawn:generator': {
    role: 'generator', skill: 'harness-generator', readOnly: false,
    expectedOutput: 'harness-result/generator-v1',
  },
  'spawn:generator-fix': {
    role: 'generator', skill: 'harness-generator', readOnly: false,
    expectedOutput: 'harness-result/generator-v1',
  },
  'spawn:evaluator': {
    // Evaluator must checkout the PR branch, start services, run package managers,
    // and persist E2E evidence. OS/provider read-only modes make that path inert.
    role: 'evaluator', skill: 'harness-evaluator', readOnly: false,
    expectedOutput: 'harness-result/evaluator-v1',
  },
  // Sprint 07231527 Blocking 3：evidence-repair 动作（INV-K6：修 attempt evidence，不走 generator-fix）
  'spawn:evaluator-evidence-repair': {
    role: 'evaluator', skill: 'harness-evaluator', readOnly: false,
    expectedOutput: 'harness-result/evaluator-v1',
  },
  'spawn:judge': {
    role: 'judge', skill: null, readOnly: true,
    expectedOutput: 'harness-result/judge-v1',
  },
  'spawn:commander': {
    role: 'commander', skill: null, readOnly: true,
    expectedOutput: 'commander-directive/v1',
  },
});

const OBJECTIVES = Object.freeze({
  planner: 'Produce the sprint PRD and executable acceptance plan from the supplied task evidence.',
  proposer: 'Propose or revise the implementation contract from the frozen PRD and current contract artifacts.',
  reviewer: 'Independently review the frozen contract against the PRD and return an approval decision.',
  generator: 'Implement or fix the approved contract in the supplied worktree and produce a pull request artifact.',
  evaluator: 'Independently evaluate the current pull request against the approved contract and return evidence.',
  judge: 'Independently judge the evaluator evidence and return the final verification decision.',
  commander: 'Observe one bounded Run snapshot and return exactly one provider-neutral Commander Directive.',
});

export function resolveAction(action) {
  const spec = ACTION_SPECS[action];
  if (!spec) throw new Error(`unsupported action: ${action}`);
  return Object.freeze({ ...spec });
}

export function localContainerIdForAttempt(attemptId, generation) {
  if (!attemptId || !Number.isInteger(generation) || generation < 0) return null;
  return `cecelia-harness-${String(attemptId).slice(0, 8)}-g${generation}`;
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function buildEvaluatorFeedback(observed) {
  const verdict = asObject(observed.evaluateVerdict);
  const result = asObject(observed.evaluateResult);
  const currentPrSha = observed.pr?.head_sha;
  const attemptId = verdict.attempt_id;
  const resultAttemptId = result.attempt_id;
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  const reason = typeof result.decision?.reason === 'string'
    ? result.decision.reason.trim()
    : '';

  if (
    verdict.verdict !== 'FAIL'
    || result.decision?.outcome !== 'FAIL'
    || !GIT_SHA_PATTERN.test(currentPrSha ?? '')
    || verdict.pr_head_sha !== currentPrSha
    || typeof attemptId !== 'string'
    || attemptId.length === 0
    || resultAttemptId !== attemptId
    || !['completed', 'completed_with_concerns'].includes(result.status)
    || summary.length === 0
    || reason.length === 0
  ) {
    return null;
  }

  const checks = Array.isArray(result.checks)
    ? result.checks
      .slice(0, MAX_EVALUATOR_FEEDBACK_CHECKS)
      .filter((check) => check && typeof check === 'object')
      .map((check) => ({
        command: sanitizeDiagnostic(check.command),
        exit_code: Number.isInteger(check.exit_code) ? check.exit_code : null,
        verification_level: sanitizeDiagnostic(check.verification_level),
        log_tail: sanitizeDiagnostic(check.log_tail),
      }))
    : [];

  return Object.freeze({
    attempt_id: attemptId,
    pr_head_sha: currentPrSha,
    verdict: 'FAIL',
    summary: sanitizeDiagnostic(summary),
    reason: sanitizeDiagnostic(reason),
    checks,
  });
}

export function resolveProviderAccountHome(provider, account) {
  if (!account) return null;
  const value = String(account);
  if (provider === 'codex') {
    const number = value.match(/^(?:codex-)?team([1-9]\d*)$/)?.[1]
      ?? value.match(/^([1-9]\d*)$/)?.[1];
    if (!number) throw new Error(`invalid codex account: ${value}`);
    return path.join(os.homedir(), `.codex-team${number}`);
  }
  if (provider === 'claude') {
    const number = value.match(/^(?:claude-)?account([1-9]\d*)$/)?.[1]
      ?? value.match(/^([1-9]\d*)$/)?.[1];
    if (!number) throw new Error(`invalid claude account: ${value}`);
    return path.join(os.homedir(), `.claude-account${number}`);
  }
  if (provider === 'grok' && ['grok', 'default'].includes(value)) {
    return path.join(os.homedir(), '.grok');
  }
  throw new Error(`invalid ${provider} account: ${value}`);
}

function buildInputs(action, spec, ctx, attemptMetadata) {
  const { observed } = ctx;
  const task = observed.task;
  const payload = asObject(task.payload);
  const common = {
    task_id: task.id ?? ctx.taskId,
    sprint_dir: payload.sprint_dir ?? task.sprint_dir,
    worktree_path: payload.worktree_path ?? ctx.worktreePath,
    artifacts: [],
    task: {
      title: task.title ?? '',
      description: task.description ?? '',
    },
    logical_cycle_id: attemptMetadata.logicalCycleId,
    attempt_kind: attemptMetadata.attemptKind,
    workstream_key: attemptMetadata.workstreamKey,
  };
  // GAN 收敛的 PRD 锚（issue ce42f68f）：r17 实证 payload 缺 thin_prd 时 Planner
  // 只能凭一句话 description 推断 PRD，"覆盖完 PRD 即收敛"失去锚点。有值才注入。
  if (typeof payload.thin_prd === 'string' && payload.thin_prd.trim()) {
    common.thin_prd = payload.thin_prd;
  }
  if (typeof payload.prep_prd_body === 'string' && payload.prep_prd_body.trim()) {
    common.prep_prd_body = payload.prep_prd_body;
  }
  if (
    ['generator', 'evaluator', 'judge'].includes(spec.role)
    && ctx.validationClock
  ) {
    common.pipeline_started_at = ctx.validationClock.pipeline_started_at;
    common.deadline_at = ctx.validationClock.deadline_at;
  }
  const latestContextAnswer = [...(observed.decisionLog ?? [])]
    .sort((a, b) => Number(b.hop) - Number(a.hop))
    .find((row) => row.action === 'verdict:context_answer');
  const contextDetail = asObject(latestContextAnswer?.detail);
  if (
    Number.isInteger(Number(contextDetail.callback_hop))
    && Number.isInteger(Number(contextDetail.context_request_hop))
    && typeof contextDetail.context_version === 'string'
    && typeof contextDetail.answer === 'string'
  ) {
    common.human_context = {
      callback_hop: Number(contextDetail.callback_hop),
      context_request_hop: Number(contextDetail.context_request_hop),
      context_version: contextDetail.context_version,
      answer: contextDetail.answer,
    };
  }

  if (spec.role === 'commander') {
    return {
      ...common,
      commander_bundle: ctx.commander.bundle,
    };
  }

  if (spec.role !== 'planner') {
    common.prd = { path: `${common.sprint_dir}/sprint-prd.md` };
  }
  if (spec.role === 'planner') {
    common.planner_branch = [
      'cp-harness-prd',
      String(common.task_id).slice(0, 8),
      `r${String(ctx.runId).slice(0, 8)}`,
      `a${ctx.hop}`,
    ].join('-');
  }
  if (spec.role === 'proposer') {
    const nextRound = Number(observed.proposeBranchRn ?? 0) + 1;
    const plannerArtifact = observed.plannerPrdArtifact;
    if (plannerArtifact?.verification_status === 'verified') {
      common.planner_branch = plannerArtifact.branch;
      common.planner_head_sha = plannerArtifact.head_sha;
    }
    common.contract_branch = observed.proposeBranch ?? observed.contract?.row?.propose_branch ?? null;
    common.contract_round = nextRound;
    common.propose_branch = [
      `cp-harness-propose-r${nextRound}`,
      String(common.task_id).slice(0, 8),
      `r${String(ctx.runId).slice(0, 8)}`,
      `a${ctx.hop}`,
    ].join('-');
    if (observed.ganLatestRoundReviewFeedback) {
      common.review_feedback = { ...observed.ganLatestRoundReviewFeedback };
    }
  }
  if (spec.role === 'reviewer') {
    common.contract_branch = observed.proposeBranch ?? observed.contract?.row?.propose_branch ?? null;
    common.contract_round = observed.proposeBranchRn ?? 0;
    common.contract_sha = observed.proposeBranchSha ?? null;
  }
  // 案卷式 GAN（issue ce42f68f，design doc §数据流2）：proposer/reviewer 读同一份
  // 全量历轮案卷（rubric 历史 + blocker 台账），由 ground-truth.js collectGroundTruth
  // 现查现给。旧的 review_feedback 字段（只带上一轮 2 句摘要）继续保留一版做兼容，
  // 不在这次改动里替换/删除。空案卷（首轮）不注入，避免给 Skill 塞无意义空数组。
  if (
    ['proposer', 'reviewer'].includes(spec.role)
    && Array.isArray(observed.caseFile)
    && observed.caseFile.length > 0
  ) {
    common.case_file = observed.caseFile;
  }
  // 案卷式 GAN 会话续接（design doc §数据流3，决策 ba33fc68）：Proposer/Reviewer
  // 各自跨轮持久对话，互相隔离——只透传本角色自己最近一个终态成功 attempt 的
  // provider_session_id（ground-truth.js 已按 role 精确过滤，这里按 spec.role
  // 索引不会跨角色串号）。同时带 resume_provider，让执行端（fleet-worker）
  // 自行判断"当前实际派发 provider 是否与录制会话时的 provider 一致"——不一致
  // 时不续接，读案卷（case_file 全量历轮反馈）降级，降级不算失败。
  if (['proposer', 'reviewer'].includes(spec.role)) {
    const resumeSession = observed.resumeSessions?.[spec.role];
    if (resumeSession?.provider_session_id) {
      common.resume_session_id = resumeSession.provider_session_id;
      common.resume_provider = resumeSession.provider;
    }
    // 运行时依赖预装（design doc §运行时依赖，r17 实证：fleet workspace clone
    // 后不装依赖，proposer 的 product-map:check 因缺 ajv 每轮红——ajv 本在
    // workspace package.json）。dispatcher 对 proposer/reviewer 默认开启
    // node_deps，让 workspace-manager checkout 后自动 npm ci。两个字段都显式
    // 写出（而不是只写 node_deps），是为了让 fleet 侧的 request/bundle 字节级
    // 一致性校验（attempt-runner.cjs taskExecutionContract）稳定匹配——那条
    // 校验按原样比较两侧 JSON，缺一个默认字段就会误判 mismatch。
    common.runtime_resources = { postgres: false, node_deps: true };
  }
  if (['generator', 'evaluator', 'judge'].includes(spec.role)) {
    common.contract = observed.contract?.row ?? null;
    common.contract_branch = observed.contract?.row?.branch
      ?? observed.contract?.row?.propose_branch
      ?? null;
  }
  if (action === 'spawn:generator-fix') {
    common.pr_branch = observed.pr?.head_ref ?? null;
    common.pr_head_sha = observed.pr?.head_sha ?? null;
    const evaluatorFeedback = buildEvaluatorFeedback(observed);
    if (evaluatorFeedback) common.evaluator_feedback = evaluatorFeedback;
  }
  if (spec.role === 'evaluator' || spec.role === 'judge') {
    common.pull_request = observed.pr ?? null;
  }
  if (spec.role === 'evaluator') {
    common.pr_branch = observed.pr?.head_ref ?? null;
    common.pr_head_sha = observed.pr?.head_sha ?? null;
    if (payload.github_evidence_request) {
      common.github_evidence_request = payload.github_evidence_request;
    }
  }
  if (spec.role === 'judge') {
    common.evaluator_result = observed.evaluateVerdict ?? observed.callbackResult ?? null;
  }
  return common;
}

function buildBundle(
  action,
  spec,
  ctx,
  attemptId,
  skill,
  attemptMetadata,
  { deferWorkspaceValidation = false } = {},
) {
  const inputs = buildInputs(action, spec, ctx, attemptMetadata);
  const bundle = {
    contract_version: '1.0',
    run_id: ctx.runId,
    attempt_id: attemptId,
    hop: ctx.hop,
    phase: ctx.decision?.phase ?? ctx.observed.run?.phase ?? 'unknown',
    role: spec.role,
    objective: action === 'spawn:generator-fix'
      ? `${OBJECTIVES.generator} This is a repair attempt; preserve the current pull request.`
      : spec.objective ?? OBJECTIVES[spec.role],
    skill,
    inputs,
    constraints: {
      read_only: spec.readOnly,
      fresh_session: true,
      timeout_seconds: Number(asObject(ctx.observed.task.payload).timeout_seconds ?? 5400),
    },
    expected_output: spec.expectedOutput,
  };
  return deferWorkspaceValidation ? bundle : parseTaskBundle(bundle);
}

function bundleByteLength(bundle) {
  return Buffer.byteLength(JSON.stringify(bundle));
}

/**
 * TaskBundle 膨胀闸2（P2-3，review CHANGES REQUESTED）：闸1（case-file-store.js
 * loadCaseFile 的 fullTextRounds SQL 投影）已经把大部分 feedback_md 全文收窄
 * 到最近几轮，但 round 数很多、单条 feedback_md 很长时仍可能把整条 TaskBundle
 * 撑到 provider payload 上限附近。派发前做字节数体检，超限就按 round 从旧到
 * 新继续丢 case_file 里的 feedback_md；全部丢完还超只告警不阻断派发——把
 * "静默撑爆派发/被 provider 拒收"变成可观测的日志，而不是让一次案卷膨胀直接
 * 搞挂整条派发链。
 */
function enforceBundleSizeLimit(bundle) {
  if (bundleByteLength(bundle) <= HARNESS_BUNDLE_MAX_BYTES) return bundle;

  let trimmedBundle = bundle;
  const caseFile = bundle.inputs?.case_file;
  if (Array.isArray(caseFile) && caseFile.length > 0) {
    const oldestFirst = [...caseFile.keys()].sort(
      (a, b) => (caseFile[a].round ?? 0) - (caseFile[b].round ?? 0),
    );
    let trimmedCaseFile = caseFile;
    for (const index of oldestFirst) {
      if (bundleByteLength(trimmedBundle) <= HARNESS_BUNDLE_MAX_BYTES) break;
      if (trimmedCaseFile[index].feedback_md == null) continue;
      trimmedCaseFile = trimmedCaseFile.map((row, i) => (
        i === index ? { ...row, feedback_md: null } : row
      ));
      trimmedBundle = {
        ...trimmedBundle,
        inputs: { ...trimmedBundle.inputs, case_file: trimmedCaseFile },
      };
    }
  }

  const finalBytes = bundleByteLength(trimmedBundle);
  if (finalBytes > HARNESS_BUNDLE_MAX_BYTES) {
    console.warn(
      `[dispatcher] TaskBundle exceeds ${HARNESS_BUNDLE_MAX_BYTES} bytes after trimming `
      + `case_file feedback_md (run_id=${trimmedBundle.run_id} attempt_id=${trimmedBundle.attempt_id} `
      + `bytes=${finalBytes})`,
    );
  }
  return trimmedBundle;
}

function executionConfig(payload, { provider, accountHome, canary = false } = {}) {
  const execution = {};
  if (canary) execution.canary = true;
  if (payload.model && payload.model !== 'auto') execution.model = payload.model;
  if (payload.codex_home) execution.codexHome = payload.codex_home;
  if (payload.claude_home) execution.claudeHome = payload.claude_home;
  if (payload.grok_home) execution.grokHome = payload.grok_home;
  if (accountHome && provider === 'codex') execution.codexHome = accountHome;
  if (accountHome && provider === 'claude') execution.claudeHome = accountHome;
  if (accountHome && provider === 'grok') execution.grokHome = accountHome;
  return execution;
}

function freezeLaunchReceipt(receipt, target, executionSurface = null) {
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('launch_receipt_invalid');
  }
  if (executionSurface === 'fleet-worker') {
    if (receipt.actualMachineId !== target?.machine) {
      throw new Error('launch_receipt_invalid:fleet_actual_machine');
    }
    if (receipt.executionTransport !== 'fleet-worker') {
      throw new Error('launch_receipt_invalid:fleet_transport');
    }
    if (receipt.attestationStatus !== 'verified') {
      throw new Error('launch_receipt_invalid:fleet_attestation');
    }
    if (typeof receipt.remoteJobId !== 'string' || receipt.remoteJobId.length === 0) {
      throw new Error('launch_receipt_invalid:fleet_job_id');
    }
    if (receipt.jobId !== receipt.remoteJobId) {
      throw new Error('launch_receipt_invalid:fleet_job_mismatch');
    }
    if (receipt.containerId != null) {
      throw new Error('launch_receipt_invalid:fleet_container_id');
    }
    return Object.freeze({
      actualMachineId: receipt.actualMachineId,
      executionTransport: receipt.executionTransport,
      remoteJobId: receipt.remoteJobId,
      attestationStatus: receipt.attestationStatus,
      containerId: null,
      jobId: receipt.jobId,
    });
  }
  const remote = target?.machine === 'xian-mac-m4' || target?.machine === 'xian-mac-m1';
  if (remote) {
    if (receipt.actualMachineId !== target.machine) {
      throw new Error('launch_receipt_invalid:remote_actual_machine');
    }
    if (receipt.executionTransport !== 'remote-bridge') {
      throw new Error('launch_receipt_invalid:remote_transport');
    }
    if (receipt.attestationStatus !== 'verified') {
      throw new Error('launch_receipt_invalid:remote_attestation');
    }
    if (typeof receipt.remoteJobId !== 'string' || receipt.remoteJobId.length === 0) {
      throw new Error('launch_receipt_invalid:remote_job_id');
    }
    if (receipt.jobId !== receipt.remoteJobId) {
      throw new Error('launch_receipt_invalid:remote_job_mismatch');
    }
    if (receipt.containerId != null) {
      throw new Error('launch_receipt_invalid:remote_container_id');
    }
    return Object.freeze({
      actualMachineId: receipt.actualMachineId,
      executionTransport: receipt.executionTransport,
      remoteJobId: receipt.remoteJobId,
      attestationStatus: receipt.attestationStatus,
      containerId: null,
      jobId: receipt.jobId,
    });
  }

  if (receipt.actualMachineId !== target?.machine) {
    throw new Error('launch_receipt_invalid:local_actual_machine');
  }
  if (receipt.executionTransport !== 'local-docker') {
    throw new Error('launch_receipt_invalid:local_transport');
  }
  if (receipt.attestationStatus !== 'local') {
    throw new Error('launch_receipt_invalid:local_attestation');
  }
  if (typeof receipt.containerId !== 'string' || receipt.containerId.length === 0) {
    throw new Error('launch_receipt_invalid:local_container_id');
  }
  if (receipt.remoteJobId != null || receipt.jobId != null) {
    throw new Error('launch_receipt_invalid:local_remote_job');
  }
  return Object.freeze({
    actualMachineId: receipt.actualMachineId,
    executionTransport: receipt.executionTransport,
    remoteJobId: null,
    attestationStatus: receipt.attestationStatus,
    containerId: receipt.containerId,
    jobId: null,
  });
}

function unsafeCancelDiagnostic(result) {
  if (['cancelled', 'cleaned', 'already_clean'].includes(result?.status)) return null;
  const status = result?.status ?? 'unknown';
  const httpStatus = result?.httpStatus == null ? '' : ` (HTTP ${result.httpStatus})`;
  return `orphan cancellation unsafe: ${status}${httpStatus}`;
}

async function cancelAfterLaunch(launcher, { attempt, target, launchReceipt }) {
  try {
    const result = await launcher.cancel({ attempt, target, launchReceipt });
    return unsafeCancelDiagnostic(result);
  } catch (error) {
    return `orphan cancellation failed: ${errorMessage(error)}`;
  }
}

export function createDispatcher(deps) {
  const randomUUID = deps.randomUUID ?? nodeRandomUUID;
  const machineId = deps.machineId ?? process.env.CECELIA_MACHINE_ID ?? os.hostname();
  const leaseOwner = deps.leaseOwner ?? `${os.hostname()}:${process.pid}`;
  const leaseSeconds = deps.leaseSeconds ?? 300;
  const handlers = deps.handlers ?? {};
  const createCallbackSecret = deps.createCallbackSecret ?? generateCallbackSecret;
  const resolveAccountHome = deps.resolveAccountHome ?? resolveProviderAccountHome;

  return async function dispatch(action, ctx) {
    if (handlers[action] && !ACTION_SPECS[action]) {
      return handlers[action](ctx);
    }

    const spec = resolveAction(action);
    const commanderContext = spec.role === 'commander' ? ctx.commander : null;
    if (spec.role === 'commander' && !commanderContext?.bundle) {
      throw new Error('spawn:commander requires coordinator context');
    }
    const attemptId = spec.role === 'commander'
      ? commanderContext.bundle.commander_attempt_id
      : randomUUID();
    const callbackSecret = createCallbackSecret();
    const skill = spec.skill ? deps.loadSkill(spec.skill) : null;
    const payload = asObject(ctx.observed.task.payload);
    const attemptMetadata = {
      logicalCycleId: commanderContext?.logical_cycle_id
        ?? ctx.retry?.logical_cycle_id
        ?? `intent:${ctx.runId}:${ctx.hop}`,
      attemptKind: commanderContext?.retry_of_attempt_id
        || ctx.retry?.retry_of_attempt_id
        ? 'retry'
        : (action === 'spawn:generator-fix' ? 'fix' : 'initial'),
      workstreamKey: payload.workstream_index ?? payload.workstream_key ?? 'ws1',
    };
    let bundle = buildBundle(
      action,
      spec,
      ctx,
      attemptId,
      skill,
      attemptMetadata,
      { deferWorkspaceValidation: typeof deps.resolveWorkspaceSpec === 'function' },
    );
    if (typeof deps.resolveWorkspaceSpec === 'function') {
      const workspaceSpec = await deps.resolveWorkspaceSpec({
        action,
        role: spec.role,
        readOnly: spec.readOnly,
        attemptId,
        ctx,
        bundle,
      });
      const {
        worktree_path: _discardedCallerPath,
        ...pathFreeInputs
      } = bundle.inputs;
      bundle = parseTaskBundle({
        ...bundle,
        inputs: {
          ...pathFreeInputs,
          execution_surface: 'fleet-worker',
          workspace_spec: workspaceSpec,
        },
      });
    }
    const roleAssignment = spec.role === 'commander'
      ? {}
      : asObject(asObject(payload.role_assignments)[spec.role]);
    const {
      role: _commanderRole,
      ...commanderTarget
    } = commanderContext?.target ?? {};
    const requestedProvider = spec.role === 'commander'
      ? commanderTarget.provider
      : roleAssignment.provider ?? payload.executor ?? payload.provider ?? 'auto';
    const requestedAccount = spec.role === 'commander'
      ? commanderTarget.account
      : roleAssignment.account ?? payload.executor_account ?? null;
    const requestedModel = spec.role === 'commander'
      ? commanderTarget.model ?? null
      : roleAssignment.model
        ?? (payload.model && payload.model !== 'auto' ? payload.model : null);
    let adapter = spec.role === 'judge' ? null : deps.registry.resolve({
      provider: requestedProvider,
      requires: ['structured_output'],
    });
    const preferredTarget = spec.role === 'judge'
      ? null
      : spec.role === 'commander'
        ? {
            provider: commanderTarget.provider ?? adapter.name,
            account: commanderTarget.account ?? null,
            ...(commanderTarget.model ? { model: commanderTarget.model } : {}),
            machine: commanderTarget.machine ?? machineId,
          }
      : {
          provider: roleAssignment.provider ?? adapter.name,
          account: roleAssignment.account ?? requestedAccount,
          ...(requestedModel ? { model: requestedModel } : {}),
          machine: roleAssignment.machine ?? machineId,
        };
    const candidateTargets = spec.role === 'judge'
      ? []
      : spec.role === 'commander'
        ? (commanderContext.candidate_targets ?? [commanderContext.target]).map(
            ({ role: _role, ...target }) => target,
          )
      : roleAssignment.strict_affinity === true
        ? [preferredTarget]
        : [preferredTarget, ...(roleAssignment.fallback_targets ?? [])];
    let selectedAccount = requestedAccount;
    let selectedMachine = preferredTarget?.machine ?? machineId;
    let selectedTarget = preferredTarget;
    let accountHome = null;
    const rawCapabilityRequirements = commanderContext?.capability_requirements
      ?? payload.contract_requirements
      ?? payload.capability_requirements
      ?? null;
    const capabilityRequirements = deriveCapabilityRequirements({
      role: spec.role,
      requirements: rawCapabilityRequirements,
    });

    if (
      (rawCapabilityRequirements || spec.role === 'commander')
      && !deps.preflightGate
      && spec.role !== 'judge'
    ) {
      const blocked = {
        status: 'DONE_WITH_CONCERNS',
        control_status: 'BLOCKED',
        detail: 'dispatch preflight blocked: capability_gate_unavailable',
        action: 'wait:human_review',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'capability_gate_unavailable',
        should_create_attempt: false,
        should_enter_generator_fix: false,
      };
      await deps.onPreflightBlocked?.(blocked, { action, ctx });
      return blocked;
    }

    if (deps.preflightGate && spec.role !== 'judge') {
      const taskBundle = {
        ...bundle,
        task_id: ctx.observed.task.id ?? ctx.taskId,
        logical_cycle: attemptMetadata.logicalCycleId,
      };
      const failedTargets = await deps.attemptStore.listFailedExecutionTargets?.(
        ctx.runId,
        spec.role,
      ) ?? [];
      const preflight = await deps.preflightGate.evaluate({
        preferred_target: preferredTarget,
        candidate_targets: candidateTargets,
        failed_targets: failedTargets,
        requirements: capabilityRequirements ?? {},
        task_bundle: taskBundle,
      });
      if (preflight.status !== 'ok') {
        const blocked = {
          ...preflight,
          status: 'DONE_WITH_CONCERNS',
          control_status: 'BLOCKED',
          detail: `dispatch preflight blocked: ${preflight.fallback_reason}`,
          should_create_attempt: false,
          should_enter_generator_fix: false,
        };
        await deps.onPreflightBlocked?.(blocked, { action, ctx });
        return blocked;
      }

      const freshness = await deps.preflightGate.validateSnapshotForDispatch(
        preflight.snapshot,
        taskBundle,
      );
      if (freshness.status !== 'ok') {
        const blocked = {
          ...freshness,
          status: 'DONE_WITH_CONCERNS',
          control_status: 'BLOCKED',
          detail: `dispatch preflight blocked: ${freshness.fallback_reason}`,
          should_create_attempt: false,
          should_enter_generator_fix: false,
        };
        await deps.onPreflightBlocked?.(blocked, { action, ctx });
        return blocked;
      }
      const preflightTarget = preflight.to_target ?? {
        provider: preflight.snapshot.provider,
        account: preflight.snapshot.account,
        machine: preflight.snapshot.machine,
      };
      selectedTarget = {
        provider: preflightTarget.provider,
        account: preflightTarget.account,
        ...((preflightTarget.model ?? preferredTarget.model)
          ? { model: preflightTarget.model ?? preferredTarget.model }
          : {}),
        machine: preflightTarget.machine,
      };
      adapter = deps.registry.resolve({
        provider: selectedTarget.provider,
        requires: ['structured_output'],
      });
      selectedAccount = selectedTarget.account;
      selectedMachine = selectedTarget.machine;
      bundle = {
        ...bundle,
        inputs: {
          ...bundle.inputs,
          ...(capabilityRequirements.postgres
            ? {
                // node_deps 可能已经被 buildInputs 对 proposer/reviewer 默认置
                // true（见上）——这里只加 postgres:true，不能整体替换掉
                // runtime_resources，否则会把刚设好的 node_deps 冲掉。
                runtime_resources: {
                  ...bundle.inputs.runtime_resources,
                  postgres: true,
                },
              }
            : {}),
          capability_snapshot_id: preflight.snapshot.capability_snapshot_id,
          capability_evidence: preflight.evidence,
        },
      };
    }
    if (spec.role !== 'judge' && selectedAccount) {
      accountHome = resolveAccountHome(adapter.name, selectedAccount);
    }

    bundle = enforceBundleSizeLimit(bundle);

    const persisted = await deps.attemptStore.createAttempt({
      id: attemptId,
      runId: ctx.runId,
      run_id: ctx.runId,
      hop: ctx.hop,
      phase: bundle.phase,
      role: spec.role,
      provider: spec.role === 'judge' ? 'independent-judge' : adapter.name,
      accountId: selectedAccount,
      machineId: selectedMachine,
      bundle,
      callbackSecretHash: hashCallbackSecret(callbackSecret),
      logicalCycleId: attemptMetadata.logicalCycleId,
      attemptKind: attemptMetadata.attemptKind,
      retryOfAttemptId: commanderContext?.retry_of_attempt_id
        ?? ctx.retry?.retry_of_attempt_id
        ?? null,
      restartReason: commanderContext?.restart_reason
        ?? ctx.retry?.restart_reason
        ?? (action === 'spawn:generator-fix' ? 'evaluator_failed' : null),
      workstreamKey: attemptMetadata.workstreamKey,
      timeDerived: ['judge', 'reporter'].includes(spec.role),
    });
    if (persisted?.id && persisted.id !== attemptId) {
      return {
        status: 'DONE_WITH_CONCERNS',
        detail: `run/hop already owns attempt ${persisted.id}; duplicate launch suppressed`,
        attemptId: persisted.id,
        provider: persisted.provider ?? (spec.role === 'judge' ? 'independent-judge' : adapter.name),
      };
    }
    let attempt = {
      ...persisted,
      id: persisted?.id ?? attemptId,
      run_id: persisted?.run_id ?? ctx.runId,
      hop: persisted?.hop ?? ctx.hop,
      role: persisted?.role ?? spec.role,
      task_bundle: persisted?.task_bundle ?? bundle,
      callbackSecret,
    };

    if (spec.role === 'judge') {
      try {
        const judge = handlers[action];
        if (!judge) throw new Error('spawn:judge requires an independent judge handler');
        return await judge({ ...ctx, attempt, bundle });
      } catch (error) {
        await deps.attemptStore.fail(attempt.id, {
          code: 'judge_failed',
          message: error.message,
        });
        throw error;
      }
    }

    const claimed = await deps.attemptStore.markStarting(attempt.id, {
      leaseOwner,
      leaseSeconds,
    });
    if (!claimed) {
      throw new Error(`attempt_lease_conflict: ${attempt.id}`);
    }
    attempt = {
      ...attempt,
      ...claimed,
      callbackSecret,
    };

    const fleetLaunch = bundle.inputs.execution_surface === 'fleet-worker';
    let rawReceipt;
    let launched;
    try {
      const adapterSpec = adapter.start({
        bundle,
        execution: executionConfig({
          ...payload,
          model: selectedTarget.model ?? payload.model,
        }, {
          provider: adapter.name,
          accountHome,
          canary: spec.canary === true,
        }),
      });
      const launchInput = {
        attempt,
        bundle,
        spec: adapterSpec,
        adapter,
        task: ctx.observed.task,
        target: selectedTarget,
        leaseClaimed: true,
      };
      rawReceipt = fleetLaunch
        ? await deps.launcher.prepare(launchInput)
        : await deps.launcher.launch(launchInput);
      launched = freezeLaunchReceipt(
        rawReceipt,
        selectedTarget,
        bundle.inputs.execution_surface,
      );
    } catch (error) {
      const cancelDiagnostic = await cancelAfterLaunch(deps.launcher, {
        attempt,
        target: selectedTarget,
        launchReceipt: rawReceipt,
      });
      const message = [
        errorMessage(error),
        cancelDiagnostic,
      ].filter(Boolean).join('; ');
      try {
        await deps.attemptStore.fail(attempt.id, {
          code: 'launch_failed',
          message,
          ...(spec.role === 'commander'
            ? { failureClass: 'infrastructure_blocked' }
            : {}),
        }, {
          leaseOwner: attempt.lease_owner,
          leaseGeneration: attempt.lease_generation,
        });
      } catch (failError) {
        throw await failurePersistenceError(deps, {
          attemptId: attempt.id,
          lifecycleCode: 'launch_failed',
          originalError: error,
          persistenceError: failError,
        });
      }
      throw error;
    }

    let receiptRow = null;
    let receiptError = null;
    try {
      receiptRow = await deps.attemptStore.recordLaunchReceipt(attempt.id, {
        leaseOwner: attempt.lease_owner,
        leaseGeneration: attempt.lease_generation,
        actualMachineId: launched.actualMachineId,
        executionTransport: launched.executionTransport,
        remoteJobId: launched.remoteJobId,
        attestationStatus: launched.attestationStatus,
      });
      if (!receiptRow) {
        receiptError = new Error('launch receipt was not persisted by the current lease owner');
      }
    } catch (error) {
      receiptError = error;
    }

    if (receiptError) {
      const cancelDiagnostic = await cancelAfterLaunch(deps.launcher, {
        attempt,
        target: selectedTarget,
        launchReceipt: launched,
      });
      const message = [
        `launch receipt persistence failed: ${errorMessage(receiptError)}`,
        cancelDiagnostic,
      ].filter(Boolean).join('; ');
      try {
        await deps.attemptStore.fail(attempt.id, {
          code: 'launch_receipt_persist_failed',
          message,
        }, {
          leaseOwner: attempt.lease_owner,
          leaseGeneration: attempt.lease_generation,
        });
      } catch (failError) {
        const lifecycleError = new Error(message);
        lifecycleError.cause = receiptError;
        throw await failurePersistenceError(deps, {
          attemptId: attempt.id,
          lifecycleCode: 'launch_receipt_persist_failed',
          originalError: lifecycleError,
          persistenceError: failError,
        });
      }
      const error = new Error(`launch_receipt_persist_failed: ${message}`);
      error.cause = receiptError;
      throw error;
    }

    if (fleetLaunch) {
      try {
        const started = await deps.launcher.start({
          attempt,
          target: selectedTarget,
        });
        if (
          !['running', 'terminal'].includes(started?.status)
          || started?.attempt_id !== attempt.id
        ) {
          throw new Error('launch_start_invalid_acknowledgement');
        }
      } catch (error) {
        const cancelDiagnostic = await cancelAfterLaunch(deps.launcher, {
          attempt,
          target: selectedTarget,
          launchReceipt: launched,
        });
        const message = [
          errorMessage(error),
          cancelDiagnostic,
        ].filter(Boolean).join('; ');
        try {
          await deps.attemptStore.fail(attempt.id, {
            code: 'launch_start_failed',
            message,
            failureClass: 'infrastructure_blocked',
          }, {
            leaseOwner: attempt.lease_owner,
            leaseGeneration: attempt.lease_generation,
          });
        } catch (failError) {
          throw await failurePersistenceError(deps, {
            attemptId: attempt.id,
            lifecycleCode: 'launch_start_failed',
            originalError: error,
            persistenceError: failError,
          });
        }
        throw error;
      }
    }

    return {
      status: 'LAUNCHED',
      detail: `attempt ${attempt.id} launched as ${launched.containerId ?? launched.jobId ?? 'worker job'}`,
      run_id: attempt.run_id,
      attempt_id: attempt.id,
      provider: adapter.name,
      lease_owner: attempt.lease_owner,
      lease_generation: attempt.lease_generation,
      local_container_naming: attempt.local_container_naming ?? null,
    };
  };
}

export function createDetachedLauncher({
  spawnDetached,
  removeContainer = async () => false,
  attemptStore,
  brainUrl = 'http://host.docker.internal:5221',
  leaseOwner = `${os.hostname()}:${process.pid}`,
  leaseSeconds = 300,
  sessionRoot = process.env.CECELIA_HARNESS_SESSION_DIR
    ?? path.join(os.tmpdir(), 'cecelia-harness-sessions'),
  ensureDir = mkdirSync,
  machineId = 'us-mac-m4',
}) {
  const requestedContainerId = (attempt, generation = attempt?.lease_generation) => (
    localContainerIdForAttempt(attempt?.id, generation)
  );
  const removeCandidates = async (containerIds) => {
    const results = [];
    for (const containerId of [...new Set(containerIds.filter(Boolean))]) {
      try {
        results.push(await removeContainer(containerId));
      } catch {
        results.push(false);
      }
    }
    return results;
  };

  return Object.freeze({
    async launch({ attempt, bundle, spec, task, leaseClaimed = false }) {
      let activeLeaseOwner = leaseOwner;
      let activeLeaseGeneration = attempt?.lease_generation ?? 0;
      if (!leaseClaimed) {
        const starting = await attemptStore.markStarting(attempt.id, { leaseOwner, leaseSeconds });
        if (!starting) throw new Error(`attempt_lease_conflict: ${attempt.id}`);
        activeLeaseOwner = starting.lease_owner ?? leaseOwner;
        activeLeaseGeneration = starting.lease_generation ?? 0;
      } else {
        if (!attempt?.lease_owner) {
          throw new Error(`attempt_lease_owner_missing: ${attempt?.id ?? 'unknown'}`);
        }
        if (!Number.isInteger(attempt?.lease_generation) || attempt.lease_generation < 0) {
          throw new Error(`attempt_lease_generation_missing: ${attempt?.id ?? 'unknown'}`);
        }
        activeLeaseOwner = attempt.lease_owner;
        activeLeaseGeneration = attempt.lease_generation;
      }
      try {
      const labels = {
        'cecelia.run_id': attempt.run_id,
        'cecelia.hop': String(attempt.hop),
        'cecelia.role': attempt.role,
        'cecelia.attempt_id': attempt.id,
      };
      const providerEnv = { ...spec.env };
      const roleEnv = {};
      if (RUNTIME_RESULT_ROLES.has(attempt.role)) {
        roleEnv.BRAIN_RESULT_FILE = '/tmp/cecelia-prompts/brain-result.json';
      }
      if (attempt.role === 'evaluator') {
        // Evaluator needs a writable worktree for package managers and real E2E tests,
        // but must never advance the PR it is judging. Git's environment config is
        // inherited by child processes, so accidental pushes fail before GitHub.
        roleEnv.GIT_CONFIG_COUNT = '1';
        roleEnv.GIT_CONFIG_KEY_0 = 'remote.origin.pushurl';
        roleEnv.GIT_CONFIG_VALUE_0 = 'blocked-by-harness://evaluator';
      }
      if (bundle.inputs.sprint_dir) roleEnv.SPRINT_DIR = String(bundle.inputs.sprint_dir);
      roleEnv.WORKSPACE_PATH = '/workspace';
      if (bundle.inputs.contract_round != null) {
        roleEnv.PROPOSE_ROUND = String(bundle.inputs.contract_round);
      }
      if (bundle.inputs.propose_branch) {
        roleEnv.PROPOSE_BRANCH = String(bundle.inputs.propose_branch);
      }
      if (bundle.inputs.contract_branch) {
        roleEnv.CONTRACT_BRANCH = String(bundle.inputs.contract_branch);
      }
      if (bundle.inputs.pipeline_started_at) {
        roleEnv.HARNESS_PIPELINE_STARTED_AT = String(bundle.inputs.pipeline_started_at);
      }
      if (bundle.inputs.deadline_at) {
        roleEnv.HARNESS_DEADLINE_AT = String(bundle.inputs.deadline_at);
      }
      if (attempt.role === 'evaluator' && bundle.inputs.pr_branch) {
        roleEnv.PR_BRANCH = String(bundle.inputs.pr_branch);
      }
      if (attempt.role === 'evaluator' && bundle.inputs.pr_head_sha) {
        roleEnv.PR_HEAD_SHA = String(bundle.inputs.pr_head_sha);
      }
      const extraMounts = [];
      if (spec.provider === 'codex' && providerEnv.CODEX_HOME) {
        extraMounts.push(`${providerEnv.CODEX_HOME}:/home/cecelia/.codex:rw`);
        providerEnv.CODEX_HOME = '/home/cecelia/.codex';
      }
      if (spec.provider === 'claude') {
        const attemptSessionRoot = path.join(sessionRoot, attempt.id);
        const projectsDir = path.join(attemptSessionRoot, 'projects');
        const sessionsDir = path.join(attemptSessionRoot, 'sessions');
        ensureDir(projectsDir, { recursive: true, mode: 0o700 });
        ensureDir(sessionsDir, { recursive: true, mode: 0o700 });
        extraMounts.push(
          `${projectsDir}:/home/cecelia/.claude/projects:rw`,
          `${sessionsDir}:/home/cecelia/.claude/sessions:rw`,
        );
      }
      if (spec.provider === 'grok' && providerEnv.GROK_HOME) {
        extraMounts.push(
          `${path.join(providerEnv.GROK_HOME, 'auth.json')}:/home/cecelia/.grok/auth.json:rw`,
          `${path.join(providerEnv.GROK_HOME, 'sessions')}:/home/cecelia/.grok/sessions:rw`,
        );
        providerEnv.GROK_HOME = '/home/cecelia/.grok';
      }
      const modelIndex = spec.args?.indexOf('--model') ?? -1;
      if (modelIndex >= 0 && spec.args[modelIndex + 1]) {
        providerEnv.HARNESS_MODEL = spec.args[modelIndex + 1];
      }
      const resumeFlagIndex = spec.args?.indexOf('--resume') ?? -1;
      const resumeCommandIndex = spec.args?.indexOf('resume') ?? -1;
      const resumeSessionId = resumeFlagIndex >= 0
        ? spec.args[resumeFlagIndex + 1]
        : (resumeCommandIndex >= 0 ? spec.args[resumeCommandIndex + 1] : null);
      if (resumeSessionId) providerEnv.HARNESS_RESUME_SESSION_ID = resumeSessionId;
      const containerId = requestedContainerId(attempt, activeLeaseGeneration);
      await removeContainer(containerId);
      const launched = await spawnDetached({
          containerId,
          task: { ...task, task_type: `harness_${attempt.role}` },
          prompt: spec.stdin,
          worktreePath: bundle.inputs.worktree_path,
          readOnlyWorktree: bundle.constraints.read_only,
          minimalHostMounts: spec.canary === true,
          labels,
          extraMounts,
          env: {
            ...providerEnv,
            ...roleEnv,
            CECELIA_EXECUTOR: spec.provider,
            CECELIA_TASK_ID: bundle.inputs.task_id,
            HARNESS_TASK_ID: bundle.inputs.task_id,
            HARNESS_NODE: attempt.role,
            HARNESS_ATTEMPT_ID: attempt.id,
            HARNESS_CALLBACK_TOKEN: attempt.callbackSecret,
            HARNESS_LEASE_OWNER: activeLeaseOwner,
            HARNESS_LEASE_GENERATION: String(activeLeaseGeneration),
            HARNESS_RUN_ID: attempt.run_id,
            HARNESS_HOP: String(attempt.hop),
            HARNESS_READ_ONLY: String(bundle.constraints.read_only),
            HARNESS_CANARY: String(spec.canary === true),
            HARNESS_CALLBACK_URL: `${brainUrl}/api/brain/harness/attempts/${attempt.id}/callback`,
            BRAIN_URL: brainUrl,
          },
        });
        if (typeof launched?.containerId !== 'string' || launched.containerId.length === 0) {
          await removeCandidates([containerId]);
          throw new Error(`local_launch_container_id_missing: ${containerId}`);
        }
        if (launched.containerId !== containerId) {
          await removeCandidates([containerId]);
          throw new Error(
            `local_launch_container_id_mismatch: expected ${containerId}, got ${launched.containerId}`,
          );
        }
        return Object.freeze({
          actualMachineId: machineId,
          executionTransport: 'local-docker',
          remoteJobId: null,
          attestationStatus: 'local',
          containerId: launched.containerId,
          jobId: null,
        });
      } catch (error) {
        if (!leaseClaimed) {
          await attemptStore.fail(attempt.id, {
            code: 'launch_failed',
            message: error.message,
          }, {
            leaseOwner: activeLeaseOwner,
            leaseGeneration: activeLeaseGeneration,
          });
        }
        throw error;
      }
    },
    async inspect() {
      return {
        status: 'unsupported',
        reason: 'local_inspection_unavailable',
      };
    },
    async cancel({ attempt, launchReceipt } = {}) {
      const containerId = requestedContainerId(attempt);
      if (!containerId) {
        return {
          status: 'unavailable',
          reason: 'local_attempt_identity_missing',
        };
      }
      if (launchReceipt?.containerId && launchReceipt.containerId !== containerId) {
        return {
          status: 'rejected',
          reason: 'local_container_id_mismatch',
          containerId,
        };
      }
      const removed = await removeCandidates([containerId]);
      return {
        status: removed.some(Boolean) ? 'cancelled' : 'missing',
        containerId,
      };
    },
  });
}

export const __test__ = {
  ACTION_SPECS, buildInputs, buildBundle, executionConfig, enforceBundleSizeLimit,
};
