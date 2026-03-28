/**
 * topic-selection-trigger.test.js
 *
 * 测试每日选题手动触发逻辑：
 *   1. hasTodayTopics 正确检测当日已有任务
 *   2. triggerDailyTopicSelection 在注入窗口时间时正常创建任务
 *   3. 已有任务时跳过（去重保护）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn(),
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

  it('无历史任务时，窗口内触发成功创建 pipeline tasks', async () => {
    generateTopics.mockResolvedValue([
      { keyword: '一人公司效率', content_type: 'solo-company-case', title_candidates: ['A', 'B', 'C'], hook: '开头', why_hot: '理由', priority_score: 0.9 },
    ]);
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, WINDOW_TIME);
    expect(result.triggered).toBe(1);
    expect(result.skipped).toBe(false);
  });

  it('今日已有任务时，hasTodayTopics 返回 true，跳过创建', async () => {
    const pool = makePool(true);
    expect(await hasTodayTopics(pool)).toBe(true);
    const result = await triggerDailyTopicSelection(pool, WINDOW_TIME);
    expect(result.skipped).toBe(true);
    expect(result.triggered).toBe(0);
  });

  it('窗口时间外不触发（skipped_window: true）', async () => {
    const pool = makePool(false);
    const result = await triggerDailyTopicSelection(pool, new Date('2026-03-27T10:00:00Z'));
    expect(result.skipped_window).toBe(true);
    expect(result.triggered).toBe(0);
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
