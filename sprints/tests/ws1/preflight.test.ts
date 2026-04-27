import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Round 3 改造：动态 import 下沉到每个 it 内部（用 loadPreflight() helper），
// 消除 vitest 版本敏感性 — 即使某个 vitest 版本把 beforeEach 抛错处理为整块 skip，
// 这里每个 it 在自己的执行体内独立 await import，独立 fail，不会被 hook 抛错传染。
const PREFLIGHT_MODULE = '../../../packages/brain/src/preflight.js';

async function loadPreflight(): Promise<any> {
  return await import(PREFLIGHT_MODULE);
}

describe('Workstream 1 — Initiative Pre-flight Description Length [BEHAVIOR]', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    delete process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    else process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = savedEnv;
  });

  it('returns ok=true when description length equals threshold', async () => {
    const preflight = await loadPreflight();
    const desc = 'a'.repeat(60);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(true);
  });

  it('returns ok=true when description length exceeds threshold', async () => {
    const preflight = await loadPreflight();
    const desc = 'b'.repeat(120);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with actualLength and threshold when description shorter than threshold', async () => {
    const preflight = await loadPreflight();
    const result = preflight.checkInitiativeDescription('short');
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(5);
    expect(result.threshold).toBe(60);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThanOrEqual(10);
  });

  it('returns ok=false when description is empty string', async () => {
    const preflight = await loadPreflight();
    const result = preflight.checkInitiativeDescription('');
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('returns ok=false when description is whitespace-only after trim', async () => {
    const preflight = await loadPreflight();
    const result = preflight.checkInitiativeDescription('   \t\n  ');
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('returns ok=false when description is null', async () => {
    const preflight = await loadPreflight();
    const result = preflight.checkInitiativeDescription(null);
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('returns ok=false when description is undefined', async () => {
    const preflight = await loadPreflight();
    const result = preflight.checkInitiativeDescription(undefined);
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(0);
  });

  it('counts CJK characters as one code point each (60 Chinese chars passes)', async () => {
    const preflight = await loadPreflight();
    const desc = '中'.repeat(60);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(true);
  });

  it('counts CJK characters as one code point each (59 Chinese chars fails with actualLength=59)', async () => {
    const preflight = await loadPreflight();
    const desc = '中'.repeat(59);
    const result = preflight.checkInitiativeDescription(desc);
    expect(result.ok).toBe(false);
    expect(result.actualLength).toBe(59);
  });

  it('counts emoji surrogate pair as one code point each', async () => {
    const preflight = await loadPreflight();
    const ok = preflight.checkInitiativeDescription('😀'.repeat(60));
    expect(ok.ok).toBe(true);
    const fail = preflight.checkInitiativeDescription('😀'.repeat(59));
    expect(fail.ok).toBe(false);
    expect(fail.actualLength).toBe(59);
  });

  it('uses options.threshold when provided, overriding env var', async () => {
    const preflight = await loadPreflight();
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '60';
    const passed = preflight.checkInitiativeDescription('hi', { threshold: 2 });
    expect(passed.ok).toBe(true);
    const failed = preflight.checkInitiativeDescription('h', { threshold: 2 });
    expect(failed.ok).toBe(false);
    expect(failed.threshold).toBe(2);
  });

  it('reads INITIATIVE_MIN_DESCRIPTION_LENGTH env var on each call (no caching)', async () => {
    const preflight = await loadPreflight();
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '5';
    expect(preflight.checkInitiativeDescription('hello').ok).toBe(true);
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '20';
    const r = preflight.checkInitiativeDescription('hello');
    expect(r.ok).toBe(false);
    expect(r.threshold).toBe(20);
  });

  it('falls back to default 60 when env var is missing', async () => {
    const preflight = await loadPreflight();
    delete process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH;
    expect(preflight.getMinDescriptionLength()).toBe(60);
    expect(preflight.DEFAULT_MIN_DESCRIPTION_LENGTH).toBe(60);
  });

  it('falls back to default 60 when env var is non-numeric', async () => {
    const preflight = await loadPreflight();
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = 'not-a-number';
    expect(preflight.getMinDescriptionLength()).toBe(60);
  });

  it('falls back to default 60 when env var is zero or negative', async () => {
    const preflight = await loadPreflight();
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '0';
    expect(preflight.getMinDescriptionLength()).toBe(60);
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '-5';
    expect(preflight.getMinDescriptionLength()).toBe(60);
  });

  it('produces identical result for repeated calls with same input (no side-effects)', async () => {
    const preflight = await loadPreflight();
    const r1 = preflight.checkInitiativeDescription('short text');
    const r2 = preflight.checkInitiativeDescription('short text');
    expect(r1).toEqual(r2);
  });

  it('buildPreflightFailureResult returns plain object with preflight_failure_reason key', async () => {
    const preflight = await loadPreflight();
    const result = preflight.buildPreflightFailureResult('hi');
    expect(result).toHaveProperty('preflight_failure_reason');
    expect(typeof result.preflight_failure_reason).toBe('object');
    expect(result.preflight_failure_reason).not.toBeNull();
  });

  it('preflight_failure_reason includes reason as string of length >= 10', async () => {
    const preflight = await loadPreflight();
    const result = preflight.buildPreflightFailureResult('hi');
    const r = result.preflight_failure_reason;
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThanOrEqual(10);
  });

  it('preflight_failure_reason.actualLength is trimmed code-point count', async () => {
    const preflight = await loadPreflight();
    const result = preflight.buildPreflightFailureResult('  中文  ');
    expect(result.preflight_failure_reason.actualLength).toBe(2);
  });

  it('preflight_failure_reason.threshold reflects effective threshold (env or option override)', async () => {
    const preflight = await loadPreflight();
    process.env.INITIATIVE_MIN_DESCRIPTION_LENGTH = '15';
    const fromEnv = preflight.buildPreflightFailureResult('short');
    expect(fromEnv.preflight_failure_reason.threshold).toBe(15);
    const fromOption = preflight.buildPreflightFailureResult('short', { threshold: 99 });
    expect(fromOption.preflight_failure_reason.threshold).toBe(99);
  });

  it('buildPreflightFailureResult does not throw on null / undefined description', async () => {
    const preflight = await loadPreflight();
    expect(() => preflight.buildPreflightFailureResult(null)).not.toThrow();
    expect(() => preflight.buildPreflightFailureResult(undefined)).not.toThrow();
    const r = preflight.buildPreflightFailureResult(null);
    expect(r.preflight_failure_reason.actualLength).toBe(0);
  });

  // ===== Round 3 新增：dispatch gate 集成 BEHAVIOR =====
  // 关闭 R2 反馈中 scope_match_prd = 7 → ≥ 8 的"不创建子任务"语义证明缺口。
  // applyDispatchPreflight 是 dispatcher.js 派发 harness pipeline task_type 的 gate 函数，
  // 通过 DI 注入 createSubtask 让 mock 可直接断言"未被调用"。

  it('applyDispatchPreflight does not call createSubtask when description shorter than threshold', async () => {
    const preflight = await loadPreflight();
    const createSubtask = vi.fn();
    const task = { id: 't-short', description: 'short' };
    const result = await preflight.applyDispatchPreflight({ task, createSubtask });
    expect(result.status).toBe('rejected_preflight');
    expect(result.result).toBeDefined();
    expect(result.result.preflight_failure_reason).toBeDefined();
    expect(createSubtask).not.toHaveBeenCalled();
  });

  it('applyDispatchPreflight calls createSubtask exactly once when description passes threshold', async () => {
    const preflight = await loadPreflight();
    const createSubtask = vi.fn().mockResolvedValue({ id: 'sub-1' });
    const task = { id: 't-ok', description: 'a'.repeat(60) };
    const result = await preflight.applyDispatchPreflight({ task, createSubtask });
    expect(result.status).toBe('dispatched');
    expect(createSubtask).toHaveBeenCalledTimes(1);
  });

  it('applyDispatchPreflight rejected result includes preflight_failure_reason with reason/actualLength/threshold all populated', async () => {
    const preflight = await loadPreflight();
    const createSubtask = vi.fn();
    const task = { id: 't-detail', description: 'short' };
    const result = await preflight.applyDispatchPreflight({ task, createSubtask });
    const r = result.result.preflight_failure_reason;
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThanOrEqual(10);
    expect(r.actualLength).toBe(5);
    expect(r.threshold).toBe(60);
    expect(createSubtask).not.toHaveBeenCalled();
  });
});
