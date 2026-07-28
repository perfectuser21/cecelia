'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = 'task-true-id';
const WORKER_ID = 'us-mac-m4';
const IMAGE_DIGEST = `cecelia/runner@sha256:${'a'.repeat(64)}`;
const BRAIN_URL = 'http://brain.internal:5221';
const RESULT_CHANNEL = Object.freeze({
  version: 'attempt-result-file/v1',
  path: `/tmp/cecelia-prompts/${ATTEMPT_ID}.result.json`,
  max_bytes: 1024 * 1024,
  bindings: Object.freeze({
    task_id: TASK_ID,
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    role: 'generator',
  }),
});
const CREDENTIAL_ENVELOPE = Object.freeze({
  contract_version: 'credential-envelope/v1',
  credential_ref: '33333333-3333-4333-8333-333333333333',
  attempt_id: ATTEMPT_ID,
  account_id: 'team1',
  machine_id: WORKER_ID,
  issued_at: '2026-07-27T12:00:00.000Z',
  expires_at: '2026-07-27T14:00:00.000Z',
  payload_hash: `sha256:${'b'.repeat(64)}`,
  payload: 'sensitive-base64-payload',
});
const CREDENTIAL = Object.freeze({
  credentialRef: CREDENTIAL_ENVELOPE.credential_ref,
  accountId: 'team1',
  authJson: '{"tokens":{"access_token":"sensitive-access-token"}}',
  metadata: Object.freeze({
    credential_ref: CREDENTIAL_ENVELOPE.credential_ref,
    attempt_id: ATTEMPT_ID,
    account_id: 'team1',
    machine_id: WORKER_ID,
    issued_at: CREDENTIAL_ENVELOPE.issued_at,
    expires_at: CREDENTIAL_ENVELOPE.expires_at,
    payload_hash: CREDENTIAL_ENVELOPE.payload_hash,
  }),
});
const CANONICAL_RESULT = Buffer.from(JSON.stringify({
  contract_version: '1.0',
  attempt_id: ATTEMPT_ID,
  status: 'completed',
  summary: 'done',
  artifacts: [],
  checks: [],
  decision: {
    outcome: 'DONE',
    reason: '',
  },
  error: null,
  provider_metadata: {
    provider: 'codex',
    session_id: 'thread-1',
    credential_ref: CREDENTIAL_ENVELOPE.credential_ref,
    credential_copy_mutated: false,
  },
}), 'utf8');
const DELIVERY_METADATA = Object.freeze({
  delivery_id: '55555555-5555-4555-8555-555555555555',
  result_nonce: '66666666-6666-4666-8666-666666666666',
  result_sha256: createHash('sha256').update(CANONICAL_RESULT).digest('hex'),
  result_bytes: CANONICAL_RESULT.length,
  terminal_status: 'completed',
});
const RESULT_RECEIPT = Object.freeze({
  schema_version: 'fleet-attempt-result-receipt/v1',
  receipt_id: '77777777-7777-4777-8777-777777777777',
  receipt_status: 'accepted',
  persisted_at: '2026-07-28T01:00:00.000Z',
  ...DELIVERY_METADATA,
});

function durableState(overrides = {}) {
  return {
    schema_version: 'fleet-attempt-state/v2',
    attempt_id: ATTEMPT_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    worker_id: WORKER_ID,
    lease_owner: 'dispatcher-1',
    lease_generation: 0,
    provider: 'codex',
    brain_url: BRAIN_URL,
    result_channel: RESULT_CHANNEL,
    credential: CREDENTIAL.metadata,
    container_id: 'container-1',
    workspace: {
      repo: 'perfectuser21/cecelia',
      branch: 'cp-07272050-attempt-runner',
      base_sha: '0123456789abcdef0123456789abcdef01234567',
      expected_head_sha: null,
      path: `/controlled/worktrees/${ATTEMPT_ID}`,
      mirror_path: '/controlled/mirrors/perfectuser21__cecelia.git',
      admin_path: `/controlled/worktrees/.admin/${ATTEMPT_ID}.git`,
      mode: 'read-write',
      head_sha: '0123456789abcdef0123456789abcdef01234567',
      owner: { run_id: RUN_ID, attempt_id: ATTEMPT_ID },
    },
    labels: {
      'cecelia.fleet.attempt_id': ATTEMPT_ID,
      'cecelia.fleet.run_id': RUN_ID,
      'cecelia.fleet.worker_id': WORKER_ID,
    },
    status: 'running',
    created_at: '2026-07-28T01:00:00.000Z',
    updated_at: '2026-07-28T01:00:00.000Z',
    ...overrides,
  };
}

function loadAttemptRunner() {
  return require('./attempt-runner.cjs');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function request(overrides = {}) {
  return {
    attempt_id: ATTEMPT_ID,
    task_id: TASK_ID,
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
    result_channel: RESULT_CHANNEL,
    brain_url: BRAIN_URL,
    credential_envelope: CREDENTIAL_ENVELOPE,
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
    admin_path: '/controlled/worktrees/.admin/22222222-2222-4222-8222-222222222222.git',
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
    reconcile: vi.fn(async () => ({ cleaned_attempts: [] })),
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
    readResult: vi.fn(async () => {
      events.push('docker.readResult');
      return {
        resultBytes: CANONICAL_RESULT,
        terminalStatus: 'completed',
        session: {
          contract_version: 'provider-session/v1',
          attempt_id: ATTEMPT_ID,
          provider: 'codex',
          session_id: 'thread-1',
        },
      };
    }),
    cleanupRuntime: vi.fn(async () => {
      events.push('docker.cleanupRuntime');
      return { cleaned: true };
    }),
    wait: vi.fn(async () => pendingWait),
    listOwned: vi.fn(async () => []),
  };
  const resultDelivery = {
    prepare: vi.fn(async () => {
      events.push('delivery.prepare');
      return DELIVERY_METADATA;
    }),
    deliver: vi.fn(async () => {
      events.push('delivery.deliver');
      return RESULT_RECEIPT;
    }),
  };
  const credentialConsumer = {
    consume: vi.fn(() => {
      events.push('credential.consume');
      return CREDENTIAL;
    }),
  };
  return {
    workspace,
    workspaceManager,
    docker,
    credentialConsumer,
    resultDelivery,
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
    credentialConsumer: deps.credentialConsumer,
    resultDelivery: deps.resultDelivery,
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

    expect(deps.events.slice(0, 3)).toEqual([
      'credential.consume',
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
      workspaceAdminMount: {
        source: deps.workspace.admin_path,
        target: deps.workspace.admin_path,
        readOnly,
      },
      labels: {
        'cecelia.fleet.attempt_id': ATTEMPT_ID,
        'cecelia.fleet.run_id': RUN_ID,
        'cecelia.fleet.worker_id': WORKER_ID,
      },
      role: 'generator',
      model: 'gpt-5',
      credential: CREDENTIAL,
    }));
  });

  it('consumes and binds the credential before materializing a workspace', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await runner.launch(request());

    expect(deps.credentialConsumer.consume).toHaveBeenCalledWith(
      CREDENTIAL_ENVELOPE,
      {
        attemptId: ATTEMPT_ID,
        accountId: 'team1',
        machineId: WORKER_ID,
      },
    );
    expect(deps.events.slice(0, 2)).toEqual([
      'credential.consume',
      'workspace.prepare',
    ]);
    const state = deps.stateStore.states.get(ATTEMPT_ID);
    expect(state.credential).toEqual(CREDENTIAL.metadata);
    expect(JSON.stringify(state)).not.toContain('sensitive');
    expect(state.credential).not.toHaveProperty('payload');
    expect(JSON.stringify(state)).not.toMatch(/callback|callback-secret/i);
  });

  it('single-flights concurrent launch for the same Attempt identity', async () => {
    const deps = dependencies();
    const prepareGate = deferred();
    deps.workspaceManager.prepare.mockImplementation(async () => {
      deps.events.push('workspace.prepare');
      await prepareGate.promise;
      return deps.workspace;
    });
    const runner = createRunner(deps);

    const first = runner.launch(request());
    await vi.waitFor(() => {
      expect(deps.workspaceManager.prepare).toHaveBeenCalledOnce();
    });
    const second = runner.launch(request());
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.workspaceManager.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.launch).not.toHaveBeenCalled();

    prepareGate.resolve();
    const outcomes = await Promise.allSettled([first, second]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected.reason).toMatchObject({
      message: 'attempt_already_exists',
    });
    expect(deps.workspaceManager.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.launch).toHaveBeenCalledOnce();
  });

  it.each(['claude', 'codex', 'grok'])(
    'carries the same true identity and result channel to the %s Docker seam',
    async (provider) => {
      const deps = dependencies();
      const runner = createRunner(deps);
      const launchRequest = request({
        provider_spec: {
          ...request().provider_spec,
          provider,
          command: provider,
        },
        target: {
          ...request().target,
          provider,
          account: provider === 'codex' ? 'team1' : `${provider}-team1`,
        },
        credential_envelope: provider === 'codex'
          ? CREDENTIAL_ENVELOPE
          : undefined,
      });

      await runner.launch(launchRequest);

      expect(deps.docker.launch).toHaveBeenCalledWith(expect.objectContaining({
        taskId: TASK_ID,
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        brainUrl: BRAIN_URL,
        resultChannel: RESULT_CHANNEL,
      }));
    },
  );

  it('rejects a Codex launch without an envelope before workspace or Docker side effects', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(runner.launch(request({
      credential_envelope: undefined,
    }))).rejects.toThrow('credential_envelope_required');
    expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    expect(deps.docker.launch).not.toHaveBeenCalled();
  });

  it('launches a frozen Codex-labelled canary without requiring or consuming credentials', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    const canaryChannel = {
      ...RESULT_CHANNEL,
      bindings: { ...RESULT_CHANNEL.bindings, role: 'reporter' },
    };
    const canaryBundle = {
      contract_version: '1.0',
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      role: 'reporter',
      skill: null,
      expected_output: 'harness-result/canary-v1',
      inputs: { task_id: TASK_ID },
    };

    await runner.launch(request({
      credential_envelope: undefined,
      target: {
        ...request().target,
        role: 'reporter',
      },
      workspace_spec: {
        ...request().workspace_spec,
        mode: 'read-only',
      },
      result_channel: canaryChannel,
      provider_spec: {
        ...request().provider_spec,
        stdin: JSON.stringify({ instruction: '', task_bundle: canaryBundle }),
      },
    }));

    expect(deps.credentialConsumer.consume).not.toHaveBeenCalled();
    expect(deps.docker.launch).toHaveBeenCalledWith(expect.objectContaining({
      credential: null,
      role: 'reporter',
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

  it.each([
    ['top-level unknown field', { attacker: true }, /attempt_launch_request_unknown_field/],
    ['descriptor unknown field', {
      result_channel: { ...RESULT_CHANNEL, attacker: true },
    }, /attempt_result_channel_unknown_field/],
    ['binding unknown field', {
      result_channel: {
        ...RESULT_CHANNEL,
        bindings: { ...RESULT_CHANNEL.bindings, attacker: true },
      },
    }, /attempt_result_channel_binding_unknown_field/],
    ['target unknown field', {
      target: { ...request().target, attacker: true },
    }, /attempt_target_unknown_field/],
    ['workspace unknown field', {
      workspace_spec: { ...request().workspace_spec, attacker: true },
    }, /attempt_workspace_spec_unknown_field/],
    ['wrong version', {
      result_channel: { ...RESULT_CHANNEL, version: 'attempt-result-file/v2' },
    }, /attempt_result_channel_version_invalid/],
    ['oversized max', {
      result_channel: { ...RESULT_CHANNEL, max_bytes: 1024 * 1024 + 1 },
    }, /attempt_result_channel_max_bytes_invalid/],
    ['path traversal', {
      result_channel: {
        ...RESULT_CHANNEL,
        path: `/tmp/cecelia-prompts/../${ATTEMPT_ID}.result.json`,
      },
    }, /attempt_result_channel_path_mismatch/],
    ['task CRLF', { task_id: `${TASK_ID}\r\nforged` }, /attempt_task_id_invalid/],
    ['task mismatch', { task_id: 'another-task' }, /attempt_result_channel_task_id_mismatch/],
    ['run mismatch', { run_id: OTHER_ATTEMPT_ID }, /attempt_result_channel_run_id_mismatch/],
    ['attempt mismatch', { attempt_id: OTHER_ATTEMPT_ID }, /attempt_result_channel_attempt_id_mismatch/],
    ['worker Brain URL with a path', {
      brain_url: `${BRAIN_URL}/api/brain`,
    }, /attempt_brain_url_invalid/],
    ['provider and target mismatch', {
      provider_spec: { ...request().provider_spec, provider: 'claude' },
    }, /attempt_provider_target_mismatch/],
    ['role mismatch', {
      target: { ...request().target, role: 'reviewer' },
    }, /attempt_result_channel_role_mismatch/],
  ])('rejects %s before credential, workspace, Docker, or state side effects', async (
    _case,
    override,
    error,
  ) => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(runner.launch(request(override))).rejects.toThrow(error);

    expect(deps.credentialConsumer.consume).not.toHaveBeenCalled();
    expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    expect(deps.docker.launch).not.toHaveBeenCalled();
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });

  it('terminal cleanup persists callback_pending before container removal and waits for exact ACK', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'cleaned',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.events.slice(-2)).toEqual([
      'workspace.cleanup',
      'docker.cleanupRuntime',
    ]);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
      preserveRuntime: true,
    });
    const savedStatuses = deps.stateStore.save.mock.calls
      .map(([state]) => state.status);
    expect(savedStatuses).toEqual([
      'running',
      'callback_pending',
      'callback_pending',
      'cleanup_pending',
    ]);
    const callbackPending = deps.stateStore.save.mock.calls[1][0];
    expect(callbackPending.delivery).toEqual(DELIVERY_METADATA);
    expect(JSON.stringify(callbackPending)).not.toContain(
      CANONICAL_RESULT.toString('base64'),
    );
    expect(JSON.stringify(callbackPending)).not.toMatch(
      /authorization|callback_token|kernel-fleet-bridge-secret/i,
    );
    expect(deps.events).toEqual([
      'credential.consume',
      'workspace.prepare',
      'docker.launch',
      'docker.readResult',
      'delivery.prepare',
      'docker.remove',
      'delivery.deliver',
      'workspace.cleanup',
      'docker.cleanupRuntime',
    ]);
    expect(deps.stateStore.delete).toHaveBeenCalledWith(ATTEMPT_ID);
  });

  it('automatically performs receipt-gated cleanup after the owned container exits', async () => {
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
    expect(deps.resultDelivery.deliver).toHaveBeenCalledOnce();
    expect(deps.docker.cleanupRuntime).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
    });
  });

  it('retains result, workspace and state as callback_pending when delivery fails', async () => {
    const deps = dependencies();
    deps.resultDelivery.deliver.mockRejectedValueOnce(new Error('Brain unavailable'));
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'callback_pending',
      attempt_id: ATTEMPT_ID,
    });

    const retained = deps.stateStore.states.get(ATTEMPT_ID);
    expect(retained.status).toBe('callback_pending');
    expect(retained.delivery).toEqual(DELIVERY_METADATA);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
      preserveRuntime: true,
    });
    expect(deps.docker.cleanupRuntime).not.toHaveBeenCalled();
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
  });

  it('rejects cancellation while a durable callback is pending', async () => {
    const deps = dependencies();
    deps.resultDelivery.deliver.mockRejectedValueOnce(new Error('Brain unavailable'));
    const runner = createRunner(deps);
    await runner.launch(request());
    await runner.terminal(ATTEMPT_ID);

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).rejects.toThrow(/attempt_callback_pending/);
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.docker.cleanupRuntime).not.toHaveBeenCalled();
  });

  it('durably fences running cancellation before kill and only reports cancelled after cleanup', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.launch(request());
    deps.events.length = 0;
    deps.stateStore.save.mockClear();
    deps.docker.remove.mockImplementationOnce(async () => {
      deps.events.push('docker.remove');
      expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
        status: 'cancel_pending',
        container_removed: false,
      });
      return { removed: true };
    });

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toEqual({
      status: 'cancelled',
      attempt_id: ATTEMPT_ID,
    });

    expect(deps.stateStore.save.mock.calls.map(([state]) => ({
      status: state.status,
      container_removed: state.container_removed,
    }))).toEqual([
      { status: 'cancel_pending', container_removed: false },
      { status: 'cancel_pending', container_removed: true },
    ]);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
      preserveRuntime: true,
    });
    expect(deps.events).toEqual([
      'docker.remove',
      'workspace.cleanup',
      'docker.cleanupRuntime',
    ]);
    expect(deps.docker.readResult).not.toHaveBeenCalled();
    expect(deps.resultDelivery.prepare).not.toHaveBeenCalled();
    expect(deps.resultDelivery.deliver).not.toHaveBeenCalled();
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
    expect(deps.stateStore.states.has(ATTEMPT_ID)).toBe(false);
  });

  it('retries cancel_pending after kill failure without reading a result', async () => {
    const deps = dependencies();
    deps.docker.remove
      .mockRejectedValueOnce(new Error('docker unavailable'))
      .mockResolvedValueOnce({ removed: true });
    const runner = createRunner(deps);
    await runner.launch(request());
    const lease = { owner: 'dispatcher-1', generation: 0 };

    await expect(runner.cancel(ATTEMPT_ID, lease)).resolves.toEqual({
      status: 'cancel_pending',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'cancel_pending',
      container_removed: false,
    });

    await expect(runner.cancel(ATTEMPT_ID, lease)).resolves.toEqual({
      status: 'cancelled',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.docker.remove).toHaveBeenCalledTimes(2);
    expect(deps.docker.readResult).not.toHaveBeenCalled();
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
  });

  it('restart reconciliation resumes cancel_pending and reports it separately from crashes', async () => {
    const cancelPending = {
      ...durableState(),
      status: 'cancel_pending',
      container_removed: false,
      cancel_requested_at: '2026-07-28T01:01:00.000Z',
    };
    const stateStore = inMemoryStateStore([cancelPending]);
    const deps = dependencies({ stateStore });
    deps.docker.inspect.mockResolvedValueOnce({ status: 'missing' });
    const runner = createRunner(deps);

    await expect(runner.reconcile()).resolves.toMatchObject({
      cleaned_attempts: [],
      cancelled_attempts: [ATTEMPT_ID],
    });

    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: cancelPending.container_id,
      attemptId: ATTEMPT_ID,
      containerMissing: true,
      preserveRuntime: true,
    });
    expect(deps.docker.readResult).not.toHaveBeenCalled();
    expect(deps.resultDelivery.prepare).not.toHaveBeenCalled();
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
    expect(deps.stateStore.states.has(ATTEMPT_ID)).toBe(false);
  });

  it('keeps cancel_pending when cleanup fails and never reports cancelled', async () => {
    const deps = dependencies();
    deps.workspaceManager.cleanup.mockRejectedValueOnce(
      new Error('cleanup unavailable'),
    );
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toEqual({
      status: 'cancel_pending',
      attempt_id: ATTEMPT_ID,
    });

    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'cancel_pending',
      container_removed: true,
    });
    expect(deps.docker.cleanupRuntime).not.toHaveBeenCalled();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
    expect(deps.docker.readResult).not.toHaveBeenCalled();
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
  });

  it('retains cancel_pending quarantine evidence instead of reporting cancelled', async () => {
    const deps = dependencies();
    deps.workspaceManager.cleanup.mockResolvedValueOnce({
      status: 'quarantined',
      attempt_id: ATTEMPT_ID,
      path: `/controlled/quarantine/${ATTEMPT_ID}`,
      admin_path: `/controlled/quarantine/${ATTEMPT_ID}.git`,
      reason: 'attempt_cleanup_failed',
    });
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toEqual({
      status: 'cancel_pending',
      attempt_id: ATTEMPT_ID,
    });

    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'cancel_pending',
      container_removed: true,
      quarantine: {
        status: 'quarantined',
        reason: 'attempt_cleanup_failed',
      },
    });
    expect(deps.docker.cleanupRuntime).not.toHaveBeenCalled();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
  });

  it('rejects cancellation after a cleanup receipt without deleting evidence', async () => {
    const cleanupPending = {
      ...durableState(),
      status: 'cleanup_pending',
      container_removed: true,
      delivery: DELIVERY_METADATA,
      receipt: {
        receipt_id: RESULT_RECEIPT.receipt_id,
        receipt_status: RESULT_RECEIPT.receipt_status,
        persisted_at: RESULT_RECEIPT.persisted_at,
      },
    };
    const deps = dependencies({
      stateStore: inMemoryStateStore([cleanupPending]),
    });
    const runner = createRunner(deps);

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).rejects.toThrow(/attempt_callback_pending/);
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.docker.cleanupRuntime).not.toHaveBeenCalled();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
  });

  it('restart reconciliation replays callback_pending before cleanup', async () => {
    const deps = dependencies();
    deps.resultDelivery.deliver.mockRejectedValueOnce(new Error('Brain unavailable'));
    const runner = createRunner(deps);
    await runner.launch(request());
    await runner.terminal(ATTEMPT_ID);
    deps.events.length = 0;

    await expect(runner.reconcile()).resolves.toMatchObject({
      cleaned_attempts: [ATTEMPT_ID],
    });
    expect(deps.events).toEqual([
      'docker.readResult',
      'delivery.deliver',
      'workspace.cleanup',
      'docker.cleanupRuntime',
    ]);
  });

  it('single-flights Docker wait, explicit terminal and reconcile delivery', async () => {
    const deps = dependencies();
    const waitExit = deferred();
    const deliveryGate = deferred();
    const delivered = [];
    deps.docker.wait.mockReturnValue(waitExit.promise);
    deps.resultDelivery.deliver.mockImplementation(async (input) => {
      deps.events.push('delivery.deliver');
      delivered.push(input);
      return deliveryGate.promise;
    });
    const runner = createRunner(deps);
    await runner.launch(request());

    waitExit.resolve({ statusCode: 0 });
    await vi.waitFor(() => {
      expect(deps.resultDelivery.prepare).toHaveBeenCalledOnce();
      expect(deps.resultDelivery.deliver).toHaveBeenCalledOnce();
    });
    const reconcile = runner.reconcile();
    const explicitTerminal = runner.terminal(ATTEMPT_ID);
    await new Promise((resolve) => setImmediate(resolve));

    expect(deps.resultDelivery.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.remove).toHaveBeenCalledOnce();
    expect(deps.resultDelivery.deliver).toHaveBeenCalledOnce();
    expect(delivered[0].delivery).toEqual(DELIVERY_METADATA);

    deliveryGate.resolve(RESULT_RECEIPT);
    await Promise.all([reconcile, explicitTerminal]);
    await vi.waitFor(() => {
      expect(deps.stateStore.states.has(ATTEMPT_ID)).toBe(false);
    });

    expect(deps.resultDelivery.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.remove).toHaveBeenCalledOnce();
    expect(deps.resultDelivery.deliver).toHaveBeenCalledOnce();
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
  });

  it('quarantines corrupt or missing canonical result without deleting runtime evidence', async () => {
    const deps = dependencies();
    deps.docker.readResult.mockRejectedValueOnce(new Error('attempt_result_missing'));
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'quarantined',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.workspaceManager.quarantine).toHaveBeenCalledOnce();
    expect(deps.docker.cleanupRuntime).not.toHaveBeenCalled();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
  });

  it('persists only a bounded non-secret quarantine reason', async () => {
    const deps = dependencies();
    const secret = `Bearer ${'s'.repeat(400)}`;
    deps.docker.readResult.mockRejectedValueOnce(
      new Error(`authorization=${secret}`),
    );
    const runner = createRunner(deps);
    await runner.launch(request());

    await runner.terminal(ATTEMPT_ID);

    const quarantine = deps.stateStore.states.get(ATTEMPT_ID).quarantine;
    const passedReason = deps.workspaceManager.quarantine.mock.calls[0][1];
    expect(quarantine.reason.length).toBeLessThanOrEqual(256);
    expect(quarantine.reason).not.toContain('authorization');
    expect(quarantine.reason).not.toContain('Bearer');
    expect(quarantine.reason).not.toContain('s'.repeat(32));
    expect(passedReason).toBeInstanceOf(Error);
    expect(passedReason.message).toBe(quarantine.reason);
    expect(passedReason.message.length).toBeLessThanOrEqual(256);
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

  it('rejects stale external cancellation without touching the owned Attempt', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.launch(request());

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'stale-dispatcher',
      generation: 0,
    })).rejects.toThrow(/attempt_lease_conflict/);
    expect(deps.docker.remove).not.toHaveBeenCalled();
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
  });

  it('rolls back the container and workspace when durable state persistence fails', async () => {
    const deps = dependencies();
    deps.stateStore.save.mockRejectedValueOnce(new Error('state write failed'));
    const runner = createRunner(deps);

    await expect(runner.launch(request())).rejects.toThrow(/state write failed/);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
    });
    expect(deps.events.slice(-2)).toEqual([
      'docker.remove',
      'workspace.cleanup',
    ]);
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
    expect(deps.workspaceManager.reconcile).toHaveBeenCalledWith({
      retainedAttemptIds: [
        OTHER_ATTEMPT_ID,
        foreignAttempt.attempt_id,
      ],
    });
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'missing-owned-container',
      attemptId: ATTEMPT_ID,
      containerMissing: true,
      preserveRuntime: true,
    });
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
  it('streams a bounded credential larger than one pipe buffer without truncation', async () => {
    const { __test__ } = loadAttemptRunner();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-credential-fifo-'));
    const fifo = path.join(root, 'credential.fifo');
    execFileSync('mkfifo', [fifo]);
    const authJson = JSON.stringify({
      tokens: {
        access_token: 'x'.repeat(100_000),
      },
    });
    const received = [];
    const reader = fs.createReadStream(fifo);
    reader.on('data', (chunk) => received.push(chunk));
    const readComplete = new Promise((resolve, reject) => {
      reader.once('end', resolve);
      reader.once('error', reject);
    });

    try {
      await Promise.all([
        __test__.defaultWriteCredential(fifo, authJson),
        readComplete,
      ]);
      expect(Buffer.concat(received).toString('utf8')).toBe(authJson);
    } finally {
      reader.destroy();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

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
        workspaceAdminMount: {
          source: '/controlled/mirrors/perfectuser21__cecelia.git',
          target: '/controlled/mirrors/perfectuser21__cecelia.git',
          readOnly: true,
        },
        labels: {
          'cecelia.fleet.attempt_id': ATTEMPT_ID,
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
        taskId: TASK_ID,
        brainUrl: BRAIN_URL,
        resultChannel: RESULT_CHANNEL,
        lease: { owner: 'dispatcher-1', generation: 0 },
        credential: CREDENTIAL,
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

  it('removes an owned runtime without calling Docker when reconciliation proves the container missing', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));
    const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
    fs.mkdirSync(attemptRuntime, { recursive: true });
    fs.writeFileSync(path.join(attemptRuntime, 'task-bundle.json'), 'bounded prompt');
    const runCommand = vi.fn();
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await docker.remove({
        containerId: 'already-missing',
        attemptId: ATTEMPT_ID,
        containerMissing: true,
      });

      expect(runCommand).not.toHaveBeenCalled();
      expect(fs.existsSync(attemptRuntime)).toBe(false);
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
    const writeCredential = vi.fn(async () => undefined);
    const docker = createDockerAdapter({
      runCommand,
      runtimeRoot,
      writeCredential,
    });

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
        workspaceAdminMount: {
          source: '/controlled/mirrors/perfectuser21__cecelia.git',
          target: '/controlled/mirrors/perfectuser21__cecelia.git',
          readOnly: true,
        },
        labels: {
          'cecelia.fleet.attempt_id': ATTEMPT_ID,
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
        taskId: TASK_ID,
        brainUrl: BRAIN_URL,
        resultChannel: RESULT_CHANNEL,
        lease: { owner: 'dispatcher-1', generation: 0 },
        credential: CREDENTIAL,
      })).resolves.toEqual({ containerId: 'container-created' });

      const [command, createArgs] = runCommand.mock.calls[0];
      expect(command).toBe('docker');
      expect(createArgs[0]).toBe('create');
      expect(createArgs).toContain(IMAGE_DIGEST);
      expect(createArgs).toContain(
        `type=bind,src=/controlled/worktrees/${ATTEMPT_ID},dst=/workspace,readonly`,
      );
      expect(createArgs).toContain(
        'type=bind,src=/controlled/mirrors/perfectuser21__cecelia.git,dst=/controlled/mirrors/perfectuser21__cecelia.git,readonly',
      );
      expect(createArgs).toContain(
        `type=bind,src=${runtimeRoot}/${ATTEMPT_ID},dst=/tmp/cecelia-prompts`,
      );
      expect(createArgs.join(' ')).not.toContain('/Users/operator');
      expect(createArgs).toEqual(expect.arrayContaining([
        '--tmpfs', '/home/cecelia/.codex:rw,noexec,nosuid,nodev,mode=0700',
        '--label', `cecelia.fleet.attempt_id=${ATTEMPT_ID}`,
        '--label', `cecelia.fleet.run_id=${RUN_ID}`,
        '--label', `cecelia.fleet.worker_id=${WORKER_ID}`,
        '--env', 'HARNESS_NODE=generator',
        '--env', 'HARNESS_MODEL=gpt-5',
        '--env', `CECELIA_TASK_ID=${TASK_ID}`,
        '--env', `HARNESS_TASK_ID=${TASK_ID}`,
        '--env', `BRAIN_RESULT_FILE=${RESULT_CHANNEL.path}`,
        '--env', `BRAIN_RESULT_MAX_BYTES=${RESULT_CHANNEL.max_bytes}`,
        '--env', `BRAIN_RESULT_CHANNEL_VERSION=${RESULT_CHANNEL.version}`,
        '--env', `BRAIN_URL=${BRAIN_URL}`,
        '--env', 'CECELIA_CREDENTIAL_FIFO=/tmp/cecelia-prompts/credential.fifo',
        '--env', `CECELIA_CREDENTIAL_REF=${CREDENTIAL.credentialRef}`,
      ]));
      expect(createArgs.join(' ')).not.toContain(CREDENTIAL.authJson);
      expect(createArgs.join(' ')).not.toMatch(/callback|callback-secret/i);
      expect(runCommand.mock.calls[1]).toEqual([
        'mkfifo',
        ['-m', '600', path.join(runtimeRoot, ATTEMPT_ID, 'credential.fifo')],
        undefined,
      ]);
      expect(runCommand.mock.calls[2]).toEqual([
        'docker',
        ['start', 'cecelia-fleet-22222222-2222-4222-8222-222222222222'],
        undefined,
      ]);
      expect(writeCredential).toHaveBeenCalledWith(
        path.join(runtimeRoot, ATTEMPT_ID, 'credential.fifo'),
        CREDENTIAL.authJson,
      );
      const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
      expect(fs.existsSync(attemptRuntime)).toBe(true);
      const resultTarget = path.join(attemptRuntime, `${ATTEMPT_ID}.result.json`);
      const resultStat = fs.lstatSync(resultTarget);
      expect(resultStat.isFile()).toBe(true);
      expect(resultStat.mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(resultTarget, 'utf8')).toBe('');

      await docker.remove({
        containerId: 'container-created',
        attemptId: ATTEMPT_ID,
      });

      expect(fs.existsSync(attemptRuntime)).toBe(false);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('keeps a frozen Codex-labelled canary free of credential files, env, and FIFO writes', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-canary-adapter-'));
    const runCommand = vi.fn(async (_command, args) => (
      args[0] === 'create' ? { stdout: 'canary-container\n' } : { stdout: '' }
    ));
    const writeCredential = vi.fn(async () => undefined);
    const docker = createDockerAdapter({ runCommand, runtimeRoot, writeCredential });
    const canaryChannel = {
      ...RESULT_CHANNEL,
      bindings: { ...RESULT_CHANNEL.bindings, role: 'reporter' },
    };
    const canaryBundle = {
      contract_version: '1.0',
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      role: 'reporter',
      skill: null,
      expected_output: 'harness-result/canary-v1',
      inputs: { task_id: TASK_ID },
    };

    try {
      await docker.launch({
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: {
          ...request().provider_spec,
          stdin: JSON.stringify({ instruction: '', task_bundle: canaryBundle }),
        },
        role: 'reporter',
        model: 'gpt-5',
        workspaceMount: {
          source: `/controlled/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: true,
        },
        workspaceAdminMount: {
          source: '/controlled/mirrors/perfectuser21__cecelia.git',
          target: '/controlled/mirrors/perfectuser21__cecelia.git',
          readOnly: true,
        },
        labels: {
          'cecelia.fleet.attempt_id': ATTEMPT_ID,
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
        taskId: TASK_ID,
        brainUrl: BRAIN_URL,
        resultChannel: canaryChannel,
        lease: { owner: 'dispatcher-1', generation: 0 },
        credential: null,
      });

      const createArgs = runCommand.mock.calls[0][1];
      expect(createArgs).toContain('HARNESS_CANARY=true');
      expect(createArgs.join(' ')).not.toContain('/home/cecelia/.codex');
      expect(createArgs.join(' ')).not.toContain('CECELIA_CREDENTIAL_');
      expect(runCommand.mock.calls.map(([command]) => command)).toEqual(['docker', 'docker']);
      expect(writeCredential).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('rejects a symlink result target and freshens a stale regular target', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-result-target-'));
    const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
    const target = path.join(attemptRuntime, `${ATTEMPT_ID}.result.json`);
    const outside = path.join(runtimeRoot, 'outside.json');
    const runCommand = vi.fn(async (_command, args) => (
      args[0] === 'create' ? { stdout: 'container-created\n' } : { stdout: '' }
    ));
    const docker = createDockerAdapter({ runCommand, runtimeRoot });
    const launchInput = {
      attemptId: ATTEMPT_ID,
      taskId: TASK_ID,
      runId: RUN_ID,
      workerId: WORKER_ID,
      brainUrl: BRAIN_URL,
      resultChannel: RESULT_CHANNEL,
      image: IMAGE_DIGEST,
      providerSpec: {
        ...request().provider_spec,
        provider: 'claude',
        command: 'claude',
      },
      role: 'generator',
      model: 'claude-opus',
      workspaceMount: {
        source: `/controlled/worktrees/${ATTEMPT_ID}`,
        target: '/workspace',
        readOnly: true,
      },
      workspaceAdminMount: {
        source: '/controlled/mirrors/perfectuser21__cecelia.git',
        target: '/controlled/mirrors/perfectuser21__cecelia.git',
        readOnly: true,
      },
      labels: {
        'cecelia.fleet.attempt_id': ATTEMPT_ID,
        'cecelia.fleet.run_id': RUN_ID,
        'cecelia.fleet.worker_id': WORKER_ID,
      },
      lease: { owner: 'dispatcher-1', generation: 0 },
      credential: null,
    };

    try {
      fs.mkdirSync(attemptRuntime, { recursive: true });
      fs.writeFileSync(outside, 'do-not-touch');
      fs.symlinkSync(outside, target);
      await expect(docker.launch(launchInput)).rejects.toThrow(
        /attempt_result_target_symlink/,
      );
      expect(fs.readFileSync(outside, 'utf8')).toBe('do-not-touch');
      expect(runCommand).not.toHaveBeenCalled();

      fs.rmSync(target);
      fs.writeFileSync(target, 'x'.repeat(RESULT_CHANNEL.max_bytes + 1), {
        mode: 0o644,
      });
      await expect(docker.launch(launchInput)).resolves.toEqual({
        containerId: 'container-created',
      });
      expect(fs.readFileSync(target, 'utf8')).toBe('');
      expect(fs.lstatSync(target).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('rejects a symlink Attempt runtime before creating a result outside the runtime root', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-runtime-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-runtime-outside-'));
    fs.symlinkSync(outside, path.join(runtimeRoot, ATTEMPT_ID));
    const runCommand = vi.fn();
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await expect(docker.launch({
        attemptId: ATTEMPT_ID,
        taskId: TASK_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        brainUrl: BRAIN_URL,
        resultChannel: RESULT_CHANNEL,
        image: IMAGE_DIGEST,
        providerSpec: {
          ...request().provider_spec,
          provider: 'grok',
          command: 'grok',
        },
        role: 'generator',
        model: 'grok-4',
        workspaceMount: {
          source: `/controlled/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: true,
        },
        workspaceAdminMount: {
          source: '/controlled/mirrors/perfectuser21__cecelia.git',
          target: '/controlled/mirrors/perfectuser21__cecelia.git',
          readOnly: true,
        },
        labels: {
          'cecelia.fleet.attempt_id': ATTEMPT_ID,
          'cecelia.fleet.run_id': RUN_ID,
          'cecelia.fleet.worker_id': WORKER_ID,
        },
        lease: { owner: 'dispatcher-1', generation: 0 },
        credential: null,
      })).rejects.toThrow(/attempt_runtime_symlink/);
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('persists bounded Attempt state atomically without execution secrets', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-store-'));
    const store = createFileAttemptStateStore({ stateRoot });
    const state = durableState();

    try {
      await store.save(state);

      await expect(store.get(ATTEMPT_ID)).resolves.toEqual(state);
      await expect(store.list()).resolves.toEqual([state]);
      const files = fs.readdirSync(stateRoot);
      expect(files).toEqual([`${ATTEMPT_ID}.json`]);
      const persisted = fs.readFileSync(path.join(stateRoot, files[0]), 'utf8');
      expect(persisted).not.toMatch(
        /"(?:callback_token|authorization|stdin|prompt)"\s*:/i,
      );

      await store.delete(ATTEMPT_ID);
      await expect(store.get(ATTEMPT_ID)).resolves.toBeNull();
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('persists the exact durable cancel_pending state shape', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-cancel-'));
    const store = createFileAttemptStateStore({ stateRoot });
    const state = durableState({
      status: 'cancel_pending',
      container_removed: false,
      cancel_requested_at: '2026-07-28T01:01:00.000Z',
    });

    try {
      await expect(store.save(state)).resolves.toEqual(state);
      await expect(store.get(ATTEMPT_ID)).resolves.toEqual(state);
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('reads canonical result and provider session through descriptor-only bounded IO', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-result-read-'));
    const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
    fs.mkdirSync(attemptRuntime, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(attemptRuntime, `${ATTEMPT_ID}.result.json`),
      CANONICAL_RESULT,
      { mode: 0o600 },
    );
    const session = {
      contract_version: 'provider-session/v1',
      attempt_id: ATTEMPT_ID,
      provider: 'codex',
      session_id: 'thread-1',
    };
    fs.writeFileSync(
      path.join(attemptRuntime, `${ATTEMPT_ID}.session.json`),
      JSON.stringify(session),
      { mode: 0o600 },
    );
    const docker = createDockerAdapter({ runtimeRoot });
    const readFileSpy = vi.spyOn(fs, 'readFileSync');

    try {
      await expect(docker.readSession({ attemptId: ATTEMPT_ID }))
        .resolves.toEqual(session);
      await expect(docker.readResult({
        attemptId: ATTEMPT_ID,
        resultChannel: RESULT_CHANNEL,
      })).resolves.toMatchObject({
        resultBytes: CANONICAL_RESULT,
        terminalStatus: 'completed',
        session,
      });
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['symlink', (target, root) => {
      const outside = path.join(root, 'outside-result.json');
      fs.writeFileSync(outside, CANONICAL_RESULT, { mode: 0o600 });
      fs.symlinkSync(outside, target);
    }],
    ['FIFO', (target) => execFileSync('mkfifo', [target])],
    ['group-readable file', (target) => {
      fs.writeFileSync(target, CANONICAL_RESULT, { mode: 0o640 });
    }],
    ['oversized file', (target) => {
      fs.writeFileSync(target, Buffer.alloc(RESULT_CHANNEL.max_bytes + 1), {
        mode: 0o600,
      });
    }],
    ['invalid UTF-8', (target) => {
      fs.writeFileSync(target, Buffer.from([0xc3, 0x28]), { mode: 0o600 });
    }],
  ])('rejects a %s canonical result file', async (_name, createTarget) => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-result-invalid-'));
    const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
    const target = path.join(attemptRuntime, `${ATTEMPT_ID}.result.json`);
    fs.mkdirSync(attemptRuntime, { recursive: true, mode: 0o700 });
    createTarget(target, runtimeRoot);
    const docker = createDockerAdapter({ runtimeRoot });

    try {
      await expect(docker.readResult({
        attemptId: ATTEMPT_ID,
        resultChannel: RESULT_CHANNEL,
      })).rejects.toThrow(/attempt_result_(?:missing|invalid)/);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['symlink', (target, root) => {
      const outside = path.join(root, 'outside-session.json');
      fs.writeFileSync(outside, JSON.stringify({
        contract_version: 'provider-session/v1',
        attempt_id: ATTEMPT_ID,
        provider: 'codex',
        session_id: 'thread-1',
      }), { mode: 0o600 });
      fs.symlinkSync(outside, target);
    }],
    ['FIFO', (target) => execFileSync('mkfifo', [target])],
    ['world-readable file', (target) => {
      fs.writeFileSync(target, '{}', { mode: 0o604 });
    }],
    ['oversized file', (target) => {
      fs.writeFileSync(target, JSON.stringify({
        contract_version: 'provider-session/v1',
        attempt_id: ATTEMPT_ID,
        provider: 'codex',
        session_id: 'x'.repeat(65_536),
      }), { mode: 0o600 });
    }],
    ['invalid UTF-8', (target) => {
      fs.writeFileSync(target, Buffer.from([0xc3, 0x28]), { mode: 0o600 });
    }],
  ])('rejects a %s provider session file', async (_name, createTarget) => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-session-invalid-'));
    const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
    const target = path.join(attemptRuntime, `${ATTEMPT_ID}.session.json`);
    fs.mkdirSync(attemptRuntime, { recursive: true, mode: 0o700 });
    createTarget(target, runtimeRoot);
    const docker = createDockerAdapter({ runtimeRoot });

    try {
      await expect(docker.readSession({ attemptId: ATTEMPT_ID }))
        .rejects.toThrow(/attempt_session_invalid/);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('returns null when the optional provider session file is absent', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-session-missing-'));
    const docker = createDockerAdapter({ runtimeRoot });

    try {
      await expect(docker.readSession({ attemptId: ATTEMPT_ID }))
        .resolves.toBeNull();
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['legacy schema', () => durableState({ schema_version: 'fleet-attempt-state/v1' })],
    ['unknown schema', () => durableState({ schema_version: 'fleet-attempt-state/v99' })],
    ['unknown top-level field', () => durableState({ surprise: true })],
    ['unknown delivery field', () => durableState({
      status: 'callback_pending',
      container_removed: false,
      delivery: { ...DELIVERY_METADATA, surprise: true },
    })],
    ['invalid delivery digest', () => durableState({
      status: 'callback_pending',
      container_removed: false,
      delivery: { ...DELIVERY_METADATA, result_sha256: 'not-a-digest' },
    })],
  ])('fails closed for %s durable state', async (_name, buildState) => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-schema-'));
    const stateFile = path.join(stateRoot, `${ATTEMPT_ID}.json`);
    fs.writeFileSync(stateFile, JSON.stringify(buildState()), { mode: 0o600 });
    const store = createFileAttemptStateStore({ stateRoot });

    try {
      await expect(store.get(ATTEMPT_ID))
        .rejects.toThrow(new RegExp(`attempt_state_corrupt:${ATTEMPT_ID}`));
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['symlink', (target, root) => {
      const outside = path.join(root, 'outside-state.json');
      fs.writeFileSync(outside, JSON.stringify(durableState()), { mode: 0o600 });
      fs.symlinkSync(outside, target);
    }],
    ['FIFO', (target) => execFileSync('mkfifo', [target])],
    ['group-readable file', (target) => {
      fs.writeFileSync(target, JSON.stringify(durableState()), { mode: 0o640 });
    }],
    ['oversized file', (target) => {
      fs.writeFileSync(target, Buffer.alloc(1_048_577), { mode: 0o600 });
    }],
    ['invalid UTF-8', (target) => {
      fs.writeFileSync(target, Buffer.from([0xc3, 0x28]), { mode: 0o600 });
    }],
  ])('rejects a %s durable state entry during listing', async (_name, createTarget) => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-invalid-'));
    const stateFile = path.join(stateRoot, `${ATTEMPT_ID}.json`);
    createTarget(stateFile, stateRoot);
    const store = createFileAttemptStateStore({ stateRoot });

    try {
      await expect(store.list())
        .rejects.toThrow(new RegExp(`attempt_state_corrupt:${ATTEMPT_ID}`));
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('reads durable state from the descriptor without pathname re-open', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-read-'));
    const stateFile = path.join(stateRoot, `${ATTEMPT_ID}.json`);
    const state = durableState();
    fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
    const store = createFileAttemptStateStore({ stateRoot });
    const readFileSpy = vi.spyOn(fs, 'readFileSync');

    try {
      await expect(store.get(ATTEMPT_ID)).resolves.toEqual(state);
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('skips a state entry that vanishes after directory enumeration', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-race-'));
    const stateFile = path.join(stateRoot, `${ATTEMPT_ID}.json`);
    fs.writeFileSync(stateFile, JSON.stringify(durableState()), { mode: 0o600 });
    const store = createFileAttemptStateStore({ stateRoot });
    const realReaddir = fs.readdirSync;
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation((
      target,
      options,
    ) => {
      const entries = realReaddir(target, options);
      if (path.resolve(String(target)) === path.resolve(stateRoot)) {
        fs.rmSync(stateFile);
      }
      return entries;
    });

    try {
      await expect(store.list()).resolves.toEqual([]);
    } finally {
      readdirSpy.mockRestore();
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['state', (root) => loadAttemptRunner().createFileAttemptStateStore({
      stateRoot: root,
    })],
    ['runtime', (root) => loadAttemptRunner().createDockerAdapter({
      runtimeRoot: root,
    })],
  ])('rejects a symlink %s root at construction', (_kind, createAdapter) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-root-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-root-outside-'));
    const root = path.join(parent, 'owned-root');
    fs.symlinkSync(outside, root);

    try {
      expect(() => createAdapter(root)).toThrow(/attempt_(?:state|runtime)_root_unsafe/);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each([
    ['state', (root) => loadAttemptRunner().createFileAttemptStateStore({
      stateRoot: root,
    })],
    ['runtime', (root) => loadAttemptRunner().createDockerAdapter({
      runtimeRoot: root,
    })],
  ])('rejects a group/world-accessible %s root', (_kind, createAdapter) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-root-mode-'));
    fs.chmodSync(root, 0o755);

    try {
      expect(() => createAdapter(root)).toThrow(/attempt_(?:state|runtime)_root_unsafe/);
    } finally {
      fs.chmodSync(root, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['state', (root) => loadAttemptRunner().createFileAttemptStateStore({
      stateRoot: root,
    })],
    ['runtime', (root) => loadAttemptRunner().createDockerAdapter({
      runtimeRoot: root,
    })],
  ])('rejects a foreign-owned %s root', (_kind, createAdapter) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-root-owner-'));
    const realLstat = fs.lstatSync;
    const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation((target) => {
      const stat = realLstat(target);
      if (path.resolve(String(target)) !== path.resolve(root)) return stat;
      return Object.assign(
        Object.create(Object.getPrototypeOf(stat)),
        stat,
        { uid: stat.uid + 1 },
      );
    });

    try {
      expect(() => createAdapter(root)).toThrow(/attempt_(?:state|runtime)_root_unsafe/);
    } finally {
      lstatSpy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails state IO closed after its parent path is replaced', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-parent-'));
    const movedParent = `${parent}-moved`;
    const outsideParent = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-swap-'));
    const stateRoot = path.join(parent, 'state');
    const replacementRoot = path.join(outsideParent, 'state');
    const store = createFileAttemptStateStore({ stateRoot });
    fs.renameSync(parent, movedParent);
    fs.mkdirSync(replacementRoot, { mode: 0o700 });
    fs.symlinkSync(outsideParent, parent);

    try {
      await expect(store.get(ATTEMPT_ID))
        .rejects.toThrow(/attempt_state_root_unsafe/);
    } finally {
      fs.rmSync(parent, { force: true });
      fs.rmSync(movedParent, { recursive: true, force: true });
      fs.rmSync(outsideParent, { recursive: true, force: true });
    }
  });

  it('fails runtime IO closed after its parent path is replaced', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-runtime-parent-'));
    const movedParent = `${parent}-moved`;
    const outsideParent = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-runtime-swap-'));
    const runtimeRoot = path.join(parent, 'runtime');
    const replacementRoot = path.join(outsideParent, 'runtime');
    const docker = createDockerAdapter({ runtimeRoot });
    fs.renameSync(parent, movedParent);
    fs.mkdirSync(replacementRoot, { mode: 0o700 });
    fs.symlinkSync(outsideParent, parent);

    try {
      await expect(docker.readSession({ attemptId: ATTEMPT_ID }))
        .rejects.toThrow(/attempt_runtime_root_unsafe/);
    } finally {
      fs.rmSync(parent, { force: true });
      fs.rmSync(movedParent, { recursive: true, force: true });
      fs.rmSync(outsideParent, { recursive: true, force: true });
    }
  });
});
