'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const WORKER_ID = 'us-mac-m4';
const IMAGE_DIGEST = `cecelia/runner@sha256:${'a'.repeat(64)}`;

function loadAttemptRunner() {
  return require('./attempt-runner.cjs');
}

function request(overrides = {}) {
  return {
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    lease_owner: 'dispatcher-1',
    lease_generation: 0,
    workspace_spec: {
      repo: 'perfectuser21/cecelia',
      base_sha: '0123456789abcdef0123456789abcdef01234567',
      branch: 'cp-07272050-attempt-runner',
      expected_head_sha: null,
      mode: 'read-write',
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
    },
    provider_spec: {
      provider: 'codex',
      command: 'codex',
      args: ['exec', '--json'],
      stdin: 'perform the bounded task',
      output: { format: 'jsonl' },
    },
    target: {
      machine: WORKER_ID,
      provider: 'codex',
      account: 'team1',
      model: 'gpt-5',
      role: 'generator',
    },
    callback_url: 'http://brain.internal:5221/api/brain/harness/callback',
    callback_token: 'callback-secret',
    ...overrides,
  };
}

function inMemoryStateStore(initial = []) {
  const states = new Map(initial.map((entry) => [entry.attempt_id, { ...entry }]));
  return {
    save: vi.fn(async (entry) => {
      states.set(entry.attempt_id, { ...entry });
      return entry;
    }),
    get: vi.fn(async (attemptId) => states.get(attemptId) ?? null),
    delete: vi.fn(async (attemptId) => states.delete(attemptId)),
    list: vi.fn(async () => [...states.values()].map((entry) => ({ ...entry }))),
    states,
  };
}

function dependencies(overrides = {}) {
  const events = [];
  const pendingWait = new Promise(() => {});
  const workspace = {
    path: '/controlled/worktrees/22222222-2222-4222-8222-222222222222',
    mirror_path: '/controlled/mirrors/perfectuser21__cecelia.git',
    mode: 'read-write',
    head_sha: '0123456789abcdef0123456789abcdef01234567',
    owner: { run_id: RUN_ID, attempt_id: ATTEMPT_ID },
  };
  const workspaceManager = {
    prepare: vi.fn(async () => {
      events.push('workspace.prepare');
      return workspace;
    }),
    verify: vi.fn(async () => ({ status: 'verified', head_sha: workspace.head_sha })),
    cleanup: vi.fn(async () => {
      events.push('workspace.cleanup');
      return { status: 'cleaned', attempt_id: ATTEMPT_ID };
    }),
    quarantine: vi.fn(async (_workspace, reason) => {
      events.push('workspace.quarantine');
      return {
        status: 'quarantined',
        attempt_id: ATTEMPT_ID,
        reason: String(reason?.message ?? reason),
      };
    }),
  };
  const docker = {
    launch: vi.fn(async () => {
      events.push('docker.launch');
      return { containerId: 'container-attempt-1' };
    }),
    inspect: vi.fn(async () => ({ status: 'running' })),
    remove: vi.fn(async () => {
      events.push('docker.remove');
      return { removed: true };
    }),
    wait: vi.fn(async () => pendingWait),
    listOwned: vi.fn(async () => []),
  };
  return {
    workspace,
    workspaceManager,
    docker,
    stateStore: inMemoryStateStore(),
    events,
    ...overrides,
  };
}

function createRunner(deps) {
  const { createAttemptRunner } = loadAttemptRunner();
  return createAttemptRunner({
    workspaceManager: deps.workspaceManager,
    docker: deps.docker,
    stateStore: deps.stateStore,
    workerId: WORKER_ID,
    runnerImageDigest: IMAGE_DIGEST,
  });
}

describe('Fleet Worker Attempt runner', () => {
  it.each([
    ['read-only', true],
    ['read-write', false],
  ])('mounts a %s workspace with an explicit outer access mode', async (
    mode,
    readOnly,
  ) => {
    const deps = dependencies();
    deps.workspaceManager.prepare.mockImplementationOnce(async () => {
      deps.events.push('workspace.prepare');
      return {
        ...deps.workspace,
        mode,
      };
    });
    const runner = createRunner(deps);

    await runner.launch(request({
      workspace_spec: {
        ...request().workspace_spec,
        mode,
      },
    }));

    expect(deps.events.slice(0, 2)).toEqual([
      'workspace.prepare',
      'docker.launch',
    ]);
    expect(deps.docker.launch).toHaveBeenCalledWith(expect.objectContaining({
      image: IMAGE_DIGEST,
      workspaceMount: {
        source: deps.workspace.path,
        target: '/workspace',
        readOnly,
      },
      labels: {
        'cecelia.fleet.attempt_id': ATTEMPT_ID,
        'cecelia.fleet.run_id': RUN_ID,
        'cecelia.fleet.worker_id': WORKER_ID,
      },
      role: 'generator',
      model: 'gpt-5',
    }));
  });

  it('rejects caller-owned cwd and mounts before Git or Docker side effects', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(runner.launch(request({
      provider_spec: {
        ...request().provider_spec,
        cwd: '/Users/operator/perfect21/cecelia',
        mounts: ['/tmp:/workspace:rw'],
      },
    }))).rejects.toThrow(/attempt_provider_spec_unknown_field/);
    expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    expect(deps.docker.launch).not.toHaveBeenCalled();
  });

  it('terminal cleanup removes the container before its worktree and state', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'cleaned',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.events.slice(-2)).toEqual([
      'docker.remove',
      'workspace.cleanup',
    ]);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
    });
    expect(deps.stateStore.delete).toHaveBeenCalledWith(ATTEMPT_ID);
  });

  it('automatically performs terminal cleanup after the owned container exits', async () => {
    let resolveExit;
    const containerExit = new Promise((resolve) => {
      resolveExit = resolve;
    });
    const deps = dependencies();
    deps.docker.wait.mockReturnValueOnce(containerExit);
    const runner = createRunner(deps);

    await runner.launch(request());
    resolveExit({ statusCode: 0 });

    await vi.waitFor(() => {
      expect(deps.stateStore.delete).toHaveBeenCalledWith(ATTEMPT_ID);
    });
    expect(deps.events.slice(-2)).toEqual([
      'docker.remove',
      'workspace.cleanup',
    ]);
  });

  it('quarantines the workspace and retains evidence when container cleanup fails', async () => {
    const deps = dependencies();
    deps.docker.remove.mockRejectedValueOnce(new Error('docker remove failed'));
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'quarantined',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.workspaceManager.quarantine).toHaveBeenCalledOnce();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID).status).toBe('quarantined');
  });

  it('restart reconciliation cleans owned orphans without deleting another Attempt', async () => {
    const ownedOrphan = {
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      worker_id: WORKER_ID,
      container_id: 'missing-owned-container',
      workspace: dependencies().workspace,
      status: 'running',
    };
    const healthyAttempt = {
      attempt_id: OTHER_ATTEMPT_ID,
      run_id: RUN_ID,
      worker_id: WORKER_ID,
      container_id: 'healthy-container',
      workspace: {
        ...dependencies().workspace,
        path: `/controlled/worktrees/${OTHER_ATTEMPT_ID}`,
        owner: { run_id: RUN_ID, attempt_id: OTHER_ATTEMPT_ID },
      },
      status: 'running',
    };
    const foreignAttempt = {
      ...healthyAttempt,
      attempt_id: '44444444-4444-4444-8444-444444444444',
      worker_id: 'xian-mac-m4',
      container_id: 'foreign-container',
    };
    const stateStore = inMemoryStateStore([
      ownedOrphan,
      healthyAttempt,
      foreignAttempt,
    ]);
    const deps = dependencies({ stateStore });
    deps.docker.inspect.mockImplementation(async ({ containerId }) => {
      if (containerId === 'missing-owned-container') return { status: 'missing' };
      return { status: 'running' };
    });
    deps.docker.listOwned.mockResolvedValueOnce([
      {
        containerId: 'unrecorded-owned-container',
        labels: {
          'cecelia.fleet.attempt_id': '55555555-5555-4555-8555-555555555555',
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
      },
      {
        containerId: 'unrecorded-foreign-container',
        labels: {
          'cecelia.fleet.attempt_id': '66666666-6666-4666-8666-666666666666',
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': 'xian-mac-m4',
        },
      },
    ]);
    const runner = createRunner(deps);

    const result = await runner.reconcile();

    expect(result).toMatchObject({
      cleaned_attempts: [ATTEMPT_ID],
      removed_orphan_containers: ['unrecorded-owned-container'],
    });
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledWith(ownedOrphan.workspace);
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalledWith(healthyAttempt.workspace);
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalledWith(foreignAttempt.workspace);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'unrecorded-owned-container',
      attemptId: '55555555-5555-4555-8555-555555555555',
    });
    expect(deps.docker.remove).not.toHaveBeenCalledWith({
      containerId: 'unrecorded-foreign-container',
    });
    expect(stateStore.states.has(OTHER_ATTEMPT_ID)).toBe(true);
    expect(stateStore.states.has(foreignAttempt.attempt_id)).toBe(true);
  });
});

describe('Fleet Worker durable runtime adapters', () => {
  it('removes the container and runtime when Docker omits the created id', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));
    const runCommand = vi.fn(async () => ({ stdout: '' }));
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await expect(docker.launch({
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        role: 'generator',
        model: 'gpt-5',
        workspaceMount: {
          source: `/controlled/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: true,
        },
        labels: {
          'cecelia.fleet.attempt_id': ATTEMPT_ID,
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
        callback: {
          url: request().callback_url,
          token: request().callback_token,
        },
        lease: { owner: 'dispatcher-1', generation: 0 },
      })).rejects.toThrow(/attempt_container_id_missing/);

      expect(runCommand).toHaveBeenCalledWith(
        'docker',
        ['rm', '-f', '--', `cecelia-fleet-${ATTEMPT_ID}`],
        undefined,
      );
      expect(fs.existsSync(path.join(runtimeRoot, ATTEMPT_ID))).toBe(false);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('builds a pinned Docker launch with only Worker-owned mounts', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'create') return { stdout: 'container-created\n' };
      return { stdout: '' };
    });
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await expect(docker.launch({
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        role: 'generator',
        model: 'gpt-5',
        workspaceMount: {
          source: `/controlled/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: true,
        },
        labels: {
          'cecelia.fleet.attempt_id': ATTEMPT_ID,
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
        callback: {
          url: request().callback_url,
          token: request().callback_token,
        },
        lease: { owner: 'dispatcher-1', generation: 0 },
      })).resolves.toEqual({ containerId: 'container-created' });

      const [command, createArgs] = runCommand.mock.calls[0];
      expect(command).toBe('docker');
      expect(createArgs[0]).toBe('create');
      expect(createArgs).toContain(IMAGE_DIGEST);
      expect(createArgs).toContain(
        `type=bind,src=/controlled/worktrees/${ATTEMPT_ID},dst=/workspace,readonly`,
      );
      expect(createArgs.join(' ')).not.toContain('/Users/operator');
      expect(createArgs).toEqual(expect.arrayContaining([
        '--label', `cecelia.fleet.attempt_id=${ATTEMPT_ID}`,
        '--label', `cecelia.fleet.run_id=${RUN_ID}`,
        '--label', `cecelia.fleet.worker_id=${WORKER_ID}`,
        '--env', 'HARNESS_NODE=generator',
        '--env', 'HARNESS_MODEL=gpt-5',
      ]));
      expect(runCommand.mock.calls[1]).toEqual([
        'docker',
        ['start', 'cecelia-fleet-22222222-2222-4222-8222-222222222222'],
        undefined,
      ]);
      const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
      expect(fs.existsSync(attemptRuntime)).toBe(true);

      await docker.remove({
        containerId: 'container-created',
        attemptId: ATTEMPT_ID,
      });

      expect(fs.existsSync(attemptRuntime)).toBe(false);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('persists bounded Attempt state atomically without execution secrets', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-store-'));
    const store = createFileAttemptStateStore({ stateRoot });
    const state = {
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      worker_id: WORKER_ID,
      container_id: 'container-1',
      status: 'running',
      workspace: {
        path: `/controlled/worktrees/${ATTEMPT_ID}`,
        owner: { run_id: RUN_ID, attempt_id: ATTEMPT_ID },
      },
    };

    try {
      await store.save(state);

      await expect(store.get(ATTEMPT_ID)).resolves.toEqual(state);
      await expect(store.list()).resolves.toEqual([state]);
      const files = fs.readdirSync(stateRoot);
      expect(files).toEqual([`${ATTEMPT_ID}.json`]);
      const persisted = fs.readFileSync(path.join(stateRoot, files[0]), 'utf8');
      expect(persisted).not.toMatch(/callback_token|authorization|stdin|prompt/i);

      await store.delete(ATTEMPT_ID);
      await expect(store.get(ATTEMPT_ID)).resolves.toBeNull();
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });
});
