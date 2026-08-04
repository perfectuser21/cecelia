'use strict';

const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKER_ID = 'us-mac-m4';
const IMAGE_DIGEST = `cecelia/runner@sha256:${'a'.repeat(64)}`;
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
const GITHUB_TOKEN = 'github_pat_attempt_scoped_test_token';
const GITHUB_CREDENTIAL_ENVELOPE = Object.freeze({
  contract_version: 'github-credential-envelope/v1',
  credential_ref: '44444444-4444-4444-8444-444444444444',
  attempt_id: ATTEMPT_ID,
  machine_id: WORKER_ID,
  issued_at: '2026-07-27T12:00:00.000Z',
  expires_at: '2026-07-27T14:00:00.000Z',
  payload_hash: `sha256:${'c'.repeat(64)}`,
  payload: 'transient-github-base64-payload',
});
const GITHUB_CREDENTIAL = Object.freeze({
  credentialRef: GITHUB_CREDENTIAL_ENVELOPE.credential_ref,
  token: GITHUB_TOKEN,
  metadata: Object.freeze({
    credential_ref: GITHUB_CREDENTIAL_ENVELOPE.credential_ref,
    attempt_id: ATTEMPT_ID,
    machine_id: WORKER_ID,
    issued_at: GITHUB_CREDENTIAL_ENVELOPE.issued_at,
    expires_at: GITHUB_CREDENTIAL_ENVELOPE.expires_at,
    payload_hash: GITHUB_CREDENTIAL_ENVELOPE.payload_hash,
  }),
});

function loadAttemptRunner() {
  return require('./attempt-runner.cjs');
}

function providerPrompt(role = 'generator', inputs = {}) {
  const validationInputs = ['generator', 'evaluator', 'judge'].includes(role)
    ? {
        pipeline_started_at: '2026-08-03T19:02:13.199Z',
        deadline_at: '2026-08-03T19:07:13.199Z',
      }
    : {};
  return JSON.stringify({
    instruction: 'Execute exactly one Harness role.',
    task_bundle: {
      contract_version: '1.0',
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      hop: 1,
      phase: 'generate',
      role,
      objective: 'perform the bounded task',
      inputs: {
        task_id: TASK_ID,
        sprint_dir: 'sprints/provider-neutral',
        artifacts: [],
        ...validationInputs,
        ...inputs,
      },
      constraints: {
        read_only: false,
        fresh_session: true,
        timeout_seconds: 300,
      },
      expected_output: `harness-result/${role}-v1`,
    },
    continuation: null,
  });
}

function request(overrides = {}) {
  return {
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    lease_owner: 'dispatcher-1',
    lease_generation: 0,
    timeout_seconds: 300,
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
      stdin: providerPrompt(),
      output: { format: 'jsonl' },
    },
    target: {
      machine: WORKER_ID,
      provider: 'codex',
      account: 'team1',
      model: 'gpt-5',
      role: 'generator',
    },
    credential_envelope: CREDENTIAL_ENVELOPE,
    github_credential_envelope: GITHUB_CREDENTIAL_ENVELOPE,
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

function instrumentedFileSystem(overrides = {}) {
  const operations = {};
  for (const method of [
    'mkdirSync',
    'openSync',
    'writeFileSync',
    'fsyncSync',
    'closeSync',
    'renameSync',
    'rmSync',
    'readFileSync',
    'readdirSync',
  ]) {
    operations[method] = vi.fn((...args) => fs[method](...args));
  }
  return Object.assign(operations, overrides);
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
    prepare: vi.fn(async () => {
      events.push('docker.prepare');
      return {
        containerId: 'container-attempt-1',
        credentialFifo: `/controlled/runtime/${ATTEMPT_ID}/credential.fifo`,
        githubCredentialFifo:
          `/controlled/runtime/${ATTEMPT_ID}/github-credential.fifo`,
      };
    }),
    start: vi.fn(async ({ containerId }) => {
      events.push('docker.start');
      return { containerId };
    }),
    inspect: vi.fn(async () => ({ status: 'running' })),
    remove: vi.fn(async () => {
      events.push('docker.remove');
      return { removed: true };
    }),
    wait: vi.fn(async () => pendingWait),
    listOwned: vi.fn(async () => []),
  };
  const credentialConsumer = {
    consume: vi.fn(() => {
      events.push('credential.consume');
      return CREDENTIAL;
    }),
  };
  const githubCredentialConsumer = {
    consume: vi.fn(() => {
      events.push('github-credential.consume');
      return GITHUB_CREDENTIAL;
    }),
  };
  const resourceManager = {
    provision: vi.fn(async () => {
      events.push('resource.provision');
      return {
        runtime: {
          postgres: {
            container_name: `cecelia-pg-${ATTEMPT_ID}`,
            network_name: `cecelia-attempt-${ATTEMPT_ID}`,
            image_digest: `sha256:${'f'.repeat(64)}`,
          },
        },
        environment: {
          DB_URL: 'postgresql://attempt:ephemeral@postgres:5432/acceptance',
          DATABASE_URL: 'postgresql://attempt:ephemeral@postgres:5432/acceptance',
        },
        networkName: `cecelia-attempt-${ATTEMPT_ID}`,
      };
    }),
    release: vi.fn(async () => {
      events.push('resource.release');
      return { status: 'released' };
    }),
    releaseService: vi.fn(async () => {
      events.push('resource.releaseService');
      return { status: 'released' };
    }),
    reconcile: vi.fn(async () => ({ removed_attempts: [] })),
  };
  return {
    workspace,
    workspaceManager,
    docker,
    credentialConsumer,
    githubCredentialConsumer,
    resourceManager,
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
    githubCredentialConsumer: deps.githubCredentialConsumer,
    resourceManager: deps.resourceManager,
  });
}

async function prepareAndStart(runner, input) {
  const prepared = await runner.prepare(input);
  await runner.start(input.attempt_id, {
    owner: input.lease_owner,
    generation: input.lease_generation,
  });
  return prepared;
}

async function prepareAndStartContainer(docker, input) {
  const prepared = await docker.prepare(input);
  await docker.start({
    attemptId: input.attemptId,
    ...prepared,
    credential: input.credential,
    githubCredential: input.githubCredential,
  });
  return Object.freeze({ containerId: prepared.containerId });
}

describe('Fleet Worker Attempt runner', () => {
  it('prepares and persists a stopped Attempt without starting provider code', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    const receipt = await runner.prepare(request());

    expect(receipt).toMatchObject({
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      actual_machine_id: WORKER_ID,
      execution_transport: 'fleet-worker',
      remote_job_id: 'container-attempt-1',
    });
    expect(deps.docker.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.start).not.toHaveBeenCalled();
    expect(deps.docker.wait).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      attempt_id: ATTEMPT_ID,
      status: 'prepared',
      credential_delivery_status: 'pending',
      lease_owner: 'dispatcher-1',
      lease_generation: 0,
      container_id: 'container-attempt-1',
    });
    expect(JSON.stringify(deps.stateStore.states.get(ATTEMPT_ID)))
      .not.toMatch(/sensitive-access-token|github_pat_attempt_scoped_test_token/);
  });

  it.each([
    ['owner', { owner: 'stale-dispatcher', generation: 0 }],
    ['generation', { owner: 'dispatcher-1', generation: 1 }],
  ])('rejects inspect with a stale lease %s', async (_field, lease) => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());

    await expect(runner.inspect(ATTEMPT_ID, lease)).rejects.toThrow(
      'attempt_lease_conflict',
    );
    expect(deps.docker.inspect).not.toHaveBeenCalled();
  });

  it('returns exact missing only after validating the inspect lease shape', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(runner.inspect(OTHER_ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toEqual({
      status: 'missing',
      attempt_id: OTHER_ATTEMPT_ID,
    });
    await expect(runner.inspect(OTHER_ATTEMPT_ID, {
      owner: '',
      generation: 0,
    })).rejects.toThrow('attempt_lease_owner_invalid');
    await expect(runner.inspect(OTHER_ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: -1,
    })).rejects.toThrow('attempt_lease_generation_invalid');
  });

  it('returns the original receipt for an exact duplicate prepare', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    const first = await runner.prepare(request());
    const duplicate = await runner.prepare(request());

    expect(duplicate).toEqual(first);
    expect(deps.docker.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.start).not.toHaveBeenCalled();
  });

  it('rejects a conflicting duplicate prepare without touching its container', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());

    await expect(runner.prepare(request({
      timeout_seconds: 301,
    }))).rejects.toThrow('attempt_already_exists');

    expect(deps.docker.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.start).not.toHaveBeenCalled();
  });

  it('single-flights concurrent exact duplicate prepare requests', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    const [first, duplicate] = await Promise.all([
      runner.prepare(request()),
      runner.prepare(request()),
    ]);

    expect(duplicate).toEqual(first);
    expect(deps.docker.prepare).toHaveBeenCalledOnce();
    expect(deps.credentialConsumer.consume).toHaveBeenCalledOnce();
    expect(deps.githubCredentialConsumer.consume).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight prepare before exact-cancelling its durable resources', async () => {
    let releasePrepare;
    const deferredPrepare = new Promise((resolve) => {
      releasePrepare = resolve;
    });
    const deps = dependencies();
    deps.docker.prepare.mockReturnValueOnce(deferredPrepare);
    const runner = createRunner(deps);

    const preparing = runner.prepare(request());
    await vi.waitFor(() => expect(deps.docker.prepare).toHaveBeenCalledOnce());
    let cancelSettled = false;
    const cancelling = runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    }).finally(() => {
      cancelSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancelSettled).toBe(false);
    releasePrepare({
      containerId: 'container-attempt-1',
      credentialFifo: `/controlled/runtime/${ATTEMPT_ID}/credential.fifo`,
      githubCredentialFifo:
        `/controlled/runtime/${ATTEMPT_ID}/github-credential.fifo`,
    });

    await expect(preparing).resolves.toMatchObject({ attempt_id: ATTEMPT_ID });
    await expect(cancelling).resolves.toEqual({
      status: 'cleaned',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.docker.remove).toHaveBeenCalledOnce();
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledOnce();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'cleaned',
    });
  });

  it('waits for a failed in-flight prepare rollback before confirming no resources remain', async () => {
    let rejectPrepare;
    const deferredPrepare = new Promise((_resolve, reject) => {
      rejectPrepare = reject;
    });
    const deps = dependencies();
    deps.docker.prepare.mockReturnValueOnce(deferredPrepare);
    const runner = createRunner(deps);

    const preparing = runner.prepare(request());
    void preparing.catch(() => {});
    await vi.waitFor(() => expect(deps.docker.prepare).toHaveBeenCalledOnce());
    let cancelSettled = false;
    const cancelling = runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    }).finally(() => {
      cancelSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancelSettled).toBe(false);
    rejectPrepare(new Error('docker prepare failed'));

    await expect(preparing).rejects.toThrow('docker prepare failed');
    await expect(cancelling).resolves.toEqual({
      status: 'already_clean',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledOnce();
    expect(deps.docker.remove).not.toHaveBeenCalled();
    expect(deps.stateStore.states.has(ATTEMPT_ID)).toBe(false);
  });

  it.each(['cancel', 'inspect'])(
    'fails closed when %s waits for an in-flight prepare whose rollback is unconfirmed',
    async (operation) => {
      let rejectPrepare;
      const deferredPrepare = new Promise((_resolve, reject) => {
        rejectPrepare = reject;
      });
      const deps = dependencies();
      deps.docker.prepare.mockReturnValueOnce(deferredPrepare);
      deps.docker.remove.mockRejectedValueOnce(new Error('container remove denied'));
      const runner = createRunner(deps);
      const preparing = runner.prepare(request());
      void preparing.catch(() => {});
      await vi.waitFor(() => expect(deps.docker.prepare).toHaveBeenCalledOnce());
      const coordinating = runner[operation](ATTEMPT_ID, {
        owner: 'dispatcher-1',
        generation: 0,
      });

      const prepareError = new Error('docker prepare failed');
      prepareError.rollbackContainerId = 'container-attempt-1';
      rejectPrepare(prepareError);

      await expect(preparing).rejects.toThrow(
        'attempt_launch_rollback_failed:docker prepare failed',
      );
      await expect(coordinating).rejects.toThrow(
        'attempt_launch_rollback_failed:docker prepare failed',
      );
      expect(deps.workspaceManager.quarantine).toHaveBeenCalledOnce();
      expect(deps.stateStore.states.has(ATTEMPT_ID)).toBe(false);
    },
  );

  it.each([
    ['cancel', { owner: 'stale-dispatcher', generation: 0 }],
    ['cancel', { owner: 'dispatcher-1', generation: 1 }],
    ['inspect', { owner: 'stale-dispatcher', generation: 0 }],
    ['inspect', { owner: 'dispatcher-1', generation: 1 }],
  ])('lease-fences %s while prepare is in flight: %j', async (operation, lease) => {
    let releasePrepare;
    const deferredPrepare = new Promise((resolve) => {
      releasePrepare = resolve;
    });
    const deps = dependencies();
    deps.docker.prepare.mockReturnValueOnce(deferredPrepare);
    const runner = createRunner(deps);
    const preparing = runner.prepare(request());
    await vi.waitFor(() => expect(deps.docker.prepare).toHaveBeenCalledOnce());

    try {
      await expect(runner[operation](ATTEMPT_ID, lease)).rejects.toThrow(
        'attempt_lease_conflict',
      );
    } finally {
      releasePrepare({ containerId: 'container-attempt-1' });
      await preparing;
      await runner.cancel(ATTEMPT_ID, {
        owner: 'dispatcher-1',
        generation: 0,
      });
    }

    expect(deps.docker.remove).toHaveBeenCalledOnce();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'cleaned',
    });
  });

  it('waits for in-flight prepare before inspect and never reports it missing', async () => {
    let releasePrepare;
    const deferredPrepare = new Promise((resolve) => {
      releasePrepare = resolve;
    });
    const deps = dependencies();
    deps.docker.prepare.mockReturnValueOnce(deferredPrepare);
    const runner = createRunner(deps);

    const preparing = runner.prepare(request());
    await vi.waitFor(() => expect(deps.docker.prepare).toHaveBeenCalledOnce());
    let inspectSettled = false;
    const inspecting = runner.inspect(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    }).finally(() => {
      inspectSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(inspectSettled).toBe(false);
    releasePrepare({ containerId: 'container-attempt-1' });

    await preparing;
    await expect(inspecting).resolves.toEqual({
      status: 'prepared',
      attempt_id: ATTEMPT_ID,
      container_id: 'container-attempt-1',
    });
    expect(deps.docker.inspect).not.toHaveBeenCalled();
  });

  it('binds duplicate prepare to callback token identity without persisting it', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());

    expect(JSON.stringify(deps.stateStore.states.get(ATTEMPT_ID)))
      .not.toContain('callback-secret');
    await expect(runner.prepare(request({
      callback_token: 'different-callback-secret',
    }))).rejects.toThrow('attempt_already_exists');
    expect(deps.docker.prepare).toHaveBeenCalledOnce();
  });

  it.each([
    ['Provider', 'credential_envelope', CREDENTIAL_ENVELOPE],
    ['GitHub', 'github_credential_envelope', GITHUB_CREDENTIAL_ENVELOPE],
  ])('binds duplicate prepare to the %s envelope payload hash', async (
    _name,
    field,
    envelope,
  ) => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());

    await expect(runner.prepare(request({
      [field]: {
        ...envelope,
        payload_hash: `sha256:${'d'.repeat(64)}`,
      },
    }))).rejects.toThrow('attempt_already_exists');
    expect(deps.docker.prepare).toHaveBeenCalledOnce();
  });

  it('fails closed when a restarted runner cannot recover prepared credentials', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    const restarted = createRunner(deps);

    await expect(restarted.prepare(request())).rejects.toThrow(
      'attempt_credentials_unavailable',
    );
    expect(deps.docker.prepare).toHaveBeenCalledOnce();
    expect(deps.docker.start).not.toHaveBeenCalled();
  });

  it('startup reconciliation exact-cancels a prepared Attempt without credentials', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    deps.docker.inspect.mockResolvedValueOnce({ status: 'created' });
    const restarted = createRunner(deps);

    await expect(restarted.reconcile()).resolves.toMatchObject({
      cleaned_attempts: [ATTEMPT_ID],
    });
    expect(deps.docker.start).not.toHaveBeenCalled();
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledWith(deps.workspace);
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'credential_delivery_unconfirmed',
    });
  });

  it('exact-finalizes a starting Attempt when delivery was not durably committed', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    Object.assign(deps.stateStore.states.get(ATTEMPT_ID), {
      status: 'starting',
      credential_delivery_status: 'pending',
    });
    const restarted = createRunner(deps);

    await expect(restarted.reconcile()).resolves.toMatchObject({
      cleaned_attempts: [ATTEMPT_ID],
    });
    expect(deps.docker.inspect).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
    });
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
    });
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'credential_delivery_unconfirmed',
    });
    expect(deps.docker.start).not.toHaveBeenCalled();
    expect(deps.docker.wait).not.toHaveBeenCalled();
  });

  it('reinstalls one waiter for a fresh running Attempt with delivered credentials', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    Object.assign(deps.stateStore.states.get(ATTEMPT_ID), {
      status: 'running',
      credential_delivery_status: 'delivered',
    });
    const restarted = createRunner(deps);

    await restarted.reconcile();
    await restarted.reconcile();

    expect(deps.docker.inspect).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
    });
    expect(deps.docker.wait).toHaveBeenCalledOnce();
    expect(deps.docker.remove).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'running',
      credential_delivery_status: 'delivered',
    });
  });

  it('exact-finalizes a delivered running Attempt found terminal after restart', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    Object.assign(deps.stateStore.states.get(ATTEMPT_ID), {
      status: 'running',
      credential_delivery_status: 'delivered',
    });
    deps.docker.inspect.mockResolvedValueOnce({ status: 'missing' });
    const restarted = createRunner(deps);

    await restarted.reconcile();

    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
      containerMissing: true,
    });
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'missing',
    });
  });

  it('fails closed on Worker inspect infrastructure errors during reconciliation', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    Object.assign(deps.stateStore.states.get(ATTEMPT_ID), {
      status: 'running',
      credential_delivery_status: 'delivered',
    });
    deps.docker.inspect.mockRejectedValueOnce(
      new Error('docker daemon permission denied'),
    );
    const restarted = createRunner(deps);

    await expect(restarted.reconcile()).rejects.toThrow(
      'docker daemon permission denied',
    );

    expect(deps.docker.remove).not.toHaveBeenCalled();
    expect(deps.resourceManager.release).not.toHaveBeenCalled();
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'running',
      credential_delivery_status: 'delivered',
    });
  });

  it.each(['created', 'prepared'])(
    'fails closed for persisted starting with Docker %s and no credentials',
    async (dockerStatus) => {
      const deps = dependencies();
      await createRunner(deps).prepare(request());
      deps.stateStore.states.get(ATTEMPT_ID).status = 'starting';
      deps.docker.inspect.mockResolvedValueOnce({ status: dockerStatus });
      const restarted = createRunner(deps);

      await expect(restarted.start(ATTEMPT_ID, {
        owner: 'dispatcher-1',
        generation: 0,
      })).rejects.toThrow('attempt_credentials_unavailable');
      expect(deps.docker.start).not.toHaveBeenCalled();
      expect(deps.stateStore.states.get(ATTEMPT_ID).status).toBe('starting');
    },
  );

  it('exact-finalizes persisted starting when its container is missing', async () => {
    const deps = dependencies();
    await createRunner(deps).prepare(request());
    deps.stateStore.states.get(ATTEMPT_ID).status = 'starting';
    deps.docker.inspect.mockResolvedValueOnce({ status: 'missing' });
    const restarted = createRunner(deps);

    await expect(restarted.start(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toEqual({
      status: 'terminal',
      attempt_id: ATTEMPT_ID,
      terminal_status: 'missing',
      deduped: true,
    });
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
      containerMissing: true,
    });
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      attempt_id: ATTEMPT_ID,
      status: 'terminal',
      terminal_status: 'missing',
      lease_owner: 'dispatcher-1',
      lease_generation: 0,
    });
  });

  it('persists a minimal lease-fenced terminal result across a fresh runner', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());
    await runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    });
    const tombstone = deps.stateStore.states.get(ATTEMPT_ID);
    expect(tombstone).toEqual({
      attempt_id: ATTEMPT_ID,
      worker_id: WORKER_ID,
      lease_owner: 'dispatcher-1',
      lease_generation: 0,
      status: 'terminal',
      terminal_status: 'cleaned',
      terminal_at: expect.any(String),
    });
    expect(JSON.stringify(tombstone)).not.toMatch(
      /credential|workspace|runtime|callback|container|run_id/,
    );
    const restarted = createRunner(deps);

    await expect(restarted.start(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toEqual({
      status: 'terminal',
      attempt_id: ATTEMPT_ID,
      terminal_status: 'cleaned',
      deduped: true,
    });
    await expect(restarted.start(ATTEMPT_ID, {
      owner: 'stale-owner',
      generation: 0,
    })).rejects.toThrow('attempt_lease_conflict');

    deps.docker.inspect.mockClear();
    await restarted.reconcile();
    expect(deps.docker.inspect).not.toHaveBeenCalled();
    expect(deps.workspaceManager.reconcile).toHaveBeenLastCalledWith({
      retainedAttemptIds: [],
    });
    expect(deps.resourceManager.reconcile).toHaveBeenLastCalledWith({
      retainedAttemptIds: [],
    });
  });

  it('starts a prepared Attempt once and deduplicates the matching lease', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());

    await expect(runner.start(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toMatchObject({
      status: 'running',
      attempt_id: ATTEMPT_ID,
    });
    await expect(runner.start(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toMatchObject({
      status: 'running',
      attempt_id: ATTEMPT_ID,
      deduped: true,
    });

    expect(deps.docker.start).toHaveBeenCalledOnce();
    expect(deps.docker.wait).toHaveBeenCalledOnce();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'running',
      credential_delivery_status: 'delivered',
    });
  });

  it('does not resurrect running when cancel races a deferred Docker start', async () => {
    let releaseStart;
    const deferredStart = new Promise((resolve) => {
      releaseStart = resolve;
    });
    const deps = dependencies();
    deps.docker.start.mockReturnValueOnce(deferredStart);
    const runner = createRunner(deps);
    await runner.prepare(request());

    const starting = runner.start(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    });
    await vi.waitFor(() => {
      expect(deps.stateStore.states.get(ATTEMPT_ID).status).toBe('starting');
    });
    const cancelling = runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));
    releaseStart({ containerId: 'container-attempt-1' });

    await Promise.allSettled([starting, cancelling]);

    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'cleaned',
    });
    expect(deps.docker.remove).toHaveBeenCalledTimes(1);
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledTimes(1);
    expect(deps.docker.wait).not.toHaveBeenCalled();
  });

  it('rejects a stale start lease without starting the prepared container', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await runner.prepare(request());

    await expect(runner.start(ATTEMPT_ID, {
      owner: 'stale-owner',
      generation: 0,
    })).rejects.toThrow('attempt_lease_conflict');

    expect(deps.docker.start).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'prepared',
    });
  });

  it('rolls back a workspace when verification fails before resource creation', async () => {
    const deps = dependencies();
    deps.workspaceManager.verify.mockRejectedValueOnce(
      new Error('workspace head mismatch'),
    );
    const runner = createRunner(deps);

    await expect(runner.prepare(request())).rejects.toThrow(
      'workspace head mismatch',
    );

    expect(deps.workspaceManager.cleanup).toHaveBeenCalledWith(deps.workspace);
    expect(deps.resourceManager.provision).not.toHaveBeenCalled();
    expect(deps.docker.prepare).not.toHaveBeenCalled();
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });

  it('quarantines workspace evidence when verify rollback cleanup fails', async () => {
    const deps = dependencies();
    deps.workspaceManager.verify.mockRejectedValueOnce(
      new Error('workspace head mismatch'),
    );
    deps.workspaceManager.cleanup.mockRejectedValueOnce(
      new Error('workspace cleanup denied'),
    );
    const runner = createRunner(deps);

    await expect(runner.prepare(request())).rejects.toThrow(
      'attempt_workspace_verify_rollback_failed:workspace head mismatch',
    );

    expect(deps.workspaceManager.quarantine).toHaveBeenCalledWith(
      deps.workspace,
      expect.objectContaining({ message: 'workspace cleanup denied' }),
    );
    expect(deps.resourceManager.provision).not.toHaveBeenCalled();
    expect(deps.docker.prepare).not.toHaveBeenCalled();
    expect(deps.stateStore.save).not.toHaveBeenCalled();
  });

  it.each([
    {
      role: 'commander',
      inputs: {},
      expected: {
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
      },
    },
    {
      role: 'planner',
      inputs: {
        planner_branch: 'cp-harness-prd-aaaaaaaa-a2',
      },
      expected: {
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
        PLANNER_BRANCH: 'cp-harness-prd-aaaaaaaa-a2',
      },
    },
    {
      role: 'proposer',
      inputs: {
        contract_round: 2,
        propose_branch: 'cp-harness-propose-r2-aaaaaaaa-a17',
        contract_branch: 'cp-harness-propose-r1-aaaaaaaa-a3',
      },
      expected: {
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
        PROPOSE_ROUND: '2',
        PROPOSE_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
        CONTRACT_BRANCH: 'cp-harness-propose-r1-aaaaaaaa-a3',
      },
    },
    {
      role: 'reviewer',
      inputs: {
        contract_round: 2,
        contract_branch: 'cp-harness-propose-r2-aaaaaaaa-a17',
      },
      expected: {
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
        BRAIN_RESULT_FILE: '/tmp/cecelia-prompts/brain-result.json',
        PROPOSE_ROUND: '2',
        CONTRACT_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
      },
    },
    {
      role: 'generator',
      inputs: {
        contract_branch: 'cp-harness-propose-r2-aaaaaaaa-a17',
      },
      expected: {
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
        CONTRACT_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
      },
    },
    {
      role: 'evaluator',
      inputs: {
        contract_branch: 'cp-harness-propose-r2-aaaaaaaa-a17',
        pr_branch: 'cp-07310943-ws-0e82adad',
        pr_head_sha: '0123456789abcdef0123456789abcdef01234567',
      },
      expected: {
        SPRINT_DIR: 'sprints/provider-neutral',
        WORKSPACE_PATH: '/workspace',
        BRAIN_RESULT_FILE: '/tmp/cecelia-prompts/brain-result.json',
        CONTRACT_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
        PR_BRANCH: 'cp-07310943-ws-0e82adad',
        PR_HEAD_SHA: '0123456789abcdef0123456789abcdef01234567',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'remote.origin.pushurl',
        GIT_CONFIG_VALUE_0: 'blocked-by-harness://evaluator',
      },
    },
  ])(
    'preserves the original task id and $role role environment from TaskBundle',
    async ({ role, inputs, expected }) => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await prepareAndStart(runner, request({
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt(role, inputs),
        },
        target: {
          ...request().target,
          role,
        },
      }));

      expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
        taskId: TASK_ID,
        roleEnv: expect.objectContaining(expected),
      }));
    },
  );

  // 案卷式 GAN 会话续接（design doc §数据流3，决策 ba33fc68）：dispatcher.js 已经把
  // resume_session_id/resume_provider 塞进 bundle.inputs，attempt-runner.cjs 是
  // 真正做"provider 匹配才续接"判断的地方——只有 resume_provider 与本次实际派发
  // 的 target.provider 都是 codex 时才追加 HARNESS_RESUME_SESSION_ID，交给
  // entrypoint.sh 里既有的 `codex exec resume <id>` 分支消费。
  describe('案卷式 GAN 会话续接（resume_session_id）', () => {
    it('reviewer + resume_provider=codex + target.provider=codex → 注入 HARNESS_RESUME_SESSION_ID', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request({
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('reviewer', {
            resume_session_id: 'thread-reviewer-1',
            resume_provider: 'codex',
          }),
        },
        target: { ...request().target, role: 'reviewer' },
      }));

      expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
        roleEnv: expect.objectContaining({
          HARNESS_RESUME_SESSION_ID: 'thread-reviewer-1',
        }),
      }));
    });

    it('proposer + resume_provider=codex + target.provider=codex → 注入 HARNESS_RESUME_SESSION_ID', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request({
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('proposer', {
            resume_session_id: 'thread-proposer-1',
            resume_provider: 'codex',
          }),
        },
        target: { ...request().target, role: 'proposer' },
      }));

      expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
        roleEnv: expect.objectContaining({
          HARNESS_RESUME_SESSION_ID: 'thread-proposer-1',
        }),
      }));
    });

    it('resume_provider 与实际派发 target.provider 不一致 → 不注入，读案卷降级', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request({
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('reviewer', {
            resume_session_id: 'thread-reviewer-1',
            resume_provider: 'codex',
          }),
        },
        target: { ...request().target, role: 'reviewer', provider: 'claude' },
      }));

      const call = deps.docker.prepare.mock.calls[0][0];
      expect(call.roleEnv).not.toHaveProperty('HARNESS_RESUME_SESSION_ID');
    });

    it('非 proposer/reviewer 角色（如 generator）即便带 resume 字段也不注入', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request({
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('generator', {
            resume_session_id: 'thread-generator-1',
            resume_provider: 'codex',
          }),
        },
        target: { ...request().target, role: 'generator' },
      }));

      const call = deps.docker.prepare.mock.calls[0][0];
      expect(call.roleEnv).not.toHaveProperty('HARNESS_RESUME_SESSION_ID');
    });

    it('resume_session_id 缺失/空 → 不注入（首轮/无历史会话的正常路径）', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request({
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('reviewer', {}),
        },
        target: { ...request().target, role: 'reviewer' },
      }));

      const call = deps.docker.prepare.mock.calls[0][0];
      expect(call.roleEnv).not.toHaveProperty('HARNESS_RESUME_SESSION_ID');
    });
  });

  // 运行时依赖预装（design doc §运行时依赖）：runtime_resources.node_deps 走同一条
  // request/bundle 一致性校验通道，再传给 workspaceManager.prepare 的第二参数。
  describe('运行时依赖预装（runtime_resources.node_deps）', () => {
    it('bundle 与 request 都带 node_deps:true → workspaceManager.prepare 收到 { nodeDeps: true }', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request({
        runtime_resources: { postgres: false, node_deps: true },
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('reviewer', {
            runtime_resources: { postgres: false, node_deps: true },
          }),
        },
        target: { ...request().target, role: 'reviewer' },
      }));

      expect(deps.workspaceManager.prepare).toHaveBeenCalledWith(
        expect.any(Object),
        { nodeDeps: true },
      );
    });

    it('未声明 runtime_resources → workspaceManager.prepare 收到 { nodeDeps: false }', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await runner.prepare(request());

      expect(deps.workspaceManager.prepare).toHaveBeenCalledWith(
        expect.any(Object),
        { nodeDeps: false },
      );
    });

    it('bundle 与 request 的 runtime_resources 不一致（node_deps 缺一侧）→ mismatch 拒绝', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await expect(runner.prepare(request({
        runtime_resources: { postgres: false, node_deps: true },
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('reviewer', {
            runtime_resources: { postgres: false },
          }),
        },
        target: { ...request().target, role: 'reviewer' },
      }))).rejects.toThrow('attempt_runtime_requirements_mismatch');
      expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    });

    it('runtime_resources 带未知字段 → attempt_runtime_requirements_invalid', async () => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await expect(runner.prepare(request({
        runtime_resources: { postgres: false, node_deps: true, extra: true },
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt('reviewer', {
            runtime_resources: { postgres: false, node_deps: true, extra: true },
          }),
        },
        target: { ...request().target, role: 'reviewer' },
      }))).rejects.toThrow('attempt_runtime_requirements_invalid');
    });
  });

  it('injects server-observed runtime attestation for late-bound validation evidence', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    const capabilitySnapshotId = '55555555-5555-4555-8555-555555555555';

    await runner.prepare(request({
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('generator', {
          capability_snapshot_id: capabilitySnapshotId,
        }),
      },
    }));

    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
      roleEnv: expect.objectContaining({
        HARNESS_PROVIDER: 'codex',
        HARNESS_ACCOUNT: 'team1',
        HARNESS_MACHINE: WORKER_ID,
        HARNESS_MODEL: 'gpt-5',
        HARNESS_RUNNER_DIGEST: IMAGE_DIGEST,
        CAPABILITY_SNAPSHOT_ID: capabilitySnapshotId,
      }),
    }));
  });

  it('injects the exact Controller-owned validation clock without resetting it', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    const pipelineStartedAt = '2026-08-03T19:02:13.199Z';
    const deadlineAt = '2026-08-03T19:07:13.199Z';

    await runner.prepare(request({
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('generator', {
          pipeline_started_at: pipelineStartedAt,
          deadline_at: deadlineAt,
        }),
      },
    }));

    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
      roleEnv: expect.objectContaining({
        HARNESS_PIPELINE_STARTED_AT: pipelineStartedAt,
        HARNESS_DEADLINE_AT: deadlineAt,
      }),
    }));
  });

  it('fails closed when a validation role TaskBundle has no shared clock', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(runner.prepare(request({
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('generator', {
          pipeline_started_at: null,
          deadline_at: null,
        }),
      },
    }))).rejects.toThrow(
      'validation_clock_required',
    );
    expect(deps.docker.prepare).not.toHaveBeenCalled();
  });

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

    await prepareAndStart(runner, request({
      workspace_spec: {
        ...request().workspace_spec,
        mode,
      },
    }));

    expect(deps.events.slice(0, 4)).toEqual([
      'credential.consume',
      'github-credential.consume',
      'workspace.prepare',
      'docker.prepare',
    ]);
    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
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
      timeoutSeconds: 300,
    }));
  });

  it('provisions an isolated PostgreSQL resource before launch and injects only its ephemeral environment', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    const postgresRequest = request({
      runtime_resources: { postgres: true },
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('evaluator', {
          runtime_resources: { postgres: true },
        }),
      },
      target: {
        ...request().target,
        role: 'evaluator',
      },
    });

    await prepareAndStart(runner, postgresRequest);

    expect(deps.resourceManager.provision).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      requirements: { postgres: true },
    });
    expect(deps.events).toEqual(expect.arrayContaining([
      'workspace.prepare',
      'resource.provision',
      'docker.prepare',
    ]));
    expect(deps.events.indexOf('resource.provision'))
      .toBeLessThan(deps.events.indexOf('docker.prepare'));
    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
      runtimeEnvironment: {
        DB_URL: 'postgresql://attempt:ephemeral@postgres:5432/acceptance',
        DATABASE_URL: 'postgresql://attempt:ephemeral@postgres:5432/acceptance',
      },
      runtimeNetwork: `cecelia-attempt-${ATTEMPT_ID}`,
    }));
    const state = deps.stateStore.states.get(ATTEMPT_ID);
    expect(state.runtime_resources).toEqual({
      postgres: {
        container_name: `cecelia-pg-${ATTEMPT_ID}`,
        network_name: `cecelia-attempt-${ATTEMPT_ID}`,
        image_digest: `sha256:${'f'.repeat(64)}`,
      },
    });
    expect(JSON.stringify(state)).not.toContain('ephemeral');
  });

  it.each([
    ['transport-only', { topLevel: { postgres: true }, bundle: undefined }],
    ['bundle-only', { topLevel: undefined, bundle: { postgres: true } }],
  ])('rejects a %s runtime-resource request before side effects', async (_name, variant) => {
    const deps = dependencies();
    const runner = createRunner(deps);
    const input = request({
      ...(variant.topLevel === undefined
        ? {}
        : { runtime_resources: variant.topLevel }),
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('evaluator', {
          ...(variant.bundle === undefined
            ? {}
            : { runtime_resources: variant.bundle }),
        }),
      },
      target: { ...request().target, role: 'evaluator' },
    });

    await expect(prepareAndStart(runner, input)).rejects.toThrow(
      'attempt_runtime_requirements_mismatch',
    );
    expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    expect(deps.resourceManager.provision).not.toHaveBeenCalled();
  });

  it('accepts the exact locally loaded sha256 image id without inventing a registry tag', async () => {
    const deps = dependencies();
    const rawImageId = `sha256:${'b'.repeat(64)}`;
    const { createAttemptRunner } = loadAttemptRunner();
    const runner = createAttemptRunner({
      workspaceManager: deps.workspaceManager,
      docker: deps.docker,
      stateStore: deps.stateStore,
      workerId: WORKER_ID,
      runnerImageDigest: rawImageId,
      credentialConsumer: deps.credentialConsumer,
      githubCredentialConsumer: deps.githubCredentialConsumer,
    });

    await prepareAndStart(runner, request());

    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
      image: rawImageId,
    }));
  });

  it('consumes and binds the credential before materializing a workspace', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await prepareAndStart(runner, request());

    expect(deps.credentialConsumer.consume).toHaveBeenCalledWith(
      CREDENTIAL_ENVELOPE,
      {
        attemptId: ATTEMPT_ID,
        accountId: 'team1',
        machineId: WORKER_ID,
      },
    );
    expect(deps.events.slice(0, 3)).toEqual([
      'credential.consume',
      'github-credential.consume',
      'workspace.prepare',
    ]);
    const state = deps.stateStore.states.get(ATTEMPT_ID);
    expect(state.credential).toEqual(CREDENTIAL.metadata);
    expect(JSON.stringify(state)).not.toContain('sensitive');
    expect(state.credential).not.toHaveProperty('payload');
  });

  it.each(['planner', 'proposer', 'generator', 'evaluator'])(
    'requires a one-use GitHub envelope for the %s role before side effects',
    async (role) => {
      const deps = dependencies();
      const runner = createRunner(deps);

      await expect(prepareAndStart(runner, request({
        github_credential_envelope: undefined,
        provider_spec: {
          ...request().provider_spec,
          stdin: providerPrompt(role),
        },
        target: {
          ...request().target,
          role,
        },
      }))).rejects.toThrow('github_credential_envelope_required');
      expect(deps.githubCredentialConsumer.consume).not.toHaveBeenCalled();
      expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
      expect(deps.docker.prepare).not.toHaveBeenCalled();
    },
  );

  it('consumes GitHub token in memory and persists metadata only', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await prepareAndStart(runner, request());

    expect(deps.githubCredentialConsumer.consume).toHaveBeenCalledWith(
      GITHUB_CREDENTIAL_ENVELOPE,
      {
        attemptId: ATTEMPT_ID,
        machineId: WORKER_ID,
      },
    );
    const state = deps.stateStore.states.get(ATTEMPT_ID);
    expect(state.github_credential).toEqual(GITHUB_CREDENTIAL.metadata);
    expect(JSON.stringify(state)).not.toContain(GITHUB_TOKEN);
    expect(state.github_credential).not.toHaveProperty('token');
    expect(state.github_credential).not.toHaveProperty('payload');
  });

  it('does not require or consume a GitHub envelope for reviewer', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await prepareAndStart(runner, request({
      github_credential_envelope: undefined,
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('reviewer'),
      },
      target: {
        ...request().target,
        role: 'reviewer',
      },
    }));

    expect(deps.githubCredentialConsumer.consume).not.toHaveBeenCalled();
  });

  it('rejects a Codex launch without an envelope before workspace or Docker side effects', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(prepareAndStart(runner, request({
      credential_envelope: undefined,
    }))).rejects.toThrow('credential_envelope_required');
    expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    expect(deps.docker.prepare).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    'rejects invalid timeout %s before credential, workspace, or Docker side effects',
    async (timeoutSeconds) => {
      const deps = dependencies();
      const runner = createRunner(deps);
      const input = request({ timeout_seconds: timeoutSeconds });
      if (timeoutSeconds === undefined) delete input.timeout_seconds;

      await expect(prepareAndStart(runner, input)).rejects.toThrow(
        'attempt_timeout_seconds_invalid',
      );
      expect(deps.credentialConsumer.consume).not.toHaveBeenCalled();
      expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
      expect(deps.docker.prepare).not.toHaveBeenCalled();
    },
  );

  it('rejects caller-owned cwd and mounts before Git or Docker side effects', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await expect(prepareAndStart(runner, request({
      provider_spec: {
        ...request().provider_spec,
        cwd: '/Users/operator/perfect21/cecelia',
        mounts: ['/tmp:/workspace:rw'],
      },
    }))).rejects.toThrow(/attempt_provider_spec_unknown_field/);
    expect(deps.workspaceManager.prepare).not.toHaveBeenCalled();
    expect(deps.docker.prepare).not.toHaveBeenCalled();
  });

  it('callback terminalization releases isolated resources but keeps the Runner alive to receive the response', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await prepareAndStart(runner, request({
      runtime_resources: { postgres: true },
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('evaluator', {
          runtime_resources: { postgres: true },
        }),
      },
      target: {
        ...request().target,
        role: 'evaluator',
      },
    }));

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'cleaned',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.events.at(-1)).toBe('resource.releaseService');
    expect(deps.docker.remove).not.toHaveBeenCalled();
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.resourceManager.release).not.toHaveBeenCalled();
    expect(deps.resourceManager.releaseService).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      runtime: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: `sha256:${'f'.repeat(64)}`,
        },
      },
    });
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
  });

  it('automatically performs terminal cleanup after the owned container exits', async () => {
    let resolveExit;
    const containerExit = new Promise((resolve) => {
      resolveExit = resolve;
    });
    const deps = dependencies();
    deps.docker.wait.mockReturnValueOnce(containerExit);
    const runner = createRunner(deps);

    await prepareAndStart(runner, request());
    resolveExit({ statusCode: 0 });

    await vi.waitFor(() => {
      expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
        status: 'terminal',
        terminal_status: 'cleaned',
      });
    });
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
    expect(deps.events.slice(-2)).toEqual([
      'docker.remove',
      'workspace.cleanup',
    ]);
  });

  it('single-flights cancel with the docker waiter it wakes up', async () => {
    let resolveExit;
    const containerExit = new Promise((resolve) => {
      resolveExit = resolve;
    });
    const deps = dependencies();
    deps.docker.wait.mockReturnValueOnce(containerExit);
    deps.docker.remove.mockImplementationOnce(async () => {
      deps.events.push('docker.remove');
      resolveExit({ statusCode: 137 });
      await new Promise((resolve) => setImmediate(resolve));
      return { removed: true };
    });
    const runner = createRunner(deps);
    await prepareAndStart(runner, request());

    await runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(deps.docker.remove).toHaveBeenCalledTimes(1);
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledTimes(1);
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'terminal',
      terminal_status: 'cleaned',
    });
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
  });

  it('cancel quarantines the workspace and retains evidence when container cleanup fails', async () => {
    const deps = dependencies();
    deps.docker.remove.mockRejectedValueOnce(new Error('docker remove failed'));
    const runner = createRunner(deps);
    await prepareAndStart(runner, request());

    await expect(runner.cancel(ATTEMPT_ID, {
      owner: 'dispatcher-1',
      generation: 0,
    })).resolves.toMatchObject({
      status: 'quarantined',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.workspaceManager.quarantine).toHaveBeenCalledOnce();
    expect(deps.stateStore.delete).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID).status).toBe('quarantined');
  });

  it('keeps the Runner and state retryable when callback resource cleanup fails', async () => {
    const deps = dependencies();
    deps.resourceManager.releaseService.mockRejectedValueOnce(
      new Error('attempt_resource_release_failed'),
    );
    const runner = createRunner(deps);
    await prepareAndStart(runner, request({
      runtime_resources: { postgres: true },
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('evaluator', {
          runtime_resources: { postgres: true },
        }),
      },
      target: {
        ...request().target,
        role: 'evaluator',
      },
    }));

    await expect(runner.terminal(ATTEMPT_ID)).resolves.toMatchObject({
      status: 'quarantined',
      attempt_id: ATTEMPT_ID,
    });
    expect(deps.docker.remove).not.toHaveBeenCalled();
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
    expect(deps.stateStore.states.get(ATTEMPT_ID)).toMatchObject({
      status: 'running',
      runtime_resources: expect.any(Object),
    });
    expect(deps.workspaceManager.quarantine).not.toHaveBeenCalled();
  });

  it('reports resource rollback failure instead of silently losing recovery evidence', async () => {
    const deps = dependencies();
    deps.stateStore.save.mockRejectedValueOnce(new Error('state write failed'));
    deps.resourceManager.release.mockRejectedValueOnce(
      new Error('attempt_resource_release_failed'),
    );
    const runner = createRunner(deps);

    await expect(prepareAndStart(runner, request({
      runtime_resources: { postgres: true },
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('generator', {
          runtime_resources: { postgres: true },
        }),
      },
    }))).rejects.toThrow(
      'attempt_launch_rollback_failed:state write failed',
    );
    expect(deps.resourceManager.release).toHaveBeenCalledOnce();
    expect(deps.workspaceManager.cleanup).toHaveBeenCalledOnce();
  });

  it('retries leaked-container cleanup and quarantines the workspace when rollback still fails', async () => {
    const deps = dependencies();
    const launchError = new Error('attempt_container_rollback_failed:start failed');
    launchError.rollbackContainerId = `cecelia-fleet-${ATTEMPT_ID}`;
    deps.docker.prepare.mockRejectedValueOnce(launchError);
    deps.docker.remove.mockRejectedValueOnce(new Error('docker daemon unavailable'));
    const runner = createRunner(deps);

    await expect(prepareAndStart(runner, request())).rejects.toThrow(
      'attempt_launch_rollback_failed:attempt_container_rollback_failed:start failed',
    );
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: `cecelia-fleet-${ATTEMPT_ID}`,
      attemptId: ATTEMPT_ID,
    });
    expect(deps.workspaceManager.quarantine).toHaveBeenCalledOnce();
    expect(deps.workspaceManager.cleanup).not.toHaveBeenCalled();
  });

  it('rejects stale external cancellation without touching the owned Attempt', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);
    await prepareAndStart(runner, request());

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

    await expect(prepareAndStart(runner, request({
      runtime_resources: { postgres: true },
      provider_spec: {
        ...request().provider_spec,
        stdin: providerPrompt('generator', {
          runtime_resources: { postgres: true },
        }),
      },
    }))).rejects.toThrow(/state write failed/);
    expect(deps.docker.remove).toHaveBeenCalledWith({
      containerId: 'container-attempt-1',
      attemptId: ATTEMPT_ID,
    });
    expect(deps.events.slice(-3)).toEqual([
      'docker.remove',
      'resource.release',
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
      runtime_resources: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: `sha256:${'f'.repeat(64)}`,
        },
      },
      status: 'running',
      credential_delivery_status: 'delivered',
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
      credential_delivery_status: 'delivered',
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
    });
    expect(deps.resourceManager.release).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      runtime: ownedOrphan.runtime_resources,
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

  it('deterministically prunes old terminal tombstones without retaining resources', async () => {
    const tombstones = Array.from({ length: 1_025 }, (_unused, index) => ({
      attempt_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      worker_id: WORKER_ID,
      lease_owner: 'dispatcher-1',
      lease_generation: 0,
      status: 'terminal',
      terminal_status: 'cleaned',
      terminal_at: new Date(index * 1_000).toISOString(),
    }));
    const stateStore = inMemoryStateStore(tombstones);
    const deps = dependencies({ stateStore });
    const runner = createRunner(deps);

    await runner.reconcile();

    expect(stateStore.delete).toHaveBeenCalledWith(tombstones[0].attempt_id);
    expect(stateStore.states.size).toBe(1_024);
    expect(deps.docker.inspect).not.toHaveBeenCalled();
    expect(deps.workspaceManager.reconcile).toHaveBeenCalledWith({
      retainedAttemptIds: [],
    });
    expect(deps.resourceManager.reconcile).toHaveBeenCalledWith({
      retainedAttemptIds: [],
    });
  });
});

describe('Fleet Worker durable runtime adapters', () => {
  it('maps only explicit Docker no-such-container errors to missing', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-inspect-'));
    const runCommand = vi.fn(async () => {
      const error = new Error('Error response from daemon: No such container');
      error.stderr = 'No such object: exact-attempt';
      throw error;
    });
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await expect(docker.inspect({
        containerId: 'exact-attempt',
      })).resolves.toEqual({ status: 'missing' });
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    'docker daemon unavailable',
    'context deadline exceeded',
    'permission denied inspecting container',
    'container inspection endpoint not found',
  ])('propagates Docker inspect infrastructure failure: %s', async (message) => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-inspect-'));
    const runCommand = vi.fn(async () => {
      throw new Error(message);
    });
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await expect(docker.inspect({
        containerId: 'exact-attempt',
      })).rejects.toThrow(message);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('streams a bounded GitHub token to its dedicated FIFO without argv exposure', async () => {
    const { __test__ } = loadAttemptRunner();
    const received = [];
    const child = new EventEmitter();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        received.push(Buffer.from(chunk));
        callback();
      },
    });
    child.kill = vi.fn();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    await __test__.defaultWriteGitHubCredential(
      `cecelia-fleet-${ATTEMPT_ID}`,
      '/tmp/cecelia-prompts/github-credential.fifo',
      GITHUB_TOKEN,
      { spawnFn },
    );

    expect(spawnFn).toHaveBeenCalledWith(
      'docker',
      [
        'exec',
        '-i',
        `cecelia-fleet-${ATTEMPT_ID}`,
        'sh',
        '-c',
        'cat > "$1"',
        'github-credential-writer',
        '/tmp/cecelia-prompts/github-credential.fifo',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    expect(JSON.stringify(spawnFn.mock.calls)).not.toContain(GITHUB_TOKEN);
    expect(Buffer.concat(received).toString('utf8')).toBe(GITHUB_TOKEN);
  });

  it('streams a bounded credential to an in-container FIFO without argv exposure', async () => {
    const { __test__ } = loadAttemptRunner();
    const authJson = JSON.stringify({
      tokens: {
        access_token: 'x'.repeat(100_000),
      },
    });
    const received = [];
    const child = new EventEmitter();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        received.push(Buffer.from(chunk));
        callback();
      },
    });
    child.kill = vi.fn();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    await __test__.defaultWriteCredential(
      `cecelia-fleet-${ATTEMPT_ID}`,
      '/tmp/cecelia-prompts/credential.fifo',
      authJson,
      { spawnFn },
    );

    expect(spawnFn).toHaveBeenCalledWith(
      'docker',
      [
        'exec',
        '-i',
        `cecelia-fleet-${ATTEMPT_ID}`,
        'sh',
        '-c',
        'cat > "$1"',
        'credential-writer',
        '/tmp/cecelia-prompts/credential.fifo',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    expect(JSON.stringify(spawnFn.mock.calls)).not.toContain(authJson);
    expect(Buffer.concat(received).toString('utf8')).toBe(authJson);
  });

  it('removes the container and runtime when Docker omits the created id', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));
    const runCommand = vi.fn(async () => ({ stdout: '' }));
    const docker = createDockerAdapter({
      runCommand,
      runtimeRoot,
      resolveMountSource: (source) => source,
    });

    try {
      await expect(prepareAndStartContainer(docker, {
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        taskId: TASK_ID,
        roleEnv: {
          SPRINT_DIR: 'sprints/provider-neutral',
          WORKSPACE_PATH: '/workspace',
          CONTRACT_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
        },
        timeoutSeconds: 300,
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
        callback: {
          url: request().callback_url,
          token: request().callback_token,
        },
        lease: { owner: 'dispatcher-1', generation: 0 },
        credential: CREDENTIAL,
        githubCredential: GITHUB_CREDENTIAL,
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

  it('retains runtime evidence and reports the leaked container when launch rollback removal fails', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'rm') throw new Error('permission denied removing container');
      return { stdout: '' };
    });
    const docker = createDockerAdapter({
      runCommand,
      runtimeRoot,
      resolveMountSource: (source) => source,
    });

    try {
      const error = await prepareAndStartContainer(docker, {
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        taskId: TASK_ID,
        roleEnv: { WORKSPACE_PATH: '/workspace' },
        timeoutSeconds: 300,
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
        callback: { url: request().callback_url, token: request().callback_token },
        lease: { owner: 'dispatcher-1', generation: 0 },
        credential: CREDENTIAL,
        githubCredential: GITHUB_CREDENTIAL,
      }).catch((caught) => caught);

      expect(error.message).toContain('attempt_container_rollback_failed');
      expect(error.rollbackContainerId).toBe(`cecelia-fleet-${ATTEMPT_ID}`);
      expect(fs.existsSync(path.join(runtimeRoot, ATTEMPT_ID))).toBe(true);
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

  it('treats Docker already-missing as idempotent during concurrent finalization', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));
    const attemptRuntime = path.join(runtimeRoot, ATTEMPT_ID);
    fs.mkdirSync(attemptRuntime, { recursive: true });
    const runCommand = vi.fn(async () => {
      throw new Error('Error response from daemon: No such container: exact-attempt');
    });
    const docker = createDockerAdapter({ runCommand, runtimeRoot });

    try {
      await expect(docker.remove({
        containerId: 'already-missing',
        attemptId: ATTEMPT_ID,
      })).resolves.toEqual({ removed: true });
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
    const writeGitHubCredential = vi.fn(async () => undefined);
    const resolveMountSource = vi.fn((source) => `/canonical${source}`);
    const docker = createDockerAdapter({
      runCommand,
      runtimeRoot,
      writeCredential,
      writeGitHubCredential,
      resolveMountSource,
      mountAccessPrincipal: 'orbstack-owner',
      cleanupAccessPrincipal: '_cecelia',
    });

    try {
      await expect(prepareAndStartContainer(docker, {
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        taskId: TASK_ID,
        roleEnv: {
          SPRINT_DIR: 'sprints/provider-neutral',
          WORKSPACE_PATH: '/workspace',
          CONTRACT_BRANCH: 'cp-harness-propose-r2-aaaaaaaa-a17',
        },
        timeoutSeconds: 300,
        role: 'generator',
        model: 'gpt-5',
        workspaceMount: {
          source: `/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: true,
        },
        workspaceAdminMount: {
          source: `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
          target: `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
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
        credential: CREDENTIAL,
        githubCredential: GITHUB_CREDENTIAL,
        runtimeNetwork: `cecelia-attempt-${ATTEMPT_ID}`,
        runtimeEnvironment: {
          DB_URL: 'postgresql://attempt:secret@postgres:5432/acceptance',
          DATABASE_URL: 'postgresql://attempt:secret@postgres:5432/acceptance',
        },
      })).resolves.toEqual({ containerId: 'container-created' });

      expect(runCommand.mock.calls[0]).toEqual([
        'mkfifo',
        ['-m', '600', path.join(runtimeRoot, ATTEMPT_ID, 'github-credential.fifo')],
        undefined,
      ]);
      expect(runCommand.mock.calls[1]).toEqual([
        'mkfifo',
        ['-m', '600', path.join(runtimeRoot, ATTEMPT_ID, 'credential.fifo')],
        undefined,
      ]);
      expect(runCommand.mock.calls[2]).toEqual([
        'chmod',
        [
          '+a',
          '_cecelia allow list,add_file,search,add_subdirectory,delete,delete_child,file_inherit,directory_inherit',
          `/canonical/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID}`,
          `/canonical/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
          `/canonical${path.join(runtimeRoot, ATTEMPT_ID)}`,
        ],
        undefined,
      ]);
      expect(runCommand.mock.calls[3]).toEqual([
        '/usr/bin/find',
        [
          '-x',
          `/canonical/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID}`,
          `/canonical/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
          `/canonical${path.join(runtimeRoot, ATTEMPT_ID)}`,
          '(',
          '-type',
          'd',
          '-o',
          '-type',
          'f',
          '-o',
          '-type',
          'p',
          ')',
          '-exec',
          'chmod',
          '+a',
          'orbstack-owner allow read,write,execute,delete',
          '{}',
          '+',
        ],
        undefined,
      ]);
      const [command, createArgs] = runCommand.mock.calls[4];
      expect(command).toBe('docker');
      expect(createArgs[0]).toBe('create');
      expect(createArgs).toContain(IMAGE_DIGEST);
      expect(createArgs).toContain(
        `type=bind,src=/canonical/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID},dst=/workspace,readonly`,
      );
      expect(createArgs).toContain(
        `type=bind,src=/canonical/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git,dst=/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git,readonly`,
      );
      expect(createArgs).toContain(
        `type=bind,src=/canonical${path.join(runtimeRoot, ATTEMPT_ID)},dst=/tmp/cecelia-prompts`,
      );
      expect(resolveMountSource).toHaveBeenCalledWith(
        `/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID}`,
      );
      expect(resolveMountSource).toHaveBeenCalledWith(
        `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
      );
      expect(resolveMountSource).toHaveBeenCalledWith(
        path.join(runtimeRoot, ATTEMPT_ID),
      );
      expect(createArgs.join(' ')).not.toContain('/Users/operator');
      expect(createArgs).toEqual(expect.arrayContaining([
        '--tmpfs', '/home/cecelia/.codex:rw,noexec,nosuid,nodev,mode=0700,uid=999,gid=999',
        '--tmpfs', '/home/cecelia/.config/gh:rw,noexec,nosuid,nodev,mode=0700,uid=999,gid=999',
        '--label', `cecelia.fleet.attempt_id=${ATTEMPT_ID}`,
        '--label', `cecelia.fleet.run_id=${RUN_ID}`,
        '--label', `cecelia.fleet.worker_id=${WORKER_ID}`,
        '--network', `cecelia-attempt-${ATTEMPT_ID}`,
        '--env', `CECELIA_TASK_ID=${TASK_ID}`,
        '--env', `HARNESS_TASK_ID=${TASK_ID}`,
        '--env', 'HARNESS_NODE=generator',
        '--env', 'HARNESS_MODEL=gpt-5',
        '--env', 'HARNESS_TIMEOUT_SECONDS=300',
        '--env', 'SPRINT_DIR=sprints/provider-neutral',
        '--env', 'WORKSPACE_PATH=/workspace',
        '--env', 'CONTRACT_BRANCH=cp-harness-propose-r2-aaaaaaaa-a17',
        '--env', 'CECELIA_CREDENTIAL_FIFO=/tmp/cecelia-prompts/credential.fifo',
        '--env', `CECELIA_CREDENTIAL_REF=${CREDENTIAL.credentialRef}`,
        '--env', 'CECELIA_GITHUB_CREDENTIAL_FIFO=/tmp/cecelia-prompts/github-credential.fifo',
        '--env', `CECELIA_GITHUB_CREDENTIAL_REF=${GITHUB_CREDENTIAL.credentialRef}`,
        '--env', 'DB_URL=postgresql://attempt:secret@postgres:5432/acceptance',
        '--env', 'DATABASE_URL=postgresql://attempt:secret@postgres:5432/acceptance',
      ]));
      expect(createArgs.join(' ')).not.toContain(CREDENTIAL.authJson);
      expect(createArgs.join(' ')).not.toContain(GITHUB_TOKEN);
      expect(createArgs).not.toContain('--user');
      expect(runCommand.mock.calls[5]).toEqual([
        'docker',
        ['start', 'cecelia-fleet-22222222-2222-4222-8222-222222222222'],
        undefined,
      ]);
      expect(writeGitHubCredential).toHaveBeenCalledWith(
        `cecelia-fleet-${ATTEMPT_ID}`,
        '/tmp/cecelia-prompts/github-credential.fifo',
        GITHUB_TOKEN,
      );
      expect(writeCredential).toHaveBeenCalledWith(
        `cecelia-fleet-${ATTEMPT_ID}`,
        '/tmp/cecelia-prompts/credential.fifo',
        CREDENTIAL.authJson,
      );
      expect(writeGitHubCredential.mock.invocationCallOrder[0])
        .toBeLessThan(writeCredential.mock.invocationCallOrder[0]);
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

  it('starts only evaluator containers as root for the trusted evidence stage', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-evaluator-root-'));
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'create') return { stdout: 'evaluator-container\n' };
      return { stdout: '' };
    });
    const docker = createDockerAdapter({
      runCommand,
      runtimeRoot,
      writeCredential: vi.fn(async () => undefined),
      writeGitHubCredential: vi.fn(async () => undefined),
      resolveMountSource: (source) => source,
    });

    try {
      await prepareAndStartContainer(docker, {
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        taskId: TASK_ID,
        roleEnv: {
          SPRINT_DIR: 'sprints/provider-neutral',
          WORKSPACE_PATH: '/workspace',
          PR_HEAD_SHA: '0123456789abcdef0123456789abcdef01234567',
        },
        timeoutSeconds: 300,
        role: 'evaluator',
        model: 'gpt-5',
        workspaceMount: {
          source: `/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: true,
        },
        workspaceAdminMount: {
          source: `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
          target: `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
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
        credential: CREDENTIAL,
        githubCredential: GITHUB_CREDENTIAL,
      });

      const createCall = runCommand.mock.calls.find(
        ([command, args]) => command === 'docker' && args[0] === 'create',
      );
      expect(createCall).toBeDefined();
      expect(createCall[1]).toEqual(expect.arrayContaining(['--user', 'root']));
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  // Attempt 3aa00156 rebased a frozen candidate onto latest main because the
  // container was never told which SHA it started from, nor that the SHA was an
  // invariant rather than a suggestion.
  it('publishes the server-observed start SHA and frozen mode into the container', async () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-frozen-env-'));
    const startSha = '0dc4e3c07ff19a0ac95440723986bf3cb78580b2';
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'create') return { stdout: 'frozen-container\n' };
      return { stdout: '' };
    });
    const docker = createDockerAdapter({
      runCommand,
      runtimeRoot,
      writeCredential: vi.fn(async () => undefined),
      writeGitHubCredential: vi.fn(async () => undefined),
      resolveMountSource: (source) => source,
    });

    try {
      await prepareAndStartContainer(docker, {
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        image: IMAGE_DIGEST,
        providerSpec: request().provider_spec,
        taskId: TASK_ID,
        roleEnv: { WORKSPACE_PATH: '/workspace' },
        timeoutSeconds: 300,
        role: 'generator',
        model: 'gpt-5',
        workspaceStartSha: startSha,
        frozenBaseline: true,
        workspaceMount: {
          source: `/var/lib/cecelia/fleet-worker/worktrees/${ATTEMPT_ID}`,
          target: '/workspace',
          readOnly: false,
        },
        workspaceAdminMount: {
          source: `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
          target: `/var/lib/cecelia/fleet-worker/worktrees/.admin/${ATTEMPT_ID}.git`,
          readOnly: false,
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
        credential: CREDENTIAL,
        githubCredential: GITHUB_CREDENTIAL,
      });

      const createCall = runCommand.mock.calls.find(
        ([command, args]) => command === 'docker' && args[0] === 'create',
      );
      expect(createCall[1]).toEqual(expect.arrayContaining([
        '--env', `HARNESS_WORKSPACE_START_SHA=${startSha}`,
        '--env', 'HARNESS_FROZEN_BASELINE=true',
      ]));
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('binds the container start SHA to the workspace the Worker actually checked out', async () => {
    const deps = dependencies();
    deps.workspace.frozen_baseline = true;
    const runner = createRunner(deps);

    await prepareAndStart(runner, request({
      workspace_spec: {
        ...request().workspace_spec,
        frozen_baseline: true,
      },
    }));

    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
      workspaceStartSha: deps.workspace.head_sha,
      frozenBaseline: true,
    }));
  });

  it('leaves ordinary dev Attempts unfrozen', async () => {
    const deps = dependencies();
    const runner = createRunner(deps);

    await prepareAndStart(runner, request());

    expect(deps.docker.prepare).toHaveBeenCalledWith(expect.objectContaining({
      frozenBaseline: false,
    }));
  });

  it('rejects an unsafe OrbStack ACL principal before launching Docker', () => {
    const { createDockerAdapter } = loadAttemptRunner();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-docker-adapter-'));

    try {
      expect(() => createDockerAdapter({
        runtimeRoot,
        mountAccessPrincipal: 'operator allow everyone',
      })).toThrow(/attempt_runner_invalid_mount_access_principal/);
      expect(() => createDockerAdapter({
        runtimeRoot,
        cleanupAccessPrincipal: '_cecelia allow everyone',
      })).toThrow(/attempt_runner_invalid_cleanup_access_principal/);
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

  it('fsyncs and closes the state file before rename and its directory after', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-sync-'));
    const fileSystem = instrumentedFileSystem();
    const store = createFileAttemptStateStore({ stateRoot, fileSystem });
    const state = {
      attempt_id: ATTEMPT_ID,
      worker_id: WORKER_ID,
      status: 'prepared',
    };

    try {
      await store.save(state);

      expect(fileSystem.openSync).toHaveBeenCalledTimes(2);
      expect(fileSystem.fsyncSync).toHaveBeenCalledTimes(2);
      expect(fileSystem.closeSync).toHaveBeenCalledTimes(2);
      expect(fileSystem.writeFileSync.mock.calls[0][0]).toEqual(expect.any(Number));
      expect(fileSystem.fsyncSync.mock.invocationCallOrder[0])
        .toBeLessThan(fileSystem.renameSync.mock.invocationCallOrder[0]);
      expect(fileSystem.renameSync.mock.invocationCallOrder[0])
        .toBeLessThan(fileSystem.fsyncSync.mock.invocationCallOrder[1]);
      expect(fileSystem.openSync).toHaveBeenLastCalledWith(stateRoot, 'r');
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('keeps the prior state intact when temp-file fsync fails', async () => {
    const { createFileAttemptStateStore } = loadAttemptRunner();
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-sync-'));
    const original = {
      attempt_id: ATTEMPT_ID,
      worker_id: WORKER_ID,
      status: 'prepared',
    };
    const replacement = { ...original, status: 'running' };
    const baselineStore = createFileAttemptStateStore({ stateRoot });
    await baselineStore.save(original);
    const fileSystem = instrumentedFileSystem();
    fileSystem.fsyncSync.mockImplementationOnce(() => {
      throw new Error('state fsync failed');
    });
    const failingStore = createFileAttemptStateStore({ stateRoot, fileSystem });

    try {
      await expect(failingStore.save(replacement)).rejects.toThrow(
        'state fsync failed',
      );
      await expect(baselineStore.get(ATTEMPT_ID)).resolves.toEqual(original);
      expect(fileSystem.renameSync).not.toHaveBeenCalled();
      expect(fileSystem.closeSync).toHaveBeenCalled();
      expect(fs.readdirSync(stateRoot)).toEqual([`${ATTEMPT_ID}.json`]);
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  });
});
