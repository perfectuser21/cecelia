import { describe, expect, it } from 'vitest';
import { createRoutedTask } from '../../work-routing-store.js';

describe('routing store transaction contract', () => {
  it('creates task and immutable receipt in one client transaction', async () => {
    const calls = [];
    const client = { query: async (sql, args) => {
      calls.push([sql, args]);
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-1' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-1' }] };
      return { rows: [] };
    }};
    const result = await createRoutedTask(client, { source: 'api', source_id: '1', title: 'fix', mutation_intent: 'write', declared_change_kind: 'bugfix', repo_hint: 'perfectuser21/cecelia' });
    expect(result).toMatchObject({ task_id: 'task-1', routing_receipt_id: 'receipt-1' });
    expect(calls.map(([sql]) => sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
  });
});
