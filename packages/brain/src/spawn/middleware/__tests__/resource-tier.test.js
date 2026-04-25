import { describe, it, expect } from 'vitest';
import { resolveResourceTier, RESOURCE_TIERS, TASK_TYPE_TIER } from '../resource-tier.js';

describe('resolveResourceTier()', () => {
  it('dev → heavy', () => {
    expect(resolveResourceTier('dev')).toEqual({ memoryMB: 1536, cpuCores: 2, timeoutMs: 7200000, tier: 'heavy' });
  });
  it('planner → light', () => {
    expect(resolveResourceTier('planner')).toEqual({ memoryMB: 512, cpuCores: 1, timeoutMs: 1800000, tier: 'light' });
  });
  it('content_research → pipeline-heavy', () => {
    expect(resolveResourceTier('content_research')).toEqual({ memoryMB: 2048, cpuCores: 1, timeoutMs: 10800000, tier: 'pipeline-heavy' });
  });
  it('unknown task_type → normal', () => {
    expect(resolveResourceTier('something_new')).toEqual({ memoryMB: 1024, cpuCores: 1, timeoutMs: 5400000, tier: 'normal' });
  });
  it('harness_planner → light (spec memory)', () => {
    expect(resolveResourceTier('harness_planner').tier).toBe('light');
  });
  it('harness_generator → heavy (spec memory)', () => {
    expect(resolveResourceTier('harness_generator').tier).toBe('heavy');
  });
});

describe('RESOURCE_TIERS / TASK_TYPE_TIER constants', () => {
  it('exports 4 tier keys', () => {
    expect(Object.keys(RESOURCE_TIERS).sort()).toEqual(['heavy', 'light', 'normal', 'pipeline-heavy']);
  });
  it('every tier has timeoutMs > 0', () => {
    for (const [name, spec] of Object.entries(RESOURCE_TIERS)) {
      expect(spec.timeoutMs, `tier ${name} must have timeoutMs`).toBeGreaterThan(0);
    }
  });
  it('timeoutMs ordering light < normal < heavy < pipeline-heavy', () => {
    const t = RESOURCE_TIERS;
    expect(t.light.timeoutMs).toBeLessThan(t.normal.timeoutMs);
    expect(t.normal.timeoutMs).toBeLessThan(t.heavy.timeoutMs);
    expect(t.heavy.timeoutMs).toBeLessThan(t['pipeline-heavy'].timeoutMs);
  });
  it('TASK_TYPE_TIER maps only to defined tiers', () => {
    for (const [_task, tier] of Object.entries(TASK_TYPE_TIER)) {
      expect(RESOURCE_TIERS[tier]).toBeDefined();
    }
  });
});
