// 结晶判官 — 三态判决规则引擎 + 证据留存规范 冻结测试（TDD Red）
// 冻结产物：Test Contract 唯一必需的 sprint 冻结测试。纯逻辑，不碰 DB（DB 写路径由
// contract-dod.md 的 [BEHAVIOR] 在真实 Brain + 真 Postgres 上验，禁 mock，见「## 禁 mock 边清单」）。
//
// 覆盖：晋升 / 降级 / 保持纯LLM(数据不足) / 保持(变体未收敛) / 探针强制(INV-2) /
//       判定层不蒸馏(INV-1) / 固化优先级=频率×失败率(INV-5) / 证据文件名 trial+timestamp(INV-4) /
//       禁复用覆盖(INV-4) / OpenClaw leadgen 八格常量。
import { describe, it, expect } from 'vitest';
import {
  classifyCrystalVerdict,
  crystallizePriority,
  CRYSTAL_THRESHOLDS,
} from '../../../packages/brain/src/crystal/verdict-engine.js';
import {
  buildEvidenceFilename,
  parseEvidenceFilename,
  assertNoOverwrite,
} from '../../../packages/brain/src/crystal/evidence.js';
import { OPENCLAW_LEADGEN_GRIDS } from '../../../packages/brain/src/crystal/grids.js';

// 满足全部晋升条件的基准指标（供各用例微调）
function promoteReady(overrides = {}) {
  return {
    n_runs: 40,
    success_rate: 0.95,
    token_cost: 8000, // 单次平均 token 成本；频率×成本 = 40*8000 = 320000 > baseline
    latency_ms: 1200,
    new_branch_rate: 0,
    broken_count: 0,
    has_postcondition: true,
    is_hardened: false,
    is_judgment_layer: false,
    data_gap: false,
    ...overrides,
  };
}

describe('结晶判官 三态判决 [BEHAVIOR]', () => {
  it('promote when N over 20 success over 90 zero new branch postcondition cost over baseline', () => {
    const out = classifyCrystalVerdict(promoteReady(), CRYSTAL_THRESHOLDS);
    expect(out.verdict).toBe('promote');
    expect(out.basis).toBeTruthy();
  });

  it('keep_llm when N under 20 data insufficient', () => {
    const out = classifyCrystalVerdict(promoteReady({ n_runs: 10 }), CRYSTAL_THRESHOLDS);
    expect(out.verdict).toBe('keep_llm');
    expect(JSON.stringify(out.basis)).toMatch(/data_insufficient|low_freq|insufficient/);
  });

  it('keep_llm when new branch rate over zero variant unconverged', () => {
    // 即使成功率高、N 足够，只要新分支率 > 0（变体未收敛）也不晋升
    const out = classifyCrystalVerdict(promoteReady({ new_branch_rate: 0.2 }), CRYSTAL_THRESHOLDS);
    expect(out.verdict).toBe('keep_llm');
    expect(JSON.stringify(out.basis)).toMatch(/variant_unconverged|new_branch/);
  });

  it('keep_llm no postcondition even if metrics qualify probe mandatory', () => {
    // INV-2 探针强制：无 postcondition 不许入库晋升
    const out = classifyCrystalVerdict(promoteReady({ has_postcondition: false }), CRYSTAL_THRESHOLDS);
    expect(out.verdict).toBe('keep_llm');
    expect(JSON.stringify(out.basis)).toMatch(/postcondition|probe/);
  });

  it('judgment layer never harden keep_llm', () => {
    // INV-1 判定层不蒸馏：判定层永不固化，即使全部晋升条件满足
    const out = classifyCrystalVerdict(promoteReady({ is_judgment_layer: true }), CRYSTAL_THRESHOLDS);
    expect(out.verdict).toBe('keep_llm');
    expect(JSON.stringify(out.basis)).toMatch(/judgment/);
  });

  it('demote when hardened and broken count reaches threshold within window', () => {
    // 降级：固化件 7 天内碎 >= 3 次
    const out = classifyCrystalVerdict(
      promoteReady({ is_hardened: true, broken_count: 3 }),
      CRYSTAL_THRESHOLDS,
    );
    expect(out.verdict).toBe('demote');
    expect(JSON.stringify(out.basis)).toMatch(/broken/);
  });

  it('data gap grid keeps llm and is flagged', () => {
    // 数据缺口：采集器空/无新数据 → 保持纯LLM，不误判
    const out = classifyCrystalVerdict(
      promoteReady({ n_runs: 0, success_rate: null, data_gap: true }),
      CRYSTAL_THRESHOLDS,
    );
    expect(out.verdict).toBe('keep_llm');
    expect(JSON.stringify(out.basis)).toMatch(/data_gap|data_insufficient/);
  });

  it('crystallize priority equals frequency times failure rate', () => {
    // INV-5 固化优先级 = 频率 × 失败率
    const p = crystallizePriority({ n_runs: 50, success_rate: 0.8 });
    expect(p).toBeCloseTo(50 * (1 - 0.8), 6);
  });

  it('thresholds expose promote and demote knobs', () => {
    expect(CRYSTAL_THRESHOLDS.minRuns).toBe(20);
    expect(CRYSTAL_THRESHOLDS.minSuccessRate).toBeCloseTo(0.9, 6);
    expect(CRYSTAL_THRESHOLDS.maxNewBranchRate).toBe(0);
    expect(CRYSTAL_THRESHOLDS.demoteBreaks).toBe(3);
    expect(CRYSTAL_THRESHOLDS.demoteWindowDays).toBe(7);
  });
});

describe('结晶判官 证据留存规范 [BEHAVIOR]', () => {
  it('build evidence filename contains trial and timestamp', () => {
    // INV-4 证据留痕：文件名强制带 trial + timestamp
    const at = new Date('2026-09-05T22:10:00.000Z');
    const name = buildEvidenceFilename({ grid: 'og1', trial: 3, ext: 'png', at });
    expect(name).toMatch(/trial3/);
    expect(name).toMatch(/20260905T221000Z/);
    expect(name).toMatch(/\.png$/);
    const parsed = parseEvidenceFilename(name);
    expect(parsed.trial).toBe(3);
    expect(parsed.timestamp).toBeTruthy();
  });

  it('assert no overwrite throws on duplicate filename', () => {
    // INV-4 禁复用文件名覆盖
    const name = 'og1__trial3__20260905T221000Z.png';
    expect(() => assertNoOverwrite([name], name)).toThrow();
    expect(() => assertNoOverwrite(['other.png'], name)).not.toThrow();
  });
});

describe('OpenClaw leadgen 八格 [BEHAVIOR]', () => {
  it('openclaw leadgen grids has exactly eight grids', () => {
    expect(Array.isArray(OPENCLAW_LEADGEN_GRIDS)).toBe(true);
    expect(OPENCLAW_LEADGEN_GRIDS.length).toBe(8);
    // 去重后仍为 8（无重复格号）
    expect(new Set(OPENCLAW_LEADGEN_GRIDS).size).toBe(8);
  });
});
