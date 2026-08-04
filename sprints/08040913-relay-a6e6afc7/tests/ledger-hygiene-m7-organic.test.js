/**
 * ledger-hygiene-m7-organic.test.js — 复现 2026-08-03 m7「自主循环零产出」击穿误报（合同回归测试，永留 CI）
 *
 * 根因两条（sprint 08040913-relay-a6e6afc7）：
 *   1. 滑动窗秒级竞态：capture 子探针用 NOW()-24h，调度时刻逐日漂移数秒，前一日 atom 差 6 秒落窗外 → count=0 误击穿
 *   2. 指标自指：守卫自产的 issue atom（content 前缀 'issue: [ledger-hygiene]'）被计入"自主循环产出"，掩盖真零产出
 *
 * 修复合同（CONTRACT IS LAW）：
 *   - export getM7CaptureWindow(now)：北京昨日自然日 [00:00:00, 24:00:00) 的 UTC 界，仅依赖 now 的北京日历日
 *   - export LEDGER_SELF_ATOM_PREFIX = 'issue: [ledger-hygiene]'：自产 atom 分类前缀（与 raiseBreachAlerts 写入同源）
 *   - computeMetrics(pool, now?)：m7 capture 计数 SQL 以 $1/$2 参数化窗口界（toISOString 字符串），禁 NOW() 滑动窗
 *   - m7.value = { stratDebt, captureDebt, organic, self }（keys 恒定；capture 未激活时 organic/self 为 null）
 *   - captureDebt = 激活且 organic===0 时为 1（self 不计入有机产出）
 *
 * 本文件由 generator 从合同 tests/ 原样复制到 packages/brain/src/__tests__/，commit 1 Red，实现后 Green，永留 brain-unit CI。
 */
import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  getM7CaptureWindow,
  LEDGER_SELF_ATOM_PREFIX,
  raiseBreachAlerts,
  renderHygieneMarkdown,
} from '../ledger-hygiene.js';

/**
 * mock pool：按 SQL 关键词路由（仅覆盖 m7 无关紧要的 m1-m6 缺省 + m7 各分支），记录全部调用。
 * organic/self 为新分解查询（单行别名 organic/self）的返回值。
 */
function makePool({ organic = '0', self = '0', stratEver = false, capEver = true, capThrow = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: s, params });
      if (s.includes('strategy_session') && s.includes("INTERVAL '24 hours'")) {
        return { rows: [{ cnt: '0' }] };
      }
      if (s.includes('strategy_session')) {
        return { rows: stratEver ? [{ '?column?': 1 }] : [] };
      }
      if (s.includes('capture_atoms')) {
        if (capThrow) throw new Error('relation "capture_atoms" does not exist');
        if (s.includes('organic')) return { rows: [{ organic, self }] };
        return { rows: capEver ? [{ '?column?': 1 }] : [] };
      }
      if (s.includes('INSERT INTO issues')) {
        return { rows: [{ id: '00000000-0000-4000-8000-000000000001' }] };
      }
      if (s.includes('FROM issues')) {
        return { rows: [] }; // 当日无同指标 issue，去重不拦截
      }
      if (s.includes('INSERT INTO captures')) {
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002' }] };
      }
      return { rows: [{ total: '0', debt: '0', cnt: '0' }] };
    },
  };
}

describe('getM7CaptureWindow — 确定性北京自然日窗口', () => {
  it('getM7CaptureWindow 返回北京昨日自然日窗口的 UTC 界', () => {
    // now = 2026-08-03T21:10:21Z 即北京 2026-08-04 05:10:21（真实调度窗口）
    const w = getM7CaptureWindow(new Date('2026-08-03T21:10:21Z'));
    expect(w.startUtc.toISOString()).toBe('2026-08-02T16:00:00.000Z'); // 北京 08-03 00:00:00
    expect(w.endUtc.toISOString()).toBe('2026-08-03T16:00:00.000Z'); // 北京 08-04 00:00:00
  });

  it('运行时刻偏移 ±60 秒窗口不变', () => {
    const T = new Date('2026-08-03T21:10:21Z');
    const w0 = getM7CaptureWindow(T);
    const wPlus = getM7CaptureWindow(new Date(T.getTime() + 60000));
    const wMinus = getM7CaptureWindow(new Date(T.getTime() - 60000));
    expect(wPlus.startUtc.toISOString()).toBe(w0.startUtc.toISOString());
    expect(wPlus.endUtc.toISOString()).toBe(w0.endUtc.toISOString());
    expect(wMinus.startUtc.toISOString()).toBe(w0.startUtc.toISOString());
    expect(wMinus.endUtc.toISOString()).toBe(w0.endUtc.toISOString());
  });

  it('复现 08-03 击穿：前一日 atom 差 6 秒不再落窗外', () => {
    // 08-01 21:10:21Z 产出 atom（北京 08-02 05:10:21）；守卫 08-02 21:10:27Z 运行（北京 08-03 05:10:27，漂移 6 秒）
    // 旧滑动窗 NOW()-24h：atom 差 6 秒落窗外 → count=0 误击穿
    // 新确定性窗口 = 北京 08-02 自然日 → atom 必在窗内
    const atomTs = new Date('2026-08-01T21:10:21Z');
    const w = getM7CaptureWindow(new Date('2026-08-02T21:10:27Z'));
    expect(atomTs.getTime()).toBeGreaterThanOrEqual(w.startUtc.getTime());
    expect(atomTs.getTime()).toBeLessThan(w.endUtc.getTime());
  });

  it('窗口边界：昨日 23:59:59 在窗内，今日 00:00:00 在窗外', () => {
    const w = getM7CaptureWindow(new Date('2026-08-03T21:10:21Z'));
    const lastSecond = new Date('2026-08-03T15:59:59Z'); // 北京 08-03 23:59:59
    const todayMidnight = new Date('2026-08-03T16:00:00Z'); // 北京 08-04 00:00:00
    expect(lastSecond.getTime()).toBeGreaterThanOrEqual(w.startUtc.getTime());
    expect(lastSecond.getTime()).toBeLessThan(w.endUtc.getTime());
    expect(todayMidnight.getTime()).toBeGreaterThanOrEqual(w.endUtc.getTime());
  });
});

describe('m7 capture 子探针 — 有机产出统计口径', () => {
  it('m7 capture 计数以参数化窗口界查询且排除自产前缀', async () => {
    const now = new Date('2026-08-03T21:10:21Z');
    const pool = makePool({ organic: '1', self: '1' });
    await computeMetrics(pool, now);
    const capCall = pool.calls.find(
      (c) => c.sql.includes('capture_atoms') && Array.isArray(c.params) && c.params.length === 2
    );
    expect(capCall).toBeTruthy();
    expect(capCall.params[0]).toBe('2026-08-02T16:00:00.000Z');
    expect(capCall.params[1]).toBe('2026-08-03T16:00:00.000Z');
    // 分类前缀进 SQL（自产排除），且 capture 计数不再用 24h 滑动窗
    expect(capCall.sql).toContain('issue: [ledger-hygiene]');
    expect(capCall.sql).not.toContain('24 hours');
  });

  it('organic 与 self 分解计入 m7.value 且 keys 恒定', async () => {
    const pool = makePool({ organic: '1', self: '1' });
    const metrics = await computeMetrics(pool, new Date('2026-08-03T21:10:21Z'));
    expect(metrics.m7.enabled).toBe(true);
    expect(Object.keys(metrics.m7.value).sort()).toEqual(['captureDebt', 'organic', 'self', 'stratDebt']);
    expect(metrics.m7.value.organic).toBe(1);
    expect(metrics.m7.value.self).toBe(1);
    expect(metrics.m7.value.captureDebt).toBe(0);
    expect(metrics.m7.debt).toBe(0);
  });

  it('窗口内仅守卫自产 atom 时 organic=0 仍击穿', async () => {
    const pool = makePool({ organic: '0', self: '1' });
    const metrics = await computeMetrics(pool, new Date('2026-08-03T21:10:21Z'));
    expect(metrics.m7.value.organic).toBe(0);
    expect(metrics.m7.value.self).toBe(1);
    expect(metrics.m7.value.captureDebt).toBe(1);
    expect(metrics.m7.debt).toBe(1);
    expect(metrics.m7.absolute).toBe(true);
  });

  it('computeMetrics 不传 now 参数向后兼容', async () => {
    const pool = makePool({ organic: '2', self: '0' });
    const metrics = await computeMetrics(pool);
    expect(metrics.m7).toBeDefined();
    expect(metrics.m7.value.organic).toBe(2);
    expect(metrics.m7.value.captureDebt).toBe(0);
  });

  it('capture_atoms 表不存在时保持未激活降级', async () => {
    const pool = makePool({ capThrow: true, stratEver: true });
    const metrics = await computeMetrics(pool, new Date('2026-08-03T21:10:21Z'));
    expect(metrics.m7).toBeDefined();
    expect(metrics.m7.enabled).toBe(true); // strat 已激活
    // capture 降级未激活：organic/self 为 null，captureDebt=0
    expect(metrics.m7.value.captureDebt).toBe(0);
    expect(metrics.m7.value.organic).toBe(null);
    expect(metrics.m7.value.self).toBe(null);
  });
});

describe('自产前缀同源保障（分类 ↔ 写入不许单边漂移）', () => {
  it('LEDGER_SELF_ATOM_PREFIX 与既有 atom 写入格式一致', () => {
    expect(LEDGER_SELF_ATOM_PREFIX).toBe('issue: [ledger-hygiene]');
  });

  it('raiseBreachAlerts 写出的 atom content 以自产前缀开头', async () => {
    const pool = makePool();
    await raiseBreachAlerts(
      pool,
      [{ key: 'm7', name: '自主循环零产出', prevDebt: 0, debt: 1, streak: 1 }],
      '2026-08-04'
    );
    const captureInsert = pool.calls.find((c) => c.sql.includes('INSERT INTO captures'));
    expect(captureInsert).toBeTruthy();
    expect(String(captureInsert.params[0]).startsWith(LEDGER_SELF_ATOM_PREFIX)).toBe(true);
  });
});

describe('日报渲染 — organic/self 分解展示', () => {
  it('日报渲染展示 organic/self 分解', () => {
    const metrics = {
      m7: {
        key: 'm7',
        name: '自主循环零产出',
        enabled: true,
        value: { stratDebt: 0, captureDebt: 0, organic: 1, self: 1 },
        debt: 0,
      },
    };
    const md = renderHygieneMarkdown('2026-08-04', metrics, []);
    expect(md).toContain('organic');
    expect(md).toContain('self');
  });
});
