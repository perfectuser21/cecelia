import { describe, expect, it, vi } from 'vitest';

import { buildCapabilityEvidence, createCapabilityGate } from './capability-gate.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadFactory() {
  const loaded = await import('./production-probes.js').catch(() => ({}));
  expect(loaded.createProductionCapabilityProbes).toBeTypeOf('function');
  return loaded.createProductionCapabilityProbes;
}

describe('production capability probes', () => {
  it('keeps the 20s Fleet admission budget separate from generic 5s HTTP calls', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const getAdmission = vi.fn(async () => null);
    const createNodeAdmissionClientFn = vi.fn(() => ({ getAdmission }));

    createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      requestTimeoutMs: 5_000,
      createNodeAdmissionClientFn,
    });

    expect(createNodeAdmissionClientFn).toHaveBeenCalledWith(expect.objectContaining({
      requestTimeoutMs: 20_000,
    }));
  });

  it('reads Brain-owned fleet and account state and verifies required capabilities', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const nodeAdmissionClient = {
      getAdmission: vi.fn(async (machine) => ({
        machine_id: machine,
        state: 'base_admitted',
        base_admitted: true,
        dispatch_ready: true,
        runtime_resources: {
          postgres: {
            available: true,
            image_digest: `sha256:${'f'.repeat(64)}`,
          },
        },
        reasons: [],
      })),
    };
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 5,
            physical_capacity: 9,
            pressure: 0.2,
          }],
        });
      }
      if (String(url).endsWith('/api/brain/dispatch/llm-capacity')) {
        return response({
          sentinel: 'ok',
          vendors: {
            codex: {
              accounts: [
                { name: 'team4', available: false, source: 'http_503' },
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
    const pool = {
      query: vi.fn(async () => ({ rows: [{ ok: 1 }] })),
    };
    const registry = {
      get: vi.fn(() => ({ capabilities: ['structured_output'] })),
    };
    const probes = createProductionCapabilityProbes({
      pool,
      registry,
      fetchFn,
      resolveGitHubTokenFn: vi.fn(async () => 'secret-token'),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      requestTimeoutMs: 100,
      nodeAdmissionClient,
    });

    await expect(probes.resolveCanonicalMachineId()).resolves.toBe('us-mac-m4');
    await expect(probes.getMachineHealth({ machine: 'us-mac-m4' })).resolves.toMatchObject({
      ok: true,
      machine: 'us-mac-m4',
    });
    await expect(probes.getMachineCapacity({
      machine: 'us-mac-m4',
      task_bundle: { role: 'planner' },
    })).resolves.toMatchObject({
      ok: true,
      available: 5,
      physical_capacity: 7,
    });
    expect(nodeAdmissionClient.getAdmission).toHaveBeenNthCalledWith(1, 'us-mac-m4', {
      forceFresh: true,
    });
    expect(nodeAdmissionClient.getAdmission).toHaveBeenNthCalledWith(2, 'us-mac-m4', {
      forceFresh: true,
    });
    await expect(probes.listProviderAccounts({ provider: 'codex' })).resolves.toEqual([
      'team4',
      'team1',
    ]);
    await expect(probes.probeProviderAuth({
      provider: 'codex',
      account: 'team4',
    })).resolves.toMatchObject({
      ok: false,
      signature: 'http_503',
    });
    await expect(probes.probeProviderAuth({
      provider: 'codex',
      account: 'team1',
    })).resolves.toMatchObject({
      ok: true,
      source: 'usage_api',
    });
    await expect(probes.probeGitHub()).resolves.toMatchObject({
      ok: true,
      login: 'cecelia-ci',
    });
    await expect(probes.probePostgres({
      target: { machine: 'us-mac-m4' },
    })).resolves.toEqual({
      ok: true,
      image_digest: `sha256:${'f'.repeat(64)}`,
    });
    expect(pool.query).not.toHaveBeenCalled();
    await expect(probes.probeModelCapability({
      capability: 'structured_output',
      target: { provider: 'codex' },
    })).resolves.toEqual({
      ok: true,
      capability: 'structured_output',
    });
  });

  it('does not let the Brain-local pool impersonate PostgreSQL on the selected Worker', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const pool = { query: vi.fn(async () => ({ rows: [{ ok: 1 }] })) };
    const nodeAdmissionClient = {
      getAdmission: vi.fn(async () => ({
        machine_id: 'us-mac-m4',
        state: 'base_admitted',
        base_admitted: true,
        dispatch_ready: true,
        runtime_resources: {
          postgres: {
            available: false,
            image_digest: null,
          },
        },
        reasons: [],
      })),
    };
    const probes = createProductionCapabilityProbes({
      pool,
      registry: { get: vi.fn() },
      fetchFn: vi.fn(),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      nodeAdmissionClient,
    });

    await expect(probes.probePostgres({
      target: { machine: 'us-mac-m4' },
    })).resolves.toEqual({
      ok: false,
      signature: 'postgres_runtime_unavailable',
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each([
    ['planner', 8, 8],
    ['proposer', 4, 4],
    ['generator', 2, 2],
    ['reporter', 8, 8],
  ])('converts eight canonical base slots into %s role units', async (
    role,
    available,
    physicalCapacity,
  ) => {
    const createProductionCapabilityProbes = await loadFactory();
    const probes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(async () => response({
        fleet: [{
          id: 'xian-mac-m4',
          online: true,
          effective_slots: 12,
          physical_capacity: 12,
          pressure: 0,
        }],
      })),
      env: { CECELIA_MACHINE_ID: 'xian-mac-m4' },
      nodeAdmissionClient: {
        getAdmission: vi.fn(async () => ({
          state: 'base_admitted',
          base_admitted: true,
          dispatch_ready: true,
          reasons: [],
        })),
      },
    });

    await expect(probes.getMachineCapacity({
      machine: 'xian-mac-m4',
      task_bundle: { role },
    })).resolves.toMatchObject({
      ok: true,
      available,
      physical_capacity: physicalCapacity,
      role,
    });
  });

  it.each([undefined, '', 'observer'])(
    'fails admitted capacity closed for unsupported role %s',
    async (role) => {
      const createProductionCapabilityProbes = await loadFactory();
      const fetchFn = vi.fn();
      const probes = createProductionCapabilityProbes({
        pool: { query: vi.fn() },
        registry: { get: vi.fn() },
        fetchFn,
        env: { CECELIA_MACHINE_ID: 'xian-mac-m4' },
        nodeAdmissionClient: {
          getAdmission: vi.fn(async () => ({
            state: 'base_admitted',
            base_admitted: true,
            dispatch_ready: true,
            reasons: [],
          })),
        },
      });

      await expect(probes.getMachineCapacity({
        machine: 'xian-mac-m4',
        task_bundle: role === undefined ? {} : { role },
      })).resolves.toMatchObject({
        ok: false,
        available: 0,
        physical_capacity: 0,
        signature: 'unknown_fleet_role',
      });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each(['proposer', 'generator', 'evaluator', 'judge'])(
    'gives autonomous %s one singleton slot when admitted online base capacity is positive',
    async (role) => {
      const createProductionCapabilityProbes = await loadFactory();
      const probes = createProductionCapabilityProbes({
        pool: { query: vi.fn() },
        registry: { get: vi.fn() },
        fetchFn: vi.fn(async () => response({
          fleet: [{
            id: 'us-mac-m4',
            online: true,
            effective_slots: 1,
            physical_capacity: 1,
            pressure: 0.27,
          }],
        })),
        env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
        nodeAdmissionClient: {
          getAdmission: vi.fn(async () => ({
            state: 'base_admitted',
            base_admitted: true,
            dispatch_ready: true,
            reasons: [],
          })),
        },
      });

      const automatic = await probes.getMachineCapacity({
        machine: 'us-mac-m4',
        task_bundle: { role },
      });
      const auditedManual = await probes.getMachineCapacity({
        machine: 'us-mac-m4',
        task_bundle: { role, inputs: { manual_dispatch: true } },
      });

      expect(automatic).toMatchObject({
        ok: true,
        available: 1,
        physical_capacity: 1,
        autonomous_progress_floor: true,
        effective_base_slots: 1,
        physical_base_slots: 1,
      });
      expect(auditedManual).toEqual(automatic);
      expect(automatic).not.toHaveProperty('manual_capacity_override');
    },
  );

  it.each([
    ['effective zero', { online: true, effective_slots: 0, physical_capacity: 1 }],
    ['physical zero', { online: true, effective_slots: 1, physical_capacity: 0 }],
    ['offline', { online: false, effective_slots: 1, physical_capacity: 1 }],
  ])('keeps autonomous singleton floor blocked when machine is %s', async (_name, row) => {
    const createProductionCapabilityProbes = await loadFactory();
    const probes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(async () => response({
        fleet: [{ id: 'us-mac-m4', pressure: 1, ...row }],
      })),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      nodeAdmissionClient: {
        getAdmission: vi.fn(async () => ({
          state: 'base_admitted',
          base_admitted: true,
          dispatch_ready: true,
          reasons: [],
        })),
      },
    });

    for (const manual_dispatch of [false, true]) {
      const capacity = await probes.getMachineCapacity({
        machine: 'us-mac-m4',
        task_bundle: { role: 'generator', inputs: { manual_dispatch } },
      });
      expect(capacity).toMatchObject({
        ok: row.online,
        available: 0,
      });
      expect(capacity).not.toHaveProperty('autonomous_progress_floor');
      expect(capacity).not.toHaveProperty('manual_capacity_override');
    }
  });

  it('admits the real capability gate through the autonomous generator singleton floor', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const productionProbes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(async () => response({
        fleet: [{
          id: 'xian-mac-m4',
          online: true,
          effective_slots: 3,
          physical_capacity: 8,
          pressure: 0.6,
        }],
      })),
      env: { CECELIA_MACHINE_ID: 'xian-mac-m4' },
      nodeAdmissionClient: {
        getAdmission: vi.fn(async () => ({
          state: 'base_admitted',
          base_admitted: true,
          dispatch_ready: true,
          reasons: [],
        })),
      },
    });
    const gate = createCapabilityGate({
      ...productionProbes,
      probeTimeoutMs: 100,
    });

    await expect(gate.evaluate({
      preferred_target: {
        provider: 'codex',
        account: 'team1',
        machine: 'xian-mac-m4',
      },
      requirements: {},
      task_bundle: {
        role: 'generator',
        logical_cycle: 'weighted-capacity-gate',
      },
    })).resolves.toMatchObject({
      status: 'ok',
      should_create_attempt: true,
      evidence: {
        machine_capacity: {
          available: 1,
          autonomous_progress_floor: true,
        },
      },
    });
  });

  it('honors an audited manual dispatch when role-weighted slots round to zero', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const productionProbes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(async () => response({
        fleet: [{
          id: 'us-mac-m4',
          online: true,
          effective_slots: 1,
          physical_capacity: 2,
          pressure: 0.27,
        }],
      })),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      nodeAdmissionClient: {
        getAdmission: vi.fn(async () => ({
          state: 'base_admitted',
          base_admitted: true,
          dispatch_ready: true,
          reasons: [],
        })),
      },
    });
    const gate = createCapabilityGate({
      ...productionProbes,
      probeTimeoutMs: 100,
    });

    await expect(gate.evaluate({
      preferred_target: {
        provider: 'claude',
        account: 'account1',
        machine: 'us-mac-m4',
      },
      requirements: {},
      task_bundle: {
        role: 'evaluator',
        logical_cycle: 'manual-dispatch-capacity',
        inputs: { manual_dispatch: true },
      },
    })).resolves.toMatchObject({
      status: 'ok',
      evidence: {
        machine_capacity: {
          available: 1,
          physical_capacity: 1,
          autonomous_progress_floor: true,
          role_weight: 4,
        },
      },
    });
  });

  it('fails closed on missing canonical identity and GitHub rejection without leaking token', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const fetchFn = vi.fn(async (url, options) => {
      if (String(url).endsWith('/api/brain/capacity-budget')) {
        return response({ fleet: [{ id: 'us-mac-m4', online: true, effective_slots: 2 }] });
      }
      if (String(url) === 'https://api.github.com/user') {
        expect(options.headers.Authorization).toBe('Bearer top-secret');
        return response({ message: 'bad credentials' }, 401);
      }
      return response({ vendors: {} });
    });
    const probes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn,
      resolveGitHubTokenFn: vi.fn(async () => 'top-secret'),
      env: {},
      requestTimeoutMs: 100,
    });

    await expect(probes.resolveCanonicalMachineId()).rejects.toThrow(
      'missing canonical machine id',
    );
    const github = await probes.probeGitHub();
    expect(github).toEqual({
      ok: false,
      signature: 'github_http_401',
      http_status: 401,
    });
    expect(JSON.stringify(github)).not.toContain('top-secret');
  });

  // 2026-08-17 生产事故：GitHub 的 /user 端点 503（githubstatus: Partially Degraded），
  // 而我们真正要用的 /repos/<owner>/<repo> 是 200 —— kernel 却拿 /user 当 GitHub 可用性探针，
  // 于是每次派 Evaluator 都被 github_http_503 挡回，两条 run 在 evaluate 段停摆。
  // 探针必须探"真正要用的资源"：有 repo 上下文时探 repo 端点，无上下文才回落 /user。
  it('有 repo 上下文时探 repo 端点；/user 故障不影响判定', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const calls = [];
    const probes = createProductionCapabilityProbes({
      pool: { query: async () => ({ rows: [] }) },
      fetchFn: async (url) => {
        calls.push(String(url));
        if (String(url).includes('/user')) {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({ full_name: 'perfectuser21/cecelia' }) };
      },
      resolveGitHubTokenFn: async () => 'gh-token',
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      requestTimeoutMs: 100,
    });
    const github = await probes.probeGitHub({
      task_bundle: { inputs: { workspace_spec: { repo: 'perfectuser21/cecelia' } } },
    });
    expect(github.ok).toBe(true);
    expect(github.repo).toBe('perfectuser21/cecelia');
    expect(calls.some((u) => u.includes('/repos/perfectuser21/cecelia'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/user'))).toBe(false);
  });

  it('repo 端点 404/403 仍 fail-closed（探针不是免检通道）', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const probes = createProductionCapabilityProbes({
      pool: { query: async () => ({ rows: [] }) },
      fetchFn: async () => ({ ok: false, status: 403, json: async () => ({}) }),
      resolveGitHubTokenFn: async () => 'gh-token',
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      requestTimeoutMs: 100,
    });
    await expect(probes.probeGitHub({
      task_bundle: { inputs: { workspace_spec: { repo: 'perfectuser21/cecelia' } } },
    })).resolves.toMatchObject({ ok: false, signature: 'github_http_403', http_status: 403 });
  });

  it('redacts credential suffixes from nested capability evidence', () => {
    expect(buildCapabilityEvidence({
      access_token: 'access-secret',
      nested: {
        refresh_token: 'refresh-secret',
        cookie: 'cookie-secret',
        safe: 'visible',
      },
    })).toEqual({
      access_token: '[REDACTED]',
      nested: {
        refresh_token: '[REDACTED]',
        cookie: '[REDACTED]',
        safe: 'visible',
      },
    });
  });

  it.each([
    ['missing client and Worker URL', undefined, {}, 'node_not_base_admitted'],
    ['missing evidence', { getAdmission: vi.fn(async () => null) }, {
      FLEET_WORKER_US_MAC_M4_URL: 'http://worker.internal:5231',
    }, 'node_not_base_admitted'],
    ['explicit draining evidence', {
      getAdmission: vi.fn(async () => ({
        state: 'draining',
        base_admitted: false,
        dispatch_ready: false,
        reasons: [{ code: 'docker_unavailable', field: 'docker.available', message: 'down' }],
      })),
    }, {
      FLEET_WORKER_US_MAC_M4_URL: 'http://worker.internal:5231',
      FLEET_NODE_ADMISSION_ENFORCED: 'false',
    }, 'node_not_base_admitted'],
  ])('fails both health and capacity closed for %s', async (
    _name,
    nodeAdmissionClient,
    env,
    signature,
  ) => {
    const createProductionCapabilityProbes = await loadFactory();
    const probes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(async (url) => {
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
        throw new Error(`unexpected fetch: ${url}`);
      }),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4', ...env },
      nodeAdmissionClient,
    });

    await expect(probes.getMachineHealth({ machine: 'us-mac-m4' })).resolves.toMatchObject({
      ok: false,
      signature,
    });
    await expect(probes.getMachineCapacity({ machine: 'us-mac-m4' })).resolves.toMatchObject({
      ok: false,
      available: 0,
      signature,
    });
  });

  it('keeps Phase 4A base-admitted nodes closed until final dispatch readiness exists', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const probes = createProductionCapabilityProbes({
      pool: { query: vi.fn() },
      registry: { get: vi.fn() },
      fetchFn: vi.fn(async () => response({
        fleet: [{
          id: 'us-mac-m4',
          online: true,
          effective_slots: 8,
          physical_capacity: 8,
          pressure: 0,
        }],
      })),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      nodeAdmissionClient: {
        getAdmission: vi.fn(async () => ({
          machine_id: 'us-mac-m4',
          state: 'base_admitted',
          base_admitted: true,
          dispatch_ready: false,
          reasons: [],
        })),
      },
    });

    await expect(probes.getMachineHealth({ machine: 'us-mac-m4' })).resolves.toMatchObject({
      ok: false,
      signature: 'node_not_dispatch_ready',
    });
    await expect(probes.getMachineCapacity({
      machine: 'us-mac-m4',
      task_bundle: { role: 'generator' },
    })).resolves.toMatchObject({
      ok: false,
      available: 0,
      signature: 'node_not_dispatch_ready',
    });
  });
});
