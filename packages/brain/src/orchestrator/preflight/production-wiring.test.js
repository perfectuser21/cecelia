import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRealDeps } from '../run.js';
import { createProviderRegistry } from '../provider-registry.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

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
        return { containerId: 'worker-1' };
      }),
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
    expect(order.slice(-3)).toEqual(['createAttempt', 'adapter.start', 'launch']);
  });
});
