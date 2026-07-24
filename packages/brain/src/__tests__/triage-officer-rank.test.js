import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInTriageOfficerRankWindow,
  computeAvgPrHours,
  computeCapacityBudget,
  buildRankedLeaderboard,
  computeLineWatermarks,
  maybeRunTriageOfficerRank,
  LEADERBOARD_KEY,
} from '../triage-officer-rank.js';

// UTC 23:00 = 北京 07:00（触发窗口）
const UTC_TRIGGER_H = 23;
const UTC_TRIGGER_M = 0;

function makePool(rowsMap = {}) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      for (const [key, rows] of Object.entries(rowsMap)) {
        if (sql.includes(key)) return Promise.resolve({ rows });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
}

describe('isInTriageOfficerRankWindow', () => {
  it('UTC 23:00 在触发窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M, 0));
    expect(isInTriageOfficerRankWindow(now)).toBe(true);
  });

  it('UTC 23:12（窗口边缘 +12min）在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M + 12, 0));
    expect(isInTriageOfficerRankWindow(now)).toBe(true);
  });

  it('UTC 23:13（窗口外 +13min）不在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M + 13, 0));
    expect(isInTriageOfficerRankWindow(now)).toBe(false);
  });

  it('UTC 12:00（中午）不在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(isInTriageOfficerRankWindow(now)).toBe(false);
  });
});

describe('computeAvgPrHours', () => {
  it('从 tasks 查询返回历史均值', async () => {
    const pool = makePool({ 'avg_hours': [{ avg_hours: '2.5' }] });
    const result = await computeAvgPrHours(pool);
    expect(result).toBeCloseTo(2.5);
  });

  it('查询为空时返回默认值 3', async () => {
    const pool = makePool({});
    const result = await computeAvgPrHours(pool);
    expect(result).toBe(3);
  });

  it('查询失败时返回默认值 3', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const result = await computeAvgPrHours(pool);
    expect(result).toBe(3);
  });
});

describe('computeCapacityBudget', () => {
  it('token_slots = accounts × 2, time_slots = floor(7×16/avg_h)', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ avg_hours: '4' }] })   // avg_pr_hours
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] }),          // account_usage_cache
    };
    const budget = await computeCapacityBudget(pool);
    expect(budget.avg_pr_hours).toBeCloseTo(4);
    expect(budget.company_accounts).toBe(2);
    expect(budget.token_slots).toBe(4);           // 2 × 2
    expect(budget.time_slots).toBe(28);            // floor(7 × 16 / 4) = 28
    expect(budget.top_n).toBe(4);                  // min(4, 28) = 4
  });

  it('top_n 不超过 TOP_N_MAX(10)', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ avg_hours: '0.1' }] })  // very fast PRs → huge time_slots
        .mockResolvedValueOnce({ rows: [{ cnt: '100' }] }),         // many accounts → huge token_slots
    };
    const budget = await computeCapacityBudget(pool);
    expect(budget.top_n).toBeLessThanOrEqual(10);
  });

  it('top_n 最小为 1', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // default avg_pr_hours=3
        .mockResolvedValueOnce({ rows: [] }),   // 0 accounts → default 1
    };
    const budget = await computeCapacityBudget(pool);
    expect(budget.top_n).toBeGreaterThanOrEqual(1);
  });
});

describe('buildRankedLeaderboard', () => {
  it('返回 rank 从 1 开始的列表', async () => {
    const mockTasks = [
      { id: 'a', title: '任务A', priority: 'P0', task_type: 'dev', queued_at: new Date(), journey_name: '线路1', queue_age_h: '2.0' },
      { id: 'b', title: '任务B', priority: 'P1', task_type: 'dev', queued_at: new Date(), journey_name: null, queue_age_h: '1.0' },
    ];
    const pool = makePool({ FROM: mockTasks });
    const result = await buildRankedLeaderboard(pool, 5);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
    expect(result[0].id).toBe('a');
  });

  it('查询失败时返回空数组（fail-open）', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db error')) };
    const result = await buildRankedLeaderboard(pool, 5);
    expect(result).toEqual([]);
  });
});

describe('computeLineWatermarks', () => {
  it('烧率 > 3 时 anomaly=true', async () => {
    const pool = makePool({
      journey_name: [
        { journey_name: '高频线', tasks_7d: 28, burn_rate: '4.00' },
      ],
    });
    const result = await computeLineWatermarks(pool);
    expect(result[0].anomaly).toBe(true);
  });

  it('烧率 ≤ 3 时 anomaly=false', async () => {
    const pool = makePool({
      journey_name: [
        { journey_name: '正常线', tasks_7d: 7, burn_rate: '1.00' },
      ],
    });
    const result = await computeLineWatermarks(pool);
    expect(result[0].anomaly).toBe(false);
  });

  it('查询失败时返回空数组（fail-open）', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db error')) };
    const result = await computeLineWatermarks(pool);
    expect(result).toEqual([]);
  });
});

describe('maybeRunTriageOfficerRank', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('窗口外跳过', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)));
    const pool = makePool();
    const result = await maybeRunTriageOfficerRank(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'outside_window' });
  });

  it('今日已跑过跳过', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M, 0)));
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ value_json: { generated_at: new Date().toISOString() } }],
        }),
    };
    const result = await maybeRunTriageOfficerRank(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'already_ran_today' });
  });

  it('窗口内且未跑过：写榜单到 working_memory，返回 ok:true', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M, 0)));
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })          // alreadyRanToday → 未跑
        .mockResolvedValueOnce({ rows: [{ avg_hours: '2' }] })  // avg_pr_hours
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })         // account_usage_cache
        .mockResolvedValueOnce({ rows: [] })          // buildRankedLeaderboard
        .mockResolvedValueOnce({ rows: [] })          // computeLineWatermarks
        .mockResolvedValue({ rows: [] }),              // writeSentinel
    };
    const result = await maybeRunTriageOfficerRank(pool);
    expect(result).toMatchObject({ ok: true });
    expect(result.top_n).toBeGreaterThanOrEqual(1);
    // veto_deadline 应在未来
    expect(new Date(result.veto_deadline) > new Date()).toBe(true);
  });

  it('sentinel 写入包含 LEADERBOARD_KEY', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M, 0)));
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    await maybeRunTriageOfficerRank(pool);
    const insertCall = pool.query.mock.calls.find(
      (args) => args[0].includes('working_memory') && args[1]?.[0] === LEADERBOARD_KEY,
    );
    expect(insertCall).toBeDefined();
  });
});
