import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db
vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('self-drive routes', () => {
  let router;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../routes/self-drive.js');
    router = mod.default;
  });

  it('should export a Router instance', () => {
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });

  it('should have GET /latest route', () => {
    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    const latestRoute = routes.find((r) => r.path === '/latest');
    expect(latestRoute).toBeDefined();
    expect(latestRoute.methods).toContain('get');
  });

  it('should query cecelia_events for self_drive events', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../../routes/self-drive.js', import.meta.url),
      'utf-8'
    );

    // 验证查询 cecelia_events 表
    expect(content).toContain('cecelia_events');
    expect(content).toContain('self_drive');
    expect(content).toContain('cycle_complete');
  });
});
