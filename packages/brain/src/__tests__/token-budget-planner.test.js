import { describe, it, expect } from 'vitest';
import { getExecutorAffinity, shouldDowngrade } from '../token-budget-planner.js';

describe('getExecutorAffinity()', () => {
  it('dev → claude primary，codex fallback，可降级', () => {
    const a = getExecutorAffinity('dev');
    expect(a.primary).toBe('claude');
    expect(a.fallback).toBe('codex');
    expect(a.no_downgrade).toBe(false);
  });

  it('architecture_design → claude primary，no_downgrade=true', () => {
    const a = getExecutorAffinity('architecture_design');
    expect(a.primary).toBe('claude');
    expect(a.fallback).toBeNull();
    expect(a.no_downgrade).toBe(true);
  });

  it('strategy_session → no_downgrade=true', () => {
    expect(getExecutorAffinity('strategy_session').no_downgrade).toBe(true);
  });

  it('initiative_plan → no_downgrade=true', () => {
    expect(getExecutorAffinity('initiative_plan').no_downgrade).toBe(true);
  });

  it('codex_dev → codex primary，no_downgrade=true', () => {
    const a = getExecutorAffinity('codex_dev');
    expect(a.primary).toBe('codex');
    expect(a.no_downgrade).toBe(true);
  });

  it('explore → codex primary（MiniMax 已停用）', () => {
    const a = getExecutorAffinity('explore');
    expect(a.primary).toBe('codex');
    expect(a.no_downgrade).toBe(true);
  });

  it('未知 task_type → 默认 claude primary，codex fallback', () => {
    const a = getExecutorAffinity('unknown_type');
    expect(a.primary).toBe('claude');
    expect(a.fallback).toBe('codex');
    expect(a.no_downgrade).toBe(false);
  });

  it('code_review → 可降级到 codex', () => {
    const a = getExecutorAffinity('code_review');
    expect(a.fallback).toBe('codex');
    expect(a.no_downgrade).toBe(false);
  });
});

// ============================================================
// shouldDowngrade — 降级决策
// ============================================================

describe('shouldDowngrade()', () => {
  it('abundant + dev → 不降级', () => {
    expect(shouldDowngrade('dev', 'abundant')).toBe(false);
  });

  it('moderate + dev → 不降级', () => {
    expect(shouldDowngrade('dev', 'moderate')).toBe(false);
  });

  it('tight + dev → 降级', () => {
    expect(shouldDowngrade('dev', 'tight')).toBe(true);
  });

  it('critical + dev → 降级', () => {
    expect(shouldDowngrade('dev', 'critical')).toBe(true);
  });

  it('tight + architecture_design → 不降级（no_downgrade=true）', () => {
    expect(shouldDowngrade('architecture_design', 'tight')).toBe(false);
  });

  it('critical + strategy_session → 不降级', () => {
    expect(shouldDowngrade('strategy_session', 'critical')).toBe(false);
  });

  it('critical + initiative_plan → 不降级', () => {
    expect(shouldDowngrade('initiative_plan', 'critical')).toBe(false);
  });

  it('tight + code_review → 降级', () => {
    expect(shouldDowngrade('code_review', 'tight')).toBe(true);
  });

  it('tight + codex_dev → 不降级（已是 Codex）', () => {
    expect(shouldDowngrade('codex_dev', 'tight')).toBe(false);
  });

  it('tight + explore → 不降级（已是 Codex，no_downgrade=true）', () => {
    expect(shouldDowngrade('explore', 'tight')).toBe(false);
  });
});
