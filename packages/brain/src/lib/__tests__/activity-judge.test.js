/**
 * 自动裁判（五块模型·裁判，决策 de6dff5d）：spans 入库后去抖异步对涉及的 Activity 跑收敛对账并只追加落库。
 * 这里锁：落库字段、版本取最新 span 的定义版本、去抖合并、出任何错只记日志绝不抛给写入路径、可关。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  judgeActivity, flushJudgments, onSpansWritten, resetJudgeScheduler, activityTargetsForSpans,
} from '../activity-judge.js';

const ACT = 'b0000000-0000-4000-8000-000000000001';
const ACT2 = 'b0000000-0000-4000-8000-000000000002';
const VER = 'c0000000-0000-4000-8000-000000000001';
const report = (over = {}) => ({
  activity_id: ACT, verdict: 'converging', converged: false, consecutive_green: 2, required_green: 5,
  runs: [{ run_id: 'r9', green: true }, { run_id: 'r8', green: true }], per_step: [], issues: [], ...over,
});
const fakeDb = (handlers) => {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) if (re.test(sql)) return fn(params);
      return { rows: [] };
    }),
  };
};
const silent = { warn: vi.fn(), error: vi.fn() };

beforeEach(() => { silent.warn.mockReset(); silent.error.mockReset(); });
afterEach(() => { resetJudgeScheduler(); vi.useRealTimers(); delete process.env.ACTIVITY_JUDGE_AUTO; });

describe('judgeActivity', () => {
  it('对账 → 取窗口内最新定义版本 → 只追加一行 activity_judgments，返回带 judgment_id 的报告', async () => {
    const db = fakeDb([
      [/FROM spans/, () => ({ rows: [{ version_id: VER }, { version_id: 'c0000000-0000-4000-8000-000000000000' }] })],
      [/INSERT INTO activity_judgments/, () => ({ rows: [{ id: 'j1', judged_at: '2026-10-10T00:00:00Z' }] })],
    ]);
    const reconcile = vi.fn(async () => report());
    const applyCell = vi.fn(async () => {});
    const out = await judgeActivity(db, ACT, { trigger: 'auto', triggerRef: 'r9', reconcile, applyCell, runsWanted: 6, requiredGreen: 5 });
    expect(reconcile).toHaveBeenCalledWith(db, ACT, { runsWanted: 6, requiredGreen: 5, applyCell: false });
    expect(applyCell).toHaveBeenCalledWith(db, ACT, 'converging');
    const ins = db.calls.find(c => /INSERT INTO activity_judgments/.test(c.sql));
    expect(ins.params.slice(0, 9)).toEqual([ACT, VER, 'converging', false, 2, 5, 2, 'auto', 'r9']);
    const stored = JSON.parse(ins.params[9]);
    expect(stored.window_version_ids).toHaveLength(2);
    expect(stored.verdict).toBe('converging');
    expect(out).toMatchObject({ judgment_id: 'j1', activity_definition_version_id: VER, verdict: 'converging' });
    expect(db.calls.some(c => /UPDATE activity_judgments|DELETE FROM activity_judgments/.test(c.sql))).toBe(false);
  });

  it('窗口内没有带版本的 span（旧协议）→ 版本留空照记', async () => {
    const db = fakeDb([[/INSERT INTO activity_judgments/, () => ({ rows: [{ id: 'j2', judged_at: 'x' }] })]]);
    const out = await judgeActivity(db, ACT, { reconcile: async () => report({ verdict: 'diverged' }) });
    expect(out.activity_definition_version_id).toBeNull();
    const ins = db.calls.find(c => /INSERT INTO activity_judgments/.test(c.sql));
    expect(ins.params[7]).toBe('manual');
  });

  it('自动触发且没有可对账的数据（no_data）→ 不落库，避免噪音', async () => {
    const db = fakeDb([]);
    const out = await judgeActivity(db, ACT, { trigger: 'auto', reconcile: async () => report({ verdict: 'no_data', runs: [], consecutive_green: 0 }) });
    expect(out).toMatchObject({ skipped: 'no_data', judgment_id: null });
    expect(db.calls.some(c => /INSERT INTO activity_judgments/.test(c.sql))).toBe(false);
  });
});

describe('judgeActivity：运行没跑完不裁判（按 Step 逐条上报的运行）', () => {
  const NOW = Date.parse('2026-10-10T01:00:00Z');
  const run = (run_id, statuses, lastAgoMs) => ({
    run_id, green: statuses.every(s => s === 'verified'), last_span_at: new Date(NOW - lastAgoMs).toISOString(),
    steps: statuses.map((status, i) => ({ key: `k${i}`, step_id: `s${i}`, status })),
  });
  const partial = (over = {}) => report({
    verdict: 'diverged', consecutive_green: 0,
    runs: [run('r3', ['verified', 'missing'], 60_000), run('r2', ['verified', 'verified'], 3_600_000)], ...over,
  });
  const insertDb = () => fakeDb([[/INSERT INTO activity_judgments/, () => ({ rows: [{ id: 'j9', judged_at: 'x' }] })]]);

  it('触发运行还有 Step 没上报、没有失败、最后一条 span 在静默期内 → 推迟：不落库、不翻色，告诉调度器多久后再判', async () => {
    const db = insertDb();
    const applyCell = vi.fn();
    const out = await judgeActivity(db, ACT, {
      trigger: 'auto', triggerRef: 'r3', reconcile: async () => partial(), applyCell, now: NOW, runIdleMs: 600_000,
    });
    expect(out).toMatchObject({ deferred: true, judgment_id: null, run_id: 'r3', retry_after_ms: 540_000 });
    expect(db.calls.some(c => /INSERT INTO activity_judgments/.test(c.sql))).toBe(false);
    expect(applyCell).not.toHaveBeenCalled();
  });

  it('静默期默认 10 分钟，可用 ACTIVITY_JUDGE_RUN_IDLE_MS 调', async () => {
    const applyCell = vi.fn();
    const def = await judgeActivity(insertDb(), ACT, { trigger: 'auto', triggerRef: 'r3', reconcile: async () => partial(), applyCell, now: NOW });
    expect(def).toMatchObject({ deferred: true, retry_after_ms: 540_000 });
    process.env.ACTIVITY_JUDGE_RUN_IDLE_MS = '30000';
    try {
      const out = await judgeActivity(insertDb(), ACT, { trigger: 'auto', triggerRef: 'r3', reconcile: async () => partial(), applyCell, now: NOW });
      expect(out.deferred).toBeUndefined();
      expect(out.judgment_id).toBe('j9');
    } finally { delete process.env.ACTIVITY_JUDGE_RUN_IDLE_MS; }
  });

  it('过了静默期还缺步 → 确实缺步，按真实结果落库并翻色', async () => {
    const db = insertDb();
    const applyCell = vi.fn(async () => {});
    const out = await judgeActivity(db, ACT, {
      trigger: 'auto', triggerRef: 'r3', applyCell, now: NOW, runIdleMs: 600_000,
      reconcile: async () => partial({ runs: [run('r3', ['verified', 'missing'], 700_000)] }),
    });
    expect(out).toMatchObject({ verdict: 'diverged', judgment_id: 'j9' });
    expect(out.deferred).toBeUndefined();
    expect(applyCell).toHaveBeenCalledWith(db, ACT, 'diverged');
  });

  it('触发运行已有 Step 失败 → 结局已定，不等，直接落库', async () => {
    const applyCell = vi.fn(async () => {});
    const out = await judgeActivity(insertDb(), ACT, {
      trigger: 'auto', triggerRef: 'r3', applyCell, now: NOW, runIdleMs: 600_000,
      reconcile: async () => partial({ runs: [run('r3', ['failed', 'missing'], 1_000)] }),
    });
    expect(out.judgment_id).toBe('j9');
    expect(applyCell).toHaveBeenCalledWith(expect.anything(), ACT, 'diverged');
  });

  it('手动裁判不推迟，照旧由 reconcileActivity 自己翻色', async () => {
    const reconcile = vi.fn(async () => partial());
    const applyCell = vi.fn();
    const out = await judgeActivity(insertDb(), ACT, { triggerRef: 'r3', reconcile, applyCell, now: NOW });
    expect(out.judgment_id).toBe('j9');
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), ACT, { runsWanted: 5, requiredGreen: 5 });
    expect(applyCell).not.toHaveBeenCalled();
  });

  it('翻色出错不影响落库（只记日志）', async () => {
    const out = await judgeActivity(insertDb(), ACT, {
      trigger: 'auto', triggerRef: 'r9', reconcile: async () => report(), log: silent,
      applyCell: async () => { throw new Error('cell boom'); },
    });
    expect(out.judgment_id).toBe('j9');
    expect(silent.warn).toHaveBeenCalled();
  });
});

describe('activityTargetsForSpans', () => {
  it('Step 级 span 没带 activity_id 时经 steps 表找归属 Activity，去重并带最新 run_id', async () => {
    const db = fakeDb([[/FROM spans/, () => ({ rows: [{ activity_id: ACT, run_id: 'r1' }, { activity_id: null, run_id: 'r2' }] })]]);
    expect(await activityTargetsForSpans(db, ['s1', 's2'])).toEqual([{ activity_id: ACT, run_id: 'r1' }]);
    expect(db.calls[0].sql).toMatch(/LEFT JOIN steps/);
    expect(await activityTargetsForSpans(db, [])).toEqual([]);
  });
});

describe('flushJudgments', () => {
  it('逐个 Activity 裁判；单个出错只记日志，其余照跑', async () => {
    const db = fakeDb([[/FROM spans/, () => ({ rows: [{ activity_id: ACT, run_id: 'r1' }, { activity_id: ACT2, run_id: 'r2' }] })]]);
    const judge = vi.fn(async (_db, id) => { if (id === ACT) throw new Error('boom'); return { activity_id: id, judgment_id: 'j' }; });
    const out = await flushJudgments(db, ['s1'], { judge, log: silent });
    expect(judge).toHaveBeenCalledTimes(2);
    expect(judge).toHaveBeenCalledWith(db, ACT2, { trigger: 'auto', triggerRef: 'r2' });
    expect(out).toEqual([{ activity_id: ACT, error: 'boom' }, { activity_id: ACT2, judgment_id: 'j' }]);
    expect(silent.warn).toHaveBeenCalled();
  });

  it('被推迟的运行作为额外目标重新裁判；同一 Activity 有新 span 时以新 span 的运行为准，不重复判', async () => {
    const db = fakeDb([[/FROM spans/, () => ({ rows: [{ activity_id: ACT, run_id: 'r4' }] })]]);
    const judge = vi.fn(async (_db, id, o) => ({ activity_id: id, run_id: o.triggerRef }));
    const out = await flushJudgments(db, ['s1'], { judge, log: silent, extraTargets: [{ activity_id: ACT, run_id: 'r3' }, { activity_id: ACT2, run_id: 'r7' }] });
    expect(judge).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ activity_id: ACT, run_id: 'r4' }, { activity_id: ACT2, run_id: 'r7' }]);
    const onlyExtra = await flushJudgments(fakeDb([]), [], { judge, log: silent, extraTargets: [{ activity_id: ACT2, run_id: 'r7' }] });
    expect(onlyExtra).toEqual([{ activity_id: ACT2, run_id: 'r7' }]);
  });

  it('查归属 Activity 都失败 → 不抛，返回空', async () => {
    const db = { query: vi.fn(async () => { throw new Error('db down'); }) };
    await expect(flushJudgments(db, ['s1'], { log: silent })).resolves.toEqual([]);
    expect(silent.warn).toHaveBeenCalled();
  });
});

describe('onSpansWritten（挂在 POST /spans 主路径上的钩子）', () => {
  it('去抖：窗口内多批 span 合并成一次裁判', async () => {
    vi.useFakeTimers();
    const db = fakeDb([[/FROM spans/, (p) => ({ rows: [{ activity_id: ACT, run_id: 'r1', n: p[0].length }] })]]);
    const judge = vi.fn(async () => ({}));
    expect(onSpansWritten(db, { ids: ['s1'] }, { debounceMs: 1000, judge, log: silent })).toBe(true);
    expect(onSpansWritten(db, { ids: ['s2', 's3'] }, { debounceMs: 1000, judge, log: silent })).toBe(true);
    expect(judge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(db.calls[0].params[0].sort()).toEqual(['s1', 's2', 's3']);
  });

  it('被推迟的运行过了静默期自动再判一次，不需要新 span 触发；判完不再重复', async () => {
    vi.useFakeTimers();
    const db = fakeDb([[/FROM spans/, () => ({ rows: [{ activity_id: ACT, run_id: 'r3' }] })]]);
    const judge = vi.fn()
      .mockResolvedValueOnce({ activity_id: ACT, deferred: true, run_id: 'r3', retry_after_ms: 5_000 })
      .mockResolvedValueOnce({ activity_id: ACT, judgment_id: 'j1' });
    onSpansWritten(db, { ids: ['s1'] }, { debounceMs: 1000, judge, log: silent });
    await vi.advanceTimersByTimeAsync(1001);
    expect(judge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(judge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(judge).toHaveBeenCalledTimes(2);
    expect(judge).toHaveBeenLastCalledWith(db, ACT, { trigger: 'auto', triggerRef: 'r3' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('没有新插入的 span（全是重复上报）→ 不排裁判', () => {
    expect(onSpansWritten(fakeDb([]), { ids: [] }, { log: silent })).toBe(false);
    expect(onSpansWritten(fakeDb([]), null, { log: silent })).toBe(false);
  });

  it('ACTIVITY_JUDGE_AUTO=off 可整体关掉', () => {
    process.env.ACTIVITY_JUDGE_AUTO = 'off';
    expect(onSpansWritten(fakeDb([]), { ids: ['s1'] }, { log: silent })).toBe(false);
  });

  it('钩子内部异常（参数坏掉）绝不抛给调用方', () => {
    expect(() => onSpansWritten(fakeDb([]), { ids: 'not-an-array' }, { log: silent })).not.toThrow();
  });

  it('裁判本身异步炸了也不产生未处理的拒绝', async () => {
    vi.useFakeTimers();
    const db = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    onSpansWritten(db, { ids: ['s1'] }, { debounceMs: 10, log: silent });
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(silent.warn).toHaveBeenCalled();
  });
});
