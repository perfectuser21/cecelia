/**
 * Memory Schema Tests - Phase 5.1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API_BASE = 'http://localhost:5211/api/system';

// Response types for type safety
interface ApiResponse {
  success: boolean;
  [key: string]: unknown;
}

describe('Memory Schema API', () => {
  const testKeys: string[] = [];

  // Clean up test entries after all tests
  afterAll(async () => {
    for (const key of testKeys) {
      try {
        await fetch(`${API_BASE}/memory/${key}`, { method: 'DELETE' });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('GET /api/system/memory/stats', () => {
    it('should return memory stats with schema', async () => {
      const response = await fetch(`${API_BASE}/memory/stats`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect(data.stats).toBeDefined();
      expect((data.schema as { layers: string[] }).layers).toContain('episodic');
      expect((data.schema as { layers: string[] }).layers).toContain('working');
      expect((data.schema as { layers: string[] }).layers).toContain('longterm');
      expect((data.schema as { categories: { working: string[] } }).categories.working).toContain('context');
      expect((data.schema as { categories: { longterm: string[] } }).categories.longterm).toContain('preference');
    });
  });

  describe('POST /api/system/memory', () => {
    it('should write working layer memory', async () => {
      const key = `test_working_${Date.now()}`;
      testKeys.push(key);

      const response = await fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer: 'working',
          category: 'context',
          key,
          value: { test: true, timestamp: Date.now() },
          source: 'system',
        }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect((data.entry as { layer: string }).layer).toBe('working');
      expect((data.entry as { category: string }).category).toBe('context');
      expect((data.entry as { key: string }).key).toBe(key);
    });

    it('should write longterm layer memory', async () => {
      const key = `test_longterm_${Date.now()}`;
      testKeys.push(key);

      const response = await fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer: 'longterm',
          category: 'lesson',
          key,
          value: { learned: 'something important' },
          source: 'inference',
          confidence: 0.85,
        }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect((data.entry as { layer: string }).layer).toBe('longterm');
      expect((data.entry as { confidence: number }).confidence).toBe(0.85);
    });

    it('should reject invalid category for layer', async () => {
      const response = await fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer: 'working',
          category: 'preference', // preference is only for longterm
          key: 'test_invalid',
          value: { test: true },
        }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect((data.errors as string[])).toContain(
        'category "preference" not allowed in layer "working". Allowed: context, state'
      );
    });

    it('should reject invalid layer', async () => {
      const response = await fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer: 'invalid_layer',
          category: 'context',
          key: 'test_invalid',
          value: { test: true },
        }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('GET /api/system/memory', () => {
    beforeAll(async () => {
      // Create test entries
      const entries = [
        { layer: 'working', category: 'context', key: 'filter_test_1', value: { n: 1 } },
        { layer: 'working', category: 'state', key: 'filter_test_2', value: { n: 2 } },
        { layer: 'longterm', category: 'preference', key: 'filter_test_3', value: { n: 3 } },
      ];

      for (const entry of entries) {
        testKeys.push(entry.key);
        await fetch(`${API_BASE}/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
      }
    });

    it('should filter by layer', async () => {
      const response = await fetch(`${API_BASE}/memory?layer=working`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect((data.entries as Array<{ layer: string }>).every((e) => e.layer === 'working')).toBe(true);
    });

    it('should filter by category', async () => {
      const response = await fetch(`${API_BASE}/memory?category=context`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect((data.entries as Array<{ category: string }>).every((e) => e.category === 'context')).toBe(true);
    });

    it('should filter by layer and category', async () => {
      const response = await fetch(`${API_BASE}/memory?layer=longterm&category=preference`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect((data.entries as Array<{ layer: string; category: string }>).every((e) => e.layer === 'longterm' && e.category === 'preference')).toBe(true);
    });
  });

  describe('GET /api/system/memory/:key', () => {
    it('should read memory by key', async () => {
      const key = `test_read_${Date.now()}`;
      testKeys.push(key);

      // Write first
      await fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer: 'working',
          category: 'context',
          key,
          value: { readable: true },
        }),
      });

      // Then read
      const response = await fetch(`${API_BASE}/memory/${key}`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect((data.entry as { key: string }).key).toBe(key);
      expect((data.entry as { value: { readable: boolean } }).value.readable).toBe(true);
    });

    it('should return 404 for non-existent key', async () => {
      const response = await fetch(`${API_BASE}/memory/non_existent_key_12345`);
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/system/memory/batch', () => {
    it('should read multiple entries by keys', async () => {
      const keys = [`batch_test_1_${Date.now()}`, `batch_test_2_${Date.now()}`];
      testKeys.push(...keys);

      // Write entries
      for (const key of keys) {
        await fetch(`${API_BASE}/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            layer: 'working',
            category: 'state',
            key,
            value: { batch: true },
          }),
        });
      }

      // Batch read
      const response = await fetch(`${API_BASE}/memory/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(data.success).toBe(true);
      expect(data.count).toBe(2);
      expect((data.entries as Record<string, unknown>)[keys[0]]).toBeDefined();
      expect((data.entries as Record<string, unknown>)[keys[1]]).toBeDefined();
    });
  });

  describe('DELETE /api/system/memory/:key', () => {
    it('should delete memory entry', async () => {
      const key = `test_delete_${Date.now()}`;

      // Write first
      await fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer: 'episodic',
          category: 'event',
          key,
          value: { deletable: true },
        }),
      });

      // Delete
      const deleteResponse = await fetch(`${API_BASE}/memory/${key}`, {
        method: 'DELETE',
      });
      const deleteData = (await deleteResponse.json()) as ApiResponse;
      expect(deleteData.success).toBe(true);

      // Verify deleted
      const readResponse = await fetch(`${API_BASE}/memory/${key}`);
      expect(readResponse.status).toBe(404);
    });
  });
});
