/**
 * Unit tests for initiativeRunEvents.js (ws3 DoD artifact)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({
  default: { query: mockQuery },
}));

let writeInitiativeRunEvent;

beforeEach(async () => {
  vi.resetModules();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  const mod = await import('../initiativeRunEvents.js');
  writeInitiativeRunEvent = mod.writeInitiativeRunEvent;
});

describe('writeInitiativeRunEvent', () => {
  it('inserts a row with correct fields (running)', async () => {
    const initiativeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await writeInitiativeRunEvent({ initiativeId, node: 'proposer', status: 'running', attempt: 1 });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO initiative_run_events');
    expect(params[0]).toBe(initiativeId);
    expect(params[1]).toBe('proposer');
    expect(params[2]).toBe('running');
    expect(params[3]).toBe(1);
    expect(typeof params[4]).toBe('number');
    expect(params[4]).toBeGreaterThanOrEqual(1000000000);
  });

  it('accepts status=done', async () => {
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'generator', status: 'done', attempt: 2 });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe('done');
  });

  it('accepts status=failed', async () => {
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'reviewer', status: 'failed' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe('failed');
  });

  it('SQL does not contain label column', async () => {
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'evaluator', status: 'running' });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('label');
  });

  it('uses custom dbPool when provided', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    const fakePool = { query: fakeQuery };
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'evaluator', status: 'done', dbPool: fakePool });
    expect(fakeQuery).toHaveBeenCalledOnce();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
