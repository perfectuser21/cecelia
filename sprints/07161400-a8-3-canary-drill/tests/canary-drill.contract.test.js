/**
 * 合同测试骨架 — A8-3 金丝雀故障注入演习
 * 状态：Red（实现尚未完成，测试预期失败）
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
  return vi.fn(async (url, opts) => {
    const defaultResponse = overrides[url] ?? { status: 200, body: { id: 'canary-test-001' } };
    return {
      ok: defaultResponse.status >= 200 && defaultResponse.status < 300,
      status: defaultResponse.status,
      json: async () => defaultResponse.body,
    };
  });
}

function makeBarkStub() {
  const calls = [];
  const fn = vi.fn(async (title, body) => {
    calls.push({ title, body });
  });
  fn._calls = calls;
  return fn;
}

// ─── BEHAVIOR-4：生产端口守卫 ─────────────────────────────────────────────────
// 从真实实现文件导入守卫函数（约定接口）
// 实现文件路径：scripts/canary-death-drill.mjs
// 导出接口约定：export function validateStagingUrl(url: string): void
//   - url 含 ':5221' 时 throw Error
//   - url 含 ':5222' 时正常返回
// 当实现文件不存在时此 import 会抛出 Module not found，确保 Red

let validateStagingUrl;
try {
  const mod = await import('../../../scripts/canary-death-drill.mjs');
  validateStagingUrl = mod.validateStagingUrl;
} catch {
  // 实现尚未存在，用占位使后续测试真正 Red（会 throw）
  validateStagingUrl = undefined;
}

describe('BEHAVIOR-4: 生产端口守卫', () => {
  it('STAGING_BRAIN_URL 含 :5221 → 立即 exit 1，不发任何请求', async () => {
    if (!validateStagingUrl) throw new Error('not implemented: validateStagingUrl not exported from scripts/canary-death-drill.mjs');
    const fetchSpy = vi.fn();
    expect(() => validateStagingUrl('http://localhost:5221')).toThrow(':5221');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('STAGING_BRAIN_URL 为 :5222 → 守卫通过，允许执行注册流程', async () => {
    if (!validateStagingUrl) throw new Error('not implemented: validateStagingUrl not exported from scripts/canary-death-drill.mjs');
    expect(() => validateStagingUrl('http://localhost:5222')).not.toThrow();
  });
});

// ─── BEHAVIOR-5：OOM 注入分类断言 ─────────────────────────────────────────────

describe('BEHAVIOR-5: OOM 注入分类 + watchdog 处置断言', () => {
  it('exit_code=137 + oom_upgraded 未设 → cause=oom + attempt 递增 + oom_upgraded=true', async () => {
    // Red：canary-death-drill.mjs 未实现，此测试预期失败
    // 实现后替换为：
    //   const { runOomDrill } = await import('../../../scripts/canary-death-drill.mjs');
    //   const result = await runOomDrill({ taskId: 'canary-001', fetchFn: fetchStub, execFn: vi.fn() });
    //   expect(result.cause).toBe('oom');
    //   expect(result.oom_upgraded).toBe(true);
    //   expect(result.attempt).toBeGreaterThan(0);
    throw new Error('not implemented: runOomDrill not exported from scripts/canary-death-drill.mjs');
  });

  it('oom_upgraded=true + exit_code=137 → cause=oom + task.status=failed（oom_wall）', async () => {
    // Red：oom_wall 路径断言
    // 实现后替换为：
    //   const { runOomDrill } = await import('../../../scripts/canary-death-drill.mjs');
    //   const result = await runOomDrill({ taskId: 'c-001', oomUpgraded: true, fetchFn: fetchStub, execFn: vi.fn() });
    //   expect(result.status).toBe('failed');
    //   expect(result.cause).toBe('oom');
    throw new Error('not implemented: runOomDrill (oom_wall path) not exported from scripts/canary-death-drill.mjs');
  });
});

// ─── BEHAVIOR-6：落档降级写 design_docs ──────────────────────────────────────

describe('BEHAVIOR-6: 演习落档降级写 design_docs', () => {
  it('POST /api/brain/incidents 返回 404 → 降级写 design_docs，type=drill_report', async () => {
    // Red：canary-death-drill.mjs 未实现
    // 实现后替换为：
    //   const { archiveDrillResult } = await import('../../../scripts/canary-death-drill.mjs');
    //   await archiveDrillResult({ taskId: 'c-001', mode: 'oom', passed: true, fetchFn: fetchStub });
    //   expect(designDocCalls.length).toBeGreaterThan(0);
    //   expect(designDocCalls[0]).toContain('/design-docs');
    throw new Error('not implemented: archiveDrillResult not exported from scripts/canary-death-drill.mjs');
  });

  it('design_docs 写入内容含 injected_mode 和 results 字段', async () => {
    // Red：内容正确性断言
    // 实现后替换为：
    //   const fetchStub = makeFetchStub();
    //   const { archiveDrillResult } = await import('../../../scripts/canary-death-drill.mjs');
    //   await archiveDrillResult({ taskId: 'c-001', mode: 'oom', passed: true, fetchFn: fetchStub });
    //   const body = JSON.parse(fetchStub.mock.calls[0][1].body);
    //   expect(body).toHaveProperty('injected_mode');
    //   expect(body).toHaveProperty('results');
    throw new Error('not implemented: archiveDrillResult content validation — scripts/canary-death-drill.mjs not yet written');
  });
});

// ─── BEHAVIOR-7：Bark 失败告警 ────────────────────────────────────────────────

describe('BEHAVIOR-7: Bark 失败告警', () => {
  it('演习断言失败 → sendBark 调用1次，标题含 CanaryDrill Failed，内容含 task_id', async () => {
    // Red：notifyDrillFailure 尚未实现，先强制 Red
    // TODO: 实现后替换为：
    // const { notifyDrillFailure } = await import('../../../scripts/canary-death-drill.mjs');
    // const barkStub = makeBarkStub();
    // await notifyDrillFailure({ taskId: 'c-001', mode: 'oom', failedAssertions: ['cause !== oom'], barkFn: barkStub });
    // expect(barkStub).toHaveBeenCalledTimes(1);
    // expect(barkStub._calls[0].title).toContain('CanaryDrill Failed');
    // expect(barkStub._calls[0].body).toContain('task_id=');
    throw new Error('not implemented: notifyDrillFailure not exported from scripts/canary-death-drill.mjs');
  });

  it('BARK_URL 未设时 log warn 不 throw（告警可选，演习继续 exit 1）', async () => {
    // Red：notifyDrillFailure 尚未实现，先强制 Red
    // TODO: 实现后替换为：
    // const { notifyDrillFailure } = await import('../../../scripts/canary-death-drill.mjs');
    // await expect(notifyDrillFailure({ taskId: 'c-001', mode: 'oom', failedAssertions: [], barkFn: null }))
    //   .resolves.not.toThrow();
    // const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BARK_URL'));
    // warnSpy.mockRestore();
    throw new Error('not implemented: notifyDrillFailure not exported from scripts/canary-death-drill.mjs');
  });
});

// ─── BEHAVIOR-8：nightly tick job 幂等 ────────────────────────────────────────

describe('BEHAVIOR-8: nightly tick job 注册（幂等）', () => {
  it('UTC 19:25~19:35 窗口内 tick → 调用一次 canary-death-drill.mjs', async () => {
    // Red：canary-drill-scheduler.js 未实现
    // 实现后替换为：
    //   const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    //   const now = new Date('2026-07-16T19:30:00Z');
    //   await maybeScheduleCanaryDrill({ now, execFn: execStub, pool: makeDbStub() });
    //   expect(execCalls.length).toBe(1);
    //   expect(execCalls[0]).toContain('canary-death-drill.mjs');
    throw new Error('not implemented: maybeScheduleCanaryDrill not exported from packages/brain/src/canary-drill-scheduler.js');
  });

  it('同日历日第二次 tick → 不重复触发（幂等保护）', async () => {
    // Red：幂等去重断言
    // 实现后替换为：
    //   const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    //   dbStub.query.mockResolvedValueOnce({ rows: [{ id: 'canary-today' }] });
    //   await maybeScheduleCanaryDrill({ now: new Date('2026-07-16T19:30:00Z'), execFn: execStub, pool: dbStub });
    //   expect(execCalls.length).toBe(0);
    throw new Error('not implemented: maybeScheduleCanaryDrill idempotency — packages/brain/src/canary-drill-scheduler.js not yet written');
  });
});
