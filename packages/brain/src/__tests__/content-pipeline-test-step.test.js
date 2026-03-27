/**
 * content-pipeline test-step API 测试
 */
import { describe, it, expect } from 'vitest';

describe('test-step route', () => {
  it('content-pipeline 路由模块可正常导入', async () => {
    const mod = await import('../routes/content-pipeline.js');
    expect(mod.default).toBeDefined();
  });

  it('路由文件包含 6 个 pipeline 步骤的系统 prompt', async () => {
    const code = (await import('fs')).readFileSync(
      new URL('../routes/content-pipeline.js', import.meta.url), 'utf-8'
    );
    const steps = [
      'content-research', 'content-copywriting', 'content-copy-review',
      'content-generate', 'content-image-review', 'content-export',
    ];
    for (const step of steps) {
      expect(code).toContain(step);
    }
  });

  it('路由文件包含 callLLM 调用', async () => {
    const code = (await import('fs')).readFileSync(
      new URL('../routes/content-pipeline.js', import.meta.url), 'utf-8'
    );
    expect(code).toContain('callLLM');
    expect(code).toContain('test-step');
  });
});
