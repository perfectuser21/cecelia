import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockRecordEvolution     = vi.hoisted(() => vi.fn());
const mockRunEvolutionSynthesis = vi.hoisted(() => vi.fn());
const mockLLM = vi.hoisted(() => vi.fn());
vi.mock('../../llm-caller.js', () => ({ callLLM: mockLLM }));

vi.mock('../../evolution-synthesizer.js', () => ({
  recordEvolution:       (...a) => mockRecordEvolution(...a),
  runEvolutionSynthesis: (...a) => mockRunEvolutionSynthesis(...a),
}));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/evolution.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/evolution', router);
  return app;
}

describe('evolution routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ── GET /records ──────────────────────────────────────────────────────────

  describe('GET /records', () => {
    it('returns all records without filters', async () => {
      const rows = [{ id: 'e1', component: 'brain', title: 'v1.0 release' }];
      mockPool.query.mockResolvedValueOnce({ rows });

      const res = await request(app).get('/evolution/records');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].component).toBe('brain');
    });

    it('queries component_evolutions table ordered by date DESC', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/records');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('component_evolutions');
      expect(sql).toContain('date DESC');
    });

    it('filters by component when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/records?component=brain');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('WHERE component = $1');
      expect(params[0]).toBe('brain');
    });

    it('uses default limit=50 and offset=0', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/records');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(50);
      expect(params).toContain(0);
    });

    it('respects custom limit and offset', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/records?limit=10&offset=20');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('query fail'));
      const res = await request(app).get('/evolution/records');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /record ──────────────────────────────────────────────────────────

  describe('POST /record', () => {
    it('records evolution and returns ok+id', async () => {
      mockRecordEvolution.mockResolvedValueOnce({ id: 'ev-1' });

      const res = await request(app).post('/evolution/record').send({
        component: 'brain',
        title: 'Add memory route',
        significance: 'major',
        prNumber: 42,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.id).toBe('ev-1');
      expect(mockRecordEvolution).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'brain', title: 'Add memory route', prNumber: 42 })
      );
    });

    it('returns 400 when component missing', async () => {
      const res = await request(app).post('/evolution/record').send({ title: 'T' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('component and title are required');
    });

    it('returns 400 when title missing', async () => {
      const res = await request(app).post('/evolution/record').send({ component: 'brain' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when both missing', async () => {
      const res = await request(app).post('/evolution/record').send({});
      expect(res.status).toBe(400);
    });

    it('returns 500 when recordEvolution throws', async () => {
      mockRecordEvolution.mockRejectedValueOnce(new Error('insert failed'));
      const res = await request(app).post('/evolution/record').send({
        component: 'brain', title: 'T',
      });
      expect(res.status).toBe(500);
    });
  });

  // ── GET /summaries ────────────────────────────────────────────────────────

  describe('GET /summaries', () => {
    it('returns summaries list', async () => {
      const rows = [{ id: 's1', component: 'brain', period_end: '2026-04-30' }];
      mockPool.query.mockResolvedValueOnce({ rows });

      const res = await request(app).get('/evolution/summaries');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].component).toBe('brain');
    });

    it('queries component_evolution_summaries ordered by period_end DESC', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/summaries');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('component_evolution_summaries');
      expect(sql).toContain('period_end DESC');
    });

    it('filters by component', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/summaries?component=executor');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('WHERE component = $1');
      expect(params[0]).toBe('executor');
    });

    it('uses default limit=20', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/summaries');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(20);
    });

    it('respects custom limit', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/evolution/summaries?limit=5');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(5);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('fail'));
      const res = await request(app).get('/evolution/summaries');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /synthesize ──────────────────────────────────────────────────────

  describe('POST /synthesize', () => {
    for (const [label, body] of [
      ['dry_run', { dry_run: true }],
      ['普通生成请求', {}],
      ['无正文', undefined],
      ['强制生成标记', { dry_run: false, force: true }],
    ]) {
      it(`${label} 返回410且不调用合成、模型或数据库`, async () => {
        mockRunEvolutionSynthesis.mockResolvedValue({ ok: true, synthesized: 3 });
        const req = request(app).post('/evolution/synthesize');
        const res = await (body === undefined ? req : req.send(body));
        expect(res.status).toBe(410);
        expect(res.body).toMatchObject({ error: 'report_generation_retired' });
        expect(mockRunEvolutionSynthesis).not.toHaveBeenCalled();
        expect(mockRecordEvolution).not.toHaveBeenCalled();
        expect(mockPool.query).not.toHaveBeenCalled();
        expect(mockLLM).not.toHaveBeenCalled();
      });
    }
  });
});
