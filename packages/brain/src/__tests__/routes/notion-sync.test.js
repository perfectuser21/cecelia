/**
 * Route tests: /api/brain/notion-sync
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../notion-sync.js', () => ({
  runSync: vi.fn(),
  getNotionConfig: vi.fn(() => ({ apiKey: 'test' })),
}));
vi.mock('../../notion-full-sync.js', () => ({
  runFullSync: vi.fn(),
  handleWebhook: vi.fn(),
  NOTION_DB_IDS: { tasks: 'db-tasks', projects: 'db-projects' },
  pushAllToNotion: vi.fn(),
}));
vi.mock('../../notion-memory-sync.js', () => ({
  rebuildMemoryDatabases: vi.fn(),
  importAllMemoryData: vi.fn(),
}));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/notion-sync.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/notion-sync', router);
  return app;
}

describe('notion-sync routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('disabled endpoints (503)', () => {
    it('POST /run returns 503', async () => {
      const res = await request(app).post('/notion-sync/run');
      expect(res.status).toBe(503);
      expect(res.body.disabled).toBe(true);
    });

    it('POST /webhook returns 503', async () => {
      const res = await request(app).post('/notion-sync/webhook');
      expect(res.status).toBe(503);
      expect(res.body.disabled).toBe(true);
    });

    it('POST /full-sync returns 503', async () => {
      const res = await request(app).post('/notion-sync/full-sync');
      expect(res.status).toBe(503);
      expect(res.body.disabled).toBe(true);
    });

    it('POST /memory-rebuild returns 503', async () => {
      const res = await request(app).post('/notion-sync/memory-rebuild');
      expect(res.status).toBe(503);
      expect(res.body.disabled).toBe(true);
    });

    it('POST /memory-sync returns 503', async () => {
      const res = await request(app).post('/notion-sync/memory-sync');
      expect(res.status).toBe(503);
      expect(res.body.disabled).toBe(true);
    });

    it('POST /push-all returns 503', async () => {
      const res = await request(app).post('/notion-sync/push-all');
      expect(res.status).toBe(503);
      expect(res.body.disabled).toBe(true);
    });
  });

  describe('GET /status', () => {
    it('returns config status and recent syncs', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: '1', started_at: '2026-01-01', direction: 'pull', records_synced: 5 }],
      });

      const res = await request(app).get('/notion-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.config.status).toBe('ok');
      expect(res.body.recent_syncs).toHaveLength(1);
    });
  });

  describe('GET /full-status', () => {
    it('returns table sync coverage', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { tbl: 'areas', total: '10', synced: '5' },
          { tbl: 'goals', total: '8', synced: '3' },
          { tbl: 'projects', total: '20', synced: '10' },
          { tbl: 'tasks', total: '100', synced: '50' },
        ],
      });

      const res = await request(app).get('/notion-sync/full-status');
      expect(res.status).toBe(200);
      expect(res.body.tables).toHaveLength(4);
      expect(res.body.notion_db_ids).toHaveProperty('tasks');
    });
  });
});
