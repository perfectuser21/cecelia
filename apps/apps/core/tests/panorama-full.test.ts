/**
 * Tests for /api/panorama/full endpoint
 * Verifies full system panorama aggregation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Store original fetch
const originalFetch = global.fetch;

describe('/api/panorama/full', () => {
  let app: express.Application;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Create fresh mock for each test
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    // Clear module cache and reimport
    vi.resetModules();
    const panoramaRoutes = await import('../src/panorama/routes.js');

    app = express();
    app.use(express.json());
    app.use('/api/panorama', panoramaRoutes.default);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns full panorama structure', async () => {
    // Mock all services
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', focus: { project: 'test' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ health: 'ok', queueLength: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { repos: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });

    const response = await request(app).get('/api/panorama/full');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('vps');
    expect(response.body.data).toHaveProperty('brain');
    expect(response.body.data).toHaveProperty('quality');
    expect(response.body.data).toHaveProperty('github');
    expect(response.body.data).toHaveProperty('services');
    expect(response.body.data).toHaveProperty('timestamp');
  });

  it('returns services health status list', async () => {
    // Mock services
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ health: 'ok' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      })
      .mockResolvedValueOnce({ ok: true });

    const response = await request(app).get('/api/panorama/full');

    expect(response.status).toBe(200);
    expect(response.body.data.services).toBeInstanceOf(Array);
    expect(response.body.data.services.length).toBeGreaterThan(0);

    const brainService = response.body.data.services.find(
      (s: any) => s.name === 'semantic-brain'
    );
    expect(brainService).toBeDefined();
    expect(brainService.port).toBe(5220);
  });

  it('marks services as down when they fail', async () => {
    // Mock all services failing
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const response = await request(app).get('/api/panorama/full');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.brain.health).toBe('unavailable');
    expect(response.body.data.quality.health).toBe('unavailable');
  });
});
