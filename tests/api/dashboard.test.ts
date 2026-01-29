import { describe, it, expect } from 'vitest';

describe('Dashboard API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5681';

  describe('GET /api/dashboard/overview', () => {
    it('should return dashboard overview with repos and summary', async () => {
      const res = await fetch(`${API_BASE}/api/dashboard/overview`);
      expect(res.status).toBe(200);

      const overview = await res.json();

      // Check structure
      expect(overview).toHaveProperty('repos');
      expect(overview).toHaveProperty('summary');

      // Check repos array
      expect(Array.isArray(overview.repos)).toBe(true);
      expect(overview.repos.length).toBeGreaterThan(0);

      // Check repo structure
      const repo = overview.repos[0];
      expect(repo).toHaveProperty('id');
      expect(repo).toHaveProperty('name');
      expect(repo).toHaveProperty('health');
      expect(repo).toHaveProperty('rciTotal');
      expect(['green', 'yellow', 'red', 'unknown']).toContain(repo.health);

      // Check summary structure
      expect(overview.summary).toHaveProperty('totalRepos');
      expect(overview.summary).toHaveProperty('healthyRepos');
      expect(overview.summary).toHaveProperty('failingRepos');
      expect(overview.summary.totalRepos).toBeGreaterThan(0);
    });
  });

  describe('GET /api/dashboard/repo/:id', () => {
    it('should return detailed dashboard for cecelia-quality', async () => {
      const res = await fetch(`${API_BASE}/api/dashboard/repo/cecelia-quality`);
      expect(res.status).toBe(200);

      const data = await res.json();

      // Check structure
      expect(data).toHaveProperty('repo');
      expect(data).toHaveProperty('health');
      expect(data).toHaveProperty('contract');
      expect(data).toHaveProperty('rcis');
      expect(data).toHaveProperty('recentRuns');

      // Check repo info
      expect(data.repo.id).toBe('cecelia-quality');
      expect(data.repo).toHaveProperty('name');
      expect(data.repo).toHaveProperty('path');
      expect(data.repo).toHaveProperty('type');

      // Check rcis array
      expect(Array.isArray(data.rcis)).toBe(true);
    });

    it('should return 404 for non-existent repo', async () => {
      const res = await fetch(`${API_BASE}/api/dashboard/repo/non-existent-repo`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/dashboard/history', () => {
    it('should return history data', async () => {
      const res = await fetch(`${API_BASE}/api/dashboard/history`);
      expect(res.status).toBe(200);

      const history = await res.json();
      expect(history).toHaveProperty('days');
    });

    it('should accept days parameter', async () => {
      const res = await fetch(`${API_BASE}/api/dashboard/history?days=14`);
      expect(res.status).toBe(200);

      const history = await res.json();
      expect(history.days).toBe(14);
    });
  });
});
