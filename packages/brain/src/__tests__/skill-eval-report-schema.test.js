import { describe, it, expect } from 'vitest';
import { validateReportData } from '../skill-eval-report-schema.js';
import legacyFixture from '../__fixtures__/daily-report-cs.report.json';
import realFixture from './fixtures/report_data8-real.json';
import interleavedFixture from './fixtures/report_interleaved-example.json';

describe('validateReportData — 真实 fixture 回归套件', () => {
  it('report_data8-real.json（全部前置，8 类资料源）合法', () => {
    const r = validateReportData(realFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('report_interleaved-example.json（穿插判定）合法', () => {
    const r = validateReportData(interleavedFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('向后兼容：老 anatomy.{inputs,kernel.rules,outputs} 结构（eval-report.test.js 仍在用）依然合法', () => {
    const r = validateReportData(legacyFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('新 pipeline 结构但没有 inputs/kernel 也合法（纯 pipeline 场景）', () => {
    const r = validateReportData({
      skill: { name: 'x' },
      verdict: { level: 'partial' },
      anatomy: { pipeline: ['load|a|库|来源|已接'], outputs: [{ name: 'b' }] },
    });
    expect(r.valid).toBe(true);
  });

  it('anatomy 既无 pipeline 也无 inputs → 报错（旧格式）', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/pipeline.*inputs|inputs.*pipeline|dimensions/);
  });

  it('v2格式：dimensions 含全部6维度 → 合法，不需要 anatomy', () => {
    const r = validateReportData({
      skill: { name: 'x' },
      verdict: { level: 'pass' },
      dimensions: {
        functional_map: { rows: [{ no: 1, name: 'f1', trigger: 't', inputs: 'i', outputs: 'o', dep_health: 'ok' }] },
        dependency_audit: { items: [] },
        logic_soundness: { rules: [], score: 'sound' },
        output_verifiability: { items: [] },
        redline: { hallucination_risk: 'low', hard_stops: [], gaps: [] },
        maturity: { production_connected: false, tested_rounds: 0, score: 'prototype' },
      },
    });
    expect(r.valid).toBe(true);
    expect(r.version).toBe('v2');
  });

  it('v2格式：dimensions 缺少维度 → 报错', () => {
    const r = validateReportData({
      skill: { name: 'x' },
      verdict: { level: 'pass' },
      dimensions: {
        functional_map: { rows: [] },
      },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('dimensions.'))).toBe(true);
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
});
