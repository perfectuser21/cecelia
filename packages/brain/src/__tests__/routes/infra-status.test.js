import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from 'express';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn(() => '/dev/disk3s1s1   228Gi    17Gi   159Gi    10%'),
}));

describe('infra-status routes', () => {
  let router;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../routes/infra-status.js');
    router = mod.default;
  });

  it('should export a Router instance', () => {
    expect(router).toBeDefined();
    // Express Router is a function
    expect(typeof router).toBe('function');
  });

  it('should have GET /servers route', () => {
    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    const serversRoute = routes.find((r) => r.path === '/servers');
    expect(serversRoute).toBeDefined();
    expect(serversRoute.methods).toContain('get');
  });

  it('should define all 7 servers in SERVERS array', async () => {
    const content = await import('fs').then((fs) =>
      fs.readFileSync(
        new URL('../../routes/infra-status.js', import.meta.url),
        'utf-8'
      )
    );

    // Count unique server IDs
    const idMatches = content.match(/id:\s*'[^']+'/g);
    expect(idMatches).toBeDefined();
    expect(idMatches.length).toBeGreaterThanOrEqual(7);
  });

  it('should include all expected server IDs', async () => {
    const content = await import('fs').then((fs) =>
      fs.readFileSync(
        new URL('../../routes/infra-status.js', import.meta.url),
        'utf-8'
      )
    );

    const expectedIds = [
      'us-mac-m4',
      'us-vps',
      'hk-vps',
      'xian-mac-m1',
      'xian-mac-m4',
      'xian-pc',
      'nas',
    ];

    for (const id of expectedIds) {
      expect(content).toContain(`'${id}'`);
    }
  });
});
