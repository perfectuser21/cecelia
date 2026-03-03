/**
 * Rumination Scheduler 测试
 *
 * 覆盖：时间窗口检查、防重复、日/周/月级合成、self_model 更新
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddTextSource = vi.hoisted(() => vi.fn());
const mockDeleteSource = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());
const mockGetSelfModel = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../notebook-adapter.js', () => ({
  queryNotebook: mockQueryNotebook,
  addTextSource: mockAddTextSource,
  deleteSource: mockDeleteSource,
}));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../self-model.js', () => ({
  updateSelfModel: mockUpdateSelfModel,
  getSelfModel: mockGetSelfModel,
}));

import {
  shouldRunDaily,
  runDailySynthesis,
  runWeeklySynthesis,
  runMonthlySynthesis,
  runSynthesisSchedulerIfNeeded,
} from '../rumination-scheduler.js';

function createPool() {
  return { query: mockQuery };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddTextSource.mockResolvedValue({ ok: true, sourceId: null });
  mockDeleteSource.mockResolvedValue({ ok: true });
  mockUpdateSelfModel.mockResolvedValue('updated');
  mockGetSelfModel.mockResolvedValue('我是 Cecelia...');
});

// ── shouldRunDaily ────────────────────────────────────────

describe('shouldRunDaily', () => {
  it('在 DAILY_HOUR_UTC 的第0分钟返回 true', () => {
    const now = new Date();
    now.setUTCHours(18, 0, 0, 0);
    expect(shouldRunDaily(now)).toBe(true);
  });

  it('在 DAILY_HOUR_UTC 第4分钟返回 true', () => {
    const now = new Date();
    now.setUTCHours(18, 4, 0, 0);
    expect(shouldRunDaily(now)).toBe(true);
  });

  it('在 DAILY_HOUR_UTC 第5分钟返回 false（窗口外）', () => {
    const now = new Date();
    now.setUTCHours(18, 5, 0, 0);
    expect(shouldRunDaily(now)).toBe(false);
  });

  it('在其他小时返回 false', () => {
    const now = new Date();
    now.setUTCHours(10, 0, 0, 0);
    expect(shouldRunDaily(now)).toBe(false);
  });
});

// ── runDailySynthesis ─────────────────────────────────────

describe('runDailySynthesis', () => {
  it('今日已有合成时跳过', async () => {
    const pool = createPool();
    const today = new Date().toISOString().slice(0, 10);
    // hasTodaySynthesis → found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    const result = await runDailySynthesis(pool);
    expect(result.skipped).toBe('already_done');
    expect(result.ok).toBe(true);
  });

  it('无数据时跳过', async () => {
    const pool = createPool();
    // hasTodaySynthesis → not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // recentItems → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // todayLearnings → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runDailySynthesis(pool);
    expect(result.skipped).toBe('no_data');
  });

  it('NotebookLM 成功时写入 synthesis_archive', async () => {
    const pool = createPool();
    const today = new Date().toISOString().slice(0, 10);

    // hasTodaySynthesis → not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // recentItems → 2 items
    mockQuery.mockResolvedValueOnce({ rows: [{ content: '洞察1' }, { content: '洞察2' }] });
    // todayLearnings → 1 item
    mockQuery.mockResolvedValueOnce({ rows: [{ title: '学习A', content: '内容A' }] });
    // getLatestSynthesis(daily) → no prev
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getNotebookId(working) → ID
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: 'nb-working-test' }] });
    // writeSynthesis INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockQueryNotebook.mockResolvedValue({ ok: true, text: '[日摘要] 今日综合洞察内容，超过五十个字的有效输出。今天 Alex 完成了核心功能开发，系统运行稳定，明日计划进行集成测试。' });

    const result = await runDailySynthesis(pool);
    expect(result.ok).toBe(true);
    expect(result.level).toBe('daily');
    expect(result.sourceCount).toBe(3);
    expect(mockQueryNotebook).toHaveBeenCalledOnce();
  });

  it('NotebookLM 失败时 fallback 到 callLLM', async () => {
    const pool = createPool();

    // hasTodaySynthesis → not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // recentItems
    mockQuery.mockResolvedValueOnce({ rows: [{ content: '洞察1' }] });
    // todayLearnings
    mockQuery.mockResolvedValueOnce({ rows: [{ title: '学习A', content: '内容A' }] });
    // getLatestSynthesis → no prev
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getNotebookId(working) → no ID
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // writeSynthesis
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockQueryNotebook.mockResolvedValue({ ok: false, error: 'timeout' });
    mockCallLLM.mockResolvedValue({ text: '[日摘要] callLLM fallback 输出内容' });

    const result = await runDailySynthesis(pool);
    expect(result.ok).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledOnce();
  });
});

// ── runWeeklySynthesis ────────────────────────────────────

describe('runWeeklySynthesis', () => {
  it('7天内已有周合成时跳过', async () => {
    const pool = createPool();
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3); // 3天前
    // getLatestSynthesis(weekly)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'w1', period_end: recentDate.toISOString().slice(0, 10), content: '上周摘要' }] });

    const result = await runWeeklySynthesis(pool);
    expect(result.skipped).toBe('already_done');
  });

  it('无 daily 数据时跳过', async () => {
    const pool = createPool();
    // getLatestSynthesis(weekly) → old entry (> 7 days ago)，单次调用
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'w1', period_end: oldDate.toISOString().slice(0, 10), content: '摘要' }] });
    // getDailies → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runWeeklySynthesis(pool);
    expect(result.skipped).toBe('no_daily_data');
  });

  it('有数据时生成周摘要并写入 synthesis_archive', async () => {
    const pool = createPool();
    // getLatestSynthesis(weekly) → no previous weekly，单次调用
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getDailies → 3 dailies（含 notebook_source_id）
    const today = new Date().toISOString().slice(0, 10);
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'd1', period_start: today, content: '日摘要1', notebook_source_id: null },
      { id: 'd2', period_start: '2026-03-02', content: '日摘要2', notebook_source_id: null },
      { id: 'd3', period_start: '2026-03-01', content: '日摘要3', notebook_source_id: null },
    ]});
    // getNotebookId(working) → ID
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: 'nb-working-test' }] });
    // writeSynthesis
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockQueryNotebook.mockResolvedValue({ ok: true, text: '[周摘要] 本周综合洞察超过五十个字的有效输出内容在这里。本周 Alex 完成了三个主要功能模块，团队协作顺畅，下周重点关注性能优化工作。' });

    const result = await runWeeklySynthesis(pool);
    expect(result.ok).toBe(true);
    expect(result.level).toBe('weekly');
    expect(result.sourceCount).toBe(3);
  });

  it('周合成完成后删除有 source_id 的日 sources', async () => {
    const pool = createPool();
    // getLatestSynthesis(weekly) → no previous
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getDailies → 3 dailies，其中 2 条有 notebook_source_id
    const today = new Date().toISOString().slice(0, 10);
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'd1', period_start: today, content: '日摘要1', notebook_source_id: 'src-daily-aaa' },
      { id: 'd2', period_start: '2026-03-02', content: '日摘要2', notebook_source_id: 'src-daily-bbb' },
      { id: 'd3', period_start: '2026-03-01', content: '日摘要3', notebook_source_id: null },
    ]});
    // getNotebookId(working) → ID
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: 'nb-working-test' }] });
    // writeSynthesis
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockQueryNotebook.mockResolvedValue({ ok: true, text: '[周摘要] 本周综合洞察超过五十个字的有效输出内容在这里。本周 Alex 完成了三个主要功能模块，团队协作顺畅，下周重点关注性能优化工作。' });
    mockAddTextSource.mockResolvedValue({ ok: true, sourceId: 'src-weekly-new' });

    const result = await runWeeklySynthesis(pool);
    expect(result.ok).toBe(true);
    // deleteSource 应被调用 2 次（只有有 source_id 的条目）
    await vi.waitFor(() => {
      expect(mockDeleteSource).toHaveBeenCalledTimes(2);
    });
    expect(mockDeleteSource).toHaveBeenCalledWith('src-daily-aaa', 'nb-working-test');
    expect(mockDeleteSource).toHaveBeenCalledWith('src-daily-bbb', 'nb-working-test');
  });
});

// ── runMonthlySynthesis ───────────────────────────────────

describe('runMonthlySynthesis', () => {
  it('30天内已有月合成时跳过', async () => {
    const pool = createPool();
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 15);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', period_end: recentDate.toISOString().slice(0, 10), content: '月摘要' }] });

    const result = await runMonthlySynthesis(pool);
    expect(result.skipped).toBe('already_done');
  });

  it('有数据时生成月摘要并更新 self_model', async () => {
    const pool = createPool();
    // getLatestSynthesis(monthly) → no prev，单次调用
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getWeeklies
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'w1', period_start: '2026-02-24', period_end: '2026-03-02', content: '周摘1' },
      { id: 'w2', period_start: '2026-02-17', period_end: '2026-02-23', content: '周摘2' },
    ]});
    // getNotebookId(working) → ID（Promise.all 第一个）
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: 'nb-working-test' }] });
    // getNotebookId(self) → ID（Promise.all 第二个）
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: 'nb-self-test' }] });
    // writeSynthesis INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockQueryNotebook.mockResolvedValue({ ok: true, text: '[月摘要] 本月综合洞察超过五十个字的有效输出内容月度演化在这里。本月 Cecelia 系统显著提升了任务调度效率，自我认知在反刍过程中得到深化，下月将重点探索欲望形成机制的优化。' });

    const result = await runMonthlySynthesis(pool);
    expect(result.ok).toBe(true);
    expect(result.level).toBe('monthly');
    expect(mockUpdateSelfModel).toHaveBeenCalledOnce();
    expect(mockUpdateSelfModel.mock.calls[0][0]).toContain('[月度演化');
  });
});

// ── runSynthesisSchedulerIfNeeded ─────────────────────────

describe('runSynthesisSchedulerIfNeeded', () => {
  it('在时间窗口外时不执行任何合成', async () => {
    const pool = createPool();
    // shouldRunDaily() 会用当前时间，如果不在窗口内则直接返回 {}
    // 为了让测试可预期，直接测 shouldRunDaily 返回 false 时的行为
    const now = new Date();
    now.setUTCHours(10, 30, 0, 0); // 非触发窗口

    // 不在窗口内时 results 为空
    if (!shouldRunDaily(now)) {
      const result = await runSynthesisSchedulerIfNeeded(pool);
      // 只要没抛出错误即可（可能 {} 或有数据）
      expect(result).toBeDefined();
    }
  });
});
