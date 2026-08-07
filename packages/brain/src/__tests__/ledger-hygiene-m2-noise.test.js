/**
 * ledger-hygiene-m2-noise.test.js — 复现 m2「归属完整率」口径三处失真（合同回归测试，永留 CI）
 *
 * 根因三条（sprint 08070516-relay-2c482ed6，调研 .harness/research-ledger-hygiene.md）：
 *   1. 守卫自噬回路：自产 issue（title '[ledger-hygiene]%'）与 capture-triage 建的
 *      '[紧急] issue: [ledger-hygiene]%' task 计入 m2，每报一次自涨（m7 已排除自产而 m2 没有）
 *   2. 冒烟噪声：headed 派发冒烟脚本建的测试 task（payload.smoke_tag 非空）计入 m2
 *   3. attribution_harness 恒空 + 双重计数：tasks.ability_id 未接线（全库仅 15 行非空），
 *      该子项=纯噪声源；harness 任务缺 journey_id 时被 tasks/harness 两条子查询各计一次
 *
 * 修复合同（CONTRACT IS LAW）：
 *   - export LEDGER_SELF_ISSUE_PREFIX = '[ledger-hygiene]'：自产 issue title 前缀
 *     （与 raiseBreachAlerts 写入 title 及当日去重查询同源）
 *   - m2 tasks 子查询（attribution_tasks 注释锚保留）排除
 *     title LIKE '[紧急] issue: [ledger-hygiene]%'（由 '[紧急] ' + LEDGER_SELF_ATOM_PREFIX 拼接派生）
 *     与 payload->>'smoke_tag' 非空的行（debt 与 total 同步排除：谓词置于外层 WHERE，
 *     即注释锚之后——只在 debt 的 FILTER 内加谓词无法通过位置锚断言）
 *   - m2 issues 子查询（attribution_issues 注释锚保留）排除 title LIKE '[ledger-hygiene]%'
 *     （debt 与 total 同步排除，位置锚同上）
 *   - attribution_harness 子查询在 ability_id 接线前不计入 m2 的 debt 与 total 求和
 *     （代码注释注明接线后恢复属后续 sprint）
 *   - m2 指标对象 shape 保持 { key, name, value, debt, enabled }
 *
 * 本文件由 generator 从合同 tests/ 原样复制到 packages/brain/src/__tests__/，
 * commit 1 Red，实现后 Green，永留 brain-unit CI（PRD NFR：回归测试不可删）。
 */
import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  evaluateRatchet,
  raiseBreachAlerts,
  LEDGER_SELF_ATOM_PREFIX,
} from '../ledger-hygiene.js';

const MODULE_PATH = '../ledger-hygiene.js';

/** mock pool：按 SQL 关键词路由返回值，记录全部调用（沿用 ledger-hygiene.test.js 先例）。 */
function makePool(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const hit = routes.find((r) => sql.includes(r.match));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

describe('m2 口径修正 — 排除谓词进 SQL', () => {
  it('m2 tasks 子查询含 smoke_tag 与守卫自产 [紧急] 前缀排除谓词', async () => {
    const pool = makePool([
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '2' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '1' }] },
    ]);
    await computeMetrics(pool);
    const call = pool.calls.find((c) => c.sql.includes('attribution_tasks'));
    expect(call).toBeTruthy();
    // 冒烟标记排除（判定点 J1：payload smoke_tag 机器标记）
    expect(call.sql).toContain('smoke_tag');
    // 守卫自产 [紧急] task 排除（前缀 = '[紧急] ' + LEDGER_SELF_ATOM_PREFIX）
    expect(call.sql).toContain(`[紧急] ${LEDGER_SELF_ATOM_PREFIX}`);
    // 谓词位置锚（规范§3）：排除谓词在外层 WHERE（/* attribution_tasks */ 注释锚之后），
    // debt 与 total 同步排除——只在 debt 的 FILTER (WHERE ...) 内加谓词（FILTER 在 FROM 之前）过不了本断言
    expect(call.sql.indexOf('smoke_tag')).toBeGreaterThan(call.sql.indexOf('attribution_tasks'));
    expect(call.sql.indexOf(`[紧急] ${LEDGER_SELF_ATOM_PREFIX}`)).toBeGreaterThan(
      call.sql.indexOf('attribution_tasks')
    );
  });

  it('m2 issues 子查询含自产前缀排除谓词', async () => {
    const pool = makePool([
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '2' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '1' }] },
    ]);
    await computeMetrics(pool);
    const call = pool.calls.find((c) => c.sql.includes('attribution_issues'));
    expect(call).toBeTruthy();
    expect(call.sql).toContain('[ledger-hygiene]');
    // 谓词位置锚（规范§2）：排除谓词在外层 WHERE（/* attribution_issues */ 注释锚之后），debt 与 total 同步排除
    expect(call.sql.indexOf('[ledger-hygiene]')).toBeGreaterThan(call.sql.indexOf('attribution_issues'));
  });

  it('m2 求和不再计入 attribution_harness 子指标', async () => {
    // harness 路由给出极端值：若仍被计入求和，debt/value 必然被拉爆
    const pool = makePool([
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '2' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '1' }] },
      { match: 'attribution_harness', rows: [{ total: '100', debt: '100' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m2.debt).toBe(3); // 仅 tasks(2) + issues(1)；含 harness 则为 103
    expect(m.m2.value).toBeCloseTo(12 / 15); // (15-3)/15；含 harness 则为 12/115
  });
});

describe('m2 口径修正 — 常量同源与 shape 守护', () => {
  it('LEDGER_SELF_ISSUE_PREFIX 与 raiseBreachAlerts 写入 title 同源', async () => {
    const mod = await import(MODULE_PATH);
    // 新常量导出且逐字等于自产 issue title 前缀（红阶段：未导出 → undefined 失败）
    expect(mod.LEDGER_SELF_ISSUE_PREFIX).toBe('[ledger-hygiene]');
    const pool = makePool([
      { match: 'INSERT INTO issues', rows: [{ id: '00000000-0000-4000-8000-000000000001' }] },
      { match: 'FROM issues', rows: [] },
      { match: 'INSERT INTO captures', rows: [{ id: '00000000-0000-4000-8000-000000000002' }] },
    ]);
    await raiseBreachAlerts(
      pool,
      [{ key: 'm2', name: '归属完整率', prevDebt: 300, debt: 301, streak: 1 }],
      '2026-08-07'
    );
    const insertCall = pool.calls.find((c) => c.sql.includes('INSERT INTO issues'));
    expect(insertCall).toBeTruthy();
    // 写入侧 title 以同一前缀开头（同源：分类 ↔ 写入不许单边漂移）
    expect(String(insertCall.params[0]).startsWith(mod.LEDGER_SELF_ISSUE_PREFIX)).toBe(true);
    const dedupCall = pool.calls.find((c) => c.sql.includes('FROM issues') && Array.isArray(c.params));
    expect(dedupCall).toBeTruthy();
    expect(String(dedupCall.params[0]).startsWith(mod.LEDGER_SELF_ISSUE_PREFIX)).toBe(true);
  });

  it('m2 指标对象 shape 保持 key name value debt enabled', async () => {
    const pool = makePool([
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '2' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '1' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m2.key).toBe('m2');
    expect(m.m2.name).toBe('归属完整率');
    expect(typeof m.m2.value).toBe('number');
    expect(typeof m.m2.debt).toBe('number');
    expect(m.m2.enabled).toBe(true);
  });
});

describe('m2 边界 — 口径修正后棘轮行为（PRD:29）', () => {
  it('口径修正后 debt 骤降不触发击穿且不重置 baseline', () => {
    const metrics = {
      m2: { key: 'm2', name: '归属完整率', value: 0.9, debt: 300, enabled: true },
    };
    const prev = {
      baseline: { m2: 329 },
      last: { m2: 459 },
      streaks: { m2: 3 },
      baseline_date: '2026-07-11',
    };
    const { state, breaches } = evaluateRatchet(metrics, prev, '2026-08-08');
    expect(breaches).toEqual([]); // 459 → 300 骤降不击穿
    expect(state.baseline.m2).toBe(329); // baseline 不重置
    expect(state.streaks.m2).toBe(0); // streak 归零
    expect(state.last.m2).toBe(300);
  });
});
