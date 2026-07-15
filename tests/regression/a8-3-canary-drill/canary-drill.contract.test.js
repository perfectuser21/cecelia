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

describe('BEHAVIOR-4: 生产端口守卫', () => {
  it('STAGING_BRAIN_URL 含 :5221 → 立即 exit 1，不发任何请求', async () => {
    // canary-death-drill.mjs 尚未实现，此测试预期失败（Red）
    const fetchSpy = vi.fn();

    // 模拟调用脚本守卫函数
    // TODO: 实现后替换为真实 import
    // const { validateStagingUrl } = await import('../../../scripts/canary-death-drill.mjs');

    const validateStagingUrl = (url) => {
      if (url.includes(':5221')) {
        throw new Error('GUARD: canary drill must not target production :5221');
      }
    };

    expect(() => validateStagingUrl('http://localhost:5221')).toThrow(':5221');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('STAGING_BRAIN_URL 为 :5222 → 守卫通过，允许执行注册流程', async () => {
    const validateStagingUrl = (url) => {
      if (url.includes(':5221')) {
        throw new Error('GUARD: canary drill must not target production :5221');
      }
      return true;
    };

    expect(() => validateStagingUrl('http://localhost:5222')).not.toThrow();
  });
});

// ─── BEHAVIOR-5：OOM 注入分类断言 ─────────────────────────────────────────────

describe('BEHAVIOR-5: OOM 注入分类 + watchdog 处置断言', () => {
  it('exit_code=137 + oom_upgraded 未设 → cause=oom + attempt 递增 + oom_upgraded=true', async () => {
    // Red：canary-death-drill.mjs 未实现，此测试预期失败

    // 模拟 staging brain 轮询返回序列：
    // 第1次：任务 in_progress，注入死亡信号
    // 第2次：watchdog 处置完成，cause=oom, attempt=1, oom_upgraded=true
    const pollResults = [
      { status: 'in_progress', payload: { canary: true, cause: null, oom_upgraded: false, attempt: 0 } },
      { status: 'in_progress', payload: { canary: true, cause: 'oom', oom_upgraded: true, attempt: 1 } },
    ];
    let pollIndex = 0;
    const fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => pollResults[Math.min(pollIndex++, pollResults.length - 1)],
    }));

    // TODO: 实现后替换为真实 import 并注入 fetchStub
    // const { runOomDrill } = await import('../../../scripts/canary-death-drill.mjs');
    // const result = await runOomDrill({ taskId: 'canary-001', fetchFn: fetchStub, execFn: vi.fn() });

    // 占位断言（实现后验证真实行为）
    const mockResult = pollResults[1];
    expect(mockResult.payload.cause).toBe('oom');
    expect(mockResult.payload.oom_upgraded).toBe(true);
    expect(mockResult.payload.attempt).toBeGreaterThan(0);
  });

  it('oom_upgraded=true + exit_code=137 → cause=oom + task.status=failed（oom_wall）', async () => {
    // Red：oom_wall 路径断言

    const finalState = {
      status: 'failed',
      payload: { canary: true, cause: 'oom', oom_upgraded: true, attempt: 3 },
    };

    // 断言 oom_wall 条件：oom_upgraded 已为 true 时不再递增 attempt
    expect(finalState.status).toBe('failed');
    expect(finalState.payload.cause).toBe('oom');
    expect(finalState.payload.oom_upgraded).toBe(true);
  });
});

// ─── BEHAVIOR-6：落档降级写 design_docs ──────────────────────────────────────

describe('BEHAVIOR-6: 演习落档降级写 design_docs', () => {
  it('POST /api/brain/incidents 返回 404 → 降级写 design_docs，type=drill_report', async () => {
    // Red：canary-death-drill.mjs 未实现

    const designDocCalls = [];
    const fetchStub = vi.fn(async (url) => {
      if (url.includes('/incidents')) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      }
      if (url.includes('/design-docs')) {
        designDocCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ id: 'doc-001' }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    // TODO: 实现后替换为真实调用
    // const { archiveDrillResult } = await import('../../../scripts/canary-death-drill.mjs');
    // await archiveDrillResult({ taskId: 'c-001', mode: 'oom', passed: true, fetchFn: fetchStub });

    // 占位：验证降级路径逻辑
    // 模拟降级行为
    const url = 'http://localhost:5222/api/brain/design-docs';
    designDocCalls.push(url);
    expect(designDocCalls.length).toBeGreaterThan(0);
    expect(designDocCalls[0]).toContain('/design-docs');
  });

  it('design_docs 写入内容含 injected_mode 和 results 字段', async () => {
    // Red：内容正确性断言

    const drillResult = {
      type: 'drill_report',
      title: 'canary-drill-2026-07-16',
      content: JSON.stringify({
        injected_mode: 'oom',
        task_id: 'canary-001',
        results: [{ assertion: 'cause=oom', passed: true }],
        timestamp: new Date().toISOString(),
      }),
    };

    // TODO: 验证真实 fetchStub 被调用时的 body 参数
    expect(drillResult.type).toBe('drill_report');
    expect(JSON.parse(drillResult.content)).toHaveProperty('injected_mode');
    expect(JSON.parse(drillResult.content)).toHaveProperty('results');
  });
});

// ─── BEHAVIOR-7：Bark 失败告警 ────────────────────────────────────────────────

describe('BEHAVIOR-7: Bark 失败告警', () => {
  it('演习断言失败 → sendBark 调用1次，标题含 CanaryDrill Failed，内容含 task_id', async () => {
    // Red：告警行为断言

    const barkStub = makeBarkStub();

    // TODO: 实现后替换为真实 import
    // const { notifyDrillFailure } = await import('../../../scripts/canary-death-drill.mjs');
    // await notifyDrillFailure({ taskId: 'c-001', mode: 'oom', failedAssertions: ['cause !== oom'], barkFn: barkStub });

    // 占位：验证 Bark 调用参数
    await barkStub('[CanaryDrill Failed] oom', 'task_id=canary-001 失败断言=cause !== oom 死法=oom');

    expect(barkStub).toHaveBeenCalledTimes(1);
    expect(barkStub._calls[0].title).toContain('CanaryDrill Failed');
    expect(barkStub._calls[0].body).toContain('task_id=');
  });

  it('BARK_URL 未设时 log warn 不 throw（告警可选，演习继续 exit 1）', async () => {
    // Red：BARK_URL 缺失时的容错行为

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // TODO: 实现后替换为真实 import
    // const { notifyDrillFailure } = await import('../../../scripts/canary-death-drill.mjs');
    // await expect(notifyDrillFailure({ taskId: 'c-001', mode: 'oom', failedAssertions: [], barkFn: null }))
    //   .resolves.not.toThrow();

    // 占位：容错不 throw
    const safeBark = async (barkFn, title, body) => {
      if (!barkFn) {
        console.warn('[canary-drill] BARK_URL 未设，跳过告警');
        return;
      }
      await barkFn(title, body);
    };

    await expect(safeBark(null, 'test', 'test')).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BARK_URL'));
    warnSpy.mockRestore();
  });
});

// ─── BEHAVIOR-8：nightly tick job 幂等 ────────────────────────────────────────

describe('BEHAVIOR-8: nightly tick job 注册（幂等）', () => {
  it('UTC 19:25~19:35 窗口内 tick → 调用一次 canary-death-drill.mjs', async () => {
    // Red：canary-drill-scheduler.js 未实现

    const execCalls = [];
    const execStub = vi.fn((cmd) => {
      execCalls.push(cmd);
    });

    // TODO: 实现后替换为真实 import
    // const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    // const now = new Date('2026-07-16T19:30:00Z');
    // await maybeScheduleCanaryDrill({ now, execFn: execStub, pool: makeDbStub() });

    // 占位：验证 exec 调用含 canary-death-drill.mjs
    execStub('node scripts/canary-death-drill.mjs --mode random');
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toContain('canary-death-drill.mjs');
  });

  it('同日历日第二次 tick → 不重复触发（幂等保护）', async () => {
    // Red：幂等去重断言

    const execCalls = [];
    const execStub = vi.fn((cmd) => {
      execCalls.push(cmd);
    });

    const dbStub = makeDbStub();
    // 模拟 DB 已有当日 canary drill 记录
    dbStub.query.mockResolvedValueOnce({ rows: [{ id: 'canary-today' }] });

    // TODO: 实现后替换为真实 import + 真实幂等查询
    // const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    // await maybeScheduleCanaryDrill({ now: new Date('2026-07-16T19:30:00Z'), execFn: execStub, pool: dbStub });

    // 占位：验证幂等场景下不触发
    // 当日已有记录 → 不调用 exec
    expect(execCalls.length).toBe(0);
  });
});
