import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildGithubReadPolicy,
  buildGithubMutationPolicy,
  buildResultChannelDescriptor,
  parseTaskBundle,
} from './execution-contract.js';
import { generateCallbackSecret, hashCallbackSecret } from './callback-auth.js';
import { errorMessage, failurePersistenceError } from './failure-persistence.js';
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

function strictPullRequestNumber(urlValue) {
  if (typeof urlValue !== 'string' || urlValue.length === 0) return null;
  try {
    const url = new URL(urlValue);
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return null;
    const match = url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)$/);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isSafeInteger(number) ? number : null;
  } catch {
    return null;
  }
}

function freezeRequiredPullRequest(value, errorCode) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  for (const key of ['url', 'head_ref', 'head_sha', 'state']) {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) {
      throw new Error(errorCode);
    }
  }
  const numberFromUrl = strictPullRequestNumber(value.url);
  if (
    numberFromUrl == null
    || (
      value.number != null
      && (!Number.isInteger(value.number) || value.number !== numberFromUrl)
    )
  ) {
    throw new Error(errorCode);
  }
  const state = value.state.toUpperCase();
  if (state !== 'OPEN') throw new Error(errorCode);
  return {
    type: 'pull_request',
    url: value.url,
    number: numberFromUrl,
    head_ref: value.head_ref,
    head_sha: value.head_sha,
    state,
  };
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

const MAX_VERIFICATION_COMMANDS = 16;
const MAX_VERIFICATION_COMMAND_BYTES = 8192;

function freezeApprovedVerificationCommands(contract) {
  const row = asObject(contract?.row);
  const acceptance = asObject(row.e2e_acceptance);
  const scenarios = acceptance.scenarios;
  if (contract?.approved !== true || row.status !== 'approved' || !Array.isArray(scenarios)) {
    throw new Error('evaluator_verification_commands_invalid');
  }
  const commands = [];
  for (const scenario of scenarios) {
    const entries = asObject(scenario).commands;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('evaluator_verification_commands_invalid');
    }
    for (const entry of entries) {
      const command = asObject(entry);
      if (
        !['bash', 'sh'].includes(command.type)
        || typeof command.cmd !== 'string'
        || command.cmd.length === 0
        || command.cmd.length > MAX_VERIFICATION_COMMAND_BYTES
        || command.cmd.trim() !== command.cmd
        || command.cmd.includes('\0')
      ) {
        throw new Error('evaluator_verification_commands_invalid');
      }
      commands.push(command.cmd);
      if (commands.length > MAX_VERIFICATION_COMMANDS) {
        throw new Error('evaluator_verification_commands_invalid');
      }
    }
  }
  if (commands.length === 0) throw new Error('evaluator_verification_commands_invalid');
  return Object.freeze([...commands]);
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

  if (spec.role === 'commander') {
    return {
      ...common,
      commander_bundle: ctx.commander.bundle,
    };
  }

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
    common.contract_sha = observed.proposeBranchSha
      ?? observed.contract?.row?.contract_sha
      ?? observed.contract?.row?.sha
      ?? null;
  }
  if (
    action === 'spawn:generator-fix'
    || spec.role === 'evaluator'
    || (spec.role === 'reporter' && action !== 'spawn:canary')
  ) {
    const errorCode = action === 'spawn:generator-fix'
      ? 'generator_fix_pr_authority_required'
      : `${spec.role}_pr_authority_required`;
    const pullRequest = freezeRequiredPullRequest(observed.pr, errorCode);
    common.pull_request = pullRequest;
    common.pr_branch = pullRequest.head_ref;
    common.pr_head_sha = pullRequest.head_sha;
  } else if (spec.role === 'judge') {
    common.pull_request = observed.pr ?? null;
  }
  if (spec.role === 'judge') {
    common.evaluator_result = observed.evaluateVerdict ?? observed.callbackResult ?? null;
  }
  if (spec.role === 'evaluator') {
    common.verification_commands = freezeApprovedVerificationCommands(observed.contract);
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
  if (result?.status === 'cancelled') return null;
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
    const payload = asObject(ctx.observed.task.payload);
    const hostWorktreePath = [ctx.worktreePath, payload.worktree_path]
      .find((candidate) => typeof candidate === 'string' && path.isAbsolute(candidate));
    const commanderContext = spec.role === 'commander' ? ctx.commander : null;
    if (spec.role === 'commander' && !commanderContext?.bundle) {
      throw new Error('spawn:commander requires coordinator context');
    }
    const attemptId = spec.role === 'commander'
      ? commanderContext.bundle.commander_attempt_id
      : randomUUID();
    const callbackSecret = createCallbackSecret();
    const skill = spec.skill ? deps.loadSkill(spec.skill) : null;
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
        result_channel: buildResultChannelDescriptor({
          taskId: bundle.inputs.task_id,
          runId: bundle.run_id,
          attemptId: bundle.attempt_id,
          role: bundle.role,
        }),
        inputs: {
          ...pathFreeInputs,
          execution_surface: 'fleet-worker',
          workspace_spec: workspaceSpec,
          ...(spec.role === 'generator'
            ? {
                github_mutation_policy: buildGithubMutationPolicy({
                  taskId: bundle.inputs.task_id,
                  runId: bundle.run_id,
                  workspaceSpec,
                  operation: action === 'spawn:generator'
                    ? 'push-and-create-draft'
                    : 'push-existing-draft',
                }),
              }
            : {}),
          ...(
            ['evaluator', 'reporter'].includes(spec.role)
            && spec.canary !== true
            ? {
                github_read_policy: buildGithubReadPolicy({
                  pullRequest: pathFreeInputs.pull_request,
                  workspaceSpec,
                  allowedStates: [pathFreeInputs.pull_request?.state],
                }),
              }
            : {}
          ),
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
    const capabilityRequirements = spec.canary === true
      ? {
          provider_auth: false,
          github: false,
          postgres: false,
          model_capabilities: [],
        }
      : deriveCapabilityRequirements({
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
        return await judge({
          ...ctx,
          attempt,
          bundle,
          hostWorktreePath,
        });
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
      rawReceipt = await deps.launcher.launch({
        attempt,
        bundle,
        spec: adapterSpec,
        adapter,
        task: ctx.observed.task,
        target: selectedTarget,
        leaseClaimed: true,
      });
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

    return {
      status: 'DONE',
      detail: `attempt ${attempt.id} launched as ${launched.containerId ?? launched.jobId ?? 'worker job'}`,
      attemptId: attempt.id,
      provider: adapter.name,
      leaseOwner: attempt.lease_owner,
      leaseGeneration: attempt.lease_generation,
      localContainerNaming: attempt.local_container_naming ?? null,
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

export const __test__ = { ACTION_SPECS, buildInputs, buildBundle, executionConfig };
