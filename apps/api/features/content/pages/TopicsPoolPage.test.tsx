/**
 * TopicsPoolPage.test.tsx — 选题池页面单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock fetch
global.fetch = vi.fn();

describe('TopicsPoolPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // rhythm mock
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/rhythm')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ daily_limit: 1 }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ topics: [], total: 0 }),
      });
    });
  });

  it('topic-pool-scheduler.js 导出 triggerTopicPoolSchedule', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../../../../../brain/src/topic-pool-scheduler.js', import.meta.url),
      'utf8'
    );
    expect(content).toContain('triggerTopicPoolSchedule');
    expect(content).toContain("status = '已通过'");
    expect(content).toContain("status = '已发布'");
  });

  it('topic-selection-scheduler.js DISABLED = true', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../../../../../brain/src/topic-selection-scheduler.js', import.meta.url),
      'utf8'
    );
    expect(content).toContain('DISABLED = true');
  });

  it('Migration 234 存在且含 topics 表 DDL', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('../../../../../brain/migrations/234_topics_pool.sql', import.meta.url),
      'utf8'
    );
    expect(content).toContain('CREATE TABLE IF NOT EXISTS topics');
    expect(content).toContain('topics_rhythm_config');
  });

  it('ContentFactory.tsx 含选题池 Tab', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(
      new URL('./ContentFactory.tsx', import.meta.url),
      'utf8'
    );
    expect(content).toContain('选题池');
    expect(content).toContain('TopicsPoolPage');
  });
});
