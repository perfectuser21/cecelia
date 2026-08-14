import { describe, expect, it, vi } from 'vitest';

import { createRoutedTask } from '../../work-routing-store.js';

const REPOSITORIES = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];

describe('work-routing-store atomic boundary', () => {
  it('commits the canonical coding task and immutable receipt on one connection', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes('INSERT INTO tasks')) {
          return { rows: [{ id: 'task-pairing', task_type: 'harness_initiative' }] };
        }
        if (String(sql).includes('INSERT INTO work_routing_receipts')) {
          return { rows: [{ id: 'receipt-pairing' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    const created = await createRoutedTask(pool, {
      source: 'api',
      source_id: 'pairing-contract',
      title: 'route coding work',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      branch: 'cp-route-pairing',
      base_sha: 'a'.repeat(40),
    }, REPOSITORIES);

    expect(created).toMatchObject({
      task_id: 'task-pairing',
      routing_receipt_id: 'receipt-pairing',
      task: { task_type: 'harness_initiative' },
    });
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
