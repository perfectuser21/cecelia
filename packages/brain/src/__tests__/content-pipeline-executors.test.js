/**
 * content-pipeline-executors 单元测试
 * 验证 executor 函数签名和基本逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeReview } from '../content-pipeline-executors.js';

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

describe('executeReview', () => {
  it('应该在找不到产出目录时返回 review_passed=false', async () => {
    const task = {
      payload: { pipeline_keyword: '测试关键词', parent_pipeline_id: 'test-id' },
      title: '测试',
    };
    const result = await executeReview(task);
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(false);
    expect(result.issues).toContain('找不到产出目录');
  });
});

describe('品牌关键词和禁用词配置', () => {
  it('executor 模块应该能正常导入', async () => {
    const mod = await import('../content-pipeline-executors.js');
    expect(typeof mod.executeResearch).toBe('function');
    expect(typeof mod.executeGenerate).toBe('function');
    expect(typeof mod.executeReview).toBe('function');
    expect(typeof mod.executeExport).toBe('function');
  });
});
