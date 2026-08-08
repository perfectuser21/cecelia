import { beforeEach, describe, expect, it, vi } from 'vitest';

const callbackRow = {
  id: '11111111-1111-4111-8111-111111111111',
  task_id: '22222222-2222-4222-8222-222222222222',
  run_id: '33333333-3333-4333-8333-333333333333',
  status: 'AI Failed',
  result_json: { error: 'fallback delivery' },
  attempt: 1,
};

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const pool = vi.hoisted(() => ({ connect: vi.fn(async () => client), query: vi.fn() }));
const processExecutionCallback = vi.hoisted(() => vi.fn(async () => ({ success: true, applied: true })));

vi.mock('../db.js', () => ({ default: pool }));
vi.mock('../callback-processor.js', () => ({ processExecutionCallback }));

describe('callback-worker 数据库租约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockResolvedValue({ rows: [], rowCount: 1 });
    client.query.mockResolvedValueOnce({ rows: [callbackRow], rowCount: 1 });
  });

  it('用 SKIP LOCKED 原子认领，处理成功后清租约并标记 processed', async () => {
    const worker = await import('../callback-worker.js');
    expect(typeof worker.pollAndProcess).toBe('function');

    await worker.pollAndProcess();

    const claimSql = client.query.mock.calls[0][0];
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain('claimed_at');
    expect(claimSql).toContain('claimed_by');
    expect(processExecutionCallback).toHaveBeenCalledTimes(1);

    const finishCall = client.query.mock.calls.find(
      ([sql, params]) => typeof sql === 'string' && sql.includes('processed_at = NOW()') && params?.[0] === callbackRow.id
    );
    expect(finishCall).toBeDefined();
    expect(finishCall[0]).toContain('claimed_at = NULL');
    expect(finishCall[0]).toContain('claimed_by = NULL');
  });
});
