import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

let recordPreflightResult: (args: {
  initiativeId: string;
  verdict: string;
  failures: string[];
}) => Promise<unknown>;
let getPreflightHistory: (initiativeId: string, limit?: number) => Promise<unknown[]>;

beforeAll(async () => {
  const modPath = '../../../packages/brain/src/preflight-store.js';
  try {
    const mod = await import(/* @vite-ignore */ modPath);
    recordPreflightResult = mod.recordPreflightResult;
    getPreflightHistory = mod.getPreflightHistory;
    if (typeof recordPreflightResult !== 'function' || typeof getPreflightHistory !== 'function') {
      throw new Error('preflight-store missing required exports');
    }
  } catch (loadErr) {
    const err = loadErr;
    recordPreflightResult = async () => {
      throw err;
    };
    getPreflightHistory = async () => {
      throw err;
    };
  }
});

describe('Workstream 2 — preflight-store [BEHAVIOR]', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('inserts a row with verdict, failures, initiative_id and created_at', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1, initiative_id: 'ini-A', verdict: 'pass', failures: [], created_at: new Date() }],
    });
    await recordPreflightResult({ initiativeId: 'ini-A', verdict: 'pass', failures: [] });
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const sql = mockPool.query.mock.calls[0][0] as string;
    const params = mockPool.query.mock.calls[0][1] as unknown[];
    expect(sql.toLowerCase()).toContain('insert into preflight_results');
    expect(params).toContain('ini-A');
    expect(params).toContain('pass');
  });

  it('persists distinct rows for two writes within same second', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2 }] });
    await recordPreflightResult({ initiativeId: 'ini-A', verdict: 'fail', failures: ['x'] });
    await recordPreflightResult({ initiativeId: 'ini-A', verdict: 'fail', failures: ['x'] });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('returns records in created_at descending order', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 3, verdict: 'pass', created_at: new Date('2026-04-27T10:00:00Z') },
        { id: 2, verdict: 'fail', created_at: new Date('2026-04-27T09:00:00Z') },
        { id: 1, verdict: 'fail', created_at: new Date('2026-04-27T08:00:00Z') },
      ],
    });
    const records = await getPreflightHistory('ini-A', 20);
    expect(records).toHaveLength(3);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql.toLowerCase()).toContain('order by created_at desc');
  });

  it('respects limit query parameter', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getPreflightHistory('ini-A', 5);
    const params = mockPool.query.mock.calls[0][1] as unknown[];
    expect(params).toContain(5);
  });

  it('caps limit at 100 even if larger value requested', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await getPreflightHistory('ini-A', 9999);
    const params = mockPool.query.mock.calls[0][1] as unknown[];
    expect(params).toContain(100);
    expect(params).not.toContain(9999);
  });
});
