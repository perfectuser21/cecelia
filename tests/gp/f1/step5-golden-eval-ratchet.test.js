// F1「工厂 · 开发闭环」质量层 —— 判定器金标集 v0 + eval 通过率棘轮（永久 CI 回归）
//
// 与既有 tests/gp/f1/step3-judge-*.test.js 同域的永久回归用例（generator port）。
// 本文件是 Test Contract 表第二行所列的真实测试文件（seal gate assertTestContractResolvable
// 用同一条 CI 解析链校验此路径），把 PRD「4 条纯代码用例落 tests/gp/f1/」+ bug-fix 死规矩
// （failing test 修复后永久保留在 CI 作回归）落实为常驻 CI 断言，随 root vitest include
// `tests/**` 每次 PR 跑。
//
// 现状 RED：tests/gp/f1/eval/harness-visual-eval.mjs 尚未实现 → import 即失败（红证据）。
// 判定器（视觉模型）调用是外层边界（本 sprint 不新增视觉 provider、judge 只读被调用），
// 以注入的 stub 承载 —— 见合同「未覆盖真实链路清单」。
import { describe, it, expect, vi } from 'vitest';
import {
  EVAL_STEPS,
  evalGoldenSet,
  failClosedJudge,
  cachedJudge,
  checkRatchet,
  assertMonotonic,
  lintSkillContract,
} from './eval/harness-visual-eval.mjs';

// 内联金标集 v0（09-05 A/B 五类标注）——自含，回归测试不依赖 fixture 读盘
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
function perfectJudge(entry) {
  return entry.label;
}

describe('判定器金标集 v0 + eval 通过率棘轮（永久 CI 回归）[BEHAVIOR]', () => {
  it('金标集 v0 eval 通过率可算出且 ≥ 入库阈值', () => {
    const r = evalGoldenSet({ manifest: goldenV0(), judge: perfectJudge });
    expect(r.total).toBe(5);
    expect(r.correct).toBe(5);
    expect(r.passRate).toBeCloseTo(1.0, 5);
    expect(r.passRate).toBeGreaterThanOrEqual(0.8);
  });

  it('棘轮：降阈提交被拦截，阈值只升不降', () => {
    expect(checkRatchet({ current: 100, watermark: 100 }).ok).toBe(true);
    expect(checkRatchet({ current: 100, watermark: 100 }).bumped).toBe(false);
    const up = checkRatchet({ current: 120, watermark: 100 });
    expect(up.ok).toBe(true);
    expect(up.bumped).toBe(true);
    expect(up.newWatermark).toBe(120);
    expect(checkRatchet({ current: 80, watermark: 100 }).ok).toBe(false);
    expect(() => assertMonotonic(100, 80)).toThrow();
    expect(assertMonotonic(100, 100)).toBe(100);
    expect(assertMonotonic(100, 120)).toBe(120);
  });

  it('缓存命中二次判定视觉调用计数为 0（防成本回归）', () => {
    const spy = vi.fn((entry) => entry.label);
    const cached = cachedJudge(spy);
    const entry = goldenV0()[0];
    cached(entry);
    const before = spy.mock.calls.length;
    cached(entry);
    const delta = spy.mock.calls.length - before;
    expect(before).toBe(1);
    expect(delta).toBe(0);
    expect(cached.visionCallCount).toBe(1);
  });

  it('视觉返回 null 必 fail-closed 判 FAIL（不假绿）', () => {
    const j = failClosedJudge(() => null);
    expect(j(goldenV0()[0])).toBe('FAIL');
    const r = evalGoldenSet({ manifest: goldenV0(), judge: () => null });
    expect(r.correct).toBe(0);
    expect(r.passRate).toBe(0);
    expect(r.failures.length).toBe(5);
  });

  it('契约完备 lint：缺 pre/post/side_effects 任一段触发 FAIL', () => {
    expect(lintSkillContract({ pre: 'x', post: 'y', side_effects: 'z' }).ok).toBe(true);
    const miss = lintSkillContract({ pre: 'x', post: 'y' });
    expect(miss.ok).toBe(false);
    expect(miss.missing).toContain('side_effects');
    expect(lintSkillContract({ pre: 'x', post: '', side_effects: 'z' }).ok).toBe(false);
  });

  it('判定步骤序列固化不漂移', () => {
    expect(EVAL_STEPS).toEqual([
      'load_manifest',
      'validate_labels',
      'judge_each',
      'compare_labels',
      'compute_pass_rate',
      'ratchet_check',
    ]);
  });

  it('金标集为空/标签缺失 → eval 直接 FAIL（不空跑判绿）', () => {
    expect(() => evalGoldenSet({ manifest: [], judge: perfectJudge })).toThrow();
    const bad = [{ id: 'x', screenshot: 'x.png' }];
    expect(() => evalGoldenSet({ manifest: bad, judge: perfectJudge })).toThrow();
  });
});
