/**
 * ledger-hygiene-m7.test.js
 *
 * m7 自主循环零产出指标 + 相关渲染测试。
 * 真库测试：m7 查询 design_docs/capture_atoms，此处用 mock pool 验证
 * SQL 路径正确（表不存在不应 throw，should 降级 enabled=false）。
 */

import { describe, it, expect, vi } from 'vitest';
import { computeMetrics, renderHygieneMarkdown, evaluateRatchet } from '../ledger-hygiene.js';

/** 轻量 mock pool：按 sql 片段返回受控数据 */
function mockPool(scenarios) {
  return {
    async query(sql, _params) {
      const s = sql.replace(/\s+/g, ' ').trim();
      for (const [pattern, rows] of Object.entries(scenarios)) {
        if (s.includes(pattern)) return { rows };
      }
      return { rows: [] };
    },
  };
}

describe('m7 — 自主循环零产出指标', () => {
  it('strategist 从未产出（design_docs 无 strategy_session）→ m7 enabled=false', async () => {
    const pool = mockPool({
      'strategy_session': [],    // stratEver = 0 rows
      'capture_atoms': [],       // capEver = 0 rows
    });

    const metrics = await computeMetrics(pool);
    expect(metrics.m7.enabled).toBe(false);
    expect(metrics.m7.debt).toBe(0);
  });

  it('strategist 历史有产出但近 24h 零产出 → m7 debt=1, absolute=true', async () => {
    const pool = {
      async query(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        // m1-m6 返回 0 行（只测 m7）
        if (s.includes('strategy_session') && s.includes('Asia/Shanghai')) {
          return { rows: [{ cnt: '0' }] }; // 近 24h 零产出
        }
        if (s.includes('strategy_session') && !s.includes('INTERVAL')) {
          return { rows: [{ '?column?': '1' }] }; // ever 有记录
        }
        if (s.includes('capture_atoms') && !s.includes('INTERVAL')) {
          return { rows: [] }; // capture 未激活
        }
        // 所有 m1-m6 的查询
        return { rows: [{ total: '0', debt: '0', cnt: '0' }] };
      },
    };

    const metrics = await computeMetrics(pool);
    expect(metrics.m7.enabled).toBe(true);
    expect(metrics.m7.debt).toBe(1);       // stratDebt=1
    expect(metrics.m7.absolute).toBe(true);
  });

  it('strategist 近 24h 有产出 → m7 debt=0', async () => {
    const pool = {
      async query(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('strategy_session') && s.includes('Asia/Shanghai')) {
          return { rows: [{ cnt: '3' }] }; // 3 条
        }
        if (s.includes('strategy_session')) {
          return { rows: [{ '?column?': '1' }] }; // ever activated
        }
        if (s.includes('capture_atoms')) {
          return { rows: [] };
        }
        return { rows: [{ total: '0', debt: '0', cnt: '0' }] };
      },
    };

    const metrics = await computeMetrics(pool);
    expect(metrics.m7.debt).toBe(0);
  });

  it('capture_atoms 表不存在（throw）→ 降级为未激活，m7 仍可用', async () => {
    const pool = {
      async query(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('strategy_session') && s.includes('Asia/Shanghai')) {
          return { rows: [{ cnt: '2' }] };
        }
        if (s.includes('strategy_session')) {
          return { rows: [{ '?column?': '1' }] };
        }
        if (s.includes('capture_atoms')) {
          throw new Error('relation "capture_atoms" does not exist');
        }
        return { rows: [{ total: '0', debt: '0', cnt: '0' }] };
      },
    };

    // 不应 throw
    const metrics = await computeMetrics(pool);
    expect(metrics.m7).toBeDefined();
    // capture 降级，但 strat 已激活且有产出 → debt=0
    expect(metrics.m7.debt).toBe(0);
  });

  it('两项都零产出 → debt=2', async () => {
    const pool = {
      async query(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('strategy_session') && s.includes('Asia/Shanghai')) {
          return { rows: [{ cnt: '0' }] };
        }
        if (s.includes('strategy_session')) {
          return { rows: [{ '?column?': '1' }] };
        }
        if (s.includes('capture_atoms') && s.includes('Asia/Shanghai')) {
          return { rows: [{ cnt: '0' }] };
        }
        if (s.includes('capture_atoms')) {
          return { rows: [{ '?column?': '1' }] }; // ever activated
        }
        return { rows: [{ total: '0', debt: '0', cnt: '0' }] };
      },
    };

    const metrics = await computeMetrics(pool);
    expect(metrics.m7.debt).toBe(2); // stratDebt=1 + captureDebt=1
  });
});

describe('m7 棘轮击穿', () => {
  const fakeMetrics = (m7Debt, m7Enabled = true) => ({
    m1: { key: 'm1', enabled: false, debt: 0 },
    m2: { key: 'm2', enabled: false, debt: 0 },
    m3: { key: 'm3', enabled: false, debt: 0 },
    m4: { key: 'm4', enabled: false, debt: 0 },
    m5: { key: 'm5', enabled: false, debt: 0 },
    m6: { key: 'm6', enabled: false, debt: 0 },
    m7: { key: 'm7', name: '自主循环零产出', enabled: m7Enabled, debt: m7Debt, absolute: true },
  });

  it('m7 首次 debt=1（absolute）→ 击穿', () => {
    const { breaches } = evaluateRatchet(fakeMetrics(1), null, '2026-07-12');
    expect(breaches.find((b) => b.key === 'm7')).toBeTruthy();
    expect(breaches[0].streak).toBe(1);
  });

  it('m7 debt=0 → 不击穿', () => {
    const { breaches } = evaluateRatchet(fakeMetrics(0), null, '2026-07-12');
    expect(breaches.find((b) => b.key === 'm7')).toBeFalsy();
  });

  it('m7 enabled=false → 不参与棘轮', () => {
    const { breaches } = evaluateRatchet(fakeMetrics(5, false), null, '2026-07-12');
    expect(breaches.find((b) => b.key === 'm7')).toBeFalsy();
  });
});

describe('renderHygieneMarkdown — m7 渲染', () => {
  it('m7 value 是 object 时以 JSON 显示', () => {
    const metrics = {
      m7: { key: 'm7', name: '自主循环零产出', enabled: true, value: { stratDebt: 1, captureDebt: 0 }, debt: 1 },
    };
    const md = renderHygieneMarkdown('2026-07-12', metrics, []);
    expect(md).toContain('stratDebt');
    expect(md).toContain('自主循环零产出');
  });

  it('m7 enabled=false 显示「未启用」', () => {
    const metrics = {
      m7: { key: 'm7', name: '自主循环零产出', enabled: false, value: null, debt: 0 },
    };
    const md = renderHygieneMarkdown('2026-07-12', metrics, []);
    expect(md).toContain('未启用');
  });
});
