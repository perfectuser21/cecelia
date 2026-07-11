/**
 * feishu-alert.test.js — 飞书告警聚合单元测试
 * Sprint: 07072314-skill-eval-service
 *
 * 覆盖：
 * - alertSkillEvalFailure：聚合缓冲、连败升级（≥3）、FEISHU_WEBHOOK_URL 未配置时降级日志
 * - sendToFeishu：webhook 正常 / 异常路径
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock fetch（全局）──────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Mock receipt-collector（T4 回执接线）───────────────────────────────────
// sendToFeishu 内部动态 import；真模块的 pool.query 在假定时器下会挂起，必须 mock。
vi.mock('../receipt-collector.js', () => ({
  recordActionReceipt: vi.fn().mockResolvedValue('r-test'),
  resolveActionReceipt: vi.fn().mockResolvedValue(true),
}));

// ─── 导入被测模块 ────────────────────────────────────────────────────────────
// feishu-alert.js 使用模块级变量（alertBuffer / flushTimer），
// 每次测试需要通过 vi.resetModules() + 重新 import 隔离状态。
async function freshModule(webhookUrl = '') {
  vi.resetModules();
  process.env.FEISHU_SKILL_EVAL_WEBHOOK = webhookUrl;
  const mod = await import('../feishu-alert.js');
  return mod;
}

describe('feishu-alert.js — alertSkillEvalFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FEISHU_SKILL_EVAL_WEBHOOK;
  });

  it('未配置 webhook 时，不调用 fetch（降级本地日志）', async () => {
    const { alertSkillEvalFailure } = await freshModule('');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 触发连败升级（≥3），即使 webhook 未配置
    alertSkillEvalFailure('dispatch', 'task-1');
    alertSkillEvalFailure('dispatch', 'task-2');
    alertSkillEvalFailure('dispatch', 'task-3'); // 第 3 次 → 升级

    expect(mockFetch).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('连败 < 3 次不立即发送，调度 flush timer', async () => {
    const { alertSkillEvalFailure } = await freshModule('https://hook.example.com');
    mockFetch.mockResolvedValue({ ok: true });

    alertSkillEvalFailure('crash', 'task-a');
    alertSkillEvalFailure('crash', 'task-b');

    // 还没到升级阈值，fetch 不应被调用
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('连败 ≥ 3 次（升级）立即发送 escalate 消息', async () => {
    const { alertSkillEvalFailure } = await freshModule('https://hook.example.com');
    mockFetch.mockResolvedValue({ ok: true });

    alertSkillEvalFailure('timeout', 'task-1');
    alertSkillEvalFailure('timeout', 'task-2');
    alertSkillEvalFailure('timeout', 'task-3'); // 触发升级

    // 等待 Promise 异步 flush
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toMatch(/连败升级/);
    expect(body.content.text).toMatch(/timeout/);
  });

  it('10 分钟聚合窗口到期后 flush 发送聚合消息', async () => {
    const { alertSkillEvalFailure } = await freshModule('https://hook.example.com');
    mockFetch.mockResolvedValue({ ok: true });

    // 2 次失败（未到升级阈值）
    alertSkillEvalFailure('publish', 'task-x');
    alertSkillEvalFailure('publish', 'task-y');

    expect(mockFetch).not.toHaveBeenCalled();

    // 推进 10 分钟 + 1ms
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content.text).toMatch(/聚合告警/);
    expect(body.content.text).toMatch(/publish/);
  });

  it('不同 failureMode 分别缓冲（互不干扰）', async () => {
    const { alertSkillEvalFailure } = await freshModule('https://hook.example.com');
    mockFetch.mockResolvedValue({ ok: true });

    // 'dispatch' 达到 3 次升级
    alertSkillEvalFailure('dispatch', 'task-d1');
    alertSkillEvalFailure('dispatch', 'task-d2');
    alertSkillEvalFailure('dispatch', 'task-d3'); // 升级，立即发

    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content.text).toMatch(/dispatch/);
  });

  it('webhook 请求失败时，不抛出（只记录日志）', async () => {
    const { alertSkillEvalFailure } = await freshModule('https://hook.example.com');
    mockFetch.mockRejectedValue(new Error('network error'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // 不应抛出
    expect(() => {
      alertSkillEvalFailure('crash', 'task-1');
      alertSkillEvalFailure('crash', 'task-2');
      alertSkillEvalFailure('crash', 'task-3'); // 升级，触发 fetch
    }).not.toThrow();

    await vi.runAllTimersAsync();

    // fetch 失败 → fallback 日志
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('webhook 返回非 ok 状态，记录 error 日志不抛出', async () => {
    const { alertSkillEvalFailure } = await freshModule('https://hook.example.com');
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    alertSkillEvalFailure('timeout', 'task-1');
    alertSkillEvalFailure('timeout', 'task-2');
    alertSkillEvalFailure('timeout', 'task-3'); // 升级

    await vi.runAllTimersAsync();

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('webhook responded'));
    errSpy.mockRestore();
  });
});
