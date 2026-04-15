/**
 * TopicsPoolPage.test.tsx — 选题池页面单元测试
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 基准目录：从当前测试文件向上找仓库根
const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('TopicsPoolPage — 文件存在性与内容校验', () => {
  it('topic-pool-scheduler.js 导出 triggerTopicPoolSchedule', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'packages/brain/src/topic-pool-scheduler.js'),
      'utf8'
    );
    expect(content).toContain('triggerTopicPoolSchedule');
    expect(content).toContain("status = '已通过'");
    expect(content).toContain("status = '已发布'");
  });

  it('topic-selection-scheduler.js DISABLED = true', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'packages/brain/src/topic-selection-scheduler.js'),
      'utf8'
    );
    expect(content).toContain('DISABLED = true');
  });

  it('Migration 234 存在且含 topics 表 DDL', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'packages/brain/migrations/234_topics_pool.sql'),
      'utf8'
    );
    expect(content).toContain('CREATE TABLE IF NOT EXISTS topics');
    expect(content).toContain('topics_rhythm_config');
  });

  it('ContentFactory.tsx 含选题池 Tab', () => {
    const content = readFileSync(
      resolve(__dirname, 'ContentFactory.tsx'),
      'utf8'
    );
    expect(content).toContain('选题池');
    expect(content).toContain('TopicsPoolPage');
  });
});
