/**
 * topic-selection-trigger.test.js
 *
 * 测试每日选题手动触发逻辑（内容生成引擎 v1：DISABLED = false）：
 *   - 触发成功路径（窗口内+无今日记录）
 *   - 已有今日任务时跳过
 *   - 窗口外跳过
 *   - migration 203 文件存在验证
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
}));

// Mock topic-suggestion-manager.js 阻断其直接导入 db.js
vi.mock('../topic-suggestion-manager.js', () => ({
  saveSuggestions: vi.fn().mockResolvedValue(5),
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

// UTC 01:02 — 触发窗口内
const WINDOW_TIME = new Date('2026-03-27T01:02:00Z');

function makePool(todayHasTasks = false) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: todayHasTasks ? [{ id: 'existing' }] : [] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('trigger-topics: 手动触发逻辑', () => {
  beforeEach(() => vi.clearAllMocks());

  it('窗口内且无今日记录时：触发成功，generateTopics 被调用', async () => {
    generateTopics.mockResolvedValue([
      { keyword: '一人公司效率', content_type: 'solo-company-case', title_candidates: ['A', 'B', 'C'], hook: '开头', why_hot: '理由', priority_score: 0.9 },
      { keyword: '副业AI变现', content_type: 'solo-company-case', title_candidates: ['A', 'B', 'C'], hook: '开头', why_hot: '理由', priority_score: 0.85 },
    ]);
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, WINDOW_TIME);
    expect(result.disabled).toBeUndefined();
    expect(result.skipped).toBe(false);
    expect(result.skipped_window).toBe(false);
    expect(generateTopics).toHaveBeenCalled();
  });

  it('今日已有任务时，hasTodayTopics 返回 true', async () => {
    const pool = makePool(true);
    expect(await hasTodayTopics(pool)).toBe(true);
  });

  it('当天已有任务时，triggerDailyTopicSelection 返回 skipped: true', async () => {
    const pool = makePool(true);
    const result = await triggerDailyTopicSelection(pool, WINDOW_TIME);
    expect(result.skipped).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('窗口时间外不触发（skipped_window: true）', async () => {
    const pool = makePool(false);
    // UTC 13:00 超过补偿截止时间 UTC 12:00
    const result = await triggerDailyTopicSelection(pool, new Date('2026-03-27T13:00:00Z'));
    expect(result.skipped_window).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('补偿窗口内（UTC 10:00）且无今日记录时：触发成功', async () => {
    generateTopics.mockResolvedValue([
      { keyword: '补偿触发选题', content_type: 'solo-company-case', title_candidates: ['A', 'B', 'C'], hook: '开头', why_hot: '理由', priority_score: 0.8 },
    ]);
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, new Date('2026-03-27T10:00:00Z'));
    expect(result.skipped_window).toBe(false);
    expect(generateTopics).toHaveBeenCalled();
  });

  it('migration 203 文件存在且包含 topic_selection_log 建表语句', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const sql = readFileSync(join(__dirname, '../../migrations/203_topic_selection_log.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS topic_selection_log');
    expect(sql).toContain('selected_date');
    expect(sql).toContain('keyword');
  });
});
