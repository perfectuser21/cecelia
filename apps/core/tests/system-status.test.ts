/**
 * Tests for /api/system/status endpoint
 * Verifies aggregation of brain, quality, and workflows status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Store original fetch
const originalFetch = global.fetch;

describe('/api/system/status', () => {
  let app: express.Application;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Create fresh mock for each test
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    // Clear module cache and reimport
    vi.resetModules();
    const systemRoutes = await import('../src/system/routes.js');

    app = express();
    app.use(express.json());
    app.use('/api/system', systemRoutes.default);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns aggregated status when all services are healthy', async () => {
    // Mock all service responses
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ focus: { project: 'test' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ enabled: true, last_tick: '2026-01-30T10:00:00Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [{ priority: 'P0', status: 'pending' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          health: 'ok',
          queueLength: 3,
          lastRun: { id: 'run-1' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

    const response = await request(app).get('/api/system/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('brain');
    expect(response.body.data).toHaveProperty('quality');
    expect(response.body.data).toHaveProperty('workflows');
    expect(response.body.data).toHaveProperty('timestamp');
  });

  it('returns health status from /api/system/health', async () => {
    const response = await request(app).get('/api/system/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe('healthy');
    expect(response.body.service).toBe('cecelia-workspace');
    expect(response.body).toHaveProperty('timestamp');
  });
});
