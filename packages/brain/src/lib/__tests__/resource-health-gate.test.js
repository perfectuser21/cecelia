/** 调度前资源健康闸（任务 5bf2512a）：不健康不派并给原因；闸自身出任何错都放行（fail-safe，只记日志）。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resourceHealthGate, _resetGateEventMemo } from '../resource-health-gate.js';

const restrictedRow = { resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '切换要人脸', observed_at: new Date().toISOString() };

function poolWith(rows) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM resource_health/.test(sql)) return { rows };
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('resourceHealthGate', () => {
  beforeEach(() => _resetGateEventMemo());

  it('任务没引用资源 → 放行且零 DB 查询', async () => {
    const pool = poolWith([]);
    expect(await resourceHealthGate({ id: 't0', payload: { anchor: {} } }, { pool })).toEqual({ blocked: false });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('引用的账号被风控 → blocked + 原因，并记一条 task_events', async () => {
    const pool = poolWith([restrictedRow]);
    const task = { id: 't1', payload: { account_ref: { platform: 'douyin', account_id: 'a1' } } };
    const r = await resourceHealthGate(task, { pool });
    expect(r.blocked).toBe(true);
    expect(r.summary).toMatch(/douyin:a1 restricted/);
    expect(r.reasons[0]).toMatchObject({ type: 'account', key: 'douyin:a1', status: 'restricted' });
    const ev = pool.calls.find((c) => /INSERT INTO task_events/.test(c.sql));
    expect(ev.params[0]).toBe('t1');
    expect(ev.params[1]).toBe('resource_health_blocked');
  });

  it('同一张单同一原因每 tick 被挡 → task_events 只记一次', async () => {
    const pool = poolWith([restrictedRow]);
    const task = { id: 't2', payload: { resource_refs: [{ type: 'account', key: 'douyin:a1' }] } };
    await resourceHealthGate(task, { pool });
    await resourceHealthGate(task, { pool });
    expect(pool.calls.filter((c) => /INSERT INTO task_events/.test(c.sql))).toHaveLength(1);
  });

  it('degraded / unknown → 放行', async () => {
    const pool = poolWith([{ ...restrictedRow, status: 'degraded' }]);
    const r = await resourceHealthGate({ id: 't3', payload: { resource_refs: [{ type: 'account', key: 'douyin:a1' }, { type: 'phone', key: 'S9' }] } }, { pool });
    expect(r.blocked).toBe(false);
  });

  it('查库抛错 → 放行（fail-safe），不外抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('relation "resource_health" does not exist')) };
    const r = await resourceHealthGate({ id: 't4', payload: { device_serial: 'S1' } }, { pool });
    expect(r.blocked).toBe(false);
    expect(r.error).toMatch(/resource_health/);
  });

  it('task_events 写失败 → 照样返回 blocked（留痕失败不影响判定）', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM resource_health/.test(sql)) return { rows: [restrictedRow] };
        throw new Error('task_events down');
      }),
    };
    const r = await resourceHealthGate({ id: 't5', payload: { account_ref: 'douyin:a1' } }, { pool });
    expect(r.blocked).toBe(true);
  });
});
