import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRealDeps } from '../run.js';
import { signMachineAttestation } from '../machine-attestation.js';
import { createProviderRegistry } from '../provider-registry.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_OWNER = 'production-wiring:4242';
const SHARED_SECRET = 'production-wiring-secret-at-least-32-bytes';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function observed(payload = {}) {
  return {
    task: {
      id: TASK_ID,
      title: 'production capability wiring',
      payload: {
        sprint_dir: 'sprints/production-capability-wiring',
        worktree_path: '/workspace',
        role_assignments: {
          generator: { provider: 'codex', account: 'team1' },
        },
        contract_requirements: {
          provider_auth: true,
          github: true,
          postgres: true,
          model_capabilities: ['structured_output'],
        },
        ...payload,
      },
    },
    run: { id: RUN_ID, phase: 'generate' },
    contract: { row: {} },
    pr: null,
  };
}

function selectedPreflight(target) {
  return {
    evaluate: vi.fn(async () => ({
      status: 'ok',
      snapshot: {
        ...target,
        capability_snapshot_id: 'production-wiring-snapshot',
      },
      evidence: {
        from_target: target,
        to_target: target,
      },
      to_target: target,
    })),
    validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
  };
}

function attemptStoreDouble() {
  return {
    createAttempt: vi.fn(async (input) => ({
      ...input,
      id: input.id,
      run_id: input.runId,
      task_bundle: input.bundle,
      status: 'queued',
    })),
    markStarting: vi.fn(async (id) => ({
      id,
      status: 'starting',
      lease_owner: LEASE_OWNER,
      lease_generation: 4,
    })),
    recordLaunchReceipt: vi.fn(async (id, receipt) => ({
      id,
      status: 'starting',
      ...receipt,
    })),
    fail: vi.fn(async () => ({ deduped: false })),
  };
}

function codexAdapter() {
  return {
    name: 'codex',
    capabilities: ['structured_output'],
    start: vi.fn(() => ({
      provider: 'codex',
      command: 'codex',
      args: ['exec'],
      env: {},
      stdin: '{}',
    })),
    resume: vi.fn(),
    inspect: vi.fn(),
    cancel: vi.fn(),
    normalizeResult: vi.fn(),
  };
}

describe('production capability wiring', () => {
  const previousMachineId = process.env.CECELIA_MACHINE_ID;

  afterEach(() => {
    if (previousMachineId === undefined) delete process.env.CECELIA_MACHINE_ID;
    else process.env.CECELIA_MACHINE_ID = previousMachineId;
  });

  it('buildRealDeps runs server-owned preflight before the real attempt and launcher', async () => {
    process.env.CECELIA_MACHINE_ID = 'us-mac-m4';
    const order = [];
    const fetchFn = vi.fn(async (url) => {
      order.push(`fetch:${url}`);
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 4,
            physical_capacity: 8,
            pressure: 0.2,
          }],
        });
      }
      if (String(url).endsWith('/api/brain/dispatch/llm-capacity')) {
        return response({
          sentinel: 'ok',
          vendors: {
            codex: {
              accounts: [{
                name: 'team1',
                available: true,
                source: 'usage_api',
              }],
            },
          },
        });
      }
      if (String(url) === 'https://api.github.com/user') {
        return response({ login: 'cecelia-ci' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const pool = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes('SELECT 1')) {
          order.push('postgres');
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }),
    };
    const attemptStore = {
      createAttempt: vi.fn(async (input) => {
        order.push('createAttempt');
        return { ...input, task_bundle: input.bundle };
      }),
      markStarting: vi.fn(async (id) => {
        order.push('claimAttempt');
        return {
          id,
          status: 'starting',
          lease_owner: LEASE_OWNER,
          lease_generation: 0,
        };
      }),
      recordLaunchReceipt: vi.fn(async (id, receipt) => {
        order.push('recordReceipt');
        return { id, status: 'starting', ...receipt };
      }),
      fail: vi.fn(),
    };
    const adapter = {
      name: 'codex',
      capabilities: ['structured_output'],
      start: vi.fn(({ bundle }) => {
        order.push('adapter.start');
        return { provider: 'codex', args: [], env: {}, stdin: JSON.stringify(bundle) };
      }),
      resume: vi.fn(),
      inspect: vi.fn(),
      cancel: vi.fn(),
      normalizeResult: vi.fn(),
    };
    const launcher = {
      launch: vi.fn(async () => {
        order.push('launch');
        return Object.freeze({
          actualMachineId: 'us-mac-m4',
          executionTransport: 'local-docker',
          remoteJobId: null,
          attestationStatus: 'local',
          containerId: 'worker-1',
          jobId: null,
        });
      }),
      cancel: vi.fn(),
    };

    const deps = await buildRealDeps({
      pool,
      attemptStore,
      registry: createProviderRegistry([adapter]),
      launcher,
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'a'.repeat(64)}`,
        content: 'generate',
      })),
      fetchFn,
      resolveGitHubToken: vi.fn(async () => 'secret-token'),
      randomUUID: () => '33333333-3333-4333-8333-333333333333',
      leaseOwner: LEASE_OWNER,
    });

    const result = await deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 9,
      observed: observed(),
      decision: { phase: 'generate', reason: 'contract_approved' },
    });

    expect(result.status).toBe('DONE');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
    expect(attemptStore.createAttempt).toHaveBeenCalledTimes(1);
    expect(attemptStore.createAttempt.mock.calls[0][0].bundle.inputs).toMatchObject({
      capability_snapshot_id: expect.any(String),
      capability_evidence: {
        from_target: {
          provider: 'codex',
          account: 'team1',
          machine: 'us-mac-m4',
        },
        to_target: {
          provider: 'codex',
          account: 'team1',
          machine: 'us-mac-m4',
        },
      },
    });
    expect(order.indexOf('postgres')).toBeLessThan(order.indexOf('createAttempt'));
    expect(order.slice(-5)).toEqual([
      'createAttempt',
      'claimAttempt',
      'adapter.start',
      'launch',
      'recordReceipt',
    ]);
  });

  it('uses the healthy fallback account for persistence, account home, and launch', async () => {
    process.env.CECELIA_MACHINE_ID = 'us-mac-m4';
    const accountHomes = [];
    const startedExecutions = [];
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 3,
            physical_capacity: 8,
            pressure: 0.3,
          }],
        });
      }
      if (String(url).endsWith('/api/brain/dispatch/llm-capacity')) {
        return response({
          sentinel: 'ok',
          vendors: {
            codex: {
              accounts: [
                { name: 'team4', available: false, source: 'credential_expired' },
                { name: 'team1', available: true, source: 'usage_api' },
              ],
            },
          },
        });
      }
      if (String(url) === 'https://api.github.com/user') {
        return response({ login: 'cecelia-ci' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const attemptStore = {
      createAttempt: vi.fn(async (input) => ({ ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(async (id) => ({
        id,
        status: 'starting',
        lease_owner: LEASE_OWNER,
        lease_generation: 0,
      })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({
        id,
        status: 'starting',
        ...receipt,
      })),
      fail: vi.fn(),
    };
    const adapter = {
      name: 'codex',
      capabilities: ['structured_output'],
      start: vi.fn(({ execution }) => {
        startedExecutions.push(execution);
        return { provider: 'codex', args: [], env: {}, stdin: '{}' };
      }),
      resume: vi.fn(),
      inspect: vi.fn(),
      cancel: vi.fn(),
      normalizeResult: vi.fn(),
    };
    const launcher = {
      launch: vi.fn(async (input) => Object.freeze({
        actualMachineId: input.target.machine,
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: `worker-${input.attempt.accountId}`,
        jobId: null,
      })),
      cancel: vi.fn(),
    };
    const deps = await buildRealDeps({
      pool: { query: vi.fn(async () => ({ rows: [{ ok: 1 }] })) },
      attemptStore,
      registry: createProviderRegistry([adapter]),
      launcher,
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'b'.repeat(64)}`,
        content: 'generate',
      })),
      fetchFn,
      resolveGitHubToken: vi.fn(async () => 'secret-token'),
      resolveAccountHome: vi.fn((_provider, account) => {
        accountHomes.push(account);
        return `/accounts/${account}`;
      }),
      leaseOwner: LEASE_OWNER,
    });

    const result = await deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 10,
      observed: observed({
        role_assignments: {
          generator: { provider: 'codex', account: 'team4' },
        },
        contract_requirements: {
          provider_auth: true,
          github: true,
          postgres: false,
          model_capabilities: ['structured_output'],
        },
      }),
      decision: { phase: 'generate', reason: 'contract_approved' },
    });

    expect(result).toMatchObject({ status: 'DONE', provider: 'codex' });
    expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'team1',
      machineId: 'us-mac-m4',
    }));
    expect(accountHomes.at(-1)).toBe('team1');
    expect(startedExecutions).toContainEqual(expect.objectContaining({
      codexHome: '/accounts/team1',
    }));
    expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({ accountId: 'team1' }),
      bundle: expect.objectContaining({
        inputs: expect.objectContaining({
          capability_evidence: expect.objectContaining({
            from_target: expect.objectContaining({ account: 'team4' }),
            to_target: expect.objectContaining({ account: 'team1' }),
          }),
        }),
      }),
    }));
  });

  it('PostgreSQL preflight failure is BLOCKED and creates no attempt', async () => {
    process.env.CECELIA_MACHINE_ID = 'us-mac-m4';
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 2,
            physical_capacity: 8,
            pressure: 0.4,
          }],
        });
      }
      if (String(url).endsWith('/api/brain/dispatch/llm-capacity')) {
        return response({
          sentinel: 'ok',
          vendors: {
            codex: {
              accounts: [{ name: 'team1', available: true, source: 'usage_api' }],
            },
          },
        });
      }
      if (String(url) === 'https://api.github.com/user') {
        return response({ login: 'cecelia-ci' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const attemptStore = {
      createAttempt: vi.fn(),
      fail: vi.fn(),
    };
    const adapter = {
      name: 'codex',
      capabilities: ['structured_output'],
      start: vi.fn(),
      resume: vi.fn(),
      inspect: vi.fn(),
      cancel: vi.fn(),
      normalizeResult: vi.fn(),
    };
    const launcher = { launch: vi.fn() };
    const deps = await buildRealDeps({
      pool: {
        query: vi.fn(async (sql) => {
          if (String(sql).includes('SELECT 1')) {
            const error = new Error('connection refused');
            error.code = 'ECONNREFUSED';
            throw error;
          }
          return { rows: [] };
        }),
      },
      attemptStore,
      registry: createProviderRegistry([adapter]),
      launcher,
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'c'.repeat(64)}`,
        content: 'generate',
      })),
      fetchFn,
      resolveGitHubToken: vi.fn(async () => 'secret-token'),
    });

    const result = await deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 11,
      observed: observed(),
      decision: { phase: 'generate', reason: 'contract_approved' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      control_status: 'BLOCKED',
      action: 'wait:human_review',
      failure_class: 'infrastructure_blocked',
      fallback_reason: 'ECONNREFUSED',
      should_create_attempt: false,
      should_enter_generator_fix: false,
    });
    expect(attemptStore.createAttempt).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('constructs the real remote router and persists its attested launch receipt', async () => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const attemptStore = attemptStoreDouble();
    const spawnDetached = vi.fn();
    const fetchFn = vi.fn(async () => response({
      status: 'accepted',
      job_id: 'remote-job-production-1',
      actual_machine_id: target.machine,
      attestation: signMachineAttestation({
        secret: SHARED_SECRET,
        attemptId: ATTEMPT_ID,
        machineId: target.machine,
        jobId: 'remote-job-production-1',
      }),
    }, 202));
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      attemptStore,
      registry: createProviderRegistry([codexAdapter()]),
      preflightGate: selectedPreflight(target),
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'d'.repeat(64)}`,
        content: 'generate',
      })),
      spawnDetached,
      removeContainer: vi.fn(),
      fetchFn,
      randomUUID: () => ATTEMPT_ID,
      leaseOwner: LEASE_OWNER,
      brainUrl: 'http://brain.internal:5221',
      machineId: 'us-mac-m4',
      env: {
        KERNEL_FLEET_REMOTE_ENABLED: 'true',
        XIAN_M4_KERNEL_BRIDGE_URL: 'http://xian-m4.internal:3458',
        XIAN_M1_KERNEL_BRIDGE_URL: 'http://xian-m1.internal:3458',
        KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
        BRAIN_URL: 'http://brain.internal:5221',
      },
    });

    await expect(deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 12,
      observed: observed(),
      decision: { phase: 'generate', reason: 'contract_approved' },
    })).resolves.toMatchObject({
      status: 'DONE',
      attemptId: ATTEMPT_ID,
    });

    expect(spawnDetached).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledWith(
      'http://xian-m4.internal:3458/harness/attempts',
      expect.objectContaining({ method: 'POST' }),
    );
    const bridgeRequest = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(bridgeRequest).toMatchObject({
      attempt_id: ATTEMPT_ID,
      lease_owner: LEASE_OWNER,
      lease_generation: 4,
      target,
      callback_url: `http://brain.internal:5221/api/brain/harness/attempts/${ATTEMPT_ID}/callback`,
    });
    expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'xian-mac-m4',
    }));
    expect(attemptStore.recordLaunchReceipt).toHaveBeenCalledWith(ATTEMPT_ID, {
      leaseOwner: LEASE_OWNER,
      leaseGeneration: 4,
      actualMachineId: 'xian-mac-m4',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-production-1',
      attestationStatus: 'verified',
    });
  });

  it.each([
    ['disabled by default', {}],
    ['missing selected bridge URL', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      XIAN_M1_KERNEL_BRIDGE_URL: 'http://xian-m1.internal:3458',
      KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
    }],
    ['missing shared token', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      XIAN_M4_KERNEL_BRIDGE_URL: 'http://xian-m4.internal:3458',
      XIAN_M1_KERNEL_BRIDGE_URL: 'http://xian-m1.internal:3458',
    }],
  ])('fails closed when remote transport is %s', async (_description, env) => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const attemptStore = attemptStoreDouble();
    const spawnDetached = vi.fn();
    const fetchFn = vi.fn();
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      attemptStore,
      registry: createProviderRegistry([codexAdapter()]),
      preflightGate: selectedPreflight(target),
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'e'.repeat(64)}`,
        content: 'generate',
      })),
      spawnDetached,
      removeContainer: vi.fn(),
      fetchFn,
      randomUUID: () => ATTEMPT_ID,
      leaseOwner: LEASE_OWNER,
      brainUrl: 'http://brain.internal:5221',
      machineId: 'us-mac-m4',
      env,
    });

    await expect(deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 13,
      observed: observed(),
      decision: { phase: 'generate' },
    })).rejects.toThrow('execution_transport_unavailable:xian-mac-m4');

    expect(spawnDetached).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(attemptStore.fail).toHaveBeenCalledWith(ATTEMPT_ID, {
      code: 'launch_failed',
      message: [
        'execution_transport_unavailable:xian-mac-m4',
        'orphan cancellation failed: execution_transport_unavailable:xian-mac-m4',
      ].join('; '),
    }, {
      leaseOwner: LEASE_OWNER,
      leaseGeneration: 4,
    });
  });

  it('cancels by Attempt when Bridge accepts but remote attestation validation fails', async () => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const attemptStore = attemptStoreDouble();
    const spawnDetached = vi.fn();
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/harness/attempts')) {
        return response({
          status: 'accepted',
          job_id: 'unverified-remote-job',
          actual_machine_id: target.machine,
          attestation: '0'.repeat(64),
        }, 202);
      }
      if (String(url).endsWith(`/harness/attempts/${ATTEMPT_ID}/cancel`)) {
        return response({ status: 'cancelled', job_id: 'unverified-remote-job' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      attemptStore,
      registry: createProviderRegistry([codexAdapter()]),
      preflightGate: selectedPreflight(target),
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'1'.repeat(64)}`,
        content: 'generate',
      })),
      spawnDetached,
      removeContainer: vi.fn(),
      fetchFn,
      randomUUID: () => ATTEMPT_ID,
      leaseOwner: LEASE_OWNER,
      brainUrl: 'http://brain.internal:5221',
      machineId: 'us-mac-m4',
      env: {
        KERNEL_FLEET_REMOTE_ENABLED: 'true',
        XIAN_M4_KERNEL_BRIDGE_URL: 'http://xian-m4.internal:3458',
        XIAN_M1_KERNEL_BRIDGE_URL: 'http://xian-m1.internal:3458',
        KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
      },
    });

    await expect(deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 14,
      observed: observed(),
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote_bridge_attestation_invalid');

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://xian-m4.internal:3458/harness/attempts',
      `http://xian-m4.internal:3458/harness/attempts/${ATTEMPT_ID}/cancel`,
    ]);
    expect(attemptStore.fail).toHaveBeenCalledWith(ATTEMPT_ID, {
      code: 'launch_failed',
      message: 'remote_bridge_attestation_invalid',
    }, {
      leaseOwner: LEASE_OWNER,
      leaseGeneration: 4,
    });
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('never falls back to local Docker when an enabled remote launch fails', async () => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m1',
    };
    const attemptStore = attemptStoreDouble();
    const spawnDetached = vi.fn();
    const fetchFn = vi.fn(async () => {
      throw new Error('bridge offline');
    });
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      attemptStore,
      registry: createProviderRegistry([codexAdapter()]),
      preflightGate: selectedPreflight(target),
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'f'.repeat(64)}`,
        content: 'generate',
      })),
      spawnDetached,
      removeContainer: vi.fn(),
      fetchFn,
      randomUUID: () => ATTEMPT_ID,
      leaseOwner: LEASE_OWNER,
      brainUrl: 'http://brain.internal:5221',
      machineId: 'us-mac-m4',
      env: {
        KERNEL_FLEET_REMOTE_ENABLED: 'true',
        XIAN_M4_KERNEL_BRIDGE_URL: 'http://xian-m4.internal:3458',
        XIAN_M1_KERNEL_BRIDGE_URL: 'http://xian-m1.internal:3458',
        KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
      },
    });

    await expect(deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 14,
      observed: observed(),
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote_bridge_launch_request_failed');

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://xian-m1.internal:3458/harness/attempts',
      `http://xian-m1.internal:3458/harness/attempts/${ATTEMPT_ID}/cancel`,
    ]);
    expect(spawnDetached).not.toHaveBeenCalled();
  });
});
