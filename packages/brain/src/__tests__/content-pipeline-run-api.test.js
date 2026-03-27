/**
 * content-pipeline run/stages/output API 测试
 */

import { describe, it, expect } from 'vitest';

describe('content-pipeline run API', () => {
  it('路由文件导出 express Router', async () => {
    const mod = await import('../routes/content-pipeline.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('orchestrator 导出 orchestrateContentPipelines 和 executeQueuedContentTasks', async () => {
    const mod = await import('../content-pipeline-orchestrator.js');
    expect(typeof mod.orchestrateContentPipelines).toBe('function');
    expect(typeof mod.executeQueuedContentTasks).toBe('function');
  });

  it('task-router content-* 路由到 xian', async () => {
    const { LOCATION_MAP } = await import('../task-router.js');
    expect(LOCATION_MAP['content-pipeline']).toBe('xian');
    expect(LOCATION_MAP['content-research']).toBe('xian');
    expect(LOCATION_MAP['content-copywriting']).toBe('xian');
    expect(LOCATION_MAP['content-copy-review']).toBe('xian');
    expect(LOCATION_MAP['content-generate']).toBe('xian');
    expect(LOCATION_MAP['content-image-review']).toBe('xian');
    expect(LOCATION_MAP['content-export']).toBe('xian');
  });
});
