import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/alex-pages.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/alex-pages', router);
  return app;
}

describe('alex-pages routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ── GET / ────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns all pages without filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'Page 1' }] });

      const res = await request(app).get('/alex-pages');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('p1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('WHERE');
      expect(params).toContain(100);
      expect(params).toContain(0);
    });

    it('filters by area', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?area=work');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('area = $1');
      expect(params[0]).toBe('work');
    });

    it('filters by project', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?project=cecelia');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('project = $1');
      expect(params[0]).toBe('cecelia');
    });

    it('filters by page_type', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?page_type=doc');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('page_type = $1');
      expect(params[0]).toBe('doc');
    });

    it('filters by tags (comma-separated)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?tags=ai,brain');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('tags && $1::text[]');
      expect(params[0]).toEqual(['ai', 'brain']);
    });

    it('ignores empty tags string', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?tags=,,,');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('tags &&');
    });

    it('combines multiple filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?area=work&project=brain&page_type=note');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('area = $1');
      expect(sql).toContain('project = $2');
      expect(sql).toContain('page_type = $3');
    });

    it('respects custom limit and offset', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get('/alex-pages?limit=10&offset=20');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('db failure'));
      const res = await request(app).get('/alex-pages');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to list alex_pages');
    });
  });

  // ── POST / ───────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('creates page with title only → 201', async () => {
      const row = { id: 'new-1', title: 'New Page', page_type: 'note', tags: [], content_json: {} };
      mockPool.query.mockResolvedValueOnce({ rows: [row] });

      const res = await request(app).post('/alex-pages').send({ title: 'New Page' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Page');
    });

    it('returns 400 if title missing', async () => {
      const res = await request(app).post('/alex-pages').send({ area: 'work' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('title is required');
    });

    it('passes optional fields to INSERT', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
      await request(app).post('/alex-pages').send({
        title: 'T', area: 'life', project: 'proj', tags: ['a'], page_type: 'doc',
        content_json: { blocks: [] },
      });
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO alex_pages');
      expect(params[0]).toBe('T');
      expect(params[2]).toBe('life');
      expect(params[3]).toBe('proj');
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('insert fail'));
      const res = await request(app).post('/alex-pages').send({ title: 'T' });
      expect(res.status).toBe(500);
    });
  });

  // ── GET /:id ─────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns page if found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'Found' }] });
      const res = await request(app).get('/alex-pages/p1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('p1');
    });

    it('returns 404 if not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/alex-pages/missing');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Page not found');
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('select fail'));
      const res = await request(app).get('/alex-pages/p1');
      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /:id ───────────────────────────────────────────────────────────

  describe('PATCH /:id', () => {
    it('updates title field → 200', async () => {
      const updated = { id: 'p1', title: 'Updated' };
      mockPool.query.mockResolvedValueOnce({ rows: [updated] });

      const res = await request(app).patch('/alex-pages/p1').send({ title: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated');
    });

    it('updates multiple fields at once', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      await request(app).patch('/alex-pages/p1').send({ title: 'T', area: 'work', page_type: 'doc' });
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('area = $2');
      expect(sql).toContain('page_type = $3');
    });

    it('updates tags and content_json', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      await request(app).patch('/alex-pages/p1').send({ tags: ['x'], content_json: { v: 1 } });
      const [sql] = mockPool.query.mock.calls[0];
      // content_json is processed before tags in route's field order
      expect(sql).toContain('content_json = $1');
      expect(sql).toContain('tags = $2');
    });

    it('returns 400 if no fields provided', async () => {
      const res = await request(app).patch('/alex-pages/p1').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No fields to update');
    });

    it('returns 404 if page not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/alex-pages/missing').send({ title: 'T' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('update fail'));
      const res = await request(app).patch('/alex-pages/p1').send({ title: 'T' });
      expect(res.status).toBe(500);
    });
  });
});
