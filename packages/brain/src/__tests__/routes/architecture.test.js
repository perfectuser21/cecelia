import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// architecture.js creates its own pool via `new pg.Pool(DB_DEFAULTS)`.
// Mock pg before module import so the constructor is intercepted.
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('pg', () => ({
  default: { Pool: vi.fn(() => ({ query: mockQuery })) },
}));

vi.mock('../../db-config.js', () => ({ DB_DEFAULTS: {} }));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/architecture.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/architecture', router);
  return app;
}

describe('architecture routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ── GET / ────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns nodes and connections with snapshot_at', async () => {
      const nodes = [
        { id: 'n1', block_id: 'brain', label: 'Brain', nature: 'core', pos_x: 100, pos_y: 200 },
      ];
      const connections = [
        { id: 1, from_node: 'n1', to_node: 'n2', path_type: 'sync', is_broken: false },
      ];
      mockQuery
        .mockResolvedValueOnce({ rows: nodes })
        .mockResolvedValueOnce({ rows: connections });

      const res = await request(app).get('/architecture');
      expect(res.status).toBe(200);
      expect(res.body.nodes).toHaveLength(1);
      expect(res.body.connections).toHaveLength(1);
      expect(res.body.nodes[0].label).toBe('Brain');
      expect(res.body.connections[0].is_broken).toBe(false);
      expect(res.body.snapshot_at).toBeTruthy();
    });

    it('returns empty arrays when no data', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/architecture');
      expect(res.status).toBe(200);
      expect(res.body.nodes).toEqual([]);
      expect(res.body.connections).toEqual([]);
    });

    it('issues two parallel queries (brain_nodes + brain_connections)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).get('/architecture');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const [sqlA] = mockQuery.mock.calls[0];
      const [sqlB] = mockQuery.mock.calls[1];
      expect(sqlA).toContain('brain_nodes');
      expect(sqlB).toContain('brain_connections');
    });

    it('returns 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('query failed'));
      const res = await request(app).get('/architecture');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeTruthy();
    });
  });

  // ── PATCH /nodes/:id ─────────────────────────────────────────────────────

  describe('PATCH /nodes/:id', () => {
    it('updates pos_x and pos_y successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'n1' }] });

      const res = await request(app)
        .patch('/architecture/nodes/n1')
        .send({ pos_x: 150, pos_y: 300 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.pos_x).toBe(150);
      expect(res.body.pos_y).toBe(300);
    });

    it('rounds float coordinates', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'n1' }] });

      const res = await request(app)
        .patch('/architecture/nodes/n1')
        .send({ pos_x: 150.7, pos_y: 300.2 });

      expect(res.status).toBe(200);
      expect(res.body.pos_x).toBe(151);
      expect(res.body.pos_y).toBe(300);
    });

    it('returns 400 when pos_x missing', async () => {
      const res = await request(app)
        .patch('/architecture/nodes/n1')
        .send({ pos_y: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('pos_x and pos_y required');
    });

    it('returns 400 when pos_y missing', async () => {
      const res = await request(app)
        .patch('/architecture/nodes/n1')
        .send({ pos_x: 100 });

      expect(res.status).toBe(400);
    });

    it('returns 404 when node not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const res = await request(app)
        .patch('/architecture/nodes/missing-node')
        .send({ pos_x: 0, pos_y: 0 });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .patch('/architecture/nodes/n1')
        .send({ pos_x: 0, pos_y: 0 });

      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /connections/:id ────────────────────────────────────────────────

  describe('PATCH /connections/:id', () => {
    it('sets is_broken=true successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .patch('/architecture/connections/1')
        .send({ is_broken: true });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.is_broken).toBe(true);
    });

    it('sets is_broken=false successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .patch('/architecture/connections/2')
        .send({ is_broken: false });

      expect(res.status).toBe(200);
      expect(res.body.is_broken).toBe(false);
      expect(res.body.id).toBe(2);
    });

    it('returns 400 when is_broken missing', async () => {
      const res = await request(app)
        .patch('/architecture/connections/1')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('is_broken required');
    });

    it('returns 404 when connection not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const res = await request(app)
        .patch('/architecture/connections/999')
        .send({ is_broken: true });

      expect(res.status).toBe(404);
    });

    it('coerces is_broken to boolean', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await request(app)
        .patch('/architecture/connections/1')
        .send({ is_broken: 'true' });

      const [, params] = mockQuery.mock.calls[0];
      expect(typeof params[0]).toBe('boolean');
      expect(params[0]).toBe(true);
    });

    it('returns 500 on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('update fail'));

      const res = await request(app)
        .patch('/architecture/connections/1')
        .send({ is_broken: false });

      expect(res.status).toBe(500);
    });
  });
});
