/**
 * warroom-context-manifest.test.js — GET /warroom/line/:id/context-manifest（T3）
 * mock db + mock harness-line-context/line-dreaming，验组装逻辑与降级。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockFetchLineContext = vi.hoisted(() => vi.fn());
vi.mock('../../harness-line-context.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, fetchLineContext: mockFetchLineContext };
});

const mockBuildLineDreamData = vi.hoisted(() => vi.fn());
vi.mock('../../line-dreaming.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, buildLineDreamData: mockBuildLineDreamData };
});

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../warroom.js');
  router = mod.default;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/warroom', router);
  return a;
}

const JID = 'ffffffff-0000-1111-2222-333333333333';
const LEDGER = { content: '# X — 24h 账本', created_at: '2026-07-10T21:00:00.000Z' };
const DELTA = { decisions: [], advancementItems: [{ id: 'a1', title: '推进项', status: 'doing' }], issues: [], runs: [], learnings: [], strategistNotes: [] };

describe('GET /warroom/line/:id/context-manifest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200：line + ledger + delta + invariants + cumulative_fr + prompt_block', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: JID, name: 'LineX', status: 'active', maturity: 'skeleton' }] });
    mockFetchLineContext.mockResolvedValueOnce({
      invariants: [{ id: 'd1', topic: '[X]a', decision: 'b', source_level: 'area' }],
      cumulativeFR: [{ ability_name: '发视频', steps: [{ order_no: 1, note: 'x' }] }],
      ledger: LEDGER,
    });
    mockBuildLineDreamData.mockResolvedValueOnce(DELTA);

    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.line).toMatchObject({ id: JID, name: 'LineX', status: 'active', maturity: 'skeleton' });
    expect(res.body.ledger).toEqual(LEDGER);
    expect(res.body.delta.advancement_items).toHaveLength(1);
    expect(res.body.invariants).toHaveLength(1);
    expect(res.body.cumulative_fr).toHaveLength(1);
    expect(res.body.prompt_block).toContain('## Invariant 约束');
    expect(res.body.generated_at).toBeTruthy();
    // delta 窗口 = 自 ledger 时刻起
    expect(mockBuildLineDreamData).toHaveBeenCalledWith(
      expect.anything(), JID, 'LineX', { since: LEDGER.created_at }
    );
    // fetchLineContext 只带 journeyId（line 级 manifest 无 task/ability 上下文）
    expect(mockFetchLineContext).toHaveBeenCalledWith(
      expect.objectContaining({ pool: expect.anything() }), { journeyId: JID }
    );
  });

  it('无 ledger → ledger:null，delta 回落 since:null（buildLineDreamData 内部 24h）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: JID, name: 'LineX', status: 'active', maturity: null }] });
    mockFetchLineContext.mockResolvedValueOnce({ invariants: [], cumulativeFR: [], ledger: null });
    mockBuildLineDreamData.mockResolvedValueOnce(DELTA);

    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.ledger).toBeNull();
    expect(res.body.prompt_block).toBe('');
    expect(mockBuildLineDreamData).toHaveBeenCalledWith(expect.anything(), JID, 'LineX', { since: null });
  });

  it('journey 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('journey not found');
  });

  it('delta 查询炸 → delta 六段空数组降级，仍 200', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: JID, name: 'LineX', status: 'active', maturity: null }] });
    mockFetchLineContext.mockResolvedValueOnce({ invariants: [], cumulativeFR: [], ledger: null });
    mockBuildLineDreamData.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app()).get(`/warroom/line/${JID}/context-manifest`);
    expect(res.status).toBe(200);
    expect(res.body.delta).toEqual({
      decisions: [], advancement_items: [], issues: [], runs: [], learnings: [], strategist_notes: [],
    });
  });
});
