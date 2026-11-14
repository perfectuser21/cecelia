import { describe, it, expect } from 'vitest';
import { normalizeAcceptance } from '../staging-acceptance.js';

describe('normalizeAcceptance', () => {
  const validScenario = {
    name: 's1',
    covered_tasks: ['t1'],
    commands: [{ type: 'curl', cmd: 'curl http://x' }],
  };

  it('合法结构 → 返回 { scenarios }', () => {
    const r = normalizeAcceptance({ scenarios: [validScenario] });
    expect(r.scenarios.length).toBe(1);
  });

  it('acceptance 非对象 → 抛错', () => {
    expect(() => normalizeAcceptance(null)).toThrow(/must be an object/);
    expect(() => normalizeAcceptance('str')).toThrow();
  });

  it('scenarios 为空 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [] })).toThrow(/non-empty/);
    expect(() => normalizeAcceptance({})).toThrow();
  });

  it('scenario.name 缺失 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [{ ...validScenario, name: '' }] }))
      .toThrow(/name required/);
  });

  it('scenario.covered_tasks 空 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [{ ...validScenario, covered_tasks: [] }] }))
      .toThrow(/covered_tasks/);
  });

  it('scenario.commands 空 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [{ ...validScenario, commands: [] }] }))
      .toThrow(/commands/);
  });

  it('scenario 非对象 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [null] })).toThrow();
  });
});

