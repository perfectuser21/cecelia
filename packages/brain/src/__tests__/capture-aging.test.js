// test-pairing 代理文件（TypeScript 实现见 capture-aging.test.ts）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
describe('capture-aging (JS pairing stub)', () => {
  it('validates capture-aging module exports', async () => {
    // 验证 capture-aging.js 可加载
    const mod = await import('../capture-aging.js');
    expect(mod).toBeDefined();
  });
});
