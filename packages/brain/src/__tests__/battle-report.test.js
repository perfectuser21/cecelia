import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

import {
  isInBattleReportWindow,
  alreadyGeneratedToday,
  buildBattleReportData,
  renderBattleReportMarkdown,
  generateBattleReport,
  maybeGenerateBattleReport,
} from '../battle-report.js';
import { sendFeishu } from '../notifier.js';

/** mock pool：INSERT design_docs 返回 id，其余空行 */
function makePool({ insertedId = 'doc-1' } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/INSERT INTO design_docs/i.test(sql)) {
        return { rows: [{ id: insertedId }] };
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isInBattleReportWindow — UTC 22:00-22:05 = 北京 06:00-06:05', () => {
  it('UTC 21:59 → false', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 21, 59)))).toBe(false);
  });
  it('UTC 22:00 → true', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 22, 0)))).toBe(true);
  });
  it('UTC 22:04 → true', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 22, 4)))).toBe(true);
  });
  it('UTC 22:05 → false', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 22, 5)))).toBe(false);
  });
});

describe('alreadyGeneratedToday — design_docs 20h 去重', () => {
  it('20h 内已有 battle_report → true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyGeneratedToday(pool)).resolves.toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/design_docs/);
    expect(sql).toMatch(/battle_report/);
    expect(sql).toMatch(/20 hours/);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyGeneratedToday(pool)).resolves.toBe(false);
  });
});

describe('buildBattleReportData — 24h 窗口四段', () => {
  it('发出四段查询且形状正确', async () => {
    const pool = makePool();
    const data = await buildBattleReportData(pool);

    const sqls = pool.query.mock.calls.map(([sql]) => sql);

    // ① merged PR：dev_records + 24h 窗口
    const prSql = sqls.find((s) => /dev_records/.test(s));
    expect(prSql).toBeTruthy();
    expect(prSql).toMatch(/merged_at/);
    expect(prSql).toMatch(/24 hours/);

    // ② 按线 run：JOIN journeys 排孤儿 + smoke-% 过滤 + 24h 窗口
    const runSql = sqls.find((s) => /initiative_runs/.test(s));
    expect(runSql).toBeTruthy();
    expect(runSql).toMatch(/JOIN journeys/);
    expect(runSql).toMatch(/smoke-%/);
    expect(runSql).toMatch(/24 hours/);

    // ③ 用户决策：made_by='user' + 24h 窗口
    const decSql = sqls.find((s) => /FROM decisions/.test(s));
    expect(decSql).toBeTruthy();
    expect(decSql).toMatch(/made_by\s*=\s*'user'/);
    expect(decSql).toMatch(/24 hours/);

    // ④ 哨兵：working_memory + scheduler_job_last_run 前缀参数
    const sentinelIdx = sqls.findIndex((s) => /working_memory/.test(s));
    expect(sentinelIdx).toBeGreaterThanOrEqual(0);
    const sentinelParams = pool.query.mock.calls[sentinelIdx][1];
    expect(sentinelParams).toContain('scheduler_job_last_run:%');

    expect(data).toMatchObject({
      mergedPrs: [],
      journeyRuns: [],
      userDecisions: [],
    });
    expect(data.sentinel).toHaveProperty('jobs');
    expect(data.sentinel).toHaveProperty('healthy');
  });

  it('哨兵 ok&&age<=1800 口径（同 routes/sentinel.js）', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/working_memory/.test(sql)) {
          return {
            rows: [
              { key: 'scheduler_jobs_expected', value_json: { count: 2 }, age_seconds: 10 },
              { key: 'scheduler_job_last_run:a', value_json: { ok: true, at: 't' }, age_seconds: 100 },
              { key: 'scheduler_job_last_run:b', value_json: { ok: true, at: 't' }, age_seconds: 2000 },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);
    expect(data.sentinel.expected).toBe(2);
    expect(data.sentinel.jobs).toHaveLength(2);
    // b 过期（age 2000 > 1800）→ 整体不健康
    expect(data.sentinel.healthy).toBe(false);
  });
});

describe('renderBattleReportMarkdown — L1 Summary 四段', () => {
  it('四段标题齐全，有数据段渲染条目', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [{ pr_title: '修复 X', pr_url: 'https://github.com/p/1' }],
      journeyRuns: [{ journey_name: 'Line 05', runs: 3, done: 2, failed: 1, last_failure: 'boom' }],
      userDecisions: [{ topic: '决定 Y', created_at: '2026-07-07T00:00:00Z' }],
      sentinel: {
        expected: 1,
        healthy: true,
        jobs: [{ name: 'arch-review', ok: true, age_seconds: 60 }],
      },
    });
    expect(md).toMatch(/合并 PR/);
    expect(md).toMatch(/各线战况|按线/);
    expect(md).toMatch(/用户决策/);
    expect(md).toMatch(/哨兵/);
    expect(md).toMatch(/修复 X/);
    expect(md).toMatch(/Line 05/);
    expect(md).toMatch(/决定 Y/);
    expect(md).toMatch(/arch-review/);
  });

  it('空段渲染"暂无"（dev_records 断供容忍）', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [],
      journeyRuns: [],
      userDecisions: [],
      sentinel: { expected: null, healthy: false, jobs: [] },
    });
    expect((md.match(/暂无/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('generateBattleReport — 落库 + 飞书', () => {
  it('INSERT design_docs 参数含 battle_report/上海日 title/area/author，飞书带链接', async () => {
    const pool = makePool({ insertedId: 'abc-1' });
    const result = await generateBattleReport(pool);

    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO design_docs/i.test(sql));
    expect(insertCall).toBeTruthy();
    const [insertSql, params] = insertCall;
    expect(insertSql).toMatch(/RETURNING id/i);
    expect(params).toContain('battle_report');
    expect(params).toContain('cecelia');
    const title = params.find((p) => typeof p === 'string' && p.startsWith('作战日报 '));
    expect(title).toMatch(/^作战日报 \d{4}-\d{2}-\d{2}$/);
    // diary_date 与 title 同一上海日
    const day = title.slice('作战日报 '.length);
    expect(params).toContain(day);

    expect(sendFeishu).toHaveBeenCalledTimes(1);
    expect(sendFeishu.mock.calls[0][0]).toContain(
      'http://perfect21:5211/reports/abc-1?source=design_docs'
    );
    expect(result.id).toBe('abc-1');
  });

  it('sendFeishu reject 不抛不回滚，仍返回 id', async () => {
    sendFeishu.mockRejectedValueOnce(new Error('feishu down'));
    const pool = makePool({ insertedId: 'abc-2' });
    const result = await generateBattleReport(pool);
    expect(result.id).toBe('abc-2');
  });

  it('sendFeishu 返回 false 也不影响结果', async () => {
    sendFeishu.mockResolvedValueOnce(false);
    const pool = makePool({ insertedId: 'abc-3' });
    const result = await generateBattleReport(pool);
    expect(result.id).toBe('abc-3');
  });
});

describe('maybeGenerateBattleReport — 窗口 + 去重自 gate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口外 → skipped，不查库', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 7, 12, 0)));
    const pool = makePool();
    const result = await maybeGenerateBattleReport(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'outside_window' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('窗口内但当日已生成 → skipped already_generated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 7, 22, 1)));
    const pool = {
      query: vi.fn(async (sql) => {
        if (/design_docs/.test(sql) && /SELECT/i.test(sql)) return { rows: [{ '?column?': 1 }] };
        return { rows: [] };
      }),
    };
    const result = await maybeGenerateBattleReport(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'already_generated' });
    expect(sendFeishu).not.toHaveBeenCalled();
  });

  it('窗口内且未生成 → 真生成', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 7, 22, 1)));
    const pool = makePool({ insertedId: 'gen-1' });
    const result = await maybeGenerateBattleReport(pool);
    expect(result.skipped).toBeFalsy();
    expect(result.id).toBe('gen-1');
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });
});
