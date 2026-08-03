import { describe, expect, it, vi } from 'vitest';

import {
  createDetachedLauncher,
  createDispatcher,
  resolveAction,
} from '../dispatcher.js';
import { createCapabilityGate } from '../preflight/capability-gate.js';

const { buildDockerArgs } = (await import('../../docker-executor.js')).__test__;

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const recoveryRoleAssignment = Object.freeze({
  provider: 'codex',
  account: 'team3',
  machine: 'xian-mac-m4',
  strict_affinity: false,
  fallback_targets: [
    { provider: 'codex', account: 'team5', machine: 'xian-mac-m1' },
    { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
  ],
});

const observed = {
  task: {
    id: taskId,
    title: 'Provider-neutral Harness',
    description: 'Build the shared execution kernel.',
    payload: {
      executor: 'auto',
      sprint_dir: 'sprints/provider-neutral',
      worktree_path: '/tmp/worktree',
    },
  },
  run: { id: runId },
  contract: { approved: false, row: { propose_branch: 'cp-propose-r1' } },
  pr: null,
  prdExists: true,
  proposeBranchRn: 1,
  proposeBranch: 'cp-harness-propose-r1-aaaaaaaa-a3',
  proposeBranchSha: 'a'.repeat(40),
  callbackResult: { transcript: 'private proposer chain of thought' },
};

function fakeSkill(name) {
  return Object.freeze({
    name,
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    content: `${name} instructions`,
  });
}

function makeDeps(order = []) {
  const leaseOwner = 'dispatcher-test:4242';
  const adapter = {
    name: 'codex',
    start: vi.fn(() => {
      order.push('adapter.start');
      return { provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' };
    }),
  };
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => {
        order.push('attempt.create');
        return { id: input.id, ...input, task_bundle: input.bundle };
      }),
      markStarting: vi.fn(async (id) => {
        order.push('attempt.claim');
        return {
          id,
          status: 'starting',
          lease_owner: leaseOwner,
          lease_generation: 0,
        };
      }),
      recordLaunchReceipt: vi.fn(async (id, receipt) => {
        order.push('attempt.receipt');
        return { id, status: 'starting', ...receipt };
      }),
      fail: vi.fn(),
      listFailedExecutionTargets: vi.fn(async () => []),
    },
    registry: {
      resolve: vi.fn(() => adapter),
    },
    launcher: {
      launch: vi.fn(async () => {
        order.push('launcher.launch');
        return Object.freeze({
          actualMachineId: 'brain-1',
          executionTransport: 'local-docker',
          remoteJobId: null,
          attestationStatus: 'local',
          containerId: 'container-1',
          jobId: null,
        });
      }),
      inspect: vi.fn(),
      cancel: vi.fn(async () => ({ status: 'missing' })),
    },
    loadSkill: vi.fn(fakeSkill),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 'attempt-secret',
    machineId: 'brain-1',
    leaseOwner,
  };
}

describe('resolveAction', () => {
  it.each([
    ['spawn:planner', 'planner', 'harness-planner'],
    ['spawn:proposer', 'proposer', 'harness-contract-proposer'],
    ['spawn:reviewer', 'reviewer', 'harness-contract-reviewer'],
    ['spawn:canary', 'reporter', null],
    ['spawn:generator', 'generator', 'harness-generator'],
    ['spawn:generator-fix', 'generator', 'harness-generator'],
    ['spawn:evaluator', 'evaluator', 'harness-evaluator'],
    ['spawn:judge', 'judge', null],
    ['spawn:commander', 'commander', null],
  ])('%s 映射为隔离的 %s/%s', (action, role, skill) => {
    expect(resolveAction(action)).toMatchObject({ role, skill });
  });

  it('未知 action fail-fast', () => {
    expect(() => resolveAction('spawn:magic')).toThrow(/unsupported action/);
  });
});

describe('createDispatcher', () => {
  it('does not start a Fleet Runner until its attested receipt commit resolves', async () => {
    const calls = [];
    let resolveReceipt;
    const receiptCommitted = new Promise((resolve) => {
      resolveReceipt = resolve;
    });
    const deps = makeDeps(calls);
    deps.resolveWorkspaceSpec = vi.fn(async () => ({
      repo: 'perfectuser21/cecelia',
      base_sha: 'a'.repeat(40),
      branch: 'cp-two-phase-ordering',
      expected_head_sha: null,
      mode: 'read-write',
      run_id: runId,
      attempt_id: attemptId,
    }));
    const fleetReceipt = Object.freeze({
      actualMachineId: 'brain-1',
      executionTransport: 'fleet-worker',
      remoteJobId: 'fleet-job-1',
      attestationStatus: 'verified',
      containerId: null,
      jobId: 'fleet-job-1',
    });
    deps.launcher.prepare = vi.fn(async () => {
      calls.push('launcher.prepare');
      return fleetReceipt;
    });
    deps.launcher.launch.mockImplementationOnce(async () => {
      calls.push('launcher.launch');
      return fleetReceipt;
    });
    deps.attemptStore.recordLaunchReceipt.mockImplementationOnce(async () => {
      calls.push('attempt.receipt.pending');
      return receiptCommitted;
    });
    deps.launcher.start = vi.fn(async () => {
      calls.push('launcher.start');
      return { status: 'running', attempt_id: attemptId };
    });

    const pending = createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    });

    await vi.waitFor(() => {
      expect(calls).toContain('attempt.receipt.pending');
    });
    expect(deps.launcher.start).not.toHaveBeenCalled();
    resolveReceipt({ id: attemptId, status: 'starting' });
    await expect(pending).resolves.toMatchObject({ status: 'LAUNCHED' });
    expect(deps.launcher.prepare).toHaveBeenCalledOnce();
    expect(deps.launcher.start).toHaveBeenCalledOnce();
    expect(calls.indexOf('launcher.prepare'))
      .toBeLessThan(calls.indexOf('attempt.receipt.pending'));
    expect(calls.indexOf('attempt.receipt.pending'))
      .toBeLessThan(calls.indexOf('launcher.start'));
    expect(deps.launcher.launch).not.toHaveBeenCalled();
  });

  it('cancels a prepared Fleet Attempt and never starts when receipt persistence fails', async () => {
    const deps = makeDeps();
    deps.resolveWorkspaceSpec = vi.fn(async () => ({
      repo: 'perfectuser21/cecelia',
      base_sha: 'a'.repeat(40),
      branch: 'cp-two-phase-receipt-failure',
      expected_head_sha: null,
      mode: 'read-write',
      run_id: runId,
      attempt_id: attemptId,
    }));
    const fleetReceipt = Object.freeze({
      actualMachineId: 'brain-1',
      executionTransport: 'fleet-worker',
      remoteJobId: 'fleet-job-2',
      attestationStatus: 'verified',
      containerId: null,
      jobId: 'fleet-job-2',
    });
    deps.launcher.prepare = vi.fn(async () => fleetReceipt);
    deps.launcher.start = vi.fn();
    deps.launcher.launch.mockResolvedValueOnce(fleetReceipt);
    deps.attemptStore.recordLaunchReceipt.mockRejectedValueOnce(
      new Error('receipt postgres unavailable'),
    );
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'cleaned',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('launch_receipt_persist_failed');

    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(deps.launcher.prepare).toHaveBeenCalledOnce();
    expect(deps.launcher.launch).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({
        id: attemptId,
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 0,
      }),
      target: { provider: 'codex', account: null, machine: 'brain-1' },
      launchReceipt: fleetReceipt,
    });
    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_receipt_persist_failed',
      message: expect.stringContaining('receipt postgres unavailable'),
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
  });

  it('fenced-fails and exact-cancels a Fleet Attempt when start fails', async () => {
    const deps = makeDeps();
    deps.resolveWorkspaceSpec = vi.fn(async () => ({
      repo: 'perfectuser21/cecelia',
      base_sha: 'a'.repeat(40),
      branch: 'cp-two-phase-start-failure',
      expected_head_sha: null,
      mode: 'read-write',
      run_id: runId,
      attempt_id: attemptId,
    }));
    const fleetReceipt = Object.freeze({
      actualMachineId: 'brain-1',
      executionTransport: 'fleet-worker',
      remoteJobId: 'fleet-job-3',
      attestationStatus: 'verified',
      containerId: null,
      jobId: 'fleet-job-3',
    });
    deps.launcher.prepare = vi.fn(async () => fleetReceipt);
    deps.launcher.start = vi.fn(async () => {
      throw new Error('remote_bridge_start_http_503');
    });
    deps.launcher.launch.mockResolvedValueOnce(fleetReceipt);
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'already_clean',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote_bridge_start_http_503');

    expect(deps.attemptStore.recordLaunchReceipt).toHaveBeenCalledOnce();
    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({
        id: attemptId,
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 0,
      }),
      target: { provider: 'codex', account: null, machine: 'brain-1' },
      launchReceipt: fleetReceipt,
    });
    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_start_failed',
      message: 'remote_bridge_start_http_503',
      failureClass: 'infrastructure_blocked',
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
  });

  it('accepts an exact terminal start replay without failing or recancelling the Attempt', async () => {
    const deps = makeDeps();
    deps.resolveWorkspaceSpec = vi.fn(async () => ({
      repo: 'perfectuser21/cecelia',
      base_sha: 'a'.repeat(40),
      branch: 'cp-two-phase-terminal-replay',
      expected_head_sha: null,
      mode: 'read-write',
      run_id: runId,
      attempt_id: attemptId,
    }));
    const fleetReceipt = Object.freeze({
      actualMachineId: 'brain-1',
      executionTransport: 'fleet-worker',
      remoteJobId: 'fleet-job-terminal',
      attestationStatus: 'verified',
      containerId: null,
      jobId: 'fleet-job-terminal',
    });
    deps.launcher.prepare = vi.fn(async () => fleetReceipt);
    deps.launcher.start = vi.fn(async () => ({
      status: 'terminal',
      attempt_id: attemptId,
      terminal_status: 'cleaned',
    }));

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).resolves.toMatchObject({
      status: 'LAUNCHED',
      attempt_id: attemptId,
    });

    expect(deps.attemptStore.recordLaunchReceipt).toHaveBeenCalledOnce();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
    expect(deps.attemptStore.fail).not.toHaveBeenCalled();
  });

  it('assigns a deterministic planner Git handoff branch owned by task, run, and hop', async () => {
    const deps = makeDeps();

    await createDispatcher(deps)('spawn:planner', {
      taskId,
      runId,
      hop: 2,
      observed,
      decision: { phase: 'planning', reason: 'no_prd' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs.planner_branch)
      .toBe('cp-harness-prd-aaaaaaaa-r11111111-a2');
  });

  it('does not reuse a planner branch across Runs of the same task and hop', async () => {
    const first = makeDeps();
    const second = makeDeps();

    await createDispatcher(first)('spawn:planner', {
      taskId,
      runId,
      hop: 2,
      observed,
      decision: { phase: 'planning', reason: 'no_prd' },
    });
    await createDispatcher(second)('spawn:planner', {
      taskId,
      runId: '33333333-3333-4333-8333-333333333333',
      hop: 2,
      observed,
      decision: { phase: 'planning', reason: 'no_prd' },
    });

    const firstBranch = first.attemptStore.createAttempt.mock.calls[0][0]
      .bundle.inputs.planner_branch;
    const secondBranch = second.attemptStore.createAttempt.mock.calls[0][0]
      .bundle.inputs.planner_branch;
    expect(firstBranch).toBe('cp-harness-prd-aaaaaaaa-r11111111-a2');
    expect(secondBranch).toBe('cp-harness-prd-aaaaaaaa-r33333333-a2');
    expect(secondBranch).not.toBe(firstBranch);
  });

  it('passes the verified planner Git artifact into the proposer TaskBundle', async () => {
    const deps = makeDeps();
    const plannerPrdArtifact = {
      type: 'git_artifact',
      kind: 'planner_prd',
      path: 'sprints/provider-neutral/sprint-prd.md',
      repo: 'perfectuser21/cecelia',
      branch: 'cp-harness-prd-aaaaaaaa-a2',
      head_sha: 'a'.repeat(40),
      verification_status: 'verified',
    };

    await createDispatcher(deps)('spawn:proposer', {
      taskId,
      runId,
      hop: 3,
      observed: { ...observed, plannerPrdArtifact },
      decision: { phase: 'gan', reason: 'awaiting_proposal' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs).toMatchObject({
      planner_branch: plannerPrdArtifact.branch,
      planner_head_sha: plannerPrdArtifact.head_sha,
    });
  });

  it('passes SHA-anchored Reviewer feedback into only the next proposer TaskBundle', async () => {
    const deps = makeDeps();
    const reviewFeedback = {
      attempt_id: 'review-attempt-1',
      contract_round: 1,
      contract_sha: 'a'.repeat(40),
      summary: 'The E2E oracle is incomplete.',
      reason: 'verification oracle below threshold',
    };

    await createDispatcher(deps)('spawn:proposer', {
      taskId,
      runId,
      hop: 6,
      observed: {
        ...observed,
        ganLatestRoundReviewFeedback: reviewFeedback,
      },
      decision: { phase: 'gan', reason: 'revision_requested' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs.review_feedback).toEqual(reviewFeedback);
    expect(JSON.stringify(created.bundle.inputs.review_feedback))
      .not.toContain('private proposer chain of thought');
  });

  it('dispatches the frozen CommanderBundle through preflight before Attempt creation', async () => {
    const order = [];
    const deps = makeDeps(order);
    const target = {
      role: 'commander',
      provider: 'codex',
      account: 'team4',
      model: 'GPT-5.5',
      machine: 'us-mac-m4',
    };
    const commanderBundle = {
      schema: 'commander-bundle/v1',
      run_id: runId,
      commander_attempt_id: attemptId,
      event_cursor: 6,
      run_profile: { commander: { primary: target, fallbacks: [] } },
      objective: { summary: 'Adjudicate the next Kernel boundary.' },
      observed: { phase: 'planning' },
      history_summary: {},
      new_events: [],
      actor_messages: [],
      active_risks: [],
      budgets: { remaining_attempts: 2 },
      allowed_actions: ['continue_default'],
      output_schema: 'commander-directive/v1',
    };
    deps.preflightGate = {
      evaluate: vi.fn(async () => {
        order.push('preflight.evaluate');
        return {
          status: 'ok',
          snapshot: {
            provider: 'codex',
            account: 'team4',
            machine: 'us-mac-m4',
            capability_snapshot_id: 'snapshot-commander',
          },
          evidence: { structured_output: true },
        };
      }),
      validateSnapshotForDispatch: vi.fn(async () => {
        order.push('preflight.validate');
        return { status: 'ok' };
      }),
    };
    deps.launcher.launch.mockImplementationOnce(async ({ target: launchedTarget }) => {
      order.push('launcher.launch');
      return {
        actualMachineId: launchedTarget.machine,
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'commander-container',
        jobId: null,
      };
    });

    const result = await createDispatcher(deps)('spawn:commander', {
      taskId,
      runId,
      hop: 12,
      observed,
      decision: { phase: 'planning', reason: 'commander_material_wakeup' },
      commander: {
        target,
        candidate_targets: [target],
        bundle: commanderBundle,
        logical_cycle_id: 'commander-wakeup:6',
      },
    });

    expect(order).toEqual([
      'preflight.evaluate',
      'preflight.validate',
      'attempt.create',
      'attempt.claim',
      'adapter.start',
      'launcher.launch',
      'attempt.receipt',
    ]);
    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created).toMatchObject({
      id: attemptId,
      role: 'commander',
      provider: 'codex',
      accountId: 'team4',
      machineId: 'us-mac-m4',
      logicalCycleId: 'commander-wakeup:6',
      retryOfAttemptId: null,
      bundle: {
        role: 'commander',
        skill: null,
        inputs: { commander_bundle: commanderBundle },
        constraints: { read_only: true, fresh_session: true },
        expected_output: 'commander-directive/v1',
      },
    });
    expect(deps.loadSkill).not.toHaveBeenCalled();
    expect(deps.preflightGate.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      preferred_target: {
        provider: 'codex',
        account: 'team4',
        model: 'GPT-5.5',
        machine: 'us-mac-m4',
      },
      candidate_targets: [{
        provider: 'codex',
        account: 'team4',
        model: 'GPT-5.5',
        machine: 'us-mac-m4',
      }],
    }));
    expect(result).toMatchObject({
      status: 'LAUNCHED',
      run_id: runId,
      attempt_id: attemptId,
      lease_generation: 0,
      provider: 'codex',
    });
  });

  it('keeps one failover retry on the declared fallback lineage with a fresh session', async () => {
    const deps = makeDeps();
    const fallbackAdapter = {
      name: 'claude',
      start: vi.fn(() => ({
        provider: 'claude',
        command: 'claude',
        args: ['--print'],
        stdin: '{}',
      })),
    };
    deps.registry.resolve.mockReturnValue(fallbackAdapter);
    deps.resolveAccountHome = vi.fn(() => '/tmp/claude-account1');
    deps.launcher.launch.mockResolvedValue({
      actualMachineId: 'us-mac-m4',
      executionTransport: 'local-docker',
      remoteJobId: null,
      attestationStatus: 'local',
      containerId: 'commander-fallback',
      jobId: null,
    });
    const sourceAttemptId = '33333333-3333-4333-8333-333333333333';
    const target = {
      role: 'commander',
      provider: 'claude',
      account: 'account1',
      machine: 'us-mac-m4',
    };
    const bundle = {
      schema: 'commander-bundle/v1',
      run_id: runId,
      commander_attempt_id: attemptId,
      event_cursor: 7,
      run_profile: {},
      objective: {},
      observed: {},
      history_summary: {},
      new_events: [],
      actor_messages: [],
      active_risks: [],
      budgets: {},
      allowed_actions: ['continue_default'],
      output_schema: 'commander-directive/v1',
    };
    deps.preflightGate = {
      evaluate: vi.fn(async ({ preferred_target: preferredTarget }) => ({
        status: 'ok',
        snapshot: {
          ...preferredTarget,
          capability_snapshot_id: 'snapshot-fallback',
        },
        evidence: {},
        to_target: preferredTarget,
      })),
      validateSnapshotForDispatch: vi.fn(async (snapshot) => ({
        status: 'ok',
        snapshot,
      })),
    };

    await createDispatcher(deps)('spawn:commander', {
      taskId,
      runId,
      hop: 14,
      observed,
      decision: { phase: 'planning' },
      commander: {
        target,
        candidate_targets: [target],
        bundle,
        logical_cycle_id: 'commander-wakeup:5',
        retry_of_attempt_id: sourceAttemptId,
        restart_reason: 'commander_failover:provider_unavailable',
      },
    });

    expect(deps.attemptStore.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: attemptId,
        provider: 'claude',
        logicalCycleId: 'commander-wakeup:5',
        attemptKind: 'retry',
        retryOfAttemptId: sourceAttemptId,
        restartReason: 'commander_failover:provider_unavailable',
      }),
    );
    expect(fallbackAdapter.start)
      .toHaveBeenCalledWith(expect.objectContaining({
        execution: expect.not.objectContaining({
          resume_session: expect.anything(),
        }),
      }));
  });

  it.each([
    [
      'missing capability gate',
      null,
    ],
    [
      'expired capability snapshot',
      {
        evaluate: vi.fn(async () => ({
          status: 'ok',
          snapshot: {
            provider: 'codex',
            account: 'team4',
            machine: 'brain-1',
            capability_snapshot_id: 'expired',
          },
          evidence: {},
        })),
        validateSnapshotForDispatch: vi.fn(async () => ({
          status: 'blocked',
          fallback_reason: 'capability_snapshot_expired',
        })),
      },
    ],
  ])('creates no Commander Attempt for %s', async (_name, preflightGate) => {
    const deps = makeDeps();
    deps.preflightGate = preflightGate;
    const target = {
      role: 'commander',
      provider: 'codex',
      account: 'team4',
      machine: 'brain-1',
    };
    const result = await createDispatcher(deps)('spawn:commander', {
      taskId,
      runId,
      hop: 12,
      observed,
      decision: { phase: 'planning' },
      commander: {
        target,
        candidate_targets: [target],
        logical_cycle_id: 'commander-wakeup:6',
        bundle: {
          schema: 'commander-bundle/v1',
          run_id: runId,
          commander_attempt_id: attemptId,
          event_cursor: 6,
          run_profile: {},
          objective: {},
          observed: {},
          history_summary: {},
          new_events: [],
          actor_messages: [],
          active_risks: [],
          budgets: {},
          allowed_actions: ['continue_default'],
          output_schema: 'commander-directive/v1',
        },
      },
    });

    expect(result).toMatchObject({
      control_status: 'BLOCKED',
      should_create_attempt: false,
    });
    expect(deps.attemptStore.createAttempt).not.toHaveBeenCalled();
  });

  it('replaces caller paths with a resolved WorkspaceSpec before Fleet prepare', async () => {
    const deps = makeDeps();
    deps.machineId = 'us-mac-m4';
    deps.resolveWorkspaceSpec = vi.fn(async () => ({
      repo: 'perfectuser21/cecelia',
      base_sha: 'a'.repeat(40),
      branch: observed.proposeBranch,
      expected_head_sha: 'a'.repeat(40),
      mode: 'read-only',
      run_id: runId,
      attempt_id: attemptId,
    }));
    deps.launcher.prepare = vi.fn(async () => ({
      jobId: 'worker-job-1',
      actualMachineId: 'us-mac-m4',
      executionTransport: 'fleet-worker',
      remoteJobId: 'worker-job-1',
      attestationStatus: 'verified',
    }));
    deps.launcher.start = vi.fn(async () => ({
      status: 'running',
      attempt_id: attemptId,
    }));
    const dispatch = createDispatcher(deps);

    await expect(dispatch('spawn:reviewer', {
      taskId,
      runId,
      hop: 2,
      observed,
      decision: { phase: 'gan', reason: 'awaiting_review' },
    })).resolves.toMatchObject({ status: 'LAUNCHED', attempt_id: attemptId });

    expect(deps.resolveWorkspaceSpec).toHaveBeenCalledWith(expect.objectContaining({
      role: 'reviewer',
      readOnly: true,
      attemptId,
    }));
    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs).toMatchObject({
      execution_surface: 'fleet-worker',
      workspace_spec: {
        repo: 'perfectuser21/cecelia',
        base_sha: 'a'.repeat(40),
        branch: observed.proposeBranch,
        expected_head_sha: 'a'.repeat(40),
        mode: 'read-only',
        run_id: runId,
        attempt_id: attemptId,
      },
    });
    expect(created.bundle.inputs).not.toHaveProperty('worktree_path');
    expect(deps.launcher.prepare.mock.calls[0][0].bundle).toBe(created.bundle);
    expect(deps.launcher.launch).not.toHaveBeenCalled();
  });

  it('dispatches the fleet canary without a role Skill or workspace dependency', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    await dispatch('spawn:canary', {
      taskId,
      runId,
      hop: 1,
      observed,
      decision: { phase: 'canary', reason: 'fleet_transport_probe' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created).toMatchObject({ role: 'reporter' });
    expect(created.bundle).toMatchObject({
      role: 'reporter',
      skill: null,
      constraints: { fresh_session: true, read_only: true },
      expected_output: 'harness-result/canary-v1',
    });
    expect(created.bundle.objective).toContain('status completed');
    expect(deps.loadSkill).not.toHaveBeenCalled();
    const adapter = deps.registry.resolve.mock.results[0].value;
    expect(adapter.start).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({ canary: true }),
    }));
  });

  it('logical cycle 锚定 durable intent，并与 bundle metadata 逐字一致', async () => {
    const deps = makeDeps();
    deps.preflightGate = {
      evaluate: vi.fn(async () => ({
        status: 'ok',
        snapshot: {
          provider: 'codex',
          account: null,
          machine: 'brain-1',
          capability_snapshot_id: 'snapshot-1',
        },
        evidence: {},
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    const dispatch = createDispatcher(deps);

    await dispatch('spawn:reviewer', {
      taskId,
      runId,
      hop: 2,
      observed,
      decision: { phase: 'gan', reason: 'awaiting_review' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.logicalCycleId).toBe(`intent:${runId}:2`);
    expect(created.bundle.inputs).toMatchObject({
      logical_cycle_id: `intent:${runId}:2`,
      attempt_kind: 'initial',
      workstream_key: 'ws1',
    });
    const evaluatedBundle = deps.preflightGate.evaluate.mock.calls[0][0].task_bundle;
    expect(evaluatedBundle.logical_cycle).toBe(created.logicalCycleId);
    expect(evaluatedBundle.inputs.logical_cycle_id).toBe(created.logicalCycleId);
  });

  it('preserves the source logical cycle for an L0-authorized role retry', async () => {
    const deps = makeDeps();
    const sourceAttemptId = '33333333-3333-4333-8333-333333333333';

    await createDispatcher(deps)('spawn:reviewer', {
      taskId,
      runId,
      hop: 13,
      observed,
      decision: { phase: 'gan', reason: 'commander_retry' },
      retry: {
        retry_of_attempt_id: sourceAttemptId,
        logical_cycle_id: 'intent:contract-review',
        restart_reason: 'commander_retry',
      },
    });

    expect(deps.attemptStore.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalCycleId: 'intent:contract-review',
        attemptKind: 'retry',
        retryOfAttemptId: sourceAttemptId,
        restartReason: 'commander_retry',
        bundle: expect.objectContaining({
          inputs: expect.objectContaining({
            logical_cycle_id: 'intent:contract-review',
            attempt_kind: 'retry',
          }),
        }),
      }),
    );
  });

  it('先持久化 attempt，再生成 adapter spec，最后 launch', async () => {
    const order = [];
    const deps = makeDeps(order);
    const dispatch = createDispatcher(deps);

    const result = await dispatch('spawn:reviewer', {
      taskId,
      runId,
      hop: 2,
      observed,
      decision: { phase: 'gan', reason: 'awaiting_review' },
    });

    expect(order).toEqual([
      'attempt.create',
      'attempt.claim',
      'adapter.start',
      'launcher.launch',
      'attempt.receipt',
    ]);
    expect(result).toMatchObject({ status: 'LAUNCHED', attempt_id: attemptId, provider: 'codex' });
    expect(deps.attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      callbackSecretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(deps.launcher.launch).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({ callbackSecret: 'attempt-secret' }),
    }));
  });

  it('auto 只交给 registry 选 provider，不注入 model', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    await dispatch('spawn:planner', {
      taskId,
      runId,
      hop: 1,
      observed,
      decision: { phase: 'planning', reason: 'no_prd' },
    });

    expect(deps.registry.resolve).toHaveBeenCalledWith({
      provider: 'auto',
      requires: ['structured_output'],
    });
    const adapterInput = deps.registry.resolve.mock.results[0].value.start.mock.calls[0][0];
    expect(adapterInput.execution.model).toBeUndefined();
  });

  it('reviewer bundle 不继承 proposer transcript，且强制 fresh/read-only', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    await dispatch('spawn:reviewer', {
      taskId,
      runId,
      hop: 4,
      observed,
      decision: { phase: 'gan', reason: 'review' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.constraints).toMatchObject({ fresh_session: true, read_only: true });
    expect(JSON.stringify(created.bundle)).not.toContain('private proposer chain of thought');
    expect(created.bundle.inputs).toMatchObject({
      contract_branch: 'cp-harness-propose-r1-aaaaaaaa-a3',
      contract_round: 1,
      contract_sha: 'a'.repeat(40),
    });
  });

  it('generator bundle 从已批准合同导出 contract_branch，供 launcher 注入环境', async () => {
    const deps = makeDeps();

    // Regression: the approved row used to be nested under inputs.contract only,
    // so the detached launcher could not populate CONTRACT_BRANCH for the worker.
    await createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 9,
      observed: {
        ...observed,
        contract: {
          approved: true,
          row: { propose_branch: 'cp-harness-propose-r2-aaaaaaaa-a6' },
        },
      },
      decision: { phase: 'implement', reason: 'contract_approved' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs).toMatchObject({
      contract_branch: 'cp-harness-propose-r2-aaaaaaaa-a6',
    });
  });

  it('恢复 Attempt 只接收与 callback hop/version 绑定的人类上下文', async () => {
    const deps = makeDeps();

    await createDispatcher(deps)('spawn:generator-fix', {
      taskId,
      runId,
      hop: 12,
      observed: {
        ...observed,
        contract: {
          approved: true,
          row: { branch: 'cp-harness-propose-r2-aaaaaaaa-a6' },
        },
        decisionLog: [{
          hop: 11,
          action: 'verdict:context_answer',
          detail: {
            callback_hop: 9,
            context_request_hop: 10,
            context_version: 'context-v1:9:attempt-9',
            answer: 'Preserve the current release policy.',
          },
        }],
      },
      decision: { phase: 'generate', reason: 'no_pr' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs.human_context).toEqual({
      callback_hop: 9,
      context_request_hop: 10,
      context_version: 'context-v1:9:attempt-9',
      answer: 'Preserve the current release policy.',
    });
  });

  it('generator-fix 只接收与当前 PR SHA 和 Attempt 绑定的安全 Evaluator 反馈', async () => {
    const deps = makeDeps();
    const evaluatorAttemptId = '33333333-3333-4333-8333-333333333333';
    const prHeadSha = 'b'.repeat(40);

    await createDispatcher(deps)('spawn:generator-fix', {
      taskId,
      runId,
      hop: 12,
      observed: {
        ...observed,
        pr: {
          number: 1571,
          head_ref: 'cp-android-cancel',
          head_sha: prHeadSha,
        },
        contract: {
          approved: true,
          row: { branch: 'cp-harness-propose-r2-aaaaaaaa-a6' },
        },
        evaluateVerdict: {
          verdict: 'FAIL',
          feedback: 'Cooldown oracle is missing.',
          attempt_id: evaluatorAttemptId,
          pr_head_sha: prHeadSha,
        },
        evaluateResult: {
          contract_version: '1.0',
          attempt_id: evaluatorAttemptId,
          status: 'completed_with_concerns',
          summary: 'Evaluator verdict: FAIL.',
          decision: {
            outcome: 'FAIL',
            reason: 'token=secret-value; add the real cooldown assertion.',
          },
          checks: [{
            command: 'npm run test:e2e',
            exit_code: 1,
            verification_level: 'L3',
            log_tail: 'Bearer private-token failed',
          }],
          provider_metadata: {
            credential_ref: 'must-not-reach-generator',
            private_chain_of_thought: 'must-not-reach-generator',
          },
        },
      },
      decision: { phase: 'generate', reason: 'evaluate_failed' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs.evaluator_feedback).toEqual({
      attempt_id: evaluatorAttemptId,
      pr_head_sha: prHeadSha,
      verdict: 'FAIL',
      summary: 'Evaluator verdict: FAIL.',
      reason: 'token=[REDACTED]; add the real cooldown assertion.',
      checks: [{
        command: 'npm run test:e2e',
        exit_code: 1,
        verification_level: 'L3',
        log_tail: 'Bearer [REDACTED] failed',
      }],
    });
    expect(JSON.stringify(created.bundle.inputs.evaluator_feedback))
      .not.toContain('must-not-reach-generator');
  });

  it.each([
    ['stale PR SHA', {
      verdict: 'FAIL',
      attempt_id: '33333333-3333-4333-8333-333333333333',
      pr_head_sha: 'c'.repeat(40),
    }],
    ['non-FAIL verdict', {
      verdict: 'PASS',
      attempt_id: '33333333-3333-4333-8333-333333333333',
      pr_head_sha: 'b'.repeat(40),
    }],
    ['mismatched Evaluator Attempt', {
      verdict: 'FAIL',
      attempt_id: '44444444-4444-4444-8444-444444444444',
      pr_head_sha: 'b'.repeat(40),
    }],
  ])('generator-fix 不接收 %s 的 Evaluator 反馈', async (_label, evaluateVerdict) => {
    const deps = makeDeps();
    const evaluatorAttemptId = '33333333-3333-4333-8333-333333333333';

    await createDispatcher(deps)('spawn:generator-fix', {
      taskId,
      runId,
      hop: 12,
      observed: {
        ...observed,
        pr: {
          number: 1571,
          head_ref: 'cp-android-cancel',
          head_sha: 'b'.repeat(40),
        },
        evaluateVerdict,
        evaluateResult: {
          attempt_id: evaluatorAttemptId,
          status: 'completed_with_concerns',
          summary: 'Evaluator verdict.',
          decision: { outcome: 'FAIL', reason: 'Fix it.' },
          checks: [],
        },
      },
      decision: { phase: 'generate', reason: 'evaluate_failed' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs).not.toHaveProperty('evaluator_feedback');
  });

  it('generator bundle 从生产合同 schema 的 row.branch 导出 contract_branch', async () => {
    const deps = makeDeps();

    await createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 9,
      observed: {
        ...observed,
        contract: {
          approved: true,
          row: { branch: 'cp-harness-propose-r2-production-schema' },
        },
      },
      decision: { phase: 'implement', reason: 'contract_approved' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs).toMatchObject({
      contract_branch: 'cp-harness-propose-r2-production-schema',
    });
  });

  it('proposer bundle 指定下一轮规范分支，避免产物落到共享任务分支', async () => {
    const deps = makeDeps();

    await createDispatcher(deps)('spawn:proposer', {
      taskId,
      runId,
      hop: 17,
      observed: { ...observed, proposeBranchRn: 0, proposeBranch: null },
      decision: { phase: 'gan', reason: 'no_contract_yet' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs).toMatchObject({
      contract_round: 1,
      propose_branch: 'cp-harness-propose-r1-aaaaaaaa-r11111111-a17',
    });
  });

  it('does not reuse a proposer branch across Runs of the same task, round, and hop', async () => {
    const first = makeDeps();
    const second = makeDeps();
    const context = {
      taskId,
      hop: 17,
      observed: { ...observed, proposeBranchRn: 0, proposeBranch: null },
      decision: { phase: 'gan', reason: 'no_contract_yet' },
    };

    await createDispatcher(first)('spawn:proposer', { ...context, runId });
    await createDispatcher(second)('spawn:proposer', {
      ...context,
      runId: '33333333-3333-4333-8333-333333333333',
    });

    const firstBranch = first.attemptStore.createAttempt.mock.calls[0][0]
      .bundle.inputs.propose_branch;
    const secondBranch = second.attemptStore.createAttempt.mock.calls[0][0]
      .bundle.inputs.propose_branch;
    expect(firstBranch).toBe('cp-harness-propose-r1-aaaaaaaa-r11111111-a17');
    expect(secondBranch).toBe('cp-harness-propose-r1-aaaaaaaa-r33333333-a17');
    expect(secondBranch).not.toBe(firstBranch);
  });

  it('evaluator 工作树可写，以便切 PR 分支、真启服务并固化验收证据', async () => {
    const deps = makeDeps();

    await createDispatcher(deps)('spawn:evaluator', {
      taskId,
      runId,
      hop: 7,
      observed: {
        ...observed,
        pr: {
          url: 'https://github.com/o/r/pull/42',
          head_ref: 'cp-evaluator-target',
          head_sha: 'sha-1',
          ci: 'pass',
        },
      },
      decision: { phase: 'evaluate', reason: 'ci_pass' },
    });

    const created = deps.attemptStore.createAttempt.mock.calls[0][0];
    expect(created.bundle.constraints).toMatchObject({ fresh_session: true, read_only: false });
    expect(created.bundle.inputs).toMatchObject({
      pr_branch: 'cp-evaluator-target',
      pr_head_sha: 'sha-1',
    });
    expect(deps.launcher.launch).toHaveBeenCalledWith(expect.objectContaining({
      bundle: expect.objectContaining({ constraints: expect.objectContaining({ read_only: false }) }),
    }));
  });

  it('只把结构化 GitHub 取证请求交给 evaluator TaskBundle', async () => {
    const deps = makeDeps();
    const headSha = 'b8be843d8a35064690a40e885eb235fc8523ea62';
    const githubEvidenceRequest = {
      contract_version: 'github-evidence-request/v1',
      repo: 'perfectuser21/zenithjoy-workspace',
      pr_number: 1571,
      expected_head_sha: headSha,
      runs: [{
        purpose: 'windows_cancel',
        mode: 'existing',
        run_id: 30694126825,
        workflow: '.github/workflows/e2e-orphan-consolidation-windows.yml',
        artifacts: ['windows-cancel-evidence-30694126825-1'],
      }],
    };
    const evidenceObserved = {
      ...observed,
      task: {
        ...observed.task,
        payload: { ...observed.task.payload, github_evidence_request: githubEvidenceRequest },
      },
      pr: {
        number: 1571,
        url: 'https://github.com/perfectuser21/zenithjoy-workspace/pull/1571',
        head_ref: 'cp-android-cancel',
        head_sha: headSha,
        ci: 'pass',
      },
    };

    await createDispatcher(deps)('spawn:evaluator', {
      taskId,
      runId,
      hop: 7,
      observed: evidenceObserved,
      decision: { phase: 'evaluate', reason: 'ci_pass' },
    });
    const evaluatorBundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(evaluatorBundle.inputs.github_evidence_request).toEqual(githubEvidenceRequest);

    const generatorDeps = makeDeps();
    await createDispatcher(generatorDeps)('spawn:generator', {
      taskId,
      runId,
      hop: 8,
      observed: evidenceObserved,
      decision: { phase: 'generate', reason: 'no_pr' },
    });
    const generatorBundle = generatorDeps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(generatorBundle.inputs).not.toHaveProperty('github_evidence_request');
  });

  it('按 role_assignments 为同一 run 的 generator/evaluator 选择不同 provider 与账户 home', async () => {
    const attempts = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    const adapters = Object.fromEntries(['codex', 'claude'].map((provider) => [provider, {
      name: provider,
      start: vi.fn(({ execution }) => ({ provider, args: [], env: {}, stdin: '{}', execution })),
    }]));
    const attemptStore = {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(async (id) => ({
        id,
        status: 'starting',
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 0,
      })),
      recordLaunchReceipt: vi.fn(async (id) => ({ id, status: 'starting' })),
      fail: vi.fn(),
    };
    const launcher = {
      launch: vi.fn(async ({ target }) => Object.freeze({
        actualMachineId: target.machine,
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'cx',
        jobId: null,
      })),
      cancel: vi.fn(),
    };
    const payload = {
      executor: 'grok',
      sprint_dir: 'sprints/provider-neutral',
      worktree_path: '/tmp/worktree',
      role_assignments: {
        generator: { provider: 'codex', account: 'team3', model: 'gpt-5.6-codex' },
        evaluator: { provider: 'claude', account: 'account2', model: 'claude-opus-4-6' },
      },
    };
    const dispatch = createDispatcher({
      attemptStore,
      registry: { resolve: vi.fn(({ provider }) => adapters[provider]) },
      launcher,
      loadSkill: vi.fn(fakeSkill),
      randomUUID: () => attempts.shift(),
      createCallbackSecret: () => 'secret',
      resolveAccountHome: (provider, account) => `/accounts/${provider}/${account}`,
      leaseOwner: 'dispatcher-test:4242',
    });
    const baseCtx = {
      taskId,
      runId,
      observed: { ...observed, task: { ...observed.task, payload } },
    };

    await dispatch('spawn:generator', { ...baseCtx, hop: 5, decision: { phase: 'generate' } });
    await dispatch('spawn:evaluator', { ...baseCtx, hop: 6, decision: { phase: 'evaluate' } });

    expect(attemptStore.createAttempt.mock.calls.map(([input]) => ({
      role: input.role,
      provider: input.provider,
      accountId: input.accountId,
    }))).toEqual([
      { role: 'generator', provider: 'codex', accountId: 'team3' },
      { role: 'evaluator', provider: 'claude', accountId: 'account2' },
    ]);
    expect(adapters.codex.start).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({ codexHome: '/accounts/codex/team3' }),
    }));
    expect(adapters.claude.start).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({
        claudeHome: '/accounts/claude/account2',
        model: 'claude-opus-4-6',
      }),
    }));
    expect(adapters.codex.start).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({ model: 'gpt-5.6-codex' }),
    }));
    expect(launcher.launch.mock.calls.map(([input]) => input.target.model)).toEqual([
      'gpt-5.6-codex',
      'claude-opus-4-6',
    ]);
  });

  it('launch 失败由 dispatcher 用唯一 lease owner fenced-fail 后再抛出', async () => {
    const deps = makeDeps();
    deps.launcher.launch.mockRejectedValueOnce(new Error('docker unavailable'));
    const dispatch = createDispatcher(deps);

    await expect(dispatch('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate', reason: 'approved' },
    })).rejects.toThrow(/docker unavailable/);
    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: 'docker unavailable; orphan cancellation unsafe: missing',
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({
        id: attemptId,
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 0,
      }),
      target: {
        provider: 'codex',
        account: null,
        machine: 'brain-1',
      },
      launchReceipt: undefined,
    });
  });

  it('launch 失败后的 claimed fail 写入失败时聚合两段错误并触发告警', async () => {
    const deps = makeDeps();
    deps.launcher.launch.mockRejectedValueOnce(new Error('docker unavailable'));
    deps.attemptStore.fail.mockRejectedValueOnce(new Error('postgres write denied'));
    deps.onFailurePersistenceFailed = vi.fn(async () => {});

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow(
      'docker unavailable; failure_persistence_failed: postgres write denied',
    );

    expect(deps.onFailurePersistenceFailed).toHaveBeenCalledWith(expect.objectContaining({
      attemptId,
      lifecycleCode: 'launch_failed',
      originalError: expect.objectContaining({ message: 'docker unavailable' }),
      persistenceError: expect.objectContaining({ message: 'postgres write denied' }),
    }));
  });

  it('lease claim 冲突时不以无 fence 的失败写覆盖其他 owner', async () => {
    const deps = makeDeps();
    deps.attemptStore.markStarting.mockResolvedValueOnce(null);

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow(`attempt_lease_conflict: ${attemptId}`);

    expect(deps.launcher.launch).not.toHaveBeenCalled();
    expect(deps.attemptStore.fail).not.toHaveBeenCalled();
  });

  it('strict affinity with a failed Xi’an M4 target never probes or launches another machine', async () => {
    const deps = makeDeps();
    const gateDeps = {
      resolveCanonicalMachineId: vi.fn(async ({ machine }) => machine),
      getMachineHealth: vi.fn(async () => ({ ok: true })),
      getMachineCapacity: vi.fn(async () => ({ ok: true, available: 1 })),
      listProviderAccounts: vi.fn(async () => ['team5', 'team1']),
      probeProviderAuth: vi.fn(async () => ({ ok: true })),
      probeGitHub: vi.fn(async () => ({ ok: true })),
      probePostgres: vi.fn(async () => ({ ok: true })),
      probeModelCapability: vi.fn(async () => ({ ok: true })),
    };
    deps.preflightGate = createCapabilityGate(gateDeps);
    deps.attemptStore.listFailedExecutionTargets.mockResolvedValueOnce([
      {
        provider: 'codex',
        account: 'team3',
        machine: 'xian-mac-m4',
      },
    ]);

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 6,
      observed: {
        ...observed,
        task: {
          ...observed.task,
          payload: {
            ...observed.task.payload,
            role_assignments: {
              generator: {
                ...recoveryRoleAssignment,
                strict_affinity: true,
              },
            },
          },
        },
      },
      decision: { phase: 'generate' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      control_status: 'BLOCKED',
      failure_class: 'infrastructure_blocked',
    });
    expect(deps.attemptStore.listFailedExecutionTargets)
      .toHaveBeenCalledWith(runId, 'generator');
    expect(gateDeps.resolveCanonicalMachineId).not.toHaveBeenCalled();
    expect(deps.attemptStore.createAttempt).not.toHaveBeenCalled();
    expect(deps.launcher.launch).not.toHaveBeenCalled();
  });

  it('a later non-strict hop creates a new Attempt on the next ordered machine', async () => {
    const firstAttemptId = '33333333-3333-4333-8333-333333333333';
    const secondAttemptId = '44444444-4444-4444-8444-444444444444';
    const ids = [firstAttemptId, secondAttemptId];
    const deps = makeDeps();
    deps.randomUUID = () => ids.shift();
    deps.attemptStore.listFailedExecutionTargets
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        provider: 'codex',
        account: 'team3',
        machine: 'xian-mac-m4',
      }]);
    const gateDeps = {
      resolveCanonicalMachineId: vi.fn(async ({ machine }) => machine),
      getMachineHealth: vi.fn(async ({ machine }) => ({ ok: true, machine })),
      getMachineCapacity: vi.fn(async () => ({ ok: true, available: 1 })),
      listProviderAccounts: vi.fn(async () => []),
      probeProviderAuth: vi.fn(async () => ({ ok: true })),
      probeGitHub: vi.fn(async () => ({ ok: true })),
      probePostgres: vi.fn(async () => ({ ok: true })),
      probeModelCapability: vi.fn(async () => ({ ok: true })),
    };
    deps.preflightGate = createCapabilityGate(gateDeps);
    deps.launcher.launch
      .mockRejectedValueOnce(new Error('xian M4 launch failed'))
      .mockImplementationOnce(async ({ target }) => ({
        actualMachineId: target.machine,
        executionTransport: 'remote-bridge',
        remoteJobId: 'remote-job-recovery',
        attestationStatus: 'verified',
        containerId: null,
        jobId: 'remote-job-recovery',
      }));
    const recoveryObserved = {
      ...observed,
      task: {
        ...observed.task,
        payload: {
          ...observed.task.payload,
          role_assignments: { generator: recoveryRoleAssignment },
        },
      },
    };
    const dispatch = createDispatcher(deps);

    await expect(dispatch('spawn:generator', {
      taskId,
      runId,
      hop: 6,
      observed: recoveryObserved,
      decision: { phase: 'generate' },
    })).rejects.toThrow('xian M4 launch failed');

    await expect(dispatch('spawn:generator', {
      taskId,
      runId,
      hop: 7,
      observed: recoveryObserved,
      decision: { phase: 'generate' },
    })).resolves.toMatchObject({
      status: 'LAUNCHED',
      attempt_id: secondAttemptId,
    });

    expect(deps.attemptStore.createAttempt.mock.calls.map(([created]) => ({
      id: created.id,
      hop: created.hop,
      machineId: created.machineId,
    }))).toEqual([
      { id: firstAttemptId, hop: 6, machineId: 'xian-mac-m4' },
      { id: secondAttemptId, hop: 7, machineId: 'xian-mac-m1' },
    ]);
    expect(deps.launcher.launch.mock.calls[1][0]).toMatchObject({
      attempt: { id: secondAttemptId, hop: 7 },
      target: {
        provider: 'codex',
        account: 'team5',
        machine: 'xian-mac-m1',
      },
    });
  });

  it('把 preflight 选中的 target、machine 与同一 fenced receipt 贯穿真实 dispatch 链', async () => {
    const order = [];
    const deps = makeDeps(order);
    const selectedTarget = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const remoteReceipt = Object.freeze({
      actualMachineId: 'xian-mac-m4',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-7',
      attestationStatus: 'verified',
      containerId: null,
      jobId: 'remote-job-7',
    });
    deps.preflightGate = {
      evaluate: vi.fn(async () => ({
        status: 'ok',
        snapshot: {
          ...selectedTarget,
          capability_snapshot_id: 'snapshot-xian',
        },
        evidence: {},
        to_target: {
          ...selectedTarget,
          untrusted_field: 'must-not-cross-transport-boundary',
        },
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    deps.attemptStore.markStarting.mockResolvedValueOnce({
      id: attemptId,
      status: 'starting',
      lease_owner: 'dispatcher-test:4242',
      lease_generation: 7,
    });
    deps.launcher.launch.mockResolvedValueOnce(remoteReceipt);

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed: {
        ...observed,
        task: {
          ...observed.task,
          payload: {
            ...observed.task.payload,
            role_assignments: {
              generator: { provider: 'codex', account: 'team1' },
            },
          },
        },
      },
      decision: { phase: 'generate' },
    })).resolves.toMatchObject({
      status: 'LAUNCHED',
      attempt_id: attemptId,
    });

    expect(deps.attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'xian-mac-m4',
    }));
    expect(deps.launcher.launch).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({
        id: attemptId,
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 7,
      }),
      target: selectedTarget,
      leaseClaimed: true,
    }));
    expect(deps.attemptStore.recordLaunchReceipt).toHaveBeenCalledWith(attemptId, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 7,
      actualMachineId: 'xian-mac-m4',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-7',
      attestationStatus: 'verified',
    });
    expect(order.indexOf('launcher.launch')).toBeLessThan(order.indexOf('attempt.receipt'));
  });

  it.each([
    ['returns null', null],
    ['throws', new Error('database unavailable')],
  ])('cancels the exact launched job and fenced-fails when receipt persistence %s', async (
    _description,
    receiptFailure,
  ) => {
    const deps = makeDeps();
    const selectedTarget = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m1',
    };
    const remoteReceipt = Object.freeze({
      actualMachineId: 'xian-mac-m1',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-orphan',
      attestationStatus: 'verified',
      containerId: null,
      jobId: 'remote-job-orphan',
    });
    deps.preflightGate = {
      evaluate: vi.fn(async () => ({
        status: 'ok',
        snapshot: {
          ...selectedTarget,
          capability_snapshot_id: 'snapshot-xian',
        },
        evidence: {},
        to_target: selectedTarget,
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    deps.attemptStore.markStarting.mockResolvedValueOnce({
      id: attemptId,
      status: 'starting',
      lease_owner: 'dispatcher-test:4242',
      lease_generation: 11,
    });
    deps.launcher.launch.mockResolvedValueOnce(remoteReceipt);
    if (receiptFailure instanceof Error) {
      deps.attemptStore.recordLaunchReceipt.mockRejectedValueOnce(receiptFailure);
    } else {
      deps.attemptStore.recordLaunchReceipt.mockResolvedValueOnce(receiptFailure);
    }
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'cleaned',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('launch_receipt_persist_failed');

    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({
        id: attemptId,
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 11,
      }),
      target: selectedTarget,
      launchReceipt: remoteReceipt,
    });
    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_receipt_persist_failed',
      message: expect.stringContaining('launch receipt'),
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 11,
    });
  });

  it('receipt 失败后的 claimed fail 写入失败时聚合两段错误并触发告警', async () => {
    const deps = makeDeps();
    deps.onFailurePersistenceFailed = vi.fn(async () => {});
    deps.attemptStore.recordLaunchReceipt.mockRejectedValueOnce(
      new Error('receipt postgres unavailable'),
    );
    deps.attemptStore.fail.mockRejectedValueOnce(new Error('terminal postgres unavailable'));
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'already_clean',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow(
      'launch receipt persistence failed: receipt postgres unavailable; ' +
      'failure_persistence_failed: terminal postgres unavailable',
    );

    expect(deps.onFailurePersistenceFailed).toHaveBeenCalledWith(expect.objectContaining({
      attemptId,
      lifecycleCode: 'launch_receipt_persist_failed',
      originalError: expect.objectContaining({
        message: expect.stringContaining('launch receipt persistence failed'),
      }),
      persistenceError: expect.objectContaining({ message: 'terminal postgres unavailable' }),
    }));
  });

  it('does not swallow a failure-persistence alert rejection and sanitizes its diagnostic', async () => {
    const deps = makeDeps();
    deps.onFailurePersistenceFailed = vi.fn(async () => {
      throw new Error('alert transport leaked bridge-secret-value');
    });
    deps.attemptStore.recordLaunchReceipt.mockRejectedValueOnce(
      new Error('receipt postgres unavailable'),
    );
    deps.attemptStore.fail.mockRejectedValueOnce(new Error('terminal postgres unavailable'));
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'cleaned',
      attempt_id: attemptId,
    });

    let thrown;
    try {
      await createDispatcher(deps)('spawn:generator', {
        taskId,
        runId,
        hop: 5,
        observed,
        decision: { phase: 'generate' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.errors).toHaveLength(3);
    expect(thrown.message).toContain('failure_persistence_alert_failed');
    expect(thrown.message).not.toContain('bridge-secret-value');
  });

  it('rejects a remote receipt that omits verified actual-machine evidence', async () => {
    const deps = makeDeps();
    const selectedTarget = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    deps.preflightGate = {
      evaluate: vi.fn(async () => ({
        status: 'ok',
        snapshot: {
          ...selectedTarget,
          capability_snapshot_id: 'snapshot-xian',
        },
        evidence: {},
        to_target: selectedTarget,
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    const invalidReceipt = Object.freeze({
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-unverified',
      attestationStatus: null,
      containerId: null,
      jobId: 'remote-job-unverified',
    });
    deps.launcher.launch.mockResolvedValueOnce(invalidReceipt);
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'already_clean',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('launch_receipt_invalid:remote_actual_machine');

    expect(deps.attemptStore.recordLaunchReceipt).not.toHaveBeenCalled();
    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: 'launch_receipt_invalid:remote_actual_machine',
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({ id: attemptId, lease_generation: 0 }),
      target: selectedTarget,
      launchReceipt: invalidReceipt,
    });
  });

  it('rejects a local receipt without the exact launched container identity', async () => {
    const deps = makeDeps();
    const invalidReceipt = Object.freeze({
      actualMachineId: 'brain-1',
      executionTransport: 'local-docker',
      remoteJobId: null,
      attestationStatus: 'local',
      containerId: null,
      jobId: null,
    });
    deps.launcher.launch.mockResolvedValueOnce(invalidReceipt);

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('launch_receipt_invalid:local_container_id');

    expect(deps.attemptStore.recordLaunchReceipt).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({ id: attemptId, lease_generation: 0 }),
      target: {
        provider: 'codex',
        account: null,
        machine: 'brain-1',
      },
      launchReceipt: invalidReceipt,
    });
  });

  it('cancels by Attempt when remote transport validation rejects after Bridge acceptance', async () => {
    const deps = makeDeps();
    const selectedTarget = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    deps.preflightGate = {
      evaluate: vi.fn(async () => ({
        status: 'ok',
        snapshot: {
          ...selectedTarget,
          capability_snapshot_id: 'snapshot-xian',
        },
        evidence: {},
        to_target: selectedTarget,
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    deps.launcher.launch.mockRejectedValueOnce(new Error('remote_bridge_attestation_invalid'));
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'cleaned',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote_bridge_attestation_invalid');

    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({
        id: attemptId,
        lease_owner: 'dispatcher-test:4242',
        lease_generation: 0,
      }),
      target: selectedTarget,
      launchReceipt: undefined,
    });
  });

  it('surfaces remote HTTP 404 missing as unconfirmed orphan cleanup', async () => {
    const deps = makeDeps();
    const selectedTarget = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    deps.preflightGate = {
      evaluate: vi.fn(async () => ({
        status: 'ok',
        snapshot: {
          ...selectedTarget,
          capability_snapshot_id: 'snapshot-xian',
        },
        evidence: {},
        to_target: selectedTarget,
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    deps.launcher.launch.mockRejectedValueOnce(new Error('remote launch failed'));
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'missing',
      httpStatus: 404,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote launch failed');

    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: 'remote launch failed; orphan cancellation unsafe: missing (HTTP 404)',
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
  });

  it.each(['cleaned', 'already_clean'])(
    'treats Fleet Worker cancel status %s as confirmed cleanup',
    async (cancelStatus) => {
      const deps = makeDeps();
      deps.resolveWorkspaceSpec = vi.fn(async () => ({
        repo: 'perfectuser21/cecelia',
        base_sha: 'a'.repeat(40),
        branch: 'cp-cancel-status-contract',
        expected_head_sha: null,
        mode: 'read-write',
        run_id: runId,
        attempt_id: attemptId,
      }));
      deps.launcher.prepare = vi.fn(async () => {
        throw new Error('remote_bridge_prepare_request_failed');
      });
      deps.launcher.start = vi.fn();
      deps.launcher.cancel.mockResolvedValueOnce({
        status: cancelStatus,
        attempt_id: attemptId,
      });

      await expect(createDispatcher(deps)('spawn:generator', {
        taskId,
        runId,
        hop: 5,
        observed,
        decision: { phase: 'generate' },
      })).rejects.toThrow('remote_bridge_prepare_request_failed');

      expect(deps.launcher.start).not.toHaveBeenCalled();
      expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
        code: 'launch_failed',
        message: 'remote_bridge_prepare_request_failed',
      }, {
        leaseOwner: 'dispatcher-test:4242',
        leaseGeneration: 0,
      });
    },
  );

  it('continues to diagnose an abnormal Fleet Worker cancel status', async () => {
    const deps = makeDeps();
    deps.resolveWorkspaceSpec = vi.fn(async () => ({
      repo: 'perfectuser21/cecelia',
      base_sha: 'a'.repeat(40),
      branch: 'cp-cancel-status-contract',
      expected_head_sha: null,
      mode: 'read-write',
      run_id: runId,
      attempt_id: attemptId,
    }));
    deps.launcher.prepare = vi.fn(async () => {
      throw new Error('remote_bridge_prepare_request_failed');
    });
    deps.launcher.start = vi.fn();
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'quarantined',
      attempt_id: attemptId,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote_bridge_prepare_request_failed');

    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: [
        'remote_bridge_prepare_request_failed',
        'orphan cancellation unsafe: quarantined',
      ].join('; '),
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
  });

  it('surfaces a structured unsafe cancel outcome in the fenced failure diagnostic', async () => {
    const deps = makeDeps();
    deps.launcher.launch.mockRejectedValueOnce(new Error('remote launch failed'));
    deps.launcher.cancel.mockResolvedValueOnce({
      status: 'rejected',
      httpStatus: 409,
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote launch failed');

    expect(deps.attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: expect.stringContaining('orphan cancellation unsafe: rejected'),
    }, {
      leaseOwner: 'dispatcher-test:4242',
      leaseGeneration: 0,
    });
  });

  it('createAttempt 命中同 run/hop 旧 attempt 时不拿新密钥重复 launch', async () => {
    const deps = makeDeps();
    deps.attemptStore.createAttempt.mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333',
      run_id: runId,
      hop: 5,
      status: 'starting',
    });

    await expect(createDispatcher(deps)('spawn:generator', {
      taskId,
      runId,
      hop: 5,
      observed,
      decision: { phase: 'generate' },
    })).resolves.toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      attemptId: '33333333-3333-4333-8333-333333333333',
    });
    expect(deps.registry.resolve.mock.results[0].value.start).not.toHaveBeenCalled();
    expect(deps.launcher.launch).not.toHaveBeenCalled();
  });

  it.each(['wait:human_review', 'merge_pr', 'report'])(
    '%s 走显式 deterministic handler',
    async (action) => {
      const deps = makeDeps();
      deps.handlers = { [action]: vi.fn(async () => ({ status: 'DONE', detail: action })) };
      const dispatch = createDispatcher(deps);
      await expect(dispatch(action, { taskId, runId, hop: 8, observed }))
        .resolves.toMatchObject({ status: 'DONE', detail: action });
      expect(deps.handlers[action]).toHaveBeenCalledOnce();
    },
  );
});

describe('createDetachedLauncher', () => {
  it('removes the requested container and rejects when Docker returns no container identity', async () => {
    const removeContainer = vi.fn(async () => true);
    const attemptStore = {
      markStarting: vi.fn(async () => ({
        id: attemptId,
        status: 'starting',
        lease_owner: 'local-launcher:1',
        lease_generation: 2,
      })),
      fail: vi.fn(async () => ({ deduped: false })),
    };
    const launcher = createDetachedLauncher({
      spawnDetached: vi.fn(async () => ({})),
      removeContainer,
      attemptStore,
      leaseOwner: 'local-launcher:1',
    });

    await expect(launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 2, role: 'generator' },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: [], stdin: '{}', env: {} },
      task: observed.task,
    })).rejects.toThrow('local_launch_container_id_missing');

    expect(removeContainer).toHaveBeenCalledTimes(2);
    expect(removeContainer.mock.calls.map(([containerId]) => containerId)).toEqual([
      'cecelia-harness-22222222-g2',
      'cecelia-harness-22222222-g2',
    ]);
    expect(attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: expect.stringContaining('local_launch_container_id_missing'),
    }, {
      leaseOwner: 'local-launcher:1',
      leaseGeneration: 2,
    });
  });

  it('never removes an untrusted returned container when Docker returns a mismatched identity', async () => {
    const removeContainer = vi.fn(async () => true);
    const launcher = createDetachedLauncher({
      spawnDetached: vi.fn(async () => ({ containerId: 'unexpected-container' })),
      removeContainer,
      attemptStore: {
        markStarting: vi.fn(async () => ({
          id: attemptId,
          status: 'starting',
          lease_owner: 'local-launcher:1',
          lease_generation: 0,
        })),
        fail: vi.fn(async () => ({ deduped: false })),
      },
      leaseOwner: 'local-launcher:1',
    });

    await expect(launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 2, role: 'generator' },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: [], stdin: '{}', env: {} },
      task: observed.task,
    })).rejects.toThrow('local_launch_container_id_mismatch');

    expect(new Set(removeContainer.mock.calls.map(([containerId]) => containerId))).toEqual(
      new Set(['cecelia-harness-22222222-g0']),
    );
    expect(removeContainer).not.toHaveBeenCalledWith('unexpected-container');
  });

  it('uses the dispatcher-claimed lease owner when launcher construction has a different owner', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const attemptStore = {
      markStarting: vi.fn(),
      fail: vi.fn(),
    };
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore,
      leaseOwner: 'launcher-constructor:1',
    });

    await launcher.launch({
      attempt: {
        id: attemptId,
        run_id: runId,
        hop: 2,
        role: 'generator',
        lease_owner: 'dispatcher-claim:9',
        lease_generation: 9,
      },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: [], stdin: '{}', env: {} },
      task: observed.task,
      leaseClaimed: true,
    });

    expect(attemptStore.markStarting).not.toHaveBeenCalled();
    expect(spawnDetached).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        HARNESS_LEASE_OWNER: 'dispatcher-claim:9',
      }),
    }));
  });

  it('returns a frozen local receipt and cancels its exact launched container', async () => {
    const removeContainer = vi.fn(async () => true);
    const launcher = createDetachedLauncher({
      spawnDetached: vi.fn(async ({ containerId }) => ({ containerId })),
      removeContainer,
      attemptStore: {
        markStarting: vi.fn(async () => ({
          id: attemptId,
          status: 'starting',
          lease_owner: 'local-launcher:1',
          lease_generation: 0,
        })),
      },
      leaseOwner: 'local-launcher:1',
    });
    const input = {
      attempt: {
        id: attemptId,
        run_id: runId,
        hop: 2,
        role: 'generator',
        lease_generation: 0,
      },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: [], stdin: '{}', env: {} },
      task: observed.task,
    };

    const receipt = await launcher.launch(input);

    expect(receipt).toEqual({
      actualMachineId: 'us-mac-m4',
      executionTransport: 'local-docker',
      remoteJobId: null,
      attestationStatus: 'local',
      containerId: 'cecelia-harness-22222222-g0',
      jobId: null,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    await expect(launcher.cancel({
      attempt: input.attempt,
      target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
      launchReceipt: receipt,
    })).resolves.toEqual({
      status: 'cancelled',
      containerId: 'cecelia-harness-22222222-g0',
    });
    expect(removeContainer).toHaveBeenCalledWith('cecelia-harness-22222222-g0');
    await expect(launcher.inspect({
      attempt: input.attempt,
      target: { machine: 'us-mac-m4' },
    })).resolves.toEqual({
      status: 'unsupported',
      reason: 'local_inspection_unavailable',
    });
  });

  it('rejects a mismatched local receipt without deleting either untrusted or other-generation IDs', async () => {
    const removeContainer = vi.fn(async () => true);
    const launcher = createDetachedLauncher({
      spawnDetached: vi.fn(),
      removeContainer,
      attemptStore: { markStarting: vi.fn() },
    });

    await expect(launcher.cancel({
      attempt: {
        id: attemptId,
        lease_generation: 2,
      },
      launchReceipt: {
        containerId: 'cecelia-harness-22222222-g3',
      },
    })).resolves.toEqual({
      status: 'rejected',
      reason: 'local_container_id_mismatch',
      containerId: 'cecelia-harness-22222222-g2',
    });
    expect(removeContainer).not.toHaveBeenCalled();
  });

  it('an old generation cancel cannot delete the current generation container', async () => {
    const removeContainer = vi.fn(async (containerId) => containerId.endsWith('-g1'));
    const launcher = createDetachedLauncher({
      spawnDetached: vi.fn(),
      removeContainer,
      attemptStore: { markStarting: vi.fn() },
    });

    await expect(launcher.cancel({
      attempt: {
        id: attemptId,
        lease_generation: 0,
      },
      launchReceipt: {
        containerId: 'cecelia-harness-22222222-g0',
      },
    })).resolves.toEqual({
      status: 'missing',
      containerId: 'cecelia-harness-22222222-g0',
    });
    expect(removeContainer).toHaveBeenCalledTimes(1);
    expect(removeContainer).toHaveBeenCalledWith('cecelia-harness-22222222-g0');
  });

  it('把 proposer/reviewer 的分支协议注入 runner env', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore: { markStarting: vi.fn(async () => ({ status: 'starting' })) },
    });

    await launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 17, role: 'proposer' },
      bundle: {
        inputs: {
          task_id: taskId,
          worktree_path: '/tmp/worktree',
          sprint_dir: 'sprints/provider-neutral',
          contract_round: 2,
          propose_branch: 'cp-harness-propose-r2-aaaaaaaa-a17',
          contract_branch: 'cp-harness-propose-r1-aaaaaaaa-a3',
        },
        constraints: { read_only: false },
      },
      spec: { provider: 'claude', args: [], stdin: '{}', env: {} },
      task: observed.task,
    });

    expect(spawnDetached).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
        PROPOSE_ROUND: '2',
        PROPOSE_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
        CONTRACT_BRANCH: 'cp-harness-propose-r1-aaaaaaaa-a3',
      }),
    }));
    expect(spawnDetached.mock.calls[0][0].env.BRAIN_RESULT_FILE).toBeUndefined();
  });

  it('evaluator 以可写工作树进入 runner，但远端 Git 写入被执行层阻断', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore: { markStarting: vi.fn(async () => ({ status: 'starting' })) },
    });

    await launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 7, role: 'evaluator' },
      bundle: {
        inputs: {
          task_id: taskId,
          worktree_path: '/tmp/worktree',
          pr_branch: 'cp-evaluator-target',
          pr_head_sha: 'sha-1',
        },
        constraints: { read_only: false },
      },
      spec: { provider: 'claude', args: [], stdin: '{}', env: {} },
      task: observed.task,
    });

    expect(spawnDetached).toHaveBeenCalledWith(expect.objectContaining({
      readOnlyWorktree: false,
      env: expect.objectContaining({
        HARNESS_READ_ONLY: 'false',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'remote.origin.pushurl',
        GIT_CONFIG_VALUE_0: 'blocked-by-harness://evaluator',
        BRAIN_RESULT_FILE: '/tmp/cecelia-prompts/brain-result.json',
        PR_BRANCH: 'cp-evaluator-target',
        PR_HEAD_SHA: 'sha-1',
      }),
    }));
  });

  it('generator 保留 Git push 能力', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore: { markStarting: vi.fn(async () => ({ status: 'starting' })) },
    });

    await launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 8, role: 'generator' },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: [], stdin: '{}', env: {} },
      task: observed.task,
    });

    const env = spawnDetached.mock.calls[0][0].env;
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_0).toBeUndefined();
  });

  it('把同一 bundle task_id 注入 generator 的 Cecelia 与 harness 任务环境', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore: { markStarting: vi.fn(async () => ({ status: 'starting' })) },
    });

    await launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 8, role: 'generator' },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: [], stdin: '{}', env: {} },
      task: observed.task,
    });

    const { env } = spawnDetached.mock.calls[0][0];
    expect(env.CECELIA_TASK_ID).toBe(taskId);
    expect(env.HARNESS_TASK_ID).toBe(taskId);
  });

  it('docker launch 失败只用当前 lease owner 标记 attempt failed', async () => {
    const attemptStore = {
      markStarting: vi.fn(async () => ({ status: 'starting' })),
      fail: vi.fn(async () => ({ deduped: false })),
    };
    const launcher = createDetachedLauncher({
      spawnDetached: vi.fn(async () => { throw new Error('docker unavailable'); }),
      attemptStore,
      leaseOwner: 'brain-1:123',
    });

    await expect(launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 2, role: 'generator' },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', args: ['exec'], stdin: '{}', env: {} },
      task: observed.task,
    })).rejects.toThrow('docker unavailable');

    expect(attemptStore.fail).toHaveBeenCalledWith(attemptId, {
      code: 'launch_failed',
      message: 'docker unavailable',
    }, {
      leaseOwner: 'brain-1:123',
      leaseGeneration: 0,
    });
  });

  it('把 attempt/run/hop/role 作为 runner env 和 Docker labels 传递', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const attemptStore = { markStarting: vi.fn(async () => ({ status: 'starting' })) };
    const launcher = createDetachedLauncher({ spawnDetached, attemptStore, brainUrl: 'http://brain:5221' });
    const attempt = {
      id: attemptId,
      run_id: runId,
      hop: 6,
      role: 'evaluator',
      callbackSecret: 'attempt-secret',
    };
    const bundle = {
      ...observed,
      inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
      constraints: { read_only: true },
    };

    await launcher.launch({
      attempt,
      bundle,
      spec: {
        provider: 'codex',
        args: ['exec', '--model', 'configured-model'],
        stdin: '{"bundle":true}',
        env: { CODEX_HOME: '/host/codex-team' },
      },
      task: observed.task,
    });

    expect(attemptStore.markStarting).toHaveBeenCalledWith(attemptId, expect.objectContaining({
      leaseOwner: expect.any(String),
    }));
    expect(spawnDetached).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '{"bundle":true}',
      readOnlyWorktree: true,
      labels: {
        'cecelia.run_id': runId,
        'cecelia.hop': '6',
        'cecelia.role': 'evaluator',
        'cecelia.attempt_id': attemptId,
      },
      extraMounts: ['/host/codex-team:/home/cecelia/.codex:rw'],
      env: expect.objectContaining({
        CECELIA_EXECUTOR: 'codex',
        CODEX_HOME: '/home/cecelia/.codex',
        HARNESS_MODEL: 'configured-model',
        HARNESS_LEASE_OWNER: expect.any(String),
        HARNESS_LEASE_GENERATION: '0',
        HARNESS_ATTEMPT_ID: attemptId,
        HARNESS_CALLBACK_TOKEN: 'attempt-secret',
        HARNESS_RUN_ID: runId,
        HARNESS_READ_ONLY: 'true',
        BRAIN_RESULT_FILE: '/tmp/cecelia-prompts/brain-result.json',
      }),
    }));
    const spawnArgs = spawnDetached.mock.calls[0][0];
    expect(JSON.stringify(spawnArgs.labels)).not.toContain('attempt-secret');
    expect(JSON.stringify(spawnArgs.labels)).not.toMatch(/callback.*token/i);
  });

  it('Claude fresh/resume 共用 attempt 级宿主 session 目录，容器替换后仍可 resume', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const attemptStore = { markStarting: vi.fn(async () => ({ status: 'starting' })) };
    const ensureDir = vi.fn();
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore,
      sessionRoot: '/tmp/harness-sessions',
      ensureDir,
    });
    const attempt = { id: attemptId, run_id: runId, hop: 2, role: 'reviewer' };
    const bundle = {
      inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
      constraints: { read_only: true },
    };

    await launcher.launch({
      attempt,
      bundle,
      spec: { provider: 'claude', args: ['-p'], stdin: '{}', env: {} },
      task: observed.task,
    });

    expect(ensureDir).toHaveBeenCalledWith(
      `/tmp/harness-sessions/${attemptId}/projects`,
      { recursive: true, mode: 0o700 },
    );
    expect(ensureDir).toHaveBeenCalledWith(
      `/tmp/harness-sessions/${attemptId}/sessions`,
      { recursive: true, mode: 0o700 },
    );
    expect(spawnDetached).toHaveBeenCalledWith(expect.objectContaining({
      extraMounts: [
        `/tmp/harness-sessions/${attemptId}/projects:/home/cecelia/.claude/projects:rw`,
        `/tmp/harness-sessions/${attemptId}/sessions:/home/cecelia/.claude/sessions:rw`,
      ],
    }));
  });

  it('resume 使用带代次的新容器名，并在 launch 前清除同名残留', async () => {
    const order = [];
    const removeContainer = vi.fn(async (name) => {
      order.push(`remove:${name}`);
    });
    const spawnDetached = vi.fn(async ({ containerId }) => {
      order.push(`spawn:${containerId}`);
      return { containerId };
    });
    const launcher = createDetachedLauncher({
      spawnDetached,
      removeContainer,
      attemptStore: { markStarting: vi.fn() },
      leaseOwner: 'watchdog:test',
    });

    await launcher.launch({
      attempt: {
        id: attemptId,
        run_id: runId,
        hop: 2,
        role: 'evaluator',
        lease_owner: 'watchdog:test',
        lease_generation: 3,
      },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: true },
      },
      spec: { provider: 'codex', args: ['exec', 'resume', 'thread-1'], stdin: '{}', env: {} },
      task: observed.task,
      leaseClaimed: true,
      generation: 3,
    });

    expect(order).toEqual([
      'remove:cecelia-harness-22222222-g3',
      'spawn:cecelia-harness-22222222-g3',
    ]);
  });

  it('launcher 只挂 Grok 认证与会话，不把宿主 Mach-O CLI 挂进 Linux 容器', async () => {
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore: { markStarting: vi.fn(async () => ({ status: 'starting' })) },
    });
    const base = {
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: true },
      },
      task: observed.task,
    };

    await launcher.launch({
      ...base,
      attempt: { id: attemptId, run_id: runId, hop: 2, role: 'evaluator' },
      spec: { provider: 'claude', args: [], stdin: '{}', env: { CLAUDE_CONFIG_DIR: '/accounts/claude/account2' } },
    });
    await launcher.launch({
      ...base,
      attempt: { id: '33333333-3333-4333-8333-333333333333', run_id: runId, hop: 3, role: 'evaluator' },
      spec: { provider: 'grok', args: [], stdin: '{}', env: { GROK_HOME: '/accounts/grok/grok' } },
    });

    expect(spawnDetached.mock.calls[0][0]).toMatchObject({
      env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/accounts/claude/account2' }),
    });
    expect(spawnDetached.mock.calls[0][0].extraMounts).not.toContain(
      '/accounts/claude/account2:/host-claude-config:ro',
    );
    expect(spawnDetached.mock.calls[1][0]).toMatchObject({
      extraMounts: [
        '/accounts/grok/grok/auth.json:/home/cecelia/.grok/auth.json:rw',
        '/accounts/grok/grok/sessions:/home/cecelia/.grok/sessions:rw',
      ],
      env: expect.objectContaining({ GROK_HOME: '/home/cecelia/.grok' }),
    });
    expect(spawnDetached.mock.calls[1][0].extraMounts).not.toContain(
      '/accounts/grok/grok:/home/cecelia/.grok:rw',
    );
  });

  it('Claude launcher 与 buildDockerArgs 组合后只挂一次配置目录', async () => {
    let built;
    const spawnDetached = vi.fn(async (opts) => {
      built = buildDockerArgs(opts, {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      });
      return { containerId: opts.containerId };
    });
    const launcher = createDetachedLauncher({
      spawnDetached,
      attemptStore: { markStarting: vi.fn(async () => ({ status: 'starting' })) },
      ensureDir: vi.fn(),
      sessionRoot: '/tmp/harness-sessions',
    });

    await launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 2, role: 'planner' },
      bundle: {
        inputs: { task_id: taskId, worktree_path: '/tmp/worktree' },
        constraints: { read_only: false },
      },
      spec: {
        provider: 'claude',
        args: [],
        stdin: '{}',
        env: { CLAUDE_CONFIG_DIR: '/accounts/claude/account1' },
      },
      task: observed.task,
    });

    const mounts = built.args.flatMap((arg, index, args) => (
      args[index - 1] === '-v' ? [arg] : []
    ));
    expect(mounts.filter((mount) => mount.includes(':/host-claude-config:'))).toEqual([
      '/accounts/claude/account1:/host-claude-config:ro',
    ]);
  });
});
