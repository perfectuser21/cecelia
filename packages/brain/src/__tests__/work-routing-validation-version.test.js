import { describe, expect, it, vi } from 'vitest';

import { createRoutedTask } from '../work-routing-store.js';

const REPOSITORY_FACTS = [{ scope_key: 'cecelia', repo: 'cecelia', aliases: [] }];
const REQUEST = Object.freeze({
  source: 'api',
  source_id: 'legacy-route',
  title: 'route one coding mutation',
  mutation_intent: 'write',
  declared_change_kind: 'bugfix',
  repo_hint: 'cecelia',
  map_scope_hint: ['F1'],
  branch: 'cp-legacy-route',
  base_sha: 'a'.repeat(40),
});

function persistedReceipt(overrides = {}) {
  return {
    id: 'receipt-legacy',
    task_id: 'task-legacy',
    source: 'api',
    source_id: 'legacy-route',
    work_kind: 'coding_mutation',
    change_kind: 'bugfix',
    pipeline: 'harness',
    canonical_task_type: 'harness_initiative',
    default_execution_profile: 'hotfix-v1',
    execution_profile_override: null,
    repo: 'cecelia',
    map_scope: ['F1'],
    impact_contract_required: true,
    orchestrator: 'kernel-harness-v2',
    router_version: 'work-router-v1',
    route_reason: 'mutation_intent:write',
    evidence: {
      source: 'api', branch: 'cp-legacy-route', base_sha: 'a'.repeat(40),
    },
    map_scope_validation_version: null,
    created_at: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function replayClient({ status, hasV2Run, receipt = persistedReceipt() }) {
  return {
    query: vi.fn(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
      if (String(sql).includes('pg_advisory_xact_lock')) return { rows: [] };
      if (String(sql).includes('FROM work_routing_receipts r')) {
        return {
          rows: [{
            routing_receipt_id: receipt.id,
            task_id: receipt.task_id,
            persisted_receipt: receipt,
            id: receipt.task_id,
            status,
            has_v2_run: hasV2Run,
          }],
        };
      }
      if (String(sql).includes('INSERT INTO cecelia_events')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    release: vi.fn(),
  };
}

describe('work routing Map validation generation', () => {
  it.each(['queued', 'in_progress'])(
    'fails closed when a %s legacy coding task has never created a v2 run',
    async (status) => {
      const client = replayClient({ status, hasV2Run: false });

      await expect(createRoutedTask(client, REQUEST, REPOSITORY_FACTS))
        .rejects.toMatchObject({ code: 'legacy_route_snapshot_unvalidated' });

      expect(client.query.mock.calls.some(([sql]) => (
        String(sql).includes('WITH authoritative_scope AS')
        || String(sql).includes('UPDATE work_routing_receipts')
      ))).toBe(false);
    },
  );

  it('replays a terminal legacy receipt without revalidating or mutating history', async () => {
    const receipt = persistedReceipt();
    const before = JSON.stringify(receipt);
    const client = replayClient({ status: 'failed', hasV2Run: false, receipt });

    const replay = await createRoutedTask(client, REQUEST, REPOSITORY_FACTS);

    expect(replay).toMatchObject({ deduplicated: true, routing_receipt_id: receipt.id });
    expect(JSON.stringify(receipt)).toBe(before);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('WITH authoritative_scope AS')
      || String(sql).includes('UPDATE work_routing_receipts')
    ))).toBe(false);
  });

  it('replays a legacy receipt after that task has already created a v2 run', async () => {
    const client = replayClient({ status: 'queued', hasV2Run: true });

    await expect(createRoutedTask(client, REQUEST, REPOSITORY_FACTS)).resolves.toMatchObject({
      deduplicated: true,
      routing_receipt_id: 'receipt-legacy',
    });
  });

  it('writes the server-owned validation version with a newly validated coding receipt', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes('WITH authoritative_scope AS')) {
          return { rows: [{ node_key: 'F1' }] };
        }
        if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-new' }] };
        if (String(sql).includes('INSERT INTO work_routing_receipts')) {
          return { rows: [{ id: 'receipt-new' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    await createRoutedTask(client, { ...REQUEST, source_id: 'new-route' }, REPOSITORY_FACTS);

    const insert = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO work_routing_receipts')
    ));
    expect(insert[0]).toContain('map_scope_validation_version');
    expect(insert[1]).toContain('active-business-node-v1');
  });
});
