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
    createCallbackSecret: () => 'attempt-secret',
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
    expect(created.bundle.inputs).toMatchObject({ contract_branch: 'cp-propose-r1' });
  });

  it('按 role_assignments 为同一 run 的 generator/evaluator 选择不同 provider 与账户 home', async () => {
    const attempts = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    const adapters = Object.fromEntries(['codex', 'claude'].map((provider) => [provider, {
      name: provider,
      start: vi.fn(({ execution }) => ({ provider, args: [], env: {}, stdin: '{}', execution })),
    }]));
    const attemptStore = {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
      fail: vi.fn(),
    };
    const launcher = { launch: vi.fn(async () => ({ containerId: 'cx' })) };
    const payload = {
      executor: 'grok',
      sprint_dir: 'sprints/provider-neutral',
      worktree_path: '/tmp/worktree',
      role_assignments: {
        generator: { provider: 'codex', account: 'team3' },
        evaluator: { provider: 'claude', account: 'account2' },
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
      execution: expect.objectContaining({ claudeHome: '/accounts/claude/account2' }),
    }));
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
    // launcher 持有 lease owner，只有 launcher 能做带 fence 的失败落库；
    // dispatcher 不得用无 lease 的 fail 覆盖已被接管的 attempt。
    expect(deps.attemptStore.fail).not.toHaveBeenCalled();
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
    }, { leaseOwner: 'brain-1:123' });
  });

  it('把 attempt/run/hop/role 作为 runner env 和 Docker labels 传递', async () => {
    const spawnDetached = vi.fn(async () => ({ containerId: 'cx' }));
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
        HARNESS_ATTEMPT_ID: attemptId,
        HARNESS_CALLBACK_TOKEN: 'attempt-secret',
        HARNESS_RUN_ID: runId,
        HARNESS_READ_ONLY: 'true',
      }),
    }));
    const spawnArgs = spawnDetached.mock.calls[0][0];
    expect(JSON.stringify(spawnArgs.labels)).not.toContain('attempt-secret');
    expect(JSON.stringify(spawnArgs.labels)).not.toMatch(/callback.*token/i);
  });

  it('Claude fresh/resume 共用 attempt 级宿主 session 目录，容器替换后仍可 resume', async () => {
    const spawnDetached = vi.fn(async () => ({ containerId: 'claude-cx' }));
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
    });

    await launcher.launch({
      attempt: { id: attemptId, run_id: runId, hop: 2, role: 'evaluator' },
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

  it('launcher 把 Claude/Grok 指定账户 home 挂到各自容器凭据目录', async () => {
    const spawnDetached = vi.fn(async () => ({ containerId: 'cx' }));
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
      extraMounts: expect.arrayContaining(['/accounts/claude/account2:/host-claude-config:ro']),
      env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/home/cecelia/.claude' }),
    });
    expect(spawnDetached.mock.calls[1][0]).toMatchObject({
      extraMounts: ['/accounts/grok/grok:/home/cecelia/.grok:rw'],
      env: expect.objectContaining({ GROK_HOME: '/home/cecelia/.grok' }),
    });
  });
});
