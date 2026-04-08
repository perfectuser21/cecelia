/**
 * topic-selection-trigger.test.js
 *
 * 测试每日选题触发逻辑（DISABLED = false，启用模式）：
 *   - 窗口内正常触发 → 创建 content-pipeline tasks
 *   - 今日已有任务 → skipped: true（幂等）
 *   - 窗口外 → skipped_window: true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
}));

// Mock topic-suggestion-manager.js 阻断其直接导入 db.js（模块级 import pool from './db.js'）
vi.mock('../topic-suggestion-manager.js', () => ({
  saveSuggestions: vi.fn().mockResolvedValue(0),
  autoPromoteSuggestions: vi.fn().mockResolvedValue(0),
  getActiveSuggestions: vi.fn().mockResolvedValue([]),
  approveSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

import { generateTopics } from '../topic-selector.js';

// UTC 01:02 — 触发窗口内
const WINDOW_TIME = new Date('2026-03-27T01:02:00Z');

function makePool(todayHasTasks = false) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("payload->>'trigger_source' = 'daily_topic_selection'")) {
        return { rows: todayHasTasks ? [{ id: 'existing' }] : [] };
      }
      return { rows: [] };
    }),
  };
}

describe('trigger-topics: 手动触发逻辑', () => {
  beforeEach(() => vi.clearAllMocks());

  it('窗口内调用，generateTopics 有返回值时创建 pipeline tasks', async () => {
    generateTopics.mockResolvedValue([
      { keyword: '一人公司效率', content_type: 'solo-company-case', title_candidates: ['A', 'B', 'C'], hook: '开头', why_hot: '理由', priority_score: 0.9 },
    ]);
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, WINDOW_TIME);
    expect(result.triggered).toBe(1);
    expect(result.disabled).toBeUndefined();
    expect(generateTopics).toHaveBeenCalledWith(pool);
  });

  it('今日已有任务时，hasTodayTopics 返回 true（独立逻辑）', async () => {
    const pool = makePool(true);
    expect(await hasTodayTopics(pool)).toBe(true);
  });

  it('今日已有任务时调用返回 skipped: true，不重复生成', async () => {
    const pool = makePool(true);
    const result = await triggerDailyTopicSelection(pool, WINDOW_TIME);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('窗口时间外（UTC 13:00）不触发，返回 skipped_window: true', async () => {
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, new Date('2026-03-27T13:00:00Z'));
    expect(result.triggered).toBe(0);
    expect(result.skipped_window).toBe(true);
    expect(generateTopics).not.toHaveBeenCalled();
  });

  it('补偿窗口内（UTC 10:00）正常触发', async () => {
    generateTopics.mockResolvedValue([
      { keyword: '补偿触发选题', content_type: 'solo-company-case', title_candidates: ['A', 'B', 'C'], hook: '开头', why_hot: '理由', priority_score: 0.8 },
    ]);
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, new Date('2026-03-27T10:00:00Z'));
    expect(result.triggered).toBe(1);
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
