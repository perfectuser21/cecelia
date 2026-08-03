import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRealDeps } from '../run.js';
import { getNodeProfile } from '../fleet-node/node-profile.js';
import { signMachineAttestation } from '../machine-attestation.js';
import { createProviderRegistry } from '../provider-registry.js';
import { createProductionCapabilityProbes } from './production-probes.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_OWNER = 'production-wiring:4242';
const SHARED_SECRET = 'production-wiring-secret-at-least-32-bytes';
const WORKER_URL = 'http://us-fleet-worker.internal:5231';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const GIB = 1024 ** 3;

function testCredentialPayload() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 3 * 60 * 60,
  })).toString('base64url');
  return JSON.stringify({
    tokens: {
      access_token: `${header}.${claims}.test-signature`,
    },
  });
}

function buildTestDeps(overrides = {}) {
  return buildRealDeps({
    resolveRepoHead: vi.fn(async () => BASE_SHA),
    loadCredential: vi.fn(async () => testCredentialPayload()),
    resolveGitHubToken: vi.fn(async () => 'github-pat-for-production-wiring-test'),
    ...overrides,
  });
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function admittedHealth(machineId = 'us-mac-m4') {
  const profile = getNodeProfile(machineId);
  const observedAt = new Date().toISOString();
  return {
    schema_version: 'fleet-node-health/v1',
    machine_id: machineId,
    observed_at: observedAt,
    worker: {
      protocol_version: profile.version_policy.worker_protocol,
      contract_version: profile.version_policy.worker_contract,
      version: profile.version_policy.worker,
    },
    runner: {
      version: profile.version_policy.runner,
      image_digest: profile.runner_image_digest,
    },
    os: { version: profile.version_policy.os },
    orbstack: { version: profile.version_policy.orbstack },
    docker: { available: true, observed_at: observedAt },
    resources: {
      cpu_cores: profile.resources.cpu_cores,
      memory_bytes: profile.resources.memory_gib * GIB,
      disk_free_bytes: profile.resources.disk_min_free_gib * GIB,
      disk_used_percent: profile.resources.disk_max_used_percent,
      cpu_pressure_percent: 0,
      memory_pressure_percent: 0,
    },
    git: { available: true, version: profile.version_policy.git },
    node: { available: true, version: profile.version_policy.node },
    codex: { available: true, version: profile.version_policy.codex },
    tailscale: { connected: true },
    callback: { reachable: true },
    time_sync: { synchronized: true },
    power: { sleep_disabled: true, auto_power_on: true },
    launchd: {
      loaded: true,
      domain: profile.launchd.domain,
      kind: profile.launchd.kind,
    },
    worktree: { root_ready: true },
    container: { probe_succeeded: true },
    runtime_resources: {
      postgres: {
        available: true,
        image_digest: profile.runtime_resources.postgres.image_digest,
      },
    },
    drain: { active: false },
  };
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

function dispatchReadyProductionProbes({
  pool,
  registry,
  fetchFn,
  resolveGitHubTokenFn,
  env,
  postgresAvailable = true,
}) {
  return createProductionCapabilityProbes({
    pool,
    registry,
    fetchFn,
    resolveGitHubTokenFn,
    env,
    requestTimeoutMs: 100,
    nodeAdmissionClient: {
      getAdmission: vi.fn(async (machine) => {
        const profile = getNodeProfile(machine);
        return {
          machine_id: machine,
          state: 'base_admitted',
          base_admitted: true,
          dispatch_ready: true,
          runtime_resources: {
            postgres: {
              available: postgresAvailable,
              image_digest: profile.runtime_resources.postgres.image_digest,
            },
          },
          reasons: [],
        };
      }),
    },
  });
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

  it('buildRealDeps admits a policy-matched Worker and launches through the Fleet receipt contract', async () => {
    process.env.CECELIA_MACHINE_ID = 'us-mac-m4';
    const order = [];
    const fetchFn = vi.fn(async (url) => {
      order.push(`fetch:${url}`);
      if (String(url) === `${WORKER_URL}/health`) return response(admittedHealth());
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
      prepare: vi.fn(async () => {
        order.push('prepare');
        return Object.freeze({
          actualMachineId: 'us-mac-m4',
          executionTransport: 'fleet-worker',
          remoteJobId: 'worker-1',
          attestationStatus: 'verified',
          containerId: null,
          jobId: 'worker-1',
        });
      }),
      start: vi.fn(async () => {
        order.push('start');
        return { status: 'running', attempt_id: ATTEMPT_ID };
      }),
      cancel: vi.fn(),
    };

    const deps = await buildTestDeps({
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
      env: {
        CECELIA_MACHINE_ID: 'us-mac-m4',
        FLEET_WORKER_US_MAC_M4_URL: WORKER_URL,
      },
    });

    const result = await deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 9,
      observed: observed(),
      decision: { phase: 'generate', reason: 'contract_approved' },
    });

    expect(result).toMatchObject({
      status: 'LAUNCHED',
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      `${WORKER_URL}/health`,
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
    expect(attemptStore.createAttempt).toHaveBeenCalledOnce();
    expect(adapter.start).toHaveBeenCalledOnce();
    expect(launcher.prepare).toHaveBeenCalledOnce();
    expect(launcher.start).toHaveBeenCalledOnce();
    expect(order).toEqual(expect.arrayContaining([
      'createAttempt',
      'claimAttempt',
      'adapter.start',
      'prepare',
      'recordReceipt',
      'start',
    ]));
  });

  it('uses the healthy fallback account for persistence, account home, and launch', async () => {
    process.env.CECELIA_MACHINE_ID = 'us-mac-m4';
    const accountHomes = [];
    const startedExecutions = [];
    const fetchFn = vi.fn(async (url) => {
      if (String(url) === `${WORKER_URL}/health`) return response(admittedHealth());
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 4,
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
      prepare: vi.fn(async (input) => Object.freeze({
        actualMachineId: input.target.machine,
        executionTransport: 'fleet-worker',
        remoteJobId: `worker-${input.attempt.accountId}`,
        attestationStatus: 'verified',
        jobId: `worker-${input.attempt.accountId}`,
      })),
      start: vi.fn(async (input) => ({
        status: 'running',
        attempt_id: input.attempt.id,
      })),
      cancel: vi.fn(),
    };
    const pool = { query: vi.fn(async () => ({ rows: [{ ok: 1 }] })) };
    const registry = createProviderRegistry([adapter]);
    const env = {
      CECELIA_MACHINE_ID: 'us-mac-m4',
      FLEET_WORKER_US_MAC_M4_URL: WORKER_URL,
    };
    const resolveGitHubToken = vi.fn(async () => 'secret-token');
    const deps = await buildTestDeps({
      pool,
      attemptStore,
      registry,
      launcher,
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'b'.repeat(64)}`,
        content: 'generate',
      })),
      fetchFn,
      resolveGitHubToken,
      productionProbes: dispatchReadyProductionProbes({
        pool,
        registry,
        fetchFn,
        resolveGitHubTokenFn: resolveGitHubToken,
        env,
      }),
      resolveAccountHome: vi.fn((_provider, account) => {
        accountHomes.push(account);
        return `/accounts/${account}`;
      }),
      leaseOwner: LEASE_OWNER,
      env,
    });

    const result = await deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 10,
      observed: observed({
        role_assignments: {
          generator: {
            provider: 'codex',
            account: 'team4',
            machine: 'us-mac-m4',
            fallback_targets: [{
              provider: 'codex',
              account: 'team1',
              machine: 'us-mac-m4',
            }],
          },
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

    expect(result).toMatchObject({ status: 'LAUNCHED', provider: 'codex' });
    expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'team1',
      machineId: 'us-mac-m4',
    }));
    expect(accountHomes.at(-1)).toBe('team1');
    expect(startedExecutions).toContainEqual(expect.objectContaining({
      codexHome: '/accounts/team1',
    }));
    expect(launcher.prepare).toHaveBeenCalledWith(expect.objectContaining({
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

  it('selected Worker PostgreSQL runtime unavailable is BLOCKED and creates no attempt', async () => {
    process.env.CECELIA_MACHINE_ID = 'us-mac-m4';
    const fetchFn = vi.fn(async (url) => {
      if (String(url) === `${WORKER_URL}/health`) return response(admittedHealth());
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 4,
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
    const pool = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes('SELECT 1')) {
          const error = new Error('connection refused');
          error.code = 'ECONNREFUSED';
          throw error;
        }
        return { rows: [] };
      }),
    };
    const registry = createProviderRegistry([adapter]);
    const env = {
      CECELIA_MACHINE_ID: 'us-mac-m4',
      FLEET_WORKER_US_MAC_M4_URL: WORKER_URL,
    };
    const resolveGitHubToken = vi.fn(async () => 'secret-token');
    const deps = await buildTestDeps({
      pool,
      attemptStore,
      registry,
      launcher,
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'c'.repeat(64)}`,
        content: 'generate',
      })),
      fetchFn,
      resolveGitHubToken,
      productionProbes: dispatchReadyProductionProbes({
        pool,
        registry,
        fetchFn,
        resolveGitHubTokenFn: resolveGitHubToken,
        env,
        postgresAvailable: false,
      }),
      env,
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
      fallback_reason: 'postgres_runtime_unavailable',
      should_create_attempt: false,
      should_enter_generator_fix: false,
    });
    expect(attemptStore.createAttempt).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('constructs the real Fleet transport and commits its attested receipt before start', async () => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const order = [];
    const attemptStore = attemptStoreDouble();
    attemptStore.recordLaunchReceipt.mockImplementationOnce(async (id, receipt) => {
      order.push('receipt');
      return { id, status: 'starting', ...receipt };
    });
    const spawnDetached = vi.fn();
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/harness/attempts/prepare')) {
        order.push('prepare');
        return response({
          status: 'accepted',
          job_id: 'remote-job-production-1',
          actual_machine_id: target.machine,
          attestation: signMachineAttestation({
            secret: SHARED_SECRET,
            attemptId: ATTEMPT_ID,
            machineId: target.machine,
            jobId: 'remote-job-production-1',
          }),
        }, 202);
      }
      if (String(url).endsWith(`/harness/attempts/${ATTEMPT_ID}/start`)) {
        order.push('start');
        return response({ status: 'running', attempt_id: ATTEMPT_ID });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const deps = await buildTestDeps({
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
        FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4.internal:5231',
        FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
        KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
        KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'https://brain.public.example',
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
      status: 'LAUNCHED',
      attempt_id: ATTEMPT_ID,
    });

    expect(spawnDetached).not.toHaveBeenCalled();
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://xian-m4.internal:5231/harness/attempts/prepare',
      `http://xian-m4.internal:5231/harness/attempts/${ATTEMPT_ID}/start`,
    ]);
    expect(order).toEqual(['prepare', 'receipt', 'start']);
    const bridgeRequest = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(bridgeRequest).toMatchObject({
      attempt_id: ATTEMPT_ID,
      lease_owner: LEASE_OWNER,
      lease_generation: 4,
      target,
      callback_url: `https://brain.public.example/api/brain/harness/attempts/${ATTEMPT_ID}/callback`,
      workspace_spec: expect.objectContaining({
        repo: 'perfectuser21/cecelia',
        attempt_id: ATTEMPT_ID,
      }),
    });
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({
      lease_owner: LEASE_OWNER,
      lease_generation: 4,
    });
    expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'xian-mac-m4',
    }));
    expect(attemptStore.recordLaunchReceipt).toHaveBeenCalledWith(ATTEMPT_ID, {
      leaseOwner: LEASE_OWNER,
      leaseGeneration: 4,
      actualMachineId: 'xian-mac-m4',
      executionTransport: 'fleet-worker',
      remoteJobId: 'remote-job-production-1',
      attestationStatus: 'verified',
    });
  });

  it.each([
    ['disabled by default', {}, false],
    ['missing selected bridge URL', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
      KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
      KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'https://brain.public.example',
    }, false],
    ['missing shared token', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4.internal:5231',
      FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
      KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'https://brain.public.example',
    }, false],
    ['missing remote callback base', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4.internal:5231',
      FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
      KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
    }, true],
    ['invalid remote callback base', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4.internal:5231',
      FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
      KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
      KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'ftp://brain.public.example',
    }, true],
  ])('fails closed when remote transport is %s', async (_description, env, canExactCancel) => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const attemptStore = attemptStoreDouble();
    const spawnDetached = vi.fn();
    const fetchFn = vi.fn(async (url) => {
      if (canExactCancel && String(url).endsWith(`/harness/attempts/${ATTEMPT_ID}/cancel`)) {
        return response({ status: 'already_clean', attempt_id: ATTEMPT_ID });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const deps = await buildTestDeps({
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
    if (canExactCancel) {
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(fetchFn.mock.calls[0][0]).toBe(
        `http://xian-m4.internal:5231/harness/attempts/${ATTEMPT_ID}/cancel`,
      );
      expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
        lease_owner: LEASE_OWNER,
        lease_generation: 4,
      });
    } else {
      expect(fetchFn).not.toHaveBeenCalled();
    }
    expect(attemptStore.fail).toHaveBeenCalledWith(ATTEMPT_ID, {
      code: 'launch_failed',
      message: canExactCancel
        ? 'execution_transport_unavailable:xian-mac-m4'
        : [
            'execution_transport_unavailable:xian-mac-m4',
            'orphan cancellation failed: execution_transport_unavailable:xian-mac-m4',
          ].join('; '),
    }, {
      leaseOwner: LEASE_OWNER,
      leaseGeneration: 4,
    });
  });

  it('never treats an injected xian controller identity as local Docker', async () => {
    const target = {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    };
    const attemptStore = attemptStoreDouble();
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const deps = await buildTestDeps({
      pool: { query: vi.fn() },
      attemptStore,
      registry: createProviderRegistry([codexAdapter()]),
      preflightGate: selectedPreflight(target),
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'9'.repeat(64)}`,
        content: 'generate',
      })),
      spawnDetached,
      removeContainer: vi.fn(),
      randomUUID: () => ATTEMPT_ID,
      leaseOwner: LEASE_OWNER,
      env: {
        CECELIA_MACHINE_ID: 'xian-mac-m4',
      },
    });

    await expect(deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 15,
      observed: observed(),
      decision: { phase: 'generate' },
    })).rejects.toThrow('execution_transport_unavailable:xian-mac-m4');
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical controller machine identity during assembly', async () => {
    await expect(buildTestDeps({
      pool: { query: vi.fn() },
      dispatch: vi.fn(),
      env: { CECELIA_MACHINE_ID: 'moon-base' },
    })).rejects.toThrow('invalid_kernel_machine_id:moon-base');
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
      if (String(url).endsWith('/harness/attempts/prepare')) {
        return response({
          status: 'accepted',
          job_id: 'unverified-remote-job',
          actual_machine_id: target.machine,
          attestation: '0'.repeat(64),
        }, 202);
      }
      if (String(url).endsWith(`/harness/attempts/${ATTEMPT_ID}/cancel`)) {
        return response({ status: 'cleaned', attempt_id: ATTEMPT_ID });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const deps = await buildTestDeps({
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
        FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4.internal:5231',
        FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
        KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
        KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'https://brain.public.example',
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
      'http://xian-m4.internal:5231/harness/attempts/prepare',
      `http://xian-m4.internal:5231/harness/attempts/${ATTEMPT_ID}/cancel`,
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

  it('never falls back to local Docker when an enabled remote prepare fails', async () => {
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
    const deps = await buildTestDeps({
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
        FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4.internal:5231',
        FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1.internal:5231',
        KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
        KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'https://brain.public.example',
      },
    });

    await expect(deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 14,
      observed: observed(),
      decision: { phase: 'generate' },
    })).rejects.toThrow('remote_bridge_prepare_request_failed');

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://xian-m1.internal:5231/harness/attempts/prepare',
      `http://xian-m1.internal:5231/harness/attempts/${ATTEMPT_ID}/cancel`,
    ]);
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('buildRealDeps still blocks before Attempt creation when canonical Worker evidence drifts', async () => {
    const workerUrl = 'http://us-fleet-worker.internal:5231';
    const fetchFn = vi.fn(async (url) => {
      if (String(url) === `${workerUrl}/health`) {
        const health = admittedHealth();
        return response({
          ...health,
          runner: {
            ...health.runner,
            image_digest: `cecelia/runner@sha256:${'0'.repeat(64)}`,
          },
        });
      }
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 8,
            physical_capacity: 8,
            pressure: 0,
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
    const attemptStore = attemptStoreDouble();
    const launcher = {
      launch: vi.fn(async () => Object.freeze({
        actualMachineId: 'us-mac-m4',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'must-not-launch',
        jobId: null,
      })),
      cancel: vi.fn(),
    };
    const deps = await buildTestDeps({
      pool: { query: vi.fn(async () => ({ rows: [{ ok: 1 }] })) },
      attemptStore,
      registry: createProviderRegistry([codexAdapter()]),
      launcher,
      handlers: {},
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'7'.repeat(64)}`,
        content: 'generate',
      })),
      fetchFn,
      resolveGitHubToken: vi.fn(async () => 'secret-token'),
      env: {
        CECELIA_MACHINE_ID: 'us-mac-m4',
        FLEET_WORKER_US_MAC_M4_URL: workerUrl,
      },
      onPreflightBlocked: vi.fn(),
    });

    const result = await deps.dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 16,
      observed: observed(),
      decision: { phase: 'generate' },
    });

    expect(fetchFn).toHaveBeenCalledWith(
      `${workerUrl}/health`,
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      control_status: 'BLOCKED',
      fallback_reason: 'node_not_base_admitted',
      should_create_attempt: false,
    });
    expect(attemptStore.createAttempt).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
  });
});
