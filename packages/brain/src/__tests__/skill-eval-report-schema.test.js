import { describe, it, expect } from 'vitest';
import { validateReportData } from '../skill-eval-report-schema.js';
import fixture from '../__fixtures__/daily-report-cs.report.json';

describe('validateReportData', () => {
  it('fixture 合法', () => {
    const r = validateReportData(fixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('缺 skill.name 报错', () => {
    const r = validateReportData({ verdict:{level:'pass'}, anatomy:{inputs:[],kernel:{rules:[]},outputs:[]} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/skill\.name/);
  });
  it('verdict.level 非枚举报错', () => {
    const r = validateReportData({ skill:{name:'x'}, verdict:{level:'maybe'}, anatomy:{inputs:[],kernel:{rules:[]},outputs:[]} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/verdict\.level/);
  });
  it('anatomy.kernel.rules 非数组报错', () => {
    const r = validateReportData({ skill:{name:'x'}, verdict:{level:'pass'}, anatomy:{inputs:[],kernel:{rules:'nope'},outputs:[]} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/kernel\.rules/);
  });
  it('fixture 含解剖图三段与 6 维 health', () => {
    expect(fixture.anatomy.inputs.length).toBeGreaterThan(0);
    expect(fixture.anatomy.outputs.length).toBeGreaterThan(0);
    expect(fixture.health.length).toBe(6);
    expect(fixture.anatomy.inputs.some(i=>i.connected===false)).toBe(true); // 状态包未接
  });
});
