import { describe, expect, it, vi } from 'vitest';

import { buildCapabilityEvidence } from './capability-gate.js';

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
  it('reads Brain-owned fleet and account state and verifies required capabilities', async () => {
    const createProductionCapabilityProbes = await loadFactory();
    const nodeAdmissionClient = {
      getAdmission: vi.fn(async (machine) => ({
        machine_id: machine,
        state: 'base_admitted',
        base_admitted: true,
        dispatch_ready: false,
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
    await expect(probes.getMachineCapacity({ machine: 'us-mac-m4' })).resolves.toMatchObject({
      ok: true,
      available: 5,
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
    await expect(probes.probePostgres()).resolves.toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1 AS ok');
    await expect(probes.probeModelCapability({
      capability: 'structured_output',
      target: { provider: 'codex' },
    })).resolves.toEqual({
      ok: true,
      capability: 'structured_output',
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
});
