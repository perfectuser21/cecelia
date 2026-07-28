/* global AbortSignal, Response */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  MACHINE_IDS,
  createLiveDispatch,
} from './kernel-fleet-three-machine-canary.mjs';
import { getNodeProfile } from '../../src/orchestrator/fleet-node/node-profile.js';

const pool = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('../../src/db.js', () => ({ default: pool }));

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const GIB = 1024 ** 3;
const WORKER_URLS = Object.freeze({
  'us-mac-m4': 'http://us-worker.internal:5231',
  'xian-mac-m4': 'http://xian-m4-worker.internal:5231',
  'xian-mac-m1': 'http://xian-m1-worker.internal:5231',
});
const WORKER_ENV = Object.freeze({
  KERNEL_FLEET_BRIDGE_TOKEN: 'k'.repeat(32),
  FLEET_WORKER_US_MAC_M4_URL: WORKER_URLS['us-mac-m4'],
  FLEET_WORKER_XIAN_MAC_M4_URL: WORKER_URLS['xian-mac-m4'],
  FLEET_WORKER_XIAN_MAC_M1_URL: WORKER_URLS['xian-mac-m1'],
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function workerHealthResponse(machine) {
  const profile = getNodeProfile(machine);
  const policy = profile.version_policy;
  const observedAt = new Date().toISOString();
  return new Response(JSON.stringify({
    schema_version: 'fleet-node-health/v1',
    machine_id: machine,
    observed_at: observedAt,
    worker: {
      protocol_version: policy.worker_protocol,
      contract_version: policy.worker_contract,
      version: policy.worker,
    },
    runner: {
      version: policy.runner,
      image_digest: profile.runner_image_digest,
    },
    os: { version: policy.os },
    orbstack: { version: policy.orbstack },
    docker: { available: true, observed_at: observedAt },
    resources: {
      cpu_cores: profile.resources.cpu_cores,
      memory_bytes: profile.resources.memory_gib * GIB,
      disk_free_bytes: profile.resources.disk_min_free_gib * GIB,
      disk_used_percent: profile.resources.disk_max_used_percent,
      cpu_pressure_percent: profile.resources.cpu_pressure_max_percent - 1,
      memory_pressure_percent: profile.resources.memory_pressure_max_percent - 1,
    },
    git: { available: true, version: policy.git },
    node: { available: true, version: policy.node },
    codex: { available: true, version: `${policy.codex}-drift` },
    tailscale: { connected: true },
    callback: { reachable: true },
    time_sync: { synchronized: true },
    power: { sleep_disabled: true, auto_power_on: true },
    launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
    worktree: { root_ready: true },
    container: { probe_succeeded: true },
    drain: { active: false },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createLiveDispatch production probe wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(MACHINE_IDS)(
    'probes canonical %s identity and blocks a drifted node before attempt creation',
    async (targetMachine) => {
      pool.query.mockImplementation(async (sql, params) => {
        if (/FROM kernel_release_alert_outbox outbox/.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO initiative_runs/.test(sql)) {
          return { rows: [{ id: RUN_ID }], rowCount: 1 };
        }
        if (/SELECT provider, account_id, requested_machine_id/.test(sql)) {
          return { rows: [] };
        }
        if (/INSERT INTO harness_attempts/.test(sql)) {
          throw new Error(
            `attempt_creation_must_stay_blocked:${params[4]}:${params[7]}`,
          );
        }
        throw new Error(`unexpected query: ${sql}`);
      });
      const fetchFn = vi.fn(async (url) => {
        if (url === 'http://localhost:5221/api/brain/health') {
          return { ok: true, status: 200 };
        }
        const workerMachine = MACHINE_IDS.find(
          (machine) => url === `${WORKER_URLS[machine]}/health`,
        );
        if (workerMachine) return workerHealthResponse(workerMachine);
        if (url.endsWith('/api/brain/capacity-budget')) {
          return jsonResponse({
            fleet: MACHINE_IDS.map((machine) => ({
              id: machine,
              registered: true,
              online: true,
              effective_slots: 1,
              physical_capacity: 1,
              pressure: 0,
            })),
          });
        }
        if (url.endsWith('/api/brain/dispatch/llm-capacity')) {
          return jsonResponse({
            vendors: {
              codex: {
                accounts: [
                  { name: 'team1', available: true, source: 'test' },
                  { name: 'team2', available: true, source: 'test' },
                  { name: 'team5', available: true, source: 'test' },
                ],
              },
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchFn);
      const dispatch = await createLiveDispatch({
        runId: RUN_ID,
        brainUrl: 'http://localhost:5221',
        env: {
          CECELIA_MACHINE_ID: 'us-mac-m4',
          ...WORKER_ENV,
        },
        fetchFn,
      });

      try {
        await expect(dispatch({
          machine: targetMachine,
          attemptNumber: 1,
        })).rejects.toThrow(
          `canary_dispatch_failed:${targetMachine}:dispatch preflight blocked: `
            + 'node_not_base_admitted',
        );
      } finally {
        await dispatch.close();
      }

      expect(
        pool.query.mock.calls.some(([sql]) => /INSERT INTO harness_attempts/.test(sql)),
      ).toBe(false);
      expect(fetchFn).toHaveBeenCalledWith(
        `${WORKER_URLS[targetMachine]}/health`,
        expect.objectContaining({
          method: 'GET',
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );
});
