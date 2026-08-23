/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 决策 3f53bb8e（Run 起手召唤 Commander）+ e3afa828（Alex 2026-08-23 拍板接通）。
 * 缺口 17ed9f07 实证：kernel run 创建方从不传 commanderMode，validateCreateInput
 * 缺省 'kernel-only'，而 commander-coordinator.reconcile 第一行对非 hybrid 直接
 * bypass——近 3 天 29 个 run 全部 kernel-only，Commander LLM 监理 0 参与，
 * r54 无限 recollect 烧 9 个 evaluator 时 Commander 不在场。
 *
 * 修复：缺省反转——未显式传 commanderMode 时默认 'hybrid'（每个 run 都带
 * Commander），env KERNEL_COMMANDER_MODE_DEFAULT 为逃生阀（显式设 kernel-only
 * 可整体回退）。显式入参仍最高优先。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { __test__ as runStoreTest } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';

const BASE_INPUT = {
  taskId: '22222222-2222-4222-8222-222222222222',
  initiativeId: '33333333-3333-4333-8333-333333333333',
  host: 'test-host',
  deadlineHours: 8,
  phase: 'planning',
  createdSource: 'kernel_dispatch',
};

afterEach(() => {
  delete process.env.KERNEL_COMMANDER_MODE_DEFAULT;
});

describe('kernel run commander_mode 缺省反转为 hybrid', () => {
  it('未传 commanderMode → 默认 hybrid（常态 run 全带 Commander）', () => {
    const { commanderMode } = runStoreTest.validateCreateInput({ ...BASE_INPUT });
    expect(commanderMode).toBe('hybrid');
  });

  it('显式传 kernel-only 仍尊重（入参最高优先）', () => {
    const { commanderMode } = runStoreTest.validateCreateInput({
      ...BASE_INPUT,
      commanderMode: 'kernel-only',
    });
    expect(commanderMode).toBe('kernel-only');
  });

  it('逃生阀：env KERNEL_COMMANDER_MODE_DEFAULT=kernel-only 时缺省回退', () => {
    process.env.KERNEL_COMMANDER_MODE_DEFAULT = 'kernel-only';
    const { commanderMode } = runStoreTest.validateCreateInput({ ...BASE_INPUT });
    expect(commanderMode).toBe('kernel-only');
  });

  it('负向：非法模式仍 throw', () => {
    expect(() => runStoreTest.validateCreateInput({
      ...BASE_INPUT,
      commanderMode: 'chaos',
    })).toThrow(/invalid Kernel run commander mode/);
  });

  it('负向：env 逃生阀给非法值 → throw（fail-closed，不静默吞）', () => {
    process.env.KERNEL_COMMANDER_MODE_DEFAULT = 'chaos';
    expect(() => runStoreTest.validateCreateInput({ ...BASE_INPUT }))
      .toThrow(/invalid Kernel run commander mode/);
  });
});
