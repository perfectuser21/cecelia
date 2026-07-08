import { describe, it, expect } from 'vitest';
import { renderReportHtml } from '../skill-eval-report-render.js';

// 同时满足老 schema.js（anatomy.inputs 数组 + anatomy.kernel.rules 数组）
// 和新渲染器要认的 anatomy.pipeline —— 这样这个测试只依赖本任务的渲染器改动，
// 不依赖 schema.js 才会做的改动。
const fixture = {
  skill: { name: '临时skill', area: 'A', line: 'L' },
  verdict: { level: 'pass', text: 'ok' },
  anatomy: {
    input: '输入X',
    loadMode: '全部前置',
    pipeline: ['load|数据A|库|来源A|已接', 'judge|判定Y'],
    inputs: [],
    kernel: { rules: [] },
    outputs: [{ name: '输出Z', kind: '文本' }],
  },
};

describe('renderReportHtml — pipeline 连线图渲染器（折自 render.mjs）', () => {
  it('认识 anatomy.pipeline，画出 n8n 风格三段带（输入/SKILL 内部/输出），不是老解剖图', () => {
    const html = renderReportHtml(fixture);
    expect(html).toContain('SKILL 内部');
    expect(html).toContain('输入');
    expect(html).toContain('输出');
  });

  it('pipeline 里的 load/judge 步骤名称出现在图里', () => {
    const html = renderReportHtml(fixture);
    expect(html).toContain('数据A');
    expect(html).toContain('判定Y');
  });

  it('不落入 fallback 兜底态', () => {
    const html = renderReportHtml(fixture);
    expect(html).not.toContain('报告数据不完整');
  });
});
