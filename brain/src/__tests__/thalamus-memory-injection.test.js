/**
 * Tests for thalamus Memory API injection
 * DoD: thalamus-memory-inject
 *
 * 验证：
 * 1. analyzeEvent() 在构建 prompt 前调用 Memory 搜索
 * 2. prompt 包含 Memory 搜索结果段落
 * 3. Memory 搜索失败时优雅降级（graceful fallback）
 * 4. 从 event payload 提取搜索 query
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractMemoryQuery, buildMemoryBlock } from '../thalamus.js';

// Mock database pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }
}));

// Mock learning.js
vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

describe('extractMemoryQuery', () => {
  it('应从 task.title 提取 query', () => {
    const event = { type: 'task_completed', task: { title: '实现登录功能', task_type: 'dev' } };
    expect(extractMemoryQuery(event)).toBe('实现登录功能');
  });

  it('应从 payload.title 提取 query（task.title 不存在时）', () => {
    const event = { type: 'task_completed', payload: { title: '数据库迁移' } };
    expect(extractMemoryQuery(event)).toBe('数据库迁移');
  });

  it('应从 payload.description 提取 query（title 不存在时）', () => {
    const event = { type: 'task_completed', payload: { description: '修复 bug' } };
    expect(extractMemoryQuery(event)).toBe('修复 bug');
  });

  it('应从 event.type 提取 query（所有 payload 字段都不存在时）', () => {
    const event = { type: 'tick' };
    expect(extractMemoryQuery(event)).toBe('tick');
  });

  it('event 为空时应返回空字符串', () => {
    expect(extractMemoryQuery({})).toBe('');
  });
});

describe('buildMemoryBlock', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('Memory 搜索成功时应返回格式化的 block', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: [
          { title: '实现 JWT 认证', similarity: 0.85, preview: '基于 JWT 的用户认证系统' },
          { title: '数据库连接池优化', similarity: 0.72, preview: '使用 pg-pool 管理连接' },
          { title: '修复登录 bug', similarity: 0.61, preview: '修复 token 过期问题' },
        ]
      }),
    });

    const event = { type: 'task_started', task: { title: '用户认证功能', task_type: 'dev' } };
    const block = await buildMemoryBlock(event);

    expect(block).toContain('## 相关历史任务（Memory 语义搜索，供参考）');
    expect(block).toContain('实现 JWT 认证');
    expect(block).toContain('0.85');
    expect(block).toContain('数据库连接池优化');
    // 每条结果不超过 150 字符预览
    const lines = block.split('\n').filter(l => l.startsWith('- ['));
    lines.forEach(line => {
      // preview 部分不超过 150 字符
      const previewMatch = line.match(/: (.+)$/);
      if (previewMatch) {
        expect(previewMatch[1].length).toBeLessThanOrEqual(150);
      }
    });
  });

  it('Memory 搜索返回空结果时应返回空字符串', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ matches: [] }),
    });

    const event = { type: 'tick', task: { title: '检查状态' } };
    const block = await buildMemoryBlock(event);

    expect(block).toBe('');
  });

  it('Memory 搜索 HTTP 失败时应优雅降级（返回空字符串）', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const event = { type: 'task_started', task: { title: '某项任务' } };
    const block = await buildMemoryBlock(event);

    expect(block).toBe('');
  });

  it('Memory API 网络超时/异常时应优雅降级（返回空字符串）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed: connection refused'));

    const event = { type: 'task_started', task: { title: '某项任务' } };
    const block = await buildMemoryBlock(event);

    expect(block).toBe('');
  });

  it('query 为空时应返回空字符串（不发起请求）', async () => {
    global.fetch = vi.fn();

    const event = {};
    const block = await buildMemoryBlock(event);

    expect(block).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('结果最多返回 3 条', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: [
          { title: 'Task 1', similarity: 0.9, preview: '预览1' },
          { title: 'Task 2', similarity: 0.8, preview: '预览2' },
          { title: 'Task 3', similarity: 0.7, preview: '预览3' },
        ]
      }),
    });

    const event = { type: 'task_started', task: { title: '某项任务' } };
    const block = await buildMemoryBlock(event);

    const lines = block.split('\n').filter(l => l.startsWith('- ['));
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});
