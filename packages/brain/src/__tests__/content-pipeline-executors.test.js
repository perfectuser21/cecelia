/**
 * content-pipeline-executors 单元测试
 * 验证 executor 函数签名和基本逻辑（6 阶段）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCopyReview } from '../content-pipeline-executors.js';

// Mock fs 和 child_process
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

describe('executeCopyReview', () => {
  it('应该在找不到产出目录时返回 review_passed=false', async () => {
    const task = {
      payload: { pipeline_keyword: '测试关键词', parent_pipeline_id: 'test-id' },
      title: '测试',
    };
    const result = await executeCopyReview(task);
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(false);
    expect(result.issues).toContain('找不到产出目录');
  });
});

describe('executor 模块导入', () => {
  it('所有 6 个 executor 函数应该能正常导入', async () => {
    const mod = await import('../content-pipeline-executors.js');
    expect(typeof mod.executeResearch).toBe('function');
    expect(typeof mod.executeCopywriting).toBe('function');
    expect(typeof mod.executeCopyReview).toBe('function');
    expect(typeof mod.executeGenerate).toBe('function');
    expect(typeof mod.executeImageReview).toBe('function');
    expect(typeof mod.executeExport).toBe('function');
  });
});
