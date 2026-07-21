import { randomUUID as nodeRandomUUID } from 'node:crypto';
import os from 'node:os';

import { parseTaskBundle } from './execution-contract.js';

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
  'spawn:generator': {
    role: 'generator', skill: 'harness-generator', readOnly: false,
    expectedOutput: 'harness-result/generator-v1',
  },
  'spawn:generator-fix': {
    role: 'generator', skill: 'harness-generator', readOnly: false,
    expectedOutput: 'harness-result/generator-v1',
  },
  'spawn:evaluator': {
    role: 'evaluator', skill: 'harness-evaluator', readOnly: true,
    expectedOutput: 'harness-result/evaluator-v1',
  },
  'spawn:judge': {
    role: 'judge', skill: null, readOnly: true,
    expectedOutput: 'harness-result/judge-v1',
  },
});

const OBJECTIVES = Object.freeze({
  planner: 'Produce the sprint PRD and executable acceptance plan from the supplied task evidence.',
  proposer: 'Propose or revise the implementation contract from the frozen PRD and current contract artifacts.',
  reviewer: 'Independently review the frozen contract against the PRD and return an approval decision.',
  generator: 'Implement or fix the approved contract in the supplied worktree and produce a pull request artifact.',
  evaluator: 'Independently evaluate the current pull request against the approved contract and return evidence.',
  judge: 'Independently judge the evaluator evidence and return the final verification decision.',
});

export function resolveAction(action) {
  const spec = ACTION_SPECS[action];
  if (!spec) throw new Error(`unsupported action: ${action}`);
  return Object.freeze({ ...spec });
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function buildInputs(spec, ctx) {
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
  };

  if (spec.role !== 'planner') {
    common.prd = { path: `${common.sprint_dir}/sprint-prd.md` };
  }
  if (spec.role === 'proposer' || spec.role === 'reviewer') {
    common.contract_branch = observed.contract?.row?.propose_branch ?? null;
    common.contract_round = observed.proposeBranchRn ?? 0;
  }
  if (['generator', 'evaluator', 'judge'].includes(spec.role)) {
    common.contract = observed.contract?.row ?? null;
  }
  if (spec.role === 'evaluator' || spec.role === 'judge') {
    common.pull_request = observed.pr ?? null;
  }
  if (spec.role === 'judge') {
    common.evaluator_result = observed.evaluateVerdict ?? observed.callbackResult ?? null;
  }
  return common;
}

function buildBundle(action, spec, ctx, attemptId, skill) {
  const inputs = buildInputs(spec, ctx);
  return parseTaskBundle({
    contract_version: '1.0',
    run_id: ctx.runId,
    attempt_id: attemptId,
    hop: ctx.hop,
    phase: ctx.decision?.phase ?? ctx.observed.run?.phase ?? 'unknown',
    role: spec.role,
    objective: action === 'spawn:generator-fix'
      ? `${OBJECTIVES.generator} This is a repair attempt; preserve the current pull request.`
      : OBJECTIVES[spec.role],
    skill,
    inputs,
    constraints: {
      read_only: spec.readOnly,
      fresh_session: true,
      timeout_seconds: Number(asObject(ctx.observed.task.payload).timeout_seconds ?? 5400),
    },
    expected_output: spec.expectedOutput,
  });
}

function executionConfig(payload) {
  const execution = {};
  if (payload.model && payload.model !== 'auto') execution.model = payload.model;
  if (payload.codex_home) execution.codexHome = payload.codex_home;
  if (payload.claude_home) execution.claudeHome = payload.claude_home;
  return execution;
}

export function createDispatcher(deps) {
  const randomUUID = deps.randomUUID ?? nodeRandomUUID;
  const machineId = deps.machineId ?? os.hostname();
  const handlers = deps.handlers ?? {};

  return async function dispatch(action, ctx) {
    if (handlers[action] && !ACTION_SPECS[action]) {
      return handlers[action](ctx);
    }

    const spec = resolveAction(action);
    const attemptId = randomUUID();
    const skill = spec.skill ? deps.loadSkill(spec.skill) : null;
    const bundle = buildBundle(action, spec, ctx, attemptId, skill);
    const payload = asObject(ctx.observed.task.payload);
    const requestedProvider = payload.executor ?? payload.provider ?? 'auto';

    const persisted = await deps.attemptStore.createAttempt({
      id: attemptId,
      runId: ctx.runId,
      hop: ctx.hop,
      phase: bundle.phase,
      role: spec.role,
      provider: spec.role === 'judge' ? 'independent-judge' : requestedProvider,
      accountId: payload.executor_account ?? null,
      machineId,
      bundle,
    });
    const attempt = {
      ...persisted,
      id: persisted?.id ?? attemptId,
      run_id: persisted?.run_id ?? ctx.runId,
      hop: persisted?.hop ?? ctx.hop,
      role: persisted?.role ?? spec.role,
      task_bundle: persisted?.task_bundle ?? bundle,
    };

    try {
      if (spec.role === 'judge') {
        const judge = handlers[action];
        if (!judge) throw new Error('spawn:judge requires an independent judge handler');
        return await judge({ ...ctx, attempt, bundle });
      }

      const adapter = deps.registry.resolve({
        provider: requestedProvider,
        requires: ['structured_output'],
      });
      const adapterSpec = adapter.start({ bundle, execution: executionConfig(payload) });
      const launched = await deps.launcher.launch({
        attempt,
        bundle,
        spec: adapterSpec,
        adapter,
        task: ctx.observed.task,
      });
      return {
        status: 'DONE',
        detail: `attempt ${attempt.id} launched as ${launched.containerId ?? launched.jobId ?? 'worker job'}`,
        attemptId: attempt.id,
        provider: adapter.name,
      };
    } catch (error) {
      await deps.attemptStore.fail(attempt.id, {
        code: spec.role === 'judge' ? 'judge_failed' : 'launch_failed',
        message: error.message,
      });
      throw error;
    }
  };
}

export function createDetachedLauncher({
  spawnDetached,
  attemptStore,
  brainUrl = 'http://host.docker.internal:5221',
  leaseOwner = `${os.hostname()}:${process.pid}`,
  leaseSeconds = 300,
}) {
  return Object.freeze({
    async launch({ attempt, bundle, spec, task }) {
      const starting = await attemptStore.markStarting(attempt.id, { leaseOwner, leaseSeconds });
      if (!starting) throw new Error(`attempt_lease_conflict: ${attempt.id}`);
      const labels = {
        'cecelia.run_id': attempt.run_id,
        'cecelia.hop': String(attempt.hop),
        'cecelia.role': attempt.role,
        'cecelia.attempt_id': attempt.id,
      };
      const providerEnv = { ...spec.env };
      let extraMounts;
      if (spec.provider === 'codex' && providerEnv.CODEX_HOME) {
        extraMounts = [`${providerEnv.CODEX_HOME}:/home/cecelia/.codex:rw`];
        providerEnv.CODEX_HOME = '/home/cecelia/.codex';
      }
      return spawnDetached({
        containerId: `cecelia-harness-${String(attempt.id).slice(0, 8)}`,
        task: { ...task, task_type: `harness_${attempt.role}` },
        prompt: spec.stdin,
        worktreePath: bundle.inputs.worktree_path,
        labels,
        extraMounts,
        env: {
          ...providerEnv,
          CECELIA_EXECUTOR: spec.provider,
          CECELIA_TASK_ID: bundle.inputs.task_id,
          HARNESS_NODE: attempt.role,
          HARNESS_ATTEMPT_ID: attempt.id,
          HARNESS_RUN_ID: attempt.run_id,
          HARNESS_HOP: String(attempt.hop),
          HARNESS_CALLBACK_URL: `${brainUrl}/api/brain/harness/attempts/${attempt.id}/callback`,
          BRAIN_URL: brainUrl,
        },
      });
    },
  });
}

export const __test__ = { ACTION_SPECS, buildInputs, buildBundle, executionConfig };
