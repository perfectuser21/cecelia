import { describe, expect, it, vi } from 'vitest';
import { finishTaskLease } from '../task-lease-finish.js';

describe('external worker lease finish', () => {
  it('invalid identity/result/status rejects before connecting', async () => {
    const pool = { connect: vi.fn() };
    for (const body of [{}, { claimer: 'worker', claimEpoch: 'bad', status: 'completed' },
      { claimer: 'worker', claimEpoch: '2026-11-14 10:00:00.123456+00', status: 'cancelled', result: {} }]) {
      expect((await finishTaskLease(pool, { taskId: 'c5b7c1d1-a928-42e7-a082-3a89d691d888', ...body })).status).toBe(400);
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
