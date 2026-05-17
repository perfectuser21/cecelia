/**
 * Notebook Feeder 测试
 *
 * 覆盖：防重复检查、今日 learnings 喂入、高重要度记忆喂入、OKR 喂入
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockAddTextSource = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../notebook-adapter.js', () => ({
  addTextSource: mockAddTextSource,
}));

import { feedDailyIfNeeded } from '../notebook-feeder.js';

function createPool() {
  return { query: mockQuery };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddTextSource.mockResolvedValue({ ok: true });
});

// ── feedDailyIfNeeded ─────────────────────────────────────

describe('feedDailyIfNeeded', () => {
  it('今日已喂过时跳过', async () => {
    const pool = createPool();
    const today = new Date().toISOString().slice(0, 10);
    // getLastFeedDate → today
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { date: today } }] });

    const result = await feedDailyIfNeeded(pool);
    expect(result.skipped).toBe('already_fed_today');
    expect(result.ok).toBe(true);
    expect(mockAddTextSource).not.toHaveBeenCalled();
  });

  it('今日未喂过时正常喂入', async () => {
    const pool = createPool();
    // getLastFeedDate → yesterday
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { date: '2026-03-02' } }] });
    // getNotebookIds → working + self IDs
    mockQuery.mockResolvedValueOnce({ rows: [
      { key: 'notebook_id_working', value_json: 'nb-working-test' },
      { key: 'notebook_id_self', value_json: 'nb-self-test' },
    ]});
    // feedTodayLearnings query → 2 learnings
    mockQuery.mockResolvedValueOnce({ rows: [
      { title: '学习A', content: '内容A', category: 'dev' },
      { title: '学习B', content: '内容B', category: 'ci' },
    ]});
    // feedHighImportanceMemory query → 1 item
    mockQuery.mockResolvedValueOnce({ rows: [{ content: '重要洞察', importance: 9 }] });
    // shouldFeedOkr: getLastOkrFeed → old
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // feedOkr: goals query
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'OKR1', status: 'in_progress', priority: 'P0' }] });
    // feedOkr: projects query
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Project1', type: 'project', status: 'active' }] });
    // setLastOkrFeed
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // setLastFeedDate
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await feedDailyIfNeeded(pool);
    expect(result.ok).toBe(true);
    expect(result.fed.learnings).toBe(2);
    expect(result.fed.memory).toBe(1);
    expect(result.fed.okr).toBeGreaterThan(0);
    expect(mockAddTextSource).toHaveBeenCalled();
  });

  it('无数据时也能正常完成（0条喂入）', async () => {
    const pool = createPool();
    // getLastFeedDate → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getNotebookIds → no IDs configured
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // feedTodayLearnings → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // feedHighImportanceMemory → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // shouldFeedOkr → already fed this week
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { date: recentDate.toISOString().slice(0, 10) } }] });
    // setLastFeedDate
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await feedDailyIfNeeded(pool);
    expect(result.ok).toBe(true);
    expect(result.fed.learnings).toBe(0);
    expect(result.fed.memory).toBe(0);
    expect(mockAddTextSource).not.toHaveBeenCalled();
  });

  it('DB 错误时不抛出，返回 ok=false', async () => {
    const pool = createPool();
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await feedDailyIfNeeded(pool);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
