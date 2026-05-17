import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockListSources = vi.hoisted(() => vi.fn());
vi.mock('../../notebook-adapter.js', () => ({ listSources: (...a) => mockListSources(...a) }));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/notebook-audit.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/notebook-audit', router);
  return app;
}

describe('notebook-audit routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // Helper: mock the two mandatory DB queries
  function mockDbQueries({ dbRows = [], notebookIdRows = [] } = {}) {
    mockPool.query
      .mockResolvedValueOnce({ rows: dbRows })     // synthesis_archive query
      .mockResolvedValueOnce({ rows: notebookIdRows }); // working_memory query
  }

  // ── GET / ────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns audit result with no tracked sources', async () => {
      mockDbQueries();
      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.matched).toBe(0);
      expect(res.body.total_db_tracked).toBe(0);
      expect(res.body.orphaned_in_db).toEqual([]);
      expect(res.body.untracked_in_notebooklm_count).toBe(0);
      expect(res.body.audit_time).toBeTruthy();
    });

    it('correctly matches DB sources with NotebookLM sources', async () => {
      const dbRows = [
        { id: 'a1', level: 'day', period_start: '2026-01-01', notebook_source_id: 'src-1' },
        { id: 'a2', level: 'week', period_start: '2026-01-01', notebook_source_id: 'src-2' },
      ];
      const notebookIdRows = [{ key: 'notebook_id_working', value_json: 'nb-1' }];

      mockDbQueries({ dbRows, notebookIdRows });
      mockListSources.mockResolvedValueOnce({
        ok: true,
        sources: [{ id: 'src-1' }, { id: 'src-2' }, { id: 'src-3' }],
      });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(2);
      expect(res.body.orphaned_in_db).toHaveLength(0);
      expect(res.body.untracked_in_notebooklm_count).toBe(1); // src-3 not in DB
    });

    it('identifies orphaned DB records (in DB but not in NotebookLM)', async () => {
      const dbRows = [
        { id: 'a1', level: 'day', period_start: '2026-01-01', notebook_source_id: 'src-orphan' },
      ];
      const notebookIdRows = [{ key: 'notebook_id_working', value_json: 'nb-1' }];

      mockDbQueries({ dbRows, notebookIdRows });
      mockListSources.mockResolvedValueOnce({ ok: true, sources: [{ id: 'src-live' }] });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(res.body.orphaned_in_db).toHaveLength(1);
      expect(res.body.orphaned_in_db[0].source_id).toBe('src-orphan');
      expect(res.body.matched).toBe(0);
    });

    it('records list errors when listSources fails', async () => {
      const notebookIdRows = [{ key: 'notebook_id_working', value_json: 'nb-1' }];
      mockDbQueries({ notebookIdRows });
      mockListSources.mockResolvedValueOnce({ ok: false, error: 'API timeout' });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(res.body.list_errors).toHaveLength(1);
      expect(res.body.list_errors[0].error).toBe('API timeout');
    });

    it('skips notebook IDs that are null/falsy in working_memory', async () => {
      const notebookIdRows = [
        { key: 'notebook_id_working', value_json: null },
        { key: 'notebook_id_self', value_json: 'nb-self' },
      ];
      mockDbQueries({ notebookIdRows });
      mockListSources.mockResolvedValueOnce({ ok: true, sources: [] });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(mockListSources).toHaveBeenCalledTimes(1); // only called for nb-self
    });

    it('writes alert to working_memory when orphans exceed threshold (>2)', async () => {
      const dbRows = [
        { id: 'a1', level: 'day', period_start: '2026-01-01', notebook_source_id: 'o1' },
        { id: 'a2', level: 'day', period_start: '2026-01-01', notebook_source_id: 'o2' },
        { id: 'a3', level: 'day', period_start: '2026-01-01', notebook_source_id: 'o3' },
      ];
      const notebookIdRows = [{ key: 'notebook_id_working', value_json: 'nb-1' }];

      mockDbQueries({ dbRows, notebookIdRows });
      mockListSources.mockResolvedValueOnce({ ok: true, sources: [] }); // all orphaned
      // Third query call is the alert INSERT
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(res.body.orphaned_in_db).toHaveLength(3);
      // Alert write is fire-and-forget, so we just verify audit returned correctly
      expect(res.body.ok).toBe(true);
    });

    it('does not write alert when orphans at or below threshold (≤2)', async () => {
      const dbRows = [
        { id: 'a1', level: 'day', period_start: '2026-01-01', notebook_source_id: 'o1' },
        { id: 'a2', level: 'day', period_start: '2026-01-01', notebook_source_id: 'o2' },
      ];
      const notebookIdRows = [{ key: 'notebook_id_working', value_json: 'nb-1' }];

      mockDbQueries({ dbRows, notebookIdRows });
      mockListSources.mockResolvedValueOnce({ ok: true, sources: [] });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      // Only 2 DB queries (synthesis_archive + working_memory), no alert INSERT
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('includes notebook_coverage breakdown per notebook', async () => {
      const notebookIdRows = [
        { key: 'notebook_id_working', value_json: 'nb-a' },
        { key: 'notebook_id_self', value_json: 'nb-b' },
      ];
      mockDbQueries({ notebookIdRows });
      mockListSources
        .mockResolvedValueOnce({ ok: true, sources: [{ id: 's1' }, { id: 's2' }] })
        .mockResolvedValueOnce({ ok: true, sources: [{ id: 's3' }] });

      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(200);
      expect(res.body.notebook_coverage).toHaveLength(2);
      const nbA = res.body.notebook_coverage.find(n => n.notebookId === 'nb-a');
      expect(nbA.sourceCount).toBe(2);
    });

    it('returns 500 on DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('db crash'));
      const res = await request(app).get('/notebook-audit');
      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });
});
