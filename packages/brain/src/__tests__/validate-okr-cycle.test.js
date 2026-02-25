/**
 * OKR Cycle Detection 测试
 * DoD: D8
 */

import { describe, it, expect } from 'vitest';
import { detectCycles } from '../validate-okr-structure.js';

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

describe('D8: pr_plan.depends_on 环检测', () => {
  it('A→B→A 双节点环 → BLOCK', () => {
    const plans = [
      { id: uuid(1), depends_on: [uuid(2)], title: 'Plan A', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(2), depends_on: [uuid(1)], title: 'Plan B', project_id: uuid(10), dod: 'x', status: 'pending' },
    ];
    const issues = [];
    detectCycles(issues, plans, { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].level).toBe('BLOCK');
    expect(issues[0].rule).toBe('dependency_cycle');
    expect(issues[0].message).toContain('→');
  });

  it('A→B→C→A 三节点环 → BLOCK', () => {
    const plans = [
      { id: uuid(1), depends_on: [uuid(2)], title: 'Plan A', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(2), depends_on: [uuid(3)], title: 'Plan B', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(3), depends_on: [uuid(1)], title: 'Plan C', project_id: uuid(10), dod: 'x', status: 'pending' },
    ];
    const issues = [];
    detectCycles(issues, plans, { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].level).toBe('BLOCK');
    expect(issues[0].rule).toBe('dependency_cycle');
  });

  it('自环 A→A → BLOCK', () => {
    const plans = [
      { id: uuid(1), depends_on: [uuid(1)], title: 'Plan A', project_id: uuid(10), dod: 'x', status: 'pending' },
    ];
    const issues = [];
    detectCycles(issues, plans, { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].level).toBe('BLOCK');
  });

  it('无环 A→B, B→C → 无 issue', () => {
    const plans = [
      { id: uuid(1), depends_on: [uuid(2)], title: 'Plan A', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(2), depends_on: [uuid(3)], title: 'Plan B', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(3), depends_on: [], title: 'Plan C', project_id: uuid(10), dod: 'x', status: 'pending' },
    ];
    const issues = [];
    detectCycles(issues, plans, { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBe(0);
  });

  it('空 depends_on → 无 issue', () => {
    const plans = [
      { id: uuid(1), depends_on: null, title: 'Plan A', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(2), depends_on: [], title: 'Plan B', project_id: uuid(10), dod: 'x', status: 'pending' },
    ];
    const issues = [];
    detectCycles(issues, plans, { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBe(0);
  });

  it('无 plans → 无 issue', () => {
    const issues = [];
    detectCycles(issues, [], { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBe(0);
  });

  it('复杂图：部分有环部分无环', () => {
    // A→B→C (无环), D→E→D (有环)
    const plans = [
      { id: uuid(1), depends_on: [uuid(2)], title: 'A', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(2), depends_on: [uuid(3)], title: 'B', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(3), depends_on: [], title: 'C', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(4), depends_on: [uuid(5)], title: 'D', project_id: uuid(10), dod: 'x', status: 'pending' },
      { id: uuid(5), depends_on: [uuid(4)], title: 'E', project_id: uuid(10), dod: 'x', status: 'pending' },
    ];
    const issues = [];
    detectCycles(issues, plans, { field: 'depends_on', severity: 'BLOCK' });
    expect(issues.length).toBeGreaterThanOrEqual(1);
    // 只检测 D-E 的环
    const cycleMsg = issues.map(i => i.message).join(' ');
    expect(cycleMsg).toContain(uuid(4));
  });
});
