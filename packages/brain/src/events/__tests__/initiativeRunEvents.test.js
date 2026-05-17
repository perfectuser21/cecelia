/**
 * Unit tests for initiativeRunEvents.js (ws3 DoD artifact)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js pool
vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import pool from '../../db.js';
import { writeInitiativeRunEvent } from '../initiativeRunEvents.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeInitiativeRunEvent', () => {
  it('inserts a row with correct fields', async () => {
    const initiativeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await writeInitiativeRunEvent({ initiativeId, node: 'proposer', status: 'running', attempt: 1 });

    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
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
    const [, params] = pool.query.mock.calls[0];
    expect(params[2]).toBe('done');
  });

  it('accepts status=failed', async () => {
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'reviewer', status: 'failed' });
    const [, params] = pool.query.mock.calls[0];
    expect(params[2]).toBe('failed');
  });

  it('does not include label field in SQL', async () => {
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'evaluator', status: 'running' });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toContain('label');
  });

  it('accepts custom dbPool', async () => {
    const fakePool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await writeInitiativeRunEvent({ initiativeId: 'test-id', node: 'evaluator', status: 'done', dbPool: fakePool });
    expect(fakePool.query).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
