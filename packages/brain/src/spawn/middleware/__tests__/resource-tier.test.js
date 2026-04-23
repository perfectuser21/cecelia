import { describe, it, expect } from 'vitest';
import { resolveResourceTier, RESOURCE_TIERS, TASK_TYPE_TIER } from '../resource-tier.js';

describe('resolveResourceTier()', () => {
  it('dev → heavy', () => {
    expect(resolveResourceTier('dev')).toEqual({ memoryMB: 1536, cpuCores: 2, tier: 'heavy' });
  });
  it('planner → light', () => {
    expect(resolveResourceTier('planner')).toEqual({ memoryMB: 512, cpuCores: 1, tier: 'light' });
  });
  it('content_research → pipeline-heavy', () => {
    expect(resolveResourceTier('content_research')).toEqual({ memoryMB: 2048, cpuCores: 1, tier: 'pipeline-heavy' });
  });
  it('unknown task_type → normal', () => {
    expect(resolveResourceTier('something_new')).toEqual({ memoryMB: 1024, cpuCores: 1, tier: 'normal' });
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
  it('TASK_TYPE_TIER maps only to defined tiers', () => {
    for (const [task, tier] of Object.entries(TASK_TYPE_TIER)) {
      expect(RESOURCE_TIERS[tier]).toBeDefined();
    }
  });
});
