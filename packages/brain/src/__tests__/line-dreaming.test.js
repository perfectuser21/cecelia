import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isInLineDreamingWindow,
  alreadyDreamedToday,
  getActiveJourneys,
  buildLineDreamData,
  renderLineLedgerMarkdown,
  upsertLineLedger,
  generateLineLedger,
  maybeRunLineDreaming,
} from '../line-dreaming.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isInLineDreamingWindow — UTC 21:00-21:05 = 北京 05:00-05:05', () => {
  it('UTC 20:59 → false', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 20, 59)))).toBe(false);
  });
  it('UTC 21:00 → true', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 0)))).toBe(true);
  });
  it('UTC 21:04 → true', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 4)))).toBe(true);
  });
  it('UTC 21:05 → false', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 5)))).toBe(false);
  });
});

describe('alreadyDreamedToday — 20h 内该 journey 已有 line_ledger → true', () => {
  it('有记录 → true，SQL 含 line_ledger/20 hours/journey_id', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyDreamedToday(pool, 'journey-1')).resolves.toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/line_ledger/);
    expect(sql).toMatch(/20 hours/);
    expect(sql).toMatch(/journey_id/);
    expect(params).toEqual(['journey-1']);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyDreamedToday(pool, 'journey-1')).resolves.toBe(false);
  });
});

describe('getActiveJourneys — 拉 status=active 的 journey', () => {
  it('返回 id+name 列表', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }],
      }),
    };
    const result = await getActiveJourneys(pool);
    expect(result).toEqual([{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'active'/);
  });
});

describe('buildLineDreamData — 六段 24h 切片，单段失败不影响其他段', () => {
  it('六段查询各自被调用一次', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await buildLineDreamData(pool, 'journey-1', 'Line A');
    expect(pool.query).toHaveBeenCalledTimes(6);
    const sqls = pool.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /FROM decisions/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM advancement_items/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM issues/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM initiative_runs/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM learnings/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM notes/.test(s))).toBe(true);
  });

  it('单段查询抛错时该段为空数组，不影响其他段', async () => {
    let call = 0;
    const pool = {
      query: vi.fn(async (sql) => {
        call++;
        if (/FROM learnings/.test(sql)) throw new Error('learnings 查询挂了');
        if (/FROM decisions/.test(sql)) return { rows: [{ id: 'd1' }] };
        return { rows: [] };
      }),
    };
    const data = await buildLineDreamData(pool, 'journey-1', 'Line A');
    expect(data.learnings).toEqual([]);
    expect(data.decisions).toEqual([{ id: 'd1' }]);
  });

  it('军师留痕查询按 journeyName 拼接标题前缀', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await buildLineDreamData(pool, 'journey-1', 'Line A');
    const notesCall = pool.query.mock.calls.find((c) => /FROM notes/.test(c[0]));
    expect(notesCall[0]).toMatch(/title LIKE/);
    expect(notesCall[1]).toContain('军师决策[Line A]%');
  });
});

describe('buildLineDreamData since 参数（T3）', () => {
  it('传 since → 六段 SQL 均带 COALESCE($2::timestamptz, ...) 且参数含 since 值', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push([sql, params]); return { rows: [] }; }) };
    const since = '2026-07-09T21:00:00Z';
    await buildLineDreamData(pool, 'j1', 'LineX', { since });
    expect(calls).toHaveLength(6);
    for (const [sql, params] of calls) {
      expect(sql).toMatch(/COALESCE\(\$\d::timestamptz, NOW\(\) - INTERVAL '24 hours'\)/);
      expect(params).toContain(since);
    }
  });

  it('不传 since → 参数位为 null（COALESCE 回落 24h，与旧行为一致）', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push([sql, params]); return { rows: [] }; }) };
    const data = await buildLineDreamData(pool, 'j1', 'LineX');
    expect(calls).toHaveLength(6);
    for (const [, params] of calls) expect(params).toContain(null);
    expect(data).toEqual({
      decisions: [], advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [],
    });
  });
});

describe('renderLineLedgerMarkdown — 空段渲染"暂无"，有数据渲染条目', () => {
  it('全空 → 每段都是"暂无"', () => {
    const md = renderLineLedgerMarkdown('Line A', {
      decisions: [], advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [],
    });
    expect(md).toContain('# Line A — 24h 账本');
    expect(md).toContain('## 决策');
    expect((md.match(/暂无/g) || []).length).toBe(6);
  });

  it('有决策数据 → 渲染 topic', () => {
    const md = renderLineLedgerMarkdown('Line A', {
      decisions: [{ id: 'd1', topic: '铁律X', decision: '决定Y', created_at: '2026-07-10T00:00:00Z' }],
      advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [],
    });
    expect(md).toContain('铁律X');
    expect(md).toContain('决定Y');
  });

  it('有军师留痕 → 渲染 title', () => {
    const md = renderLineLedgerMarkdown('Line A', {
      decisions: [], advancementItems: [], issues: [], runs: [], learnings: [],
      strategistNotes: [{ id: 'n1', title: '军师决策[Line A]: 挑下一个推进项', created_at: '2026-07-10T00:00:00Z' }],
    });
    expect(md).toContain('军师决策[Line A]: 挑下一个推进项');
  });
});

describe('upsertLineLedger — 20h 内存在则 UPDATE，否则 INSERT', () => {
  it('存在近期记录 → UPDATE', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT id FROM design_docs/.test(sql)) return { rows: [{ id: 'doc-1' }] };
        return { rows: [] };
      }),
    };
    await expect(
      // @ts-ignore - 函数还未定义
      upsertLineLedger(pool, 'journey-1', 'Line A', '# content')
    ).resolves.not.toThrow();
    const updateCall = pool.query.mock.calls.find((c) => /UPDATE design_docs/.test(c[0]));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('doc-1');
  });

  it('不存在 → INSERT', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(
      // @ts-ignore - 函数还未定义
      upsertLineLedger(pool, 'journey-1', 'Line A', '# content')
    ).resolves.not.toThrow();
    const insertCall = pool.query.mock.calls.find((c) => /INSERT INTO design_docs/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[0]).toMatch(/line_ledger/);
  });
});

describe('maybeRunLineDreaming — 非窗口期不执行；窗口期遍历 active journeys', () => {
  it('非窗口期 → triggered=false', async () => {
    const pool = { query: vi.fn() };
    // @ts-ignore - 函数还未定义
    const result = await maybeRunLineDreaming(pool, new Date(Date.UTC(2026, 6, 10, 10, 0)));
    expect(result.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('窗口期 → 遍历 active journeys，单条失败不阻断其他 journey', async () => {
    let journeyCall = 0;
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM journeys WHERE status/.test(sql)) {
          return { rows: [{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }] };
        }
        if (/type = 'line_ledger'.*journey_id = \$1/s.test(sql)) {
          journeyCall++;
          if (journeyCall === 1) throw new Error('j1 去重检查挂了');
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    // @ts-ignore - 函数还未定义
    const result = await maybeRunLineDreaming(pool, new Date(Date.UTC(2026, 6, 10, 21, 0)));
    expect(result.triggered).toBe(true);
    expect(result.failed).toBe(1);
    expect(result.dreamed).toBe(1);
  });
});
