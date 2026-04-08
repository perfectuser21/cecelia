/**
 * topic-selection-scheduler.test.js
 *
 * 测试每日内容选题调度器的核心行为：
 *   注：DISABLED = true 后，triggerDailyTopicSelection 始终提前返回 { disabled: true }
 *   原"启用路径"测试已更新为验证 disabled 模式行为。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';

// ─── Mock topic-selector.js ──────────────────────────────────────────────────

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
}));

// Mock topic-suggestion-manager.js 阻断模块级 import pool from './db.js'
vi.mock('../topic-suggestion-manager.js', () => ({
  saveSuggestions: vi.fn().mockResolvedValue(0),
  autoPromoteSuggestions: vi.fn().mockResolvedValue(0),
  getActiveSuggestions: vi.fn().mockResolvedValue([]),
  approveSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

import { generateTopics } from '../topic-selector.js';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 构造在触发窗口内（UTC 01:02，首选窗口）的 Date */
function makeWindowTime() {
  const d = new Date('2026-03-19T01:02:00Z');
  return d;
}

/** 构造在补偿窗口内（UTC 10:00，09:00-北京时间之后）的 Date */
function makeCatchupWindowTime() {
  return new Date('2026-03-19T10:00:00Z');
}

/** 构造在触发窗口外（UTC 13:00，超过补偿截止时间 12:00）的 Date */
function makeOutsideWindowTime() {
  return new Date('2026-03-19T13:00:00Z');
}

/** 构造 N 个选题 */
function makeTopics(n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    keyword: `选题关键词${i + 1}`,
    content_type: 'solo-company-case',
    title_candidates: [`标题A${i + 1}`, `标题B${i + 1}`, `标题C${i + 1}`],
    hook: `这是第${i + 1}个选题的钩子文案`,
    why_hot: `选题${i + 1}与账号画像匹配`,
    priority_score: 0.9 - i * 0.05,
  }));
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('triggerDailyTopicSelection', () => {
  let pool;
  let insertedTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedTasks = [];

    pool = {
      query: vi.fn(async (sql) => {
        const s = sql.trim();
        if (s.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
          return { rows: [] };
        }
        if (s.startsWith('INSERT INTO tasks')) {
          insertedTasks.push(sql);
          return { rows: [] };
        }
        if (s.startsWith('INSERT INTO topic_selection_log')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
  });

  // ─── DISABLED 模式（DISABLED = true）─────────────────────────────────────

  it('DISABLED 模式：窗口外调用返回 disabled: true，triggered 为 0', async () => {
    const result = await triggerDailyTopicSelection(pool, makeOutsideWindowTime());
    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('DISABLED 模式：窗口内调用也返回 disabled: true，不创建任务', async () => {
    generateTopics.mockResolvedValue(makeTopics(3));
    const result = await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
    expect(insertedTasks).toHaveLength(0);
  });

  it('DISABLED 模式：补偿窗口内调用也返回 disabled: true', async () => {
    generateTopics.mockResolvedValue(makeTopics(1));
    const result = await triggerDailyTopicSelection(pool, makeCatchupWindowTime());
    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('DAILY_TOPIC_CATCHUP_CUTOFF_UTC 边界：UTC 12:00 整点调用返回 disabled: true', async () => {
    const atCutoff = new Date('2026-03-19T12:00:00Z');
    const result = await triggerDailyTopicSelection(pool, atCutoff);
    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
  });

  it('DAILY_TOPIC_CATCHUP_CUTOFF_UTC 边界：UTC 11:59 调用返回 disabled: true', async () => {
    generateTopics.mockResolvedValue(makeTopics(1));
    const justBeforeCutoff = new Date('2026-03-19T11:59:00Z');
    const result = await triggerDailyTopicSelection(pool, justBeforeCutoff);
    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('DISABLED 模式：当天已有任务时调用同样返回 disabled: true（不进入去重逻辑）', async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: [{ id: 'existing-task' }] };
      }
      return { rows: [] };
    });

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    // DISABLED 提前返回，pool.query 不应被调用
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DISABLED 模式：generateTopics 即使 mock 有返回值，也不调用也不创建任务', async () => {
    generateTopics.mockResolvedValue(makeTopics(15));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
    expect(insertedTasks).toHaveLength(0);
  });

  it('DISABLED 模式：generateTopics 即使 mock 为空数组，triggered 仍为 0', async () => {
    generateTopics.mockResolvedValue([]);

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
  });

  it('DISABLED 模式：generateTopics 即使 mock 抛出错误，也不执行（不返回 error 字段）', async () => {
    generateTopics.mockRejectedValue(new Error('Claude API 不可用'));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(result.disabled).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

// ─── hasTodayTopics 单独测试 ──────────────────────────────────────────────────

describe('hasTodayTopics', () => {
  it('有今日任务时返回 true', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'task-1' }] }),
    };
    expect(await hasTodayTopics(pool)).toBe(true);
  });

  it('无今日任务时返回 false', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    expect(await hasTodayTopics(pool)).toBe(false);
  });
});
