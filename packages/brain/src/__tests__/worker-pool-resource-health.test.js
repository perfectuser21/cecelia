// worker-pool-resource-health.test.js — 任务 5bf2512a：worker 池派发前查资源健康，被风控/掉线的资源不预占不发射；健康闸出错照常派。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWorkerPoolDispatch, __resetWorkerPoolDispatchForTest } from '../worker-pool-dispatch.js';
import { _resetGateEventMemo } from '../lib/resource-health-gate.js';

const TASK = {
  id: 'cccccccc-0000-0000-0000-000000000003',
  title: '用某账号的并行任务',
  payload: { parallel_worker: true, account_ref: { platform: 'douyin', account_id: 'a1' } },
};

function makeExecFn() {
  const calls = [];
  const pending = {};
  const fn = vi.fn((cmd) => {
    calls.push({ cmd });
    const sk = cmd.match(/send-keys -t (slot\d+)/);
    if (sk) pending[sk[1]] = true;
    const m = cmd.match(/list-panes[^']*-t (slot\d+)/);
    if (m) return pending[m[1]] ? 'claude\n' : 'zsh\n';
    return '';
  });
  fn.calls = calls;
  return fn;
}

function makePool(healthRows, { healthError = null } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/FROM resource_health/.test(sql)) {
        if (healthError) throw healthError;
        return { rows: healthRows };
      }
      if (/FROM dispatch_events/i.test(sql) && /SELECT/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM tasks/i.test(sql) && /queued/i.test(sql)) return { rows: [TASK], rowCount: 1 };
      if (/UPDATE tasks/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetWorkerPoolDispatchForTest();
  _resetGateEventMemo();
});

describe('worker 池 × 资源健康', () => {
  it('引用的账号被风控 → 不预占、不发射', async () => {
    const execFn = makeExecFn();
    const pool = makePool([{ resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '人脸', observed_at: new Date().toISOString() }]);
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(0);
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE tasks SET claimed_by = 'interactive-dev-skill'/.test(sql))).toBe(false);
    expect(execFn.calls.some((c) => /send-keys/.test(c.cmd))).toBe(false);
  });

  it('账号健康 → 照常预占并发射', async () => {
    const execFn = makeExecFn();
    const pool = makePool([{ resource_type: 'account', resource_key: 'douyin:a1', status: 'healthy', reason: null, observed_at: new Date().toISOString() }]);
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(1);
  });

  it('健康表查询抛错 → fail-safe 照常派发', async () => {
    const execFn = makeExecFn();
    const pool = makePool([], { healthError: new Error('relation "resource_health" does not exist') });
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(1);
  });
});
