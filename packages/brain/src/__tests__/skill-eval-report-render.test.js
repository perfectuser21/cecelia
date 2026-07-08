import { describe, it, expect } from 'vitest';
import { renderReportHtml, buildAnatomySvg } from '../skill-eval-report-render.js';
import fixture from '../__fixtures__/daily-report-cs.report.json';

describe('buildAnatomySvg', () => {
  const svg = buildAnatomySvg(fixture.anatomy);
  it('未接依赖渲染红断线 stroke-dasharray + 该 input 名', () => {
    expect(svg).toMatch(/stroke-dasharray/);
    expect(svg).toContain('状态包');
  });
  it('已接依赖不用断线（客户一句话为绿实线区）', () => {
    expect(svg).toContain('客户最新一句话');
  });
  it('内核 8 条规则名全部出现', () => {
    for (const r of fixture.anatomy.kernel.rules) expect(svg).toContain(r.name);
  });
  it('硬闸规则带 lock 标记', () => {
    expect(svg).toContain('🔒');
    expect(svg).toContain('事实边界');
    expect(svg).toContain('高风险转人工');
  });
  it('输出字段名出现', () => {
    for (const f of ['stage','signal','inquiry','risk','gap','escalate']) expect(svg).toContain(f);
  });
  it('同输入恒等输出（纯函数）', () => {
    expect(buildAnatomySvg(fixture.anatomy)).toBe(svg);
  });
});

describe('renderReportHtml', () => {
  it('完整 HTML 含裁决文案 + 解剖图三段 + 深入三项 + 6维指纹', () => {
    const html = renderReportHtml(fixture);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain(fixture.verdict.text);
    expect(html).toContain('输入'); expect(html).toContain('内核'); expect(html).toContain('输出');
    expect(html).toContain('询价分级');        // 深入·逻辑发现
    expect(html).toContain('回复自检 5 清单');  // 深入·红线
    expect(html).toContain('15×3 遍');          // 深入·成熟度
    // 6 维 health 色码：bad 用 fail 变量
    expect(html).toContain('var(--fail)');
  });
  it('report-data 畸形 → 兜底态，不抛错', () => {
    const html = renderReportHtml({ skill: {} });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('报告数据不完整');
  });
});
