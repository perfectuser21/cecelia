import { describe, expect, it, vi } from 'vitest';

import {
  createDetachedLauncher,
  createDispatcher,
  resolveAction,
} from '../dispatcher.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

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
      fail: vi.fn(),
    },
    registry: {
      resolve: vi.fn(() => adapter),
    },
    launcher: {
      launch: vi.fn(async () => {
        order.push('launcher.launch');
        return { containerId: 'container-1' };
      }),
    },
    loadSkill: vi.fn(fakeSkill),
    randomUUID: () => attemptId,
    machineId: 'brain-1',
  };
}

describe('resolveAction', () => {
  it.each([
    ['spawn:planner', 'planner', 'harness-planner'],
    ['spawn:proposer', 'proposer', 'harness-contract-proposer'],
    ['spawn:reviewer', 'reviewer', 'harness-contract-reviewer'],
    ['spawn:generator', 'generator', 'harness-generator'],
    ['spawn:generator-fix', 'generator', 'harness-generator'],
    ['spawn:evaluator', 'evaluator', 'harness-evaluator'],
    ['spawn:judge', 'judge', null],
  ])('%s 映射为隔离的 %s/%s', (action, role, skill) => {
    expect(resolveAction(action)).toMatchObject({ role, skill });
  });

  it('未知 action fail-fast', () => {
    expect(() => resolveAction('spawn:magic')).toThrow(/unsupported action/);
  });
});

describe('createDispatcher', () => {
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

    expect(order).toEqual(['attempt.create', 'adapter.start', 'launcher.launch']);
    expect(result).toMatchObject({ status: 'DONE', attemptId, provider: 'codex' });
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
    expect(created.bundle.inputs).toMatchObject({ contract_branch: 'cp-propose-r1' });
  });

  it('launch 失败会把 attempt 记为 failed 后再抛出', async () => {
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
      message: 'docker unavailable',
    });
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
  it('把 attempt/run/hop/role 作为 runner env 和 Docker labels 传递', async () => {
    const spawnDetached = vi.fn(async () => ({ containerId: 'cx' }));
    const attemptStore = { markStarting: vi.fn(async () => ({ status: 'starting' })) };
    const launcher = createDetachedLauncher({ spawnDetached, attemptStore, brainUrl: 'http://brain:5221' });
    const attempt = { id: attemptId, run_id: runId, hop: 6, role: 'evaluator' };
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
        HARNESS_ATTEMPT_ID: attemptId,
        HARNESS_RUN_ID: runId,
        HARNESS_READ_ONLY: 'true',
      }),
    }));
  });
});
