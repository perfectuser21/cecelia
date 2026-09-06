/**
 * coding-grids.test.js — 编码线九格常量与相判定映射（判官口粮第二铲）
 *
 * 病灶（2026-09-07 实测）：crystal_verdict 里 og1..og8 恒为 keep_llm{"rule":"data_gap"}，
 * 而编码线真实跑过的格子成败躺在 harness_attempts（3400+ 行 phase×status）里从未进过判官账本。
 * 本文件锁死第一段接线：**格子表从哪来、旧代 kernel 相怎么归到九格、探针从哪认**。
 *
 * 三条守卫：
 *   ① 九格必须从 home-sequencer STAGE_ORDER 派生 —— 硬编码副本会和序列器漂移。
 *   ② 判决单位键必须带 `coding:` 前缀 —— 与判官自管单位（og1..og8 + 证据段名）写者隔离。
 *   ③ 认不出的相返回 null，不猜 —— 猜一个格等于往账本里塞假数。
 */
import { describe, it, expect } from 'vitest';
import {
  CODING_GRIDS,
  CODING_UNIT_PREFIX,
  codingUnitKey,
  gridForKernelPhase,
  gridHasPostcondition,
} from '../coding-grids.js';
import { STAGE_ORDER } from '../../orchestrator/home-sequencer.js';
import { STAGE_REQUIRED_HANDOFFS } from '../../orchestrator/handoff-schemas.js';
import { OPENCLAW_LEADGEN_GRIDS } from '../grids.js';

describe('编码线九格常量', () => {
  it('恰好九格，且逐格派生自 home-sequencer STAGE_ORDER（去掉 init/finalize 两个非格）', () => {
    const derived = STAGE_ORDER.filter((s) => !s.startsWith('__'));
    expect(CODING_GRIDS).toEqual(derived);
    expect(CODING_GRIDS).toHaveLength(9);
  });

  it('判决单位键带 coding: 前缀，与判官自管单位永不撞键', () => {
    expect(CODING_UNIT_PREFIX).toBe('coding:');
    for (const g of CODING_GRIDS) {
      expect(codingUnitKey(g)).toBe(`coding:${g}`);
      expect(OPENCLAW_LEADGEN_GRIDS).not.toContain(codingUnitKey(g));
      expect(codingUnitKey(g)).not.toBe('search_account');
    }
  });
});

describe('kernel 相 → 九格归一（两代同一判决单位，否则次数永远攒不够）', () => {
  it('六个有确定对应的相逐一归位', () => {
    expect(gridForKernelPhase('planning')).toBe('plan');
    expect(gridForKernelPhase('gan')).toBe('contract');
    expect(gridForKernelPhase('generate')).toBe('generate');
    expect(gridForKernelPhase('evaluate')).toBe('evaluate');
    expect(gridForKernelPhase('judge')).toBe('judge');
    expect(gridForKernelPhase('publish')).toBe('publish');
    expect(gridForKernelPhase('merge')).toBe('merge');
  });

  it('九格里没有对应物的相返回 null，不硬塞（review=人审、failed/done=终态）', () => {
    expect(gridForKernelPhase('review')).toBeNull();
    expect(gridForKernelPhase('failed')).toBeNull();
    expect(gridForKernelPhase('done')).toBeNull();
    expect(gridForKernelPhase('没见过的相')).toBeNull();
    expect(gridForKernelPhase(null)).toBeNull();
    expect(gridForKernelPhase(undefined)).toBeNull();
  });

  it('映射目标一律是合法九格之一（防写错格名静默丢数）', () => {
    for (const phase of ['planning', 'gan', 'generate', 'evaluate', 'judge', 'publish', 'merge']) {
      expect(CODING_GRIDS).toContain(gridForKernelPhase(phase));
    }
  });
});

describe('探针（INV-2 postcondition）认定来自机械交接件契约，不是人工声明', () => {
  it('有 STAGE_REQUIRED_HANDOFFS 要求的格才算有探针', () => {
    for (const g of CODING_GRIDS) {
      const expected = Array.isArray(STAGE_REQUIRED_HANDOFFS[g]) && STAGE_REQUIRED_HANDOFFS[g].length > 0;
      expect(gridHasPostcondition(g)).toBe(expected);
    }
  });

  it('实测四格有探针（contract/seal/generate/publish），其余五格没有', () => {
    expect(gridHasPostcondition('contract')).toBe(true);
    expect(gridHasPostcondition('seal')).toBe(true);
    expect(gridHasPostcondition('generate')).toBe(true);
    expect(gridHasPostcondition('publish')).toBe(true);
    expect(gridHasPostcondition('plan')).toBe(false);
    expect(gridHasPostcondition('evaluate')).toBe(false);
    expect(gridHasPostcondition('judge')).toBe(false);
    expect(gridHasPostcondition('merge')).toBe(false);
    expect(gridHasPostcondition('cleanup')).toBe(false);
  });
});
