import { describe, it, expect, vi } from 'vitest';

import { createRoutedTask } from '../../../packages/brain/src/work-routing-store.js';
import { spawnHeadedKernelRuntime } from '../../../packages/brain/src/orchestrator/headed-kernel-runtime.js';

const REPOSITORIES = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];

// Fake pg client that captures the payload written to INSERT INTO tasks.
function makeRoutedClient(captured) {
  const client = {
    query: vi.fn(async (sql, params) => {
      const s = String(sql);
      if (s.includes('WITH authoritative_scope AS')) {
        const scope = Array.isArray(params?.[1]) ? params[1] : [];
        return { rows: scope.map((node_key) => ({ node_key })) };
      }
      if (s.includes('INSERT INTO tasks')) {
        captured.payload = JSON.parse(params[9]);
        return {
          rows: [{
            id: 'task-under-test',
            task_type: 'harness_initiative',
            status: 'queued',
            payload: captured.payload,
          }],
        };
      }
      if (s.includes('INSERT INTO work_routing_receipts')) {
        return { rows: [{ id: 'receipt-under-test' }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn(async () => client) };
}

function baseRequest(overrides = {}) {
  return {
    source: 'api',
    source_id: `commander-thread-${Math.abs((JSON.stringify(overrides)).length)}-${overrides.source_id ?? 'x'}`,
    title: 'route coding work',
    mutation_intent: 'write',
    declared_change_kind: 'bugfix',
    repo_hint: 'perfectuser21/cecelia',
    map_scope_hint: ['F1'],
    branch: 'cp-route-commander-thread',
    base_sha: 'a'.repeat(40),
    ...overrides,
  };
}

describe('commander入口透传 — createRoutedTask threads commander fields into task payload', () => {
  it('threads commander_mode and commander_profile into task payload', async () => {
    const captured = {};
    const pool = makeRoutedClient(captured);
    await createRoutedTask(pool, baseRequest({
      source_id: 'explicit-hybrid',
      commander_mode: 'hybrid',
      commander_profile: {
        primary: { provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
        fallbacks: [{ provider: 'claude', account: 'account2', machine: 'us-mac-m4' }],
      },
      commander_retry_budget: 3,
    }), REPOSITORIES);

    expect(captured.payload.commander_mode).toBe('hybrid');
    expect(captured.payload.commander.primary.provider).toBe('codex');
    expect(captured.payload.commander.primary.account).toBe('team2');
    expect(captured.payload.commander_retry_budget).toBe(3);
  });

  it('F1 map_scope with no explicit commander_mode defaults to hybrid + default profile', async () => {
    const captured = {};
    const pool = makeRoutedClient(captured);
    await createRoutedTask(pool, baseRequest({ source_id: 'f1-default' }), REPOSITORIES);

    expect(captured.payload.commander_mode).toBe('hybrid');
    expect(captured.payload.commander.primary).toMatchObject({
      provider: 'codex', account: 'team2', machine: 'us-mac-m4',
    });
    expect(captured.payload.commander.fallbacks[0]).toMatchObject({
      provider: 'claude', account: 'account2', machine: 'us-mac-m4',
    });
  });

  it('explicit kernel-only on an F1 task is respected (default hybrid does not override)', async () => {
    const captured = {};
    const pool = makeRoutedClient(captured);
    await createRoutedTask(pool, baseRequest({
      source_id: 'f1-explicit-kernel-only',
      commander_mode: 'kernel-only',
    }), REPOSITORIES);

    expect(captured.payload.commander_mode).toBe('kernel-only');
    expect(captured.payload.commander).toBeUndefined();
  });

  it('non-F1 task with no commander_mode is NOT defaulted (存量 kernel-only path unchanged)', async () => {
    const captured = {};
    const pool = makeRoutedClient(captured);
    await createRoutedTask(pool, baseRequest({
      source_id: 'non-f1',
      map_scope_hint: ['backbone-core'],
    }), REPOSITORIES);

    expect(captured.payload.commander_mode).toBeUndefined();
  });
});

describe('commander入口透传 — dispatch reads payload.commander_mode into createKernelRun', () => {
  it('passes task.payload.commander_mode to createKernelRun as commanderMode', async () => {
    const captured = {};
    const deps = {
      createKernelRun: async (_pool, input) => {
        captured.input = input;
        // Early-return path (run already exists) — avoids downstream launch deps.
        return { created: false, run: { id: 'run-under-test' } };
      },
    };
    await spawnHeadedKernelRuntime({
      task: {
        id: '11111111-1111-4111-8111-111111111111',
        ability_id: null,
        payload: { commander_mode: 'hybrid', journey_id: null },
      },
      dbPool: {},
      initiativeId: 'init-under-test',
      deps,
      gear: 'default',
    });

    expect(captured.input.commanderMode).toBe('hybrid');
  });
});
