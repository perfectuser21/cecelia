import { describe, expect, it } from 'vitest';
import { assertDispatchRoutingReceipt } from '../dispatcher.js';

describe('headless routing receipt gate', () => {
  it('rejects coding execution without canonical receipt', () => {
    expect(() => assertDispatchRoutingReceipt({ task_type: 'dev', payload: {} }, null)).toThrow('route_violation');
    expect(assertDispatchRoutingReceipt({ task_type: 'harness_initiative', id: 't1', payload: { routing_receipt_id: 'r1' } }, { id: 'r1', task_id: 't1', pipeline: 'harness', canonical_task_type: 'harness_initiative' })).toBe(true);
  });
});
