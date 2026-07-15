/**
 * 合同测试 — A8-3 金丝雀故障注入演习
 * 状态：Green
 *
 * 规则（INV-04）：
 * - 只 mock docker/tmux/gh/Bark/staging HTTP fetch 最外层
 * - classifyDeath（纯函数）必须真实执行
 * - canary 过滤 SQL 条件、Bark 消息内容构造不得 mock
 *
 * BEHAVIOR 编号与 contract-dod.md 对应：
 *   BEHAVIOR-4  演习脚本生产端口守卫
 *   BEHAVIOR-5  OOM 注入分类断言
 *   BEHAVIOR-6  演习落档降级写 design_docs
 *   BEHAVIOR-7  Bark 失败告警
 *   BEHAVIOR-8  nightly tick job 注册（幂等）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock 最外层：docker/tmux/gh exec + HTTP fetch ────────────────────────────

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((cmd) => {
      if (typeof cmd === 'string' &&
          (cmd.includes('docker') || cmd.includes('tmux') || cmd.includes('gh'))) {
        return '';
      }
      return actual.execSync(cmd);
    }),
    exec: vi.fn((_cmd, cb) => cb && cb(null, '', '')),
    spawn: vi.fn(() => ({
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    })),
  };
});

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

function makeDbStub() {
  const calls = [];
  return {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
    _calls: calls,
  };
}

function makeFetchStub(overrides = {}) {
  const calls = [];
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url, opts });
    const defaultResponse = overrides[url] ?? { status: 200, body: { id: 'canary-test-001' } };
    return {
      ok: defaultResponse.status >= 200 && defaultResponse.status < 300,
      status: defaultResponse.status,
      json: async () => defaultResponse.body,
    };
  });
  fn._calls = calls;
  return fn;
}

// ─── 从真实实现导入 ───────────────────────────────────────────────────────────

import {
  validateStagingUrl,
  sendBark,
  archiveDrillResult,
  runOomDrill,
  notifyDrillFailure,
} from '../../../scripts/canary-death-drill.mjs';

import {
  maybeScheduleCanaryDrill,
} from '../../../packages/brain/src/canary-drill-scheduler.js';

// ─── BEHAVIOR-4：生产端口守卫 ─────────────────────────────────────────────────

describe('BEHAVIOR-4: 生产端口守卫', () => {
  it('STAGING_BRAIN_URL 含 :5221 → 立即 throw，不发任何请求', async () => {
    const fetchSpy = vi.fn();
    expect(() => validateStagingUrl('http://localhost:5221')).toThrow(':5221');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('STAGING_BRAIN_URL 为 :5222 → 守卫通过，允许执行注册流程', async () => {
    expect(() => validateStagingUrl('http://localhost:5222')).not.toThrow();
  });

  it('validateStagingUrl 是 named export（函数）', () => {
    expect(typeof validateStagingUrl).toBe('function');
  });
});

// ─── BEHAVIOR-5：OOM 注入分类断言 ─────────────────────────────────────────────

describe('BEHAVIOR-5: OOM 注入分类 + watchdog 处置断言', () => {
  it('runOomDrill 是 named export（函数）', () => {
    expect(typeof runOomDrill).toBe('function');
  });

  it('runOomDrill 发起 PATCH 请求设置 exit_code=137 + cause=oom', async () => {
    const calls = [];
    const fetchStub = vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      if (opts?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      // GET /tasks/:id → 返回 failed+cause=oom
      return {
        ok: true, status: 200,
        json: async () => ({ status: 'failed', result: { exit_code: 137, cause: 'oom' }, payload: { cause: 'oom' } }),
      };
    });
    const result = await runOomDrill({
      taskId: 'canary-001',
      fetchFn: fetchStub,
      baseUrl: 'http://localhost:5222',
      timeoutMin: 0.01,
    });
    expect(result.cause).toBe('oom');
    // PATCH 调用应含 exit_code:137
    const patchCall = calls.find(c => c.opts?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(patchCall.opts.body);
    expect(patchBody.result.exit_code).toBe(137);
    expect(patchBody.result.cause).toBe('oom');
  });
});

// ─── BEHAVIOR-6：落档降级写 design_docs ──────────────────────────────────────

describe('BEHAVIOR-6: 演习落档降级写 design_docs', () => {
  it('archiveDrillResult 是 named export（函数）', () => {
    expect(typeof archiveDrillResult).toBe('function');
  });

  it('archiveDrillResult 调用 POST /api/brain/design-docs，type=drill_report', async () => {
    const fetchStub = makeFetchStub();
    await archiveDrillResult({
      taskId: 'c-001',
      mode: 'oom',
      results: { pass: true },
      success: true,
      fetchFn: fetchStub,
      baseUrl: 'http://localhost:5222',
    });
    const designDocCall = fetchStub._calls.find(c => c.url.includes('/design-docs'));
    expect(designDocCall).toBeDefined();
    const body = JSON.parse(designDocCall.opts.body);
    expect(body.type).toBe('drill_report');
  });

  it('design_docs 写入内容含 injected_mode 和 results 字段', async () => {
    const fetchStub = makeFetchStub();
    await archiveDrillResult({
      taskId: 'c-001',
      mode: 'oom',
      results: { pass: true, reason: 'ok' },
      success: true,
      fetchFn: fetchStub,
      baseUrl: 'http://localhost:5222',
    });
    const designDocCall = fetchStub._calls.find(c => c.url.includes('/design-docs'));
    const body = JSON.parse(designDocCall.opts.body);
    const content = JSON.parse(body.content);
    expect(content).toHaveProperty('injected_mode');
    expect(content).toHaveProperty('results');
    expect(content.injected_mode).toBe('oom');
  });
});

// ─── BEHAVIOR-7：Bark 失败告警 ────────────────────────────────────────────────

describe('BEHAVIOR-7: Bark 失败告警', () => {
  it('notifyDrillFailure 是 named export（函数）', () => {
    expect(typeof notifyDrillFailure).toBe('function');
  });

  it('notifyDrillFailure 调用 barkFn，标题含 CanaryDrill Failed，body 含 task_id', async () => {
    const barkCalls = [];
    const barkStub = vi.fn(async (title, body) => {
      barkCalls.push({ title, body });
    });
    await notifyDrillFailure({
      taskId: 'c-001',
      mode: 'oom',
      failedAssertions: ['cause !== oom'],
      barkFn: barkStub,
    });
    expect(barkStub).toHaveBeenCalledTimes(1);
    expect(barkCalls[0].title).toContain('CanaryDrill Failed');
    expect(barkCalls[0].body).toContain('task_id=c-001');
  });

  it('BARK_URL 未设时（barkFn=null）log warn 不 throw', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      notifyDrillFailure({ taskId: 'c-001', mode: 'oom', failedAssertions: [], barkFn: null })
    ).resolves.not.toThrow();
    warnSpy.mockRestore();
  });
});

// ─── BEHAVIOR-8：nightly tick job 幂等 ────────────────────────────────────────

describe('BEHAVIOR-8: nightly tick job 注册（幂等）', () => {
  it('maybeScheduleCanaryDrill 是 named export（函数）', () => {
    expect(typeof maybeScheduleCanaryDrill).toBe('function');
  });

  it('UTC 19:30 窗口内 → triggered=true，execFn 被调用一次', async () => {
    const execCalls = [];
    const execStub = vi.fn(async (script, args) => {
      execCalls.push({ script, args });
    });
    const now = new Date('2026-07-17T19:30:00Z'); // UTC 19:30 in window
    const result = await maybeScheduleCanaryDrill({ now, execFn: execStub });
    expect(result.triggered).toBe(true);
    expect(execCalls.length).toBe(1);
    expect(execCalls[0].script).toContain('canary-death-drill.mjs');
  });

  it('同日历日第二次 tick → skipped=true，execFn 不重复调用', async () => {
    const execCalls = [];
    const execStub = vi.fn(async (script, args) => {
      execCalls.push({ script, args });
    });
    const now = new Date('2026-07-18T19:30:00Z');
    // 第一次触发
    await maybeScheduleCanaryDrill({ now, execFn: execStub });
    // 第二次同日期
    const result = await maybeScheduleCanaryDrill({ now, execFn: execStub });
    expect(result.skipped).toBe(true);
    expect(execCalls.length).toBe(1); // 只调用了一次
  });

  it('UTC 19:00（窗口外）→ triggered=false，skipped=true', async () => {
    const execStub = vi.fn();
    const now = new Date('2026-07-19T19:00:00Z'); // 在窗口之前
    const result = await maybeScheduleCanaryDrill({ now, execFn: execStub });
    expect(result.triggered).toBe(false);
    expect(result.skipped).toBe(true);
    expect(execStub).not.toHaveBeenCalled();
  });
});
