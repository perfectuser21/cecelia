// F1「工厂 · 开发闭环」质量层 —— 判定器金标集 v0 + eval 通过率棘轮 + 4 条纯代码用例
//
// 独立小路（无父路）：本 sprint 是 F1 scope 下新增的判定器质量闸，不推进既有 Golden Path
// 步骤，只为判定器（judge / 视觉判定器）装上"只升不降"的 CI 通过率棘轮与 4 条防退化用例。
//
// 冻结合同测试（proposer RED）：断言 tests/gp/f1/eval/harness-visual-eval.mjs 这层
// **被本 sprint 新增/改动的边**（eval 计分 / 缓存零视觉 / null fail-closed / 棘轮单调 /
// 契约完备 lint / 步骤序列固化）的真实行为。judge/视觉模型调用是**外层边界**（本 sprint
// 不新增视觉 provider、judge 只读被调用），以注入的 stub 承载 —— 见合同「未覆盖真实链路清单」。
//
// 现状 RED：harness-visual-eval.mjs 尚未实现 → import 即失败（红证据）。
import { describe, it, expect, vi } from 'vitest';
import {
  EVAL_STEPS,
  evalGoldenSet,
  failClosedJudge,
  cachedJudge,
  checkRatchet,
  assertMonotonic,
  lintSkillContract,
} from '../../../tests/gp/f1/eval/harness-visual-eval.mjs';

// 内联金标集 v0（09-05 A/B 五类标注）——自含，冻结测试不依赖 fixture 文件读盘
function goldenV0() {
  return [
    { id: 'user-list', screenshot: 'user-list.png', label: 'true' },
    { id: 'desktop', screenshot: 'desktop.png', label: 'false' },
    { id: 'calculator', screenshot: 'calculator.png', label: 'false' },
    { id: 'search-history', screenshot: 'search-history.png', label: 'false' },
    { id: 'lenovo-suggest', screenshot: 'lenovo-suggest.png', label: 'false' },
  ];
}

// 完美参考判定器：verdict 与 ground-truth 完全一致
function perfectJudge(entry: any) {
  return entry.label;
}

describe('判定器金标集 v0 + eval 通过率棘轮 [BEHAVIOR]', () => {
  it('B-01 eval 金标集 v0 通过率可算出且 ≥ 入库阈值', () => {
    const r = evalGoldenSet({ manifest: goldenV0(), judge: perfectJudge });
    expect(r.total).toBe(5);
    expect(r.correct).toBe(5);
    expect(r.passRate).toBeCloseTo(1.0, 5);
    // 阈值以 v0 参考通过率为下限（本例 1.0），≥ 判 PASS
    expect(r.passRate).toBeGreaterThanOrEqual(0.8);
  });

  it('B-02 降阈提交被棘轮拦截（阈值只升不降）', () => {
    // 恰等 → PASS 不上调；更高 → PASS 且上调；更低 → FAIL
    expect(checkRatchet({ current: 100, watermark: 100 }).ok).toBe(true);
    expect(checkRatchet({ current: 100, watermark: 100 }).bumped).toBe(false);
    const up = checkRatchet({ current: 120, watermark: 100 });
    expect(up.ok).toBe(true);
    expect(up.bumped).toBe(true);
    expect(up.newWatermark).toBe(120);
    expect(checkRatchet({ current: 80, watermark: 100 }).ok).toBe(false);
    // 直接下调水位（降阈提交）必被拒
    expect(() => assertMonotonic(100, 80)).toThrow();
    expect(assertMonotonic(100, 100)).toBe(100);
    expect(assertMonotonic(100, 120)).toBe(120);
  });

  it('B-03 缓存命中二次判定视觉调用计数为 0（防成本回归）', () => {
    const spy = vi.fn((entry: any) => entry.label);
    const cached = cachedJudge(spy);
    const entry = goldenV0()[0];
    cached(entry); // 首次：产生 1 次视觉调用
    const before = spy.mock.calls.length;
    cached(entry); // 二次同输入：不得再产生视觉调用
    const delta = spy.mock.calls.length - before;
    expect(before).toBe(1);
    expect(delta).toBe(0);
    expect(cached.visionCallCount).toBe(1);
  });

  it('B-04 视觉返回 null 必 fail-closed 判 FAIL（不假绿）', () => {
    const j = failClosedJudge(() => null);
    expect(j(goldenV0()[0])).toBe('FAIL');
    // 整体 eval：null verdict 永不计入正确，通过率随之下降，绝不假绿
    const r = evalGoldenSet({ manifest: goldenV0(), judge: () => null });
    expect(r.correct).toBe(0);
    expect(r.passRate).toBe(0);
    expect(r.failures.length).toBe(5);
  });

  it('B-05 契约缺 pre/post/side_effects 任一段触发 lint FAIL', () => {
    expect(lintSkillContract({ pre: 'x', post: 'y', side_effects: 'z' }).ok).toBe(true);
    const miss = lintSkillContract({ pre: 'x', post: 'y' });
    expect(miss.ok).toBe(false);
    expect(miss.missing).toContain('side_effects');
    // 空段也算缺段
    expect(lintSkillContract({ pre: 'x', post: '', side_effects: 'z' }).ok).toBe(false);
  });

  it('B-06 判定步骤序列固化不漂移', () => {
    expect(EVAL_STEPS).toEqual([
      'load_manifest',
      'validate_labels',
      'judge_each',
      'compare_labels',
      'compute_pass_rate',
      'ratchet_check',
    ]);
  });

  it('B-07 金标集为空/标签缺失 → eval 直接 FAIL（不空跑判绿）', () => {
    expect(() => evalGoldenSet({ manifest: [], judge: perfectJudge })).toThrow();
    const bad = [{ id: 'x', screenshot: 'x.png' }]; // 缺 label
    expect(() => evalGoldenSet({ manifest: bad as any, judge: perfectJudge })).toThrow();
  });
});
