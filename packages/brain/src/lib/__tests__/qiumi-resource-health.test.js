/**
 * qiumi-resource-health.test.js — 秋米路由出口资源健康闸的纯函数与查询（任务 5bf2512a 审查修复）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  phoneAccountRefs, qiumiRouteHealthGate,
  rememberBlockedRoute, recallBlockedRoute, forgetBlockedRoute, _resetBlockedRouteMemo,
} from '../qiumi-resource-health.js';
import { _resetGateEventMemo } from '../resource-health-gate.js';

const poolOf = (handler) => ({ query: vi.fn(handler) });

beforeEach(() => {
  _resetBlockedRouteMemo();
  _resetGateEventMemo();
});

describe('phoneAccountRefs', () => {
  it('只取 current=true 的账号，兼容 id / account_id 两种字段', async () => {
    const pool = poolOf(async () => ({ rows: [{ douyin_accounts: [
      { id: 'a1', current: true }, { id: 'a2', current: false }, { account_id: 'a3', current: true },
    ] }] }));
    expect(await phoneAccountRefs(pool, 'S1')).toEqual([
      { type: 'account', key: 'douyin:a1' },
      { type: 'account', key: 'douyin:a3' },
    ]);
  });

  it('台账没有这台手机 / 没有 serial → 空', async () => {
    expect(await phoneAccountRefs(poolOf(async () => ({ rows: [] })), 'S1')).toEqual([]);
    const pool = poolOf(async () => ({ rows: [] }));
    expect(await phoneAccountRefs(pool, null)).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('查询出错 → 空数组不抛（fail-safe）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await phoneAccountRefs(poolOf(async () => { throw new Error('boom'); }), 'S1')).toEqual([]);
    spy.mockRestore();
  });
});

describe('qiumiRouteHealthGate', () => {
  it('手机健康但当前账号被风控 → blocked', async () => {
    const pool = poolOf(async (sql) => {
      if (/phone_registry/.test(sql)) return { rows: [{ douyin_accounts: [{ id: 'a1', current: true }] }] };
      if (/resource_health/.test(sql)) return { rows: [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '人脸', observed_at: new Date().toISOString() }] };
      return { rows: [] };
    });
    const r = await qiumiRouteHealthGate({ id: 't1', payload: {} }, 'S1', { pool, tag: 't' });
    expect(r.blocked).toBe(true);
  });

  it('查的资源包含手机 serial 与 payload 原有 resource_refs', async () => {
    let params;
    const pool = poolOf(async (sql, p) => {
      if (/resource_health/.test(sql)) { params = p; return { rows: [] }; }
      return { rows: [] };
    });
    const r = await qiumiRouteHealthGate({ id: 't1' }, 'S1', { pool, payload: { resource_refs: [{ type: 'machine', key: 'm1' }] }, tag: 't' });
    expect(r.blocked).toBe(false);
    const pairs = params[0].map((t, i) => `${t}:${params[1][i]}`);
    expect(pairs).toEqual(expect.arrayContaining(['phone:S1', 'machine:m1']));
  });
});

describe('被挡路由备忘', () => {
  it('记住 → 取回；忘掉 → null；过期 → null', () => {
    rememberBlockedRoute('t1', 'S1', 1000);
    expect(recallBlockedRoute('t1', 2000)).toBe('S1');
    forgetBlockedRoute('t1');
    expect(recallBlockedRoute('t1', 2000)).toBeNull();
    rememberBlockedRoute('t2', 'S2', 0);
    expect(recallBlockedRoute('t2', 31 * 60 * 1000)).toBeNull();
  });
});
