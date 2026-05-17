import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Registry API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5681';
  let createdRepoId: string | null = null;

  afterAll(async () => {
    // Cleanup: delete test repo if created
    if (createdRepoId) {
      await fetch(`${API_BASE}/api/repos/${createdRepoId}`, {
        method: 'DELETE',
      });
    }
  });

  describe('GET /api/repos', () => {
    it('should return list of registered repos', async () => {
      const res = await fetch(`${API_BASE}/api/repos`);
      expect(res.status).toBe(200);

      const repos = await res.json();
      expect(Array.isArray(repos)).toBe(true);
      expect(repos.length).toBeGreaterThan(0);

      // Check repo structure
      const repo = repos[0];
      expect(repo).toHaveProperty('id');
      expect(repo).toHaveProperty('name');
      expect(repo).toHaveProperty('path');
      expect(repo).toHaveProperty('type');
    });
  });

  describe('GET /api/repos/:id', () => {
    it('should return single repo by id', async () => {
      const res = await fetch(`${API_BASE}/api/repos/cecelia-quality`);
      expect(res.status).toBe(200);

      const repo = await res.json();
      expect(repo.id).toBe('cecelia-quality');
      expect(repo.name).toBe('Cecelia Quality');
      expect(repo).toHaveProperty('runners');
    });

    it('should return 404 for non-existent repo', async () => {
      const res = await fetch(`${API_BASE}/api/repos/non-existent-repo`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/repos', () => {
    it('should register a new repo', async () => {
      const newRepo = {
        id: 'test-repo-' + Date.now(),
        name: 'Test Repo',
        path: '/tmp/test-repo',
        type: 'Business',
        priority: 'P2',
      };

      const res = await fetch(`${API_BASE}/api/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRepo),
      });

      expect(res.status).toBe(201);
      const repo = await res.json();
      expect(repo.id).toBe(newRepo.id);
      expect(repo.name).toBe('Test Repo');
      expect(repo.enabled).toBe(true);

      createdRepoId = repo.id;
    });

    it('should reject duplicate repo id', async () => {
      const res = await fetch(`${API_BASE}/api/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'cecelia-quality',
          path: '/some/path',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject missing required fields', async () => {
      const res = await fetch(`${API_BASE}/api/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing ID' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/repos/:id', () => {
    it('should delete existing repo', async () => {
      // First create a repo to delete
      const tempId = 'temp-delete-' + Date.now();
      await fetch(`${API_BASE}/api/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tempId,
          path: '/tmp/temp-delete',
        }),
      });

      const res = await fetch(`${API_BASE}/api/repos/${tempId}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.success).toBe(true);
    });

    it('should return 404 for non-existent repo', async () => {
      const res = await fetch(`${API_BASE}/api/repos/non-existent-repo`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/repos/discover', () => {
    it('should return list of unregistered repos', async () => {
      const res = await fetch(`${API_BASE}/api/repos/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('discovered');
      expect(Array.isArray(result.discovered)).toBe(true);

      // Check discovered repo structure
      if (result.discovered.length > 0) {
        const repo = result.discovered[0];
        expect(repo).toHaveProperty('id');
        expect(repo).toHaveProperty('path');
        expect(repo).toHaveProperty('suggested_type');
      }
    });
  });
});
