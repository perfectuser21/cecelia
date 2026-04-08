/**
 * topic-selection-scheduler.test.js
 *
 * 测试每日内容选题调度器的核心行为（DISABLED = false，启用模式）：
 *   - 窗口外调用 → skipped_window: true
 *   - 今日已有任务 → skipped: true
 *   - 正常窗口内触发 → generateTopics 被调用，创建 content-pipeline tasks
 *   - MAX_DAILY_TOPICS = 5，每日限额
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
          return { rows: [] }; // 默认今日无任务
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

  // ─── 窗口外 ─────────────────────────────────────────────────────────────────

  it('窗口外调用（UTC 13:00）返回 skipped_window: true，不创建任务', async () => {
    const result = await triggerDailyTopicSelection(pool, makeOutsideWindowTime());
    expect(result.triggered).toBe(0);
    expect(result.skipped_window).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('DAILY_TOPIC_CATCHUP_CUTOFF_UTC 边界：UTC 12:00 整点返回 skipped_window: true', async () => {
    const atCutoff = new Date('2026-03-19T12:00:00Z');
    const result = await triggerDailyTopicSelection(pool, atCutoff);
    expect(result.triggered).toBe(0);
    expect(result.skipped_window).toBe(true);
  });

  // ─── 今日已有任务（幂等） ──────────────────────────────────────────────────

  it('今日已有任务时返回 skipped: true，不重复生成', async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: [{ id: 'existing-task' }] };
      }
      return { rows: [] };
    });

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  // ─── 正常触发路径 ─────────────────────────────────────────────────────────

  it('窗口内调用，generateTopics 返回 3 个选题，全部创建 content-pipeline 任务', async () => {
    generateTopics.mockResolvedValue(makeTopics(3));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(generateTopics).toHaveBeenCalledWith(pool);
    // saveSuggestions mock 返回 0（全部进自动队列）→ 创建 3 个任务
    expect(result.triggered).toBe(3);
    expect(result.skipped).toBeFalsy();
    expect(result.disabled).toBeUndefined();
    expect(insertedTasks).toHaveLength(3);
  });

  it('补偿窗口内（UTC 10:00）正常触发', async () => {
    generateTopics.mockResolvedValue(makeTopics(2));

    const result = await triggerDailyTopicSelection(pool, makeCatchupWindowTime());

    expect(generateTopics).toHaveBeenCalled();
    expect(result.triggered).toBe(2);
  });

  it('MAX_DAILY_TOPICS = 5 限流：generateTopics 返回 10 个选题，最多创建 5 个任务', async () => {
    generateTopics.mockResolvedValue(makeTopics(10));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    // saveSuggestions mock 返回 0 → 全部进自动队列，但限流到 5
    expect(result.triggered).toBe(5);
    expect(insertedTasks.length).toBeLessThanOrEqual(5);
  });

  it('generateTopics 返回空数组时不创建任务', async () => {
    generateTopics.mockResolvedValue([]);

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(insertedTasks).toHaveLength(0);
  });

  it('generateTopics 抛出错误时返回 error 字段，triggered 为 0', async () => {
    generateTopics.mockRejectedValue(new Error('Claude API 不可用'));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(result.error).toBeDefined();
    expect(insertedTasks).toHaveLength(0);
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
