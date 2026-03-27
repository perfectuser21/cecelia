import { describe, it, expect } from 'vitest';

describe('ContentPipelinePage', () => {
  it('模块可正常导入', async () => {
    const mod = await import('./ContentPipelinePage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

describe('content feature manifest', () => {
  it('manifest 导出正确的 id 和 routes', async () => {
    const mod = await import('../index');
    const manifest = mod.default;
    expect(manifest.id).toBe('content');
    expect(manifest.routes.length).toBeGreaterThan(0);
    expect(manifest.routes[0].path).toBe('/content');
  });
});
