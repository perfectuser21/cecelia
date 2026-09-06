/**
 * verdict-engine.test.js — 三态判决引擎逐文件配对测试(lint-test-pairing)
 * 铁律来源:决策 28ca1f69(判定层不蒸馏/探针强制/N≥20/碎3降级/优先级=频率×失败率)
 */
import { describe, it, expect } from 'vitest';
import { classifyCrystalVerdict, crystallizePriority, CRYSTAL_THRESHOLDS } from '../verdict-engine.js';

const P = (o = {}) => ({
  n_runs: 40, success_rate: 0.95, token_cost: 8000, latency_ms: 1200,
  new_branch_rate: 0, broken_count: 0, has_postcondition: true,
  is_hardened: false, is_judgment_layer: false, data_gap: false, ...o,
});

describe('classifyCrystalVerdict 三态铁律', () => {
  it('全条件满足 → promote', () => {
    expect(classifyCrystalVerdict(P()).verdict).toBe('promote');
  });
  it('INV-1 判定层永不蒸馏 → keep_llm(即使其余全满足)', () => {
    expect(classifyCrystalVerdict(P({ is_judgment_layer: true })).verdict).toBe('keep_llm');
  });
  it('INV-2 无探针不许固化 → keep_llm', () => {
    expect(classifyCrystalVerdict(P({ has_postcondition: false })).verdict).toBe('keep_llm');
  });
  it('N<minRuns 数据不足 → keep_llm', () => {
    expect(classifyCrystalVerdict(P({ n_runs: CRYSTAL_THRESHOLDS.minRuns - 1 })).verdict).toBe('keep_llm');
  });
  it('固化件 broken_count 达阈 → demote(双向棘轮)', () => {
    expect(classifyCrystalVerdict(P({ is_hardened: true, broken_count: CRYSTAL_THRESHOLDS.demoteBreaks })).verdict).toBe('demote');
  });
  it('新分支率>0(变体未探明)不晋升', () => {
    expect(classifyCrystalVerdict(P({ new_branch_rate: 0.2 })).verdict).toBe('keep_llm');
  });
});

describe('crystallizePriority = 频率×失败率(INV-5)', () => {
  it('50 次 × 20% 失败 = 10', () => {
    expect(crystallizePriority({ n_runs: 50, success_rate: 0.8 })).toBeCloseTo(10, 6);
  });
  it('高频零失败 → 优先级 0(跑得好不折腾)', () => {
    expect(crystallizePriority({ n_runs: 100, success_rate: 1 })).toBeCloseTo(0, 6);
  });
});
