/**
 * capture-atoms 路由配套测试（lint-test-pairing 就近配对）
 *
 * T10 守卫：自动分诊来源（handoff/learning/issue）的 confirm 返回 400，
 * 由 capture-triage tick 分诊，不支持人工路由（人工出路=改判 target_type）。
 * 其余路由行为见 src/__tests__/capture-atoms-route.test.js。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

const MOCK_ATOM = {
  id: 'atom-uuid-1234',
  capture_id: 'capture-uuid-5678',
  content: 'handoff: 某任务交接',
  target_type: 'handoff',
  target_subtype: 'FAIL',
  suggested_area_id: null,
  status: 'pending_review',
  routed_to_table: 'tasks',
  routed_to_id: 'task-uuid-1',
  confidence: 0,
  created_at: '2026-07-10T00:00:00.000Z',
  updated_at: '2026-07-10T00:00:00.000Z',
};

describe('capture-atoms confirm 守卫（T10 自动分诊来源）', () => {
  let app;
  let mockPool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbModule = await import('../db.js');
    mockPool = dbModule.default;
    const captureAtomsRouter = (await import('./capture-atoms.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/brain/capture-atoms', captureAtomsRouter);
  });

  it.each(['handoff', 'learning', 'issue'])(
    'confirm 自动分诊来源 %s 返回 400（由 capture-triage 分诊，不支持人工路由）',
    async (autoType) => {
      const autoAtom = Object.assign({}, MOCK_ATOM, { target_type: autoType });
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockClient.query.mockResolvedValueOnce({});
      mockClient.query.mockResolvedValueOnce({ rows: [autoAtom] });
      mockClient.query.mockResolvedValueOnce({});
      mockPool.connect.mockResolvedValueOnce(mockClient);

      const res = await request(app)
        .patch('/api/brain/capture-atoms/' + MOCK_ATOM.id)
        .send({ action: 'confirm' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('capture-triage');
      expect(res.body.error).toContain(autoType);
    }
  );

  it('dismiss 自动分诊来源不受守卫限制', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockClient.query.mockResolvedValueOnce({});
    mockClient.query.mockResolvedValueOnce({ rows: [MOCK_ATOM] });
    mockClient.query.mockResolvedValueOnce({});
    mockClient.query.mockResolvedValueOnce({});
    mockPool.connect.mockResolvedValueOnce(mockClient);

    const res = await request(app)
      .patch('/api/brain/capture-atoms/' + MOCK_ATOM.id)
      .send({ action: 'dismiss' });

    expect(res.status).toBe(200);
  });
});
