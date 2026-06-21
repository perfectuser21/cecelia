import { describe, it, expect } from 'vitest';
// @ts-expect-error 模块尚未实现 — TDD Red：generator 实现后转绿
import { computeStopBoundary, buildReport } from '../../packages/brain/src/harness-rss-measure.js';

describe('harness-rss-measure computeStopBoundary [BEHAVIOR]', () => {
  it('evaluator 后截断：返回恰 4 角色，不含 openPr/writeback', () => {
    const full = ['planner', 'proposer', 'generator', 'evaluator', 'openPr', 'writeback'];
    expect(computeStopBoundary(full, 'evaluator')).toEqual([
      'planner', 'proposer', 'generator', 'evaluator',
    ]);
  });
});

describe('harness-rss-measure buildReport [BEHAVIOR]', () => {
  const RID = '00000000-0000-4000-8000-000000000000';

  it('聚合 schema：顶层 keys 严格 == {roles,run_id,run_ts,stopped_after}，peak=max，sample_count 正确', () => {
    const rep = buildReport(RID, 1718900000000, [
      { role: 'planner', samples: [100, 312.5, 200], status: 'complete' },
      { role: 'proposer', samples: [287.1], status: 'complete' },
      { role: 'generator', samples: [540.8, 10], status: 'complete' },
      { role: 'evaluator', samples: [410.2], status: 'complete' },
    ]);
    expect(Object.keys(rep).sort()).toEqual(['roles', 'run_id', 'run_ts', 'stopped_after']);
    expect(rep.stopped_after).toBe('evaluator');
    expect(rep.roles).toHaveLength(4);
    const planner = rep.roles.find((r: any) => r.role === 'planner');
    expect(planner.peak_rss_mb).toBe(312.5);
    expect(planner.sample_count).toBe(3);
    expect(Object.keys(planner).sort()).toEqual(['peak_rss_mb', 'role', 'sample_count', 'status']);
  });

  it('禁用字段名不漏网（rss_mb/memory/samples/id 一律不得出现）', () => {
    const rep = buildReport(RID, 1718900000000, [
      { role: 'planner', samples: [100], status: 'complete' },
    ]);
    expect('id' in rep).toBe(false);
    const item = rep.roles[0];
    expect('rss_mb' in item).toBe(false);
    expect('memory' in item).toBe(false);
    expect('samples' in item).toBe(false);
  });

  it('边界：角色提前退出 status=incomplete 但 peak_rss_mb 仍 > 0', () => {
    const rep = buildReport(RID, 1718900000000, [
      { role: 'generator', samples: [180, 260], status: 'incomplete' },
    ]);
    const g = rep.roles.find((r: any) => r.role === 'generator');
    expect(g.status).toBe('incomplete');
    expect(g.peak_rss_mb).toBeGreaterThan(0);
  });
});
