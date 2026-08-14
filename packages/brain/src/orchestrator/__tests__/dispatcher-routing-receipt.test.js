import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assertDispatchRoutingReceipt, createDispatcher } from '../dispatcher.js';

describe('headless routing receipt gate', () => {
  it('rejects coding execution without canonical receipt', () => {
    expect(() => assertDispatchRoutingReceipt({ task_type: 'dev', payload: {} }, null)).toThrow('route_violation');
    expect(assertDispatchRoutingReceipt({ task_type: 'harness_initiative', id: 't1', payload: { routing_receipt_id: 'r1', change_kind: 'bugfix', repo: 'perfectuser21/cecelia' } }, { id: 'r1', task_id: 't1', superseded: false, router_version: 'work-router-v1', work_kind: 'coding_mutation', change_kind: 'bugfix', repo: 'perfectuser21/cecelia', pipeline: 'harness', canonical_task_type: 'harness_initiative', impact_contract_required: true })).toBe(true);
  });

  it('invokes the receipt assertion inside dispatch before Attempt creation', async () => {
    const source = await readFile(new URL('../dispatcher.js', import.meta.url), 'utf8');
    const dispatchBody = source.slice(source.indexOf('return async function dispatch'));
    const guard = dispatchBody.indexOf('assertDispatchRoutingReceipt(');
    const createAttempt = dispatchBody.indexOf('attemptStore.createAttempt(');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(createAttempt).toBeGreaterThan(guard);
  });

  it('records route_violation before refusing headless execution', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const dispatch = createDispatcher({ db });
    await expect(dispatch('spawn:generator', {
      observed: { task: { id: 'task-1', task_type: 'dev', payload: {} }, routingReceipt: null },
    })).rejects.toThrow('route_violation');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cecelia_events'),
      ['route_violation', expect.stringContaining('"task_id":"task-1"')],
    );
  });
});
