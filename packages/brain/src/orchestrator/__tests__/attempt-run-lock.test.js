import { describe, expect, it, vi } from 'vitest';

import { createAttemptRunLock } from '../attempt-run-lock.js';

describe('attempt run-first mutation authority', () => {
  it('locks the parent run before mutating and owns Pool transaction cleanup', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'attempt-1' }] })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
    const mutate = createAttemptRunLock(pool);

    await expect(mutate('attempt-1', (locked) => locked.query('UPDATE attempt')))
      .resolves.toEqual({ rows: [{ id: 'attempt-1' }] });

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/JOIN initiative_runs[\s\S]*FOR SHARE OF run/i),
      'UPDATE attempt',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed for an implicit query-only production adapter', async () => {
    const queryOnly = { query: vi.fn() };
    const mutate = createAttemptRunLock(queryOnly);

    await expect(mutate('attempt-1', vi.fn())).rejects.toThrow(
      /requires a PostgreSQL Pool or transactionClient/,
    );
    expect(queryOnly.query).not.toHaveBeenCalled();
  });

  it('rolls back, releases once, and preserves the mutation error', async () => {
    const mutationError = new Error('projected attempt update failed');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
        .mockRejectedValueOnce(mutationError)
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
    const mutate = createAttemptRunLock(pool);

    await expect(mutate('attempt-1', (locked) => locked.query('UPDATE attempt')))
      .rejects.toBe(mutationError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR SHARE OF run/i),
      'UPDATE attempt',
      'ROLLBACK',
    ]);
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
