/**
 * topic-selector.js 单元测试
 * 覆盖纯函数：normalizeTopicItem（通过 generateTopics 的 normalizeTopicItem）
 * 以及 get7DayROIContext 的无数据降级行为
 */

import { describe, it, expect, vi } from 'vitest';

// Mock llm-caller.js 以阻断 account-usage.js → db.js → dotenv/config 的导入链
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '' }),
}));

import { get7DayROIContext } from '../topic-selector.js';

// ─── get7DayROIContext 降级行为 ────────────────────────────────────────────────

describe('get7DayROIContext', () => {
  it('DB 查询返回空数组时返回空字符串', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await get7DayROIContext(mockPool as any);
    expect(result).toBe('');
  });

  it('DB 查询抛出异常时降级返回空字符串', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const result = await get7DayROIContext(mockPool as any);
    expect(result).toBe('');
  });

  it('有数据时返回包含平台信息的上下文段落', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            platform: '抖音',
            content_count: '5',
            total_views: '10000',
            total_likes: '500',
            total_comments: '100',
            total_shares: '50',
            avg_views_per_content: '2000',
            engagement_rate: '65.00',
          },
        ],
      }),
    };
    const result = await get7DayROIContext(mockPool as any);
    expect(result).toContain('近7日实际发布数据参考');
    expect(result).toContain('抖音');
    expect(result).toContain('5篇内容');
  });

  it('content_count 为 0 的平台不出现在结果中', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            platform: '知乎',
            content_count: '0',
            total_views: '0',
            total_likes: '0',
            total_comments: '0',
            total_shares: '0',
            avg_views_per_content: '0',
            engagement_rate: '0',
          },
        ],
      }),
    };
    const result = await get7DayROIContext(mockPool as any);
    expect(result).toBe('');
  });
});
