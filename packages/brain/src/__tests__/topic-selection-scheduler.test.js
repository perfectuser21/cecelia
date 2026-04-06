/**
 * topic-selection-scheduler.test.js
 *
 * 测试每日内容选题调度器的核心行为：
 *   1. 触发时间窗口内创建 content-pipeline tasks
 *   2. 当天已有任务时跳过（去重）
 *   3. 每日最多创建 10 条任务（限流）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';

// ─── Mock topic-selector.js ──────────────────────────────────────────────────

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
}));

// Mock topic-suggestion-manager.js 阻断模块级 import pool from './db.js'
// saveSuggestions 返回 0 表示无选题存入推荐队列，所有选题走直接入队流程
vi.mock('../topic-suggestion-manager.js', () => ({
  saveSuggestions: vi.fn().mockResolvedValue(0),
  autoPromoteSuggestions: vi.fn().mockResolvedValue(0),
  getActiveSuggestions: vi.fn().mockResolvedValue([]),
  approveSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

import { generateTopics } from '../topic-selector.js';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 构造在触发窗口内（UTC 01:02）的 Date */
function makeWindowTime() {
  const d = new Date('2026-03-19T01:02:00Z');
  return d;
}

/** 构造在触发窗口外（UTC 10:00）的 Date */
function makeOutsideWindowTime() {
  return new Date('2026-03-19T10:00:00Z');
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
        // hasTodayTopics 查询
        if (s.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
          return { rows: [] }; // 默认：今天没有任务
        }
        // INSERT content-pipeline
        if (s.startsWith('INSERT INTO tasks')) {
          insertedTasks.push(sql);
          return { rows: [] };
        }
        // INSERT topic_selection_log
        if (s.startsWith('INSERT INTO topic_selection_log')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
  });

  // ─── 触发窗口外 ──────────────────────────────────────────────────────────

  it('触发窗口外不触发（skipped_window: true）', async () => {
    const result = await triggerDailyTopicSelection(pool, makeOutsideWindowTime());
    expect(result.skipped_window).toBe(true);
    expect(result.triggered).toBe(0);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  // ─── 去重逻辑 ─────────────────────────────────────────────────────────────

  it('当天已有 daily_topic_selection 任务时跳过（skipped: true）', async () => {
    // mock hasTodayTopics → 已有任务
    pool.query = vi.fn(async (sql) => {
      if (sql.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: [{ id: 'existing-task' }] };
      }
      return { rows: [] };
    });

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(result.skipped).toBe(true);
    expect(result.triggered).toBe(0);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  // ─── 正常触发：创建 content-pipeline tasks ────────────────────────────────

  it('触发时间窗口内且无重复时，创建与选题数量相同的 content-pipeline tasks', async () => {
    const topics = makeTopics(5);
    generateTopics.mockResolvedValue(topics);

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.skipped).toBe(false);
    expect(result.skipped_window).toBe(false);
    expect(result.triggered).toBe(5);
    // 每个选题: 1x INSERT tasks + 1x INSERT topic_selection_log = 5+5 = 10 calls + 1x hasTodayTopics
    const insertTaskCalls = insertedTasks.filter(s => s.includes("'content-pipeline'"));
    expect(insertTaskCalls).toHaveLength(5);
  });

  it('创建的 tasks 包含 pipeline_keyword 和 trigger_source: daily_topic_selection', async () => {
    const topics = makeTopics(1);
    generateTopics.mockResolvedValue(topics);

    const insertedPayloads = [];
    pool.query = vi.fn(async (sql, params) => {
      if (sql.trim().startsWith('INSERT INTO tasks')) {
        insertedPayloads.push(params);
      }
      if (sql.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(insertedPayloads).toHaveLength(1);
    const payload = JSON.parse(insertedPayloads[0][2]); // 第3个参数是 payload JSON
    expect(payload.pipeline_keyword).toBe('选题关键词1');
    expect(payload.trigger_source).toBe('daily_topic_selection');
    expect(payload.content_type).toBe('solo-company-case');
    expect(payload.title_candidates).toHaveLength(3);
  });

  // ─── 限流：最多创建 10 条 ──────────────────────────────────────────────────

  it('generateTopics 返回超过 10 个时，最多只创建 10 条 content-pipeline tasks', async () => {
    const topics = makeTopics(15); // 超过限额
    generateTopics.mockResolvedValue(topics);

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(10); // 限流生效
    const insertTaskCalls = insertedTasks.filter(s => s.includes("'content-pipeline'"));
    expect(insertTaskCalls).toHaveLength(10);
  });

  it('generateTopics 返回空数组时，triggered 为 0', async () => {
    generateTopics.mockResolvedValue([]);

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(insertedTasks).toHaveLength(0);
  });

  it('generateTopics 抛出错误时，返回 error 字段且 triggered 为 0', async () => {
    generateTopics.mockRejectedValue(new Error('Claude API 不可用'));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(result.error).toContain('Claude API 不可用');
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
