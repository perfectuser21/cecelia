import { describe, it, expect } from 'vitest';

describe('Executor API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5681';

  describe('POST /api/execute', () => {
    it('should reject request without repoId', async () => {
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain('repoId');
    });

    it('should return error for non-existent repo', async () => {
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: 'non-existent-repo' }),
      });

      expect(res.status).toBe(500);
      const result = await res.json();
      expect(result.error).toContain('not found');
    });

    // This test actually runs QA, so we use a timeout and mark it as integration test
    it.skip('should execute QA for cecelia-quality (integration)', async () => {
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: 'cecelia-quality' }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();

      expect(result).toHaveProperty('runId');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('repoId');
      expect(result.repoId).toBe('cecelia-quality');
      expect(['running', 'passed', 'failed']).toContain(result.status);
    }, 120000);
  });

  describe('GET /api/execute/:runId', () => {
    it('should return 404 for non-existent run', async () => {
      const res = await fetch(`${API_BASE}/api/execute/non-existent-run`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/execute/all', () => {
    // This test runs QA on all repos, so we skip it by default
    it.skip('should execute QA for all repos (integration)', async () => {
      const res = await fetch(`${API_BASE}/api/execute/all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const results = await res.json();
      expect(Array.isArray(results)).toBe(true);
    }, 300000);
  });
});
