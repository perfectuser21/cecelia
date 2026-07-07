/**
 * WarRoomPanels 纯函数单测（relay-baton4 item2）
 * 四板块的数据变换纯函数：战况 chip / 交接单卡片 / 决策行 / 哨兵灯。
 * 字段名以生产实测为准（success_rate 0-1 小数、age_seconds、{handoffs} 包装、decisions 裸数组）。
 */
import { describe, it, expect } from 'vitest';
import {
  pctLabel, journeyStatRows, handoffRows, decisionRows,
  sentinelLight, sentinelRows, sentinelVisible, SENTINEL_STALE_SECONDS,
} from '../WarRoomPanels';

describe('pctLabel（成功率 0-1 → 百分比）', () => {
  it('0.8 → 80%；0 → 0%；1 → 100%', () => {
    expect(pctLabel(0.8)).toBe('80%');
    expect(pctLabel(0)).toBe('0%');
    expect(pctLabel(1)).toBe('100%');
  });
  it('null/undefined/非数 → —', () => {
    expect(pctLabel(null)).toBe('—');
    expect(pctLabel(undefined)).toBe('—');
    expect(pctLabel('abc')).toBe('—');
  });
});

describe('journeyStatRows（/harness/stats?by=journey）', () => {
  const stat = {
    by: 'journey', period_days: 30,
    journeys: [{
      journey_id: 'j1', journey_name: 'Line 05 视频剪辑', runs: 5, done: 4, failed: 1,
      success_rate: 0.8, last_run_at: '2026-07-05T00:00:00Z', last_failure: null,
    }],
  };
  it('正常映射：name/runs/pct/last_run_at', () => {
    const rows = journeyStatRows(stat);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Line 05 视频剪辑');
    expect(rows[0].runs).toBe(5);
    expect(rows[0].pct).toBe('80%');
    expect(rows[0].hasFailure).toBe(false);
  });
  it('last_failure 多行长文本 → 压成单行截断 36 字 + 原文保留', () => {
    const long = 'x'.repeat(50) + '\nbash: line 2: error\n' + 'y'.repeat(50);
    const rows = journeyStatRows({ journeys: [{ ...stat.journeys[0], last_failure: long }] });
    expect(rows[0].hasFailure).toBe(true);
    expect(rows[0].failure_short.length).toBeLessThanOrEqual(37); // 36 + 省略号
    expect(rows[0].failure_short.includes('\n')).toBe(false);
    expect(rows[0].failure_full).toBe(long);
  });
  it('非对象 / 缺 journeys / journeys 非数组 → []', () => {
    expect(journeyStatRows(null)).toEqual([]);
    expect(journeyStatRows({})).toEqual([]);
    expect(journeyStatRows({ journeys: 'no' })).toEqual([]);
  });
});

describe('handoffRows（/api/brain/handoffs 包装对象）', () => {
  it('取 resp.handoffs；next_step 取 next_steps[0]', () => {
    const rows = handoffRows({
      handoffs: [{ task_id: 't1', title: '交接单A', verdict: 'PASS', created_at: '2026-07-07T00:00:00Z', next_steps: ['下一步1', '下一步2'] }],
      total: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('交接单A');
    expect(rows[0].verdict).toBe('PASS');
    expect(rows[0].next_step).toBe('下一步1');
  });
  it('next_steps 缺失/空数组 → next_step 空串；verdict 缺失 → null', () => {
    const rows = handoffRows({ handoffs: [{ task_id: 't2', title: 'B', next_steps: [] }, { task_id: 't3', title: 'C' }] });
    expect(rows[0].next_step).toBe('');
    expect(rows[0].verdict).toBeNull();
    expect(rows[1].next_step).toBe('');
  });
  it('非对象/裸数组入参/缺 handoffs → []', () => {
    expect(handoffRows(null)).toEqual([]);
    expect(handoffRows([{ task_id: 'x' }])).toEqual([]);
    expect(handoffRows({})).toEqual([]);
  });
});

describe('decisionRows（/api/brain/decisions 裸数组）', () => {
  it('topic + 上海日期 YYYY-MM-DD', () => {
    const rows = decisionRows([{ id: 'd1', topic: '拍板A', created_at: '2026-07-06T20:00:00Z' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe('拍板A');
    expect(rows[0].date).toBe('2026-07-07'); // UTC 20:00 = 上海 07-07 04:00
  });
  it('created_at 非法/缺失 → date 空串', () => {
    expect(decisionRows([{ id: 'd2', topic: 'B' }])[0].date).toBe('');
  });
  it('非数组（含 {data} 包装误传）→ []', () => {
    expect(decisionRows(null)).toEqual([]);
    expect(decisionRows({ data: [] })).toEqual([]);
  });
});

describe('sentinelLight / sentinelRows（/api/brain/sentinel/health）', () => {
  it('ok=true 且 age_seconds<=1800 → green；1801 → yellow；ok=false → yellow', () => {
    expect(SENTINEL_STALE_SECONDS).toBe(1800);
    expect(sentinelLight({ ok: true, age_seconds: 1800 })).toBe('green');
    expect(sentinelLight({ ok: true, age_seconds: 1801 })).toBe('yellow');
    expect(sentinelLight({ ok: false, age_seconds: 10 })).toBe('yellow');
    expect(sentinelLight(null)).toBe('yellow');
  });
  it('全绿且数量>=expected → healthy=true', () => {
    const s = sentinelRows({ jobs: [{ name: 'a', ok: true, age_seconds: 60 }, { name: 'b', ok: true, age_seconds: 60 }], expected: 2, healthy: true });
    expect(s.healthy).toBe(true);
    expect(s.lights).toHaveLength(2);
    expect(s.lights[0].light).toBe('green');
  });
  it('数量<expected → healthy=false（即使后端 healthy=true 也以前端自算为准）', () => {
    const s = sentinelRows({ jobs: [{ name: 'a', ok: true, age_seconds: 60 }], expected: 5, healthy: true });
    expect(s.healthy).toBe(false);
  });
  it('expected 缺失 → expected=null 且 healthy=false；jobs 非数组 → lights=[]', () => {
    const s = sentinelRows({ jobs: [{ name: 'a', ok: true, age_seconds: 60 }] });
    expect(s.expected).toBeNull();
    expect(s.healthy).toBe(false);
    expect(sentinelRows({ jobs: 'no', expected: 1 }).lights).toEqual([]);
  });
  it('某灯 yellow → healthy=false', () => {
    const s = sentinelRows({ jobs: [{ name: 'a', ok: true, age_seconds: 60 }, { name: 'b', ok: false, age_seconds: 60 }], expected: 2 });
    expect(s.healthy).toBe(false);
  });
  it('sentinelVisible：哨兵全灭（jobs=[] 但 expected=5）→ true（最需要报警不能隐藏）', () => {
    expect(sentinelVisible({ lights: [], expected: 5, healthy: false })).toBe(true);
  });
  it('sentinelVisible：无灯且 expected 未知 → false；有灯 → true', () => {
    expect(sentinelVisible({ lights: [], expected: null, healthy: false })).toBe(false);
    expect(sentinelVisible({ lights: [{ name: 'a', light: 'green', age_seconds: 60 }], expected: null, healthy: false })).toBe(true);
  });
});
