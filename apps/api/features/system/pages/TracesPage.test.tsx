/**
 * TracesPage.test.tsx — sibling test for TracesPage component.
 * 遵循 apps/api/features/ 现有最小约定：验证默认导出可加载。
 */
import { describe, it, expect } from 'vitest';

describe('TracesPage', () => {
  it('should export default component', async () => {
    const mod = await import('./TracesPage');
    expect(typeof mod.default).toBe('function');
  });
});
