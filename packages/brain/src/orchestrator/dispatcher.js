import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseTaskBundle } from './execution-contract.js';
import { generateCallbackSecret, hashCallbackSecret } from './callback-auth.js';
import { deriveCapabilityRequirements } from './preflight/requirements.js';

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
  if (spec.role === 'proposer') {
    const nextRound = Number(observed.proposeBranchRn ?? 0) + 1;
    common.contract_branch = observed.proposeBranch ?? observed.contract?.row?.propose_branch ?? null;
    common.contract_round = nextRound;
    common.propose_branch = `cp-harness-propose-r${nextRound}-${String(common.task_id).slice(0, 8)}-a${ctx.hop}`;
  }
  if (spec.role === 'reviewer') {
    common.contract_branch = observed.proposeBranch ?? observed.contract?.row?.propose_branch ?? null;
    common.contract_round = observed.proposeBranchRn ?? 0;
    common.contract_sha = observed.proposeBranchSha ?? null;
  }
  if (['generator', 'evaluator', 'judge'].includes(spec.role)) {
    common.contract = observed.contract?.row ?? null;
    common.contract_branch = observed.contract?.row?.branch
      ?? observed.contract?.row?.propose_branch
      ?? null;
  }
  if (spec.role === 'evaluator' || spec.role === 'judge') {
    common.pull_request = observed.pr ?? null;
  }
  if (spec.role === 'evaluator') {
    common.pr_branch = observed.pr?.head_ref ?? null;
    common.pr_head_sha = observed.pr?.head_sha ?? null;
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

function executionConfig(payload, { provider, accountHome } = {}) {
  const execution = {};
  if (payload.model && payload.model !== 'auto') execution.model = payload.model;
  if (payload.codex_home) execution.codexHome = payload.codex_home;
  if (payload.claude_home) execution.claudeHome = payload.claude_home;
  if (payload.grok_home) execution.grokHome = payload.grok_home;
  if (accountHome && provider === 'codex') execution.codexHome = accountHome;
  if (accountHome && provider === 'claude') execution.claudeHome = accountHome;
  if (accountHome && provider === 'grok') execution.grokHome = accountHome;
  return execution;
}

export function createDispatcher(deps) {
  const randomUUID = deps.randomUUID ?? nodeRandomUUID;
  const machineId = deps.machineId ?? process.env.CECELIA_MACHINE_ID ?? os.hostname();
  const handlers = deps.handlers ?? {};
  const createCallbackSecret = deps.createCallbackSecret ?? generateCallbackSecret;
  const resolveAccountHome = deps.resolveAccountHome ?? resolveProviderAccountHome;

  return async function dispatch(action, ctx) {
    if (handlers[action] && !ACTION_SPECS[action]) {
      return handlers[action](ctx);
    }

    const spec = resolveAction(action);
    const attemptId = randomUUID();
    const callbackSecret = createCallbackSecret();
    const skill = spec.skill ? deps.loadSkill(spec.skill) : null;
    let bundle = buildBundle(action, spec, ctx, attemptId, skill);
    const payload = asObject(ctx.observed.task.payload);
    const roleAssignment = asObject(asObject(payload.role_assignments)[spec.role]);
    const requestedProvider = roleAssignment.provider ?? payload.executor ?? payload.provider ?? 'auto';
    const requestedAccount = roleAssignment.account ?? payload.executor_account ?? null;
    let adapter = spec.role === 'judge' ? null : deps.registry.resolve({
      provider: requestedProvider,
      requires: ['structured_output'],
    });
    let selectedAccount = requestedAccount;
    let selectedMachine = machineId;
    let accountHome = null;
    const rawCapabilityRequirements = payload.contract_requirements
      ?? payload.capability_requirements
      ?? null;
    const capabilityRequirements = deriveCapabilityRequirements({
      role: spec.role,
      requirements: rawCapabilityRequirements,
    });

    if (rawCapabilityRequirements && !deps.preflightGate && spec.role !== 'judge') {
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
        logical_cycle: payload.logical_cycle ?? ctx.hop,
      };
      const preflight = await deps.preflightGate.evaluate({
        preferred_target: {
          provider: adapter.name,
          account: requestedAccount,
          machine: machineId,
        },
        requirements: capabilityRequirements ?? {},
        task_bundle: taskBundle,
      });
      if (preflight.status !== 'ok') {
        const blocked = {
          ...preflight,
          status: 'DONE_WITH_CONCERNS',
          control_status: 'BLOCKED',
          detail: `dispatch preflight blocked: ${preflight.fallback_reason}`,
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
        };
        await deps.onPreflightBlocked?.(blocked, { action, ctx });
        return blocked;
      }
      const selectedTarget = preflight.to_target ?? {
        provider: preflight.snapshot.provider,
        account: preflight.snapshot.account,
        machine: preflight.snapshot.machine,
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
          capability_snapshot_id: preflight.snapshot.capability_snapshot_id,
          capability_evidence: preflight.evidence,
        },
      };
    }
    if (spec.role !== 'judge' && selectedAccount) {
      accountHome = resolveAccountHome(adapter.name, selectedAccount);
    }

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
    });
    if (persisted?.id && persisted.id !== attemptId) {
      return {
        status: 'DONE_WITH_CONCERNS',
        detail: `run/hop already owns attempt ${persisted.id}; duplicate launch suppressed`,
        attemptId: persisted.id,
        provider: persisted.provider ?? (spec.role === 'judge' ? 'independent-judge' : adapter.name),
      };
    }
    const attempt = {
      ...persisted,
      id: persisted?.id ?? attemptId,
      run_id: persisted?.run_id ?? ctx.runId,
      hop: persisted?.hop ?? ctx.hop,
      role: persisted?.role ?? spec.role,
      task_bundle: persisted?.task_bundle ?? bundle,
      callbackSecret,
    };

    let handedToLauncher = false;
    try {
      if (spec.role === 'judge') {
        const judge = handlers[action];
        if (!judge) throw new Error('spawn:judge requires an independent judge handler');
        return await judge({ ...ctx, attempt, bundle });
      }

      const adapterSpec = adapter.start({
        bundle,
        execution: executionConfig(payload, { provider: adapter.name, accountHome }),
      });
      handedToLauncher = true;
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
      // Worker launcher owns the lease and performs its own fenced failure write.
      // Fail here only before ownership transfers (adapter construction) or for
      // the in-process judge, which never claims a worker lease.
      if (!handedToLauncher || spec.role === 'judge') {
        await deps.attemptStore.fail(attempt.id, {
          code: spec.role === 'judge' ? 'judge_failed' : 'launch_failed',
          message: error.message,
        });
      }
      throw error;
    }
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
}) {
  return Object.freeze({
    async launch({ attempt, bundle, spec, task, leaseClaimed = false, generation = null }) {
      if (!leaseClaimed) {
        const starting = await attemptStore.markStarting(attempt.id, { leaseOwner, leaseSeconds });
        if (!starting) throw new Error(`attempt_lease_conflict: ${attempt.id}`);
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
      const generationSuffix = generation == null
        ? ''
        : `-g${String(generation).replace(/[^a-zA-Z0-9_-]/g, '') || '0'}`;
      const containerId = `cecelia-harness-${String(attempt.id).slice(0, 8)}${generationSuffix}`;
      if (generation != null) await removeContainer(containerId);
      return await spawnDetached({
          containerId,
          task: { ...task, task_type: `harness_${attempt.role}` },
          prompt: spec.stdin,
          worktreePath: bundle.inputs.worktree_path,
          readOnlyWorktree: bundle.constraints.read_only,
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
            HARNESS_LEASE_OWNER: leaseOwner,
            HARNESS_RUN_ID: attempt.run_id,
            HARNESS_HOP: String(attempt.hop),
            HARNESS_READ_ONLY: String(bundle.constraints.read_only),
            HARNESS_CALLBACK_URL: `${brainUrl}/api/brain/harness/attempts/${attempt.id}/callback`,
            BRAIN_URL: brainUrl,
          },
        });
      } catch (error) {
        await attemptStore.fail(attempt.id, {
          code: 'launch_failed',
          message: error.message,
        }, { leaseOwner });
        throw error;
      }
    },
  });
}

export const __test__ = { ACTION_SPECS, buildInputs, buildBundle, executionConfig };
