import { describe, it, expect } from 'vitest';

describe('Contract API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5681';

  describe('GET /api/contracts', () => {
    it('should return list of all contracts', async () => {
      const res = await fetch(`${API_BASE}/api/contracts`);
      expect(res.status).toBe(200);

      const contracts = await res.json();
      expect(Array.isArray(contracts)).toBe(true);
      expect(contracts.length).toBeGreaterThan(0);

      // Check contract structure
      const contract = contracts[0];
      expect(contract).toHaveProperty('file');
      expect(contract).toHaveProperty('repo');
      expect(contract).toHaveProperty('rciCount');
    });
  });

  describe('GET /api/contracts/:repoId', () => {
    it('should return contract for cecelia-quality', async () => {
      const res = await fetch(`${API_BASE}/api/contracts/cecelia-quality`);
      expect(res.status).toBe(200);

      const contract = await res.json();
      expect(contract.repo).toBe('cecelia-quality');
      expect(contract).toHaveProperty('rcis');
      expect(Array.isArray(contract.rcis)).toBe(true);
      expect(contract.rcis.length).toBeGreaterThan(0);
    });

    it('should return contract for cecelia-semantic-brain', async () => {
      const res = await fetch(`${API_BASE}/api/contracts/cecelia-semantic-brain`);
      expect(res.status).toBe(200);

      const contract = await res.json();
      expect(contract).toHaveProperty('rcis');
      // Brain has 9 RCIs according to PRD
      expect(contract.rcis.length).toBeGreaterThanOrEqual(9);
    });

    it('should return 404 for non-existent contract', async () => {
      const res = await fetch(`${API_BASE}/api/contracts/non-existent-repo`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/contracts/:repoId/rci/:rciId', () => {
    it('should return single RCI by id', async () => {
      const res = await fetch(`${API_BASE}/api/contracts/cecelia-quality/rci/C-GATEWAY-HTTP-001`);
      expect(res.status).toBe(200);

      const rci = await res.json();
      expect(rci.id).toBe('C-GATEWAY-HTTP-001');
      expect(rci).toHaveProperty('name');
      expect(rci).toHaveProperty('scope');
      expect(rci).toHaveProperty('priority');
      expect(rci).toHaveProperty('triggers');
    });

    it('should return 404 for non-existent RCI', async () => {
      const res = await fetch(`${API_BASE}/api/contracts/cecelia-quality/rci/INVALID-RCI`);
      expect(res.status).toBe(404);
    });
  });
});
