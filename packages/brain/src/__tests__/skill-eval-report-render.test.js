import { describe, it, expect } from 'vitest';
import { renderReportHtml, renderComparePage } from '../skill-eval-report-render.js';
import { validateReportData } from '../skill-eval-report-schema.js';
import realFixture from './fixtures/report_data8-real.json';
import interleavedFixture from './fixtures/report_interleaved-example.json';

describe('renderReportHtml — report_data8-real.json（全部前置，daily-report-v1-2）', () => {
  const html = renderReportHtml(realFixture);

  it('不落入 fallback 兜底态', () => {
    expect(html).not.toContain('报告数据不完整');
  });

  it('是完整 HTML 页面', () => {
    expect(html).toMatch(/^<!doctype html>/i);
  });

  it('breadcrumb 含 area/line', () => {
    expect(html).toContain('Line 02 客户智能获客路径');
  });

  it('skill 名称与裁决标签出现', () => {
    expect(html).toContain('daily-report-v1-2');
    expect(html).toContain('改了能用'); // verdict.level === 'partial' 的中文标签
  });

  it('summary 一句话出现在 lead 里', () => {
    expect(html).toContain('规则写得细致老实,但客户数据库这些资料源压根没接通,现在跑不了全自动化。');
  });

  it('识别出 loadMode=全部前置，不是穿插判定', () => {
    expect(html).toContain('全部前置 · 先读完再判');
  });

  it('主流程步数统计：pipeline 共 15 步，7 读 6 判 2 闸；6 个 load 未接', () => {
    expect(html).toContain('7读 6判 2闸');
    expect(html).toContain('6 未接');
  });

  it('输入节点 客户名称 与判定/闸步骤文案原样出现在连线图节点里', () => {
    expect(html).toContain('客户名称');
    expect(html).toContain('判推进信号强弱'); // judge 步骤
    expect(html).toContain('事实越界编造'); // gate 步骤
  });

  it('输出节点名称出现', () => {
    expect(html).toContain('单客户日报');
  });

  it('nextSteps 第一条（issue+fix）原样出现', () => {
    expect(html).toContain('客户数据库等8类资料源全包没有任何真实接口定义');
    expect(html).toContain('补上数据库或API对接方式,或明确改成用户手动贴资料模式');
  });
});

describe('renderReportHtml — report_interleaved-example.json（穿插判定，realtime-reply-cs）', () => {
  const html = renderReportHtml(interleavedFixture);

  it('不落入 fallback 兜底态', () => {
    expect(html).not.toContain('报告数据不完整');
  });

  it('识别出 loadMode=穿插判定', () => {
    expect(html).toContain('穿插判定 · 边判边读');
  });

  it('主流程步数统计：11 步，4 读 5 判 2 闸；1 个 load 未接（历史订单）', () => {
    expect(html).toContain('4读 5判 2闸');
    expect(html).toContain('1 未接');
  });

  it('skill 名称与 summary 出现', () => {
    expect(html).toContain('realtime-reply-cs');
    expect(html).toContain('边判边读逻辑清晰，但历史订单接口没接通');
  });

  it('类型图例含来源方式友好名（结构化库 / 外部API）', () => {
    expect(html).toContain('结构化库');
    expect(html).toContain('外部API');
  });

  it('nextSteps 第一条原样出现', () => {
    expect(html).toContain('历史订单 API 没接，第5步拿不到数据');
  });
});

describe('validateReportData 对两份真实 fixture 均判定合法（不进入 fallback 的前提条件）', () => {
  it('report_data8-real.json valid', () => {
    expect(validateReportData(realFixture)).toEqual({ valid: true, errors: [] });
  });
  it('report_interleaved-example.json valid', () => {
    expect(validateReportData(interleavedFixture)).toEqual({ valid: true, errors: [] });
  });
});

describe('renderComparePage — 导出面保留验证（无新调用方，但需保证可用）', () => {
  it('把两份真实报告放进一页对比，各自 label 与 skill 名称都出现', () => {
    const html = renderComparePage([
      { label: '全部前置示例', data: realFixture },
      { label: '穿插判定示例', data: interleavedFixture },
    ]);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('全部前置示例');
    expect(html).toContain('穿插判定示例');
    expect(html).toContain('daily-report-v1-2');
    expect(html).toContain('realtime-reply-cs');
  });
});
