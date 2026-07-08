import { describe, it, expect } from 'vitest';
import { validateReportData } from '../skill-eval-report-schema.js';
import legacyFixture from '../__fixtures__/daily-report-cs.report.json';

describe('validateReportData — 兼容新 pipeline 结构 + 老 inputs/kernel 结构', () => {
  it('老结构但没有 kernel 字段（只有 inputs + outputs）——新规则不查 kernel，应该合法', () => {
    const noKernelLegacy = {
      skill: { name: 'x' },
      verdict: { level: 'pass' },
      anatomy: { inputs: [{ name: 'a' }], outputs: [{ name: 'b' }] },
    };
    const r = validateReportData(noKernelLegacy);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('新 pipeline 结构（无 inputs/kernel）合法', () => {
    const pipelineOnly = {
      skill: { name: 'x' },
      verdict: { level: 'partial' },
      anatomy: { pipeline: ['load|a|库|来源|已接'], outputs: [{ name: 'b' }] },
    };
    const r = validateReportData(pipelineOnly);
    expect(r.valid).toBe(true);
  });

  it('anatomy 既无 pipeline 也无 inputs → 报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/pipeline.*inputs|inputs.*pipeline/);
  });

  it('缺 skill.name 报错', () => {
    const r = validateReportData({ verdict: { level: 'pass' }, anatomy: { inputs: [], outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/skill\.name/);
  });

  it('verdict.level 非枚举报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'maybe' }, anatomy: { inputs: [], outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/verdict\.level/);
  });

  it('anatomy.outputs 非数组报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { inputs: [], outputs: 'nope' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/outputs/);
  });

  it('向后兼容：eval-report.test.js 仍在用的老 fixture（inputs/kernel.rules/outputs 全套老结构）依然合法', () => {
    const r = validateReportData(legacyFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
