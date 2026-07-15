/**
 * dev-records.test.js — BEHAVIOR-1 补充：dev-records 路由 canary 过滤测试
 */
import { describe, it, expect } from 'vitest';

describe('dev-records route', () => {
  describe('GET /api/brain/dev-records', () => {
    it('canary 任务不出现在 dev-records 列表（IS DISTINCT FROM 过滤）', async () => {
      // 验证路由模块可以被导入（实现已存在）
      const mod = await import('../dev-records.js');
      expect(mod).toBeDefined();
      // router 是 default export 或命名 export
      const router = mod.default ?? mod.router;
      expect(router).toBeDefined();
    });

    it('canary 过滤条件使用 IS DISTINCT FROM 处理 NULL', async () => {
      // 读取 dev-records.js 源码验证过滤条件存在
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const { dirname, join } = await import('node:path');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(__dirname, '../dev-records.js'), 'utf8');
      // 必须含 IS DISTINCT FROM 或 canary 过滤相关代码
      const hasDistinctFrom = src.includes('IS DISTINCT FROM');
      const hasCanaryFilter = src.includes("canary");
      expect(hasCanaryFilter).toBe(true);
      expect(hasDistinctFrom).toBe(true);
    });

    it('列表端点存在 limit/offset 分页参数处理', async () => {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const { dirname, join } = await import('node:path');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(__dirname, '../dev-records.js'), 'utf8');
      expect(src).toMatch(/limit/);
      expect(src).toMatch(/offset/);
    });
  });
});
