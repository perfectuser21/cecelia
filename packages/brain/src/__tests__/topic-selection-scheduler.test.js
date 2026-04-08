/**
 * topic-selection-scheduler.test.js
 *
 * 测试每日内容选题调度器的核心行为（内容生成引擎 v1：DISABLED = false）：
 *   - 触发窗口内且今天无记录时：调用 generateTopics 并保存推荐
 *   - 窗口外：跳过（skipped_window: true）
 *   - 今天已触发过：跳过（skipped: true）
 *   - 传入主题库种子词给 generateTopics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';

// ─── Mock 依赖 ────────────────────────────────────────────────────────────────

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
}));

vi.mock('../topic-suggestion-manager.js', () => ({
  saveSuggestions: vi.fn().mockResolvedValue(0),
  autoPromoteSuggestions: vi.fn().mockResolvedValue(0),
  getActiveSuggestions: vi.fn().mockResolvedValue([]),
  approveSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

vi.mock('../content-types/ai-solopreneur-topic-library.js', () => ({
  AI_SOLOPRENEUR_TOPICS: Array.from({ length: 30 }, (_, i) => ({
    keyword: `种子词${i}`,
    category: 'case',
    content_type: 'solo-company-case',
  })),
  sampleTopics: vi.fn().mockReturnValue([
    { keyword: '种子词A', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词B', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词C', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词D', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词E', category: 'case', content_type: 'solo-company-case' },
  ]),
}));

import { generateTopics } from '../topic-selector.js';
import { saveSuggestions } from '../topic-suggestion-manager.js';
import { sampleTopics } from '../content-types/ai-solopreneur-topic-library.js';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 构造在触发窗口内（UTC 01:02，首选窗口）的 Date */
function makeWindowTime() {
  return new Date('2026-03-19T01:02:00Z');
}

/** 构造在补偿窗口内（UTC 10:00）的 Date */
function makeCatchupWindowTime() {
  return new Date('2026-03-19T10:00:00Z');
}

/** 构造在触发窗口外（UTC 13:00，超过补偿截止时间 12:00）的 Date */
function makeOutsideWindowTime() {
  return new Date('2026-03-19T13:00:00Z');
}

/** 构造 N 个选题 */
function makeTopics(n = 5) {
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
        const s = typeof sql === 'string' ? sql.trim() : '';
        if (s.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
          return { rows: [] }; // 今天没有触发过
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

    generateTopics.mockResolvedValue(makeTopics(5));
    saveSuggestions.mockResolvedValue(5);
  });

  // ─── 启用路径：窗口内触发 ───────────────────────────────────────────────────

  it('触发窗口内且今天无记录时：调用 generateTopics，不返回 disabled', async () => {
    const result = await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(result.disabled).toBeUndefined();
    expect(result.skipped_window).toBe(false);
    expect(result.skipped).toBe(false);
    expect(generateTopics).toHaveBeenCalled();
  });

  it('触发窗口内：generateTopics 被调用时传入 seedKeywords', async () => {
    await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(sampleTopics).toHaveBeenCalled();
    expect(generateTopics).toHaveBeenCalledWith(
      pool,
      expect.arrayContaining(['种子词A'])
    );
  });

  it('补偿窗口内（UTC 10:00）：也触发选题生成', async () => {
    const result = await triggerDailyTopicSelection(pool, makeCatchupWindowTime());
    expect(result.disabled).toBeUndefined();
    expect(result.skipped_window).toBe(false);
    expect(generateTopics).toHaveBeenCalled();
  });

  it('generateTopics 返回 5 个选题时，保存推荐队列', async () => {
    await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(saveSuggestions).toHaveBeenCalledWith(pool, expect.any(Array), expect.any(String));
  });

  // ─── 跳过路径：窗口外 ──────────────────────────────────────────────────────

  it('窗口外（UTC 13:00）：跳过，不调用 generateTopics', async () => {
    const result = await triggerDailyTopicSelection(pool, makeOutsideWindowTime());
    expect(result.skipped_window).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('DAILY_TOPIC_CATCHUP_CUTOFF_UTC 边界：UTC 12:00 整点超出窗口，跳过', async () => {
    const atCutoff = new Date('2026-03-19T12:00:00Z');
    const result = await triggerDailyTopicSelection(pool, atCutoff);
    expect(result.skipped_window).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('UTC 11:59 在窗口内：触发', async () => {
    const justBeforeCutoff = new Date('2026-03-19T11:59:00Z');
    const result = await triggerDailyTopicSelection(pool, justBeforeCutoff);
    expect(result.skipped_window).toBe(false);
    expect(generateTopics).toHaveBeenCalled();
  });

  // ─── 跳过路径：今天已触发 ──────────────────────────────────────────────────

  it('今天已有触发记录时：跳过（skipped: true），不调用 generateTopics', async () => {
    pool.query = vi.fn(async (sql) => {
      const s = typeof sql === 'string' ? sql.trim() : '';
      if (s.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: [{ id: 'existing-task' }] }; // 今天已有记录
      }
      return { rows: [] };
    });

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());
    expect(result.skipped).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  // ─── 错误处理 ──────────────────────────────────────────────────────────────

  it('generateTopics 抛出错误时：返回 error 字段，triggered 为 0', async () => {
    generateTopics.mockRejectedValue(new Error('Claude API 不可用'));

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
    expect(result.error).toBe('Claude API 不可用');
    expect(result.disabled).toBeUndefined();
  });

  it('generateTopics 返回空数组时：triggered 为 0，不创建任务', async () => {
    generateTopics.mockResolvedValue([]);

    const result = await triggerDailyTopicSelection(pool, makeWindowTime());

    expect(result.triggered).toBe(0);
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
