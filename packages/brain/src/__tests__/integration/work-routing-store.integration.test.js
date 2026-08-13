import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
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

  it('uses one checked-out connection and preserves canonical task fields', async () => {
    const calls = [];
    const client = {
      query: vi.fn(async (sql, args) => {
        calls.push([String(sql), args]);
        if (String(sql).includes('INSERT INTO tasks')) {
          return { rows: [{ id: 'task-2', task_type: 'harness_initiative', priority: 'P0' }] };
        }
        if (String(sql).includes('INSERT INTO work_routing_receipts')) {
          return { rows: [{ id: 'receipt-2' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    const result = await createRoutedTask(pool, {
      source: 'api',
      source_id: 'request-2',
      title: 'critical fix',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      task: { priority: 'P0', project_id: 'project-1', status: 'queued' },
    });

    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls.at(-1)[0]).toBe('COMMIT');
    expect(result.task).toMatchObject({ task_type: 'harness_initiative', priority: 'P0' });
    const taskInsert = calls.find(([sql]) => sql.includes('INSERT INTO tasks'));
    expect(taskInsert[0]).toContain('project_id');
    expect(taskInsert[1]).toContain('P0');
    expect(taskInsert[1]).toContain('project-1');
  });

  it('joins an existing transaction without nested BEGIN/COMMIT', async () => {
    const calls = [];
    const client = { query: vi.fn(async (sql) => {
      calls.push(String(sql));
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-3' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-3' }] };
      return { rows: [] };
    }) };

    await createRoutedTask(client, {
      source: 'inbox', source_id: 'atom-3', title: 'fix', mutation_intent: 'unknown',
      declared_change_kind: 'bugfix', repo_hint: 'perfectuser21/cecelia',
    }, [], { transaction: 'existing' });

    expect(calls).not.toContain('BEGIN');
    expect(calls).not.toContain('COMMIT');
    expect(calls).not.toContain('ROLLBACK');
  });
});
