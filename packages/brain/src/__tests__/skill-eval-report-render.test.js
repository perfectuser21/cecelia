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

  it('旧格式（anatomy.pipeline）：不渲染圆核图，不崩溃', () => {
    // 新渲染器对旧格式只显示基础信息，不渲染 SVG 连线图
    expect(html).not.toContain('报告数据不完整');
    // verdict 和 skill 名依然出现
    expect(html).toContain('daily-report-v1-2');
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

  it('旧格式（anatomy.pipeline）：不渲染圆核图，不崩溃', () => {
    expect(html).not.toContain('报告数据不完整');
  });

  it('skill 名称与 summary 出现', () => {
    expect(html).toContain('realtime-reply-cs');
    expect(html).toContain('边判边读逻辑清晰，但历史订单接口没接通');
  });

  it('nextSteps 第一条原样出现', () => {
    expect(html).toContain('历史订单 API 没接，第5步拿不到数据');
  });
});

describe('renderReportHtml — 新 6维度格式渲染测试', () => {
  const newFmtData = {
    skill: { name: '客户日报 Skill v2', area: 'ZenithJoy', line: 'Line 04', ability: '智能日报' },
    verdict: { level: 'partial', text: '核心功能可跑，但历史订单接口未接通' },
    stats: { function_count: 2, dep_gaps: 1, defects_high: 1, defects_mid_low: 2, cost_estimate_usd: 0.08, eval_minutes: 12 },
    summary: '核心功能可跑，但历史订单接口未接通，建议先在沙箱测试',
    dimensions: {
      functional_map: {
        rows: [
          { no: 1, name: '日报生成', trigger: '每日09:00定时', inputs: '客户数据库', outputs: '日报文件', dep_health: 'ok' },
          { no: 2, name: '发送通知', trigger: '日报生成后', inputs: '微信API', outputs: '通知消息', dep_health: 'warning', dep_health_note: '微信API密钥未确认' },
        ],
      },
      dependency_audit: {
        items: [
          { dep: '客户数据库', source_type: '数据库', source_desc: 'PostgreSQL prod', status: 'confirmed', note: '已接通' },
          { dep: '微信API', source_type: 'API', source_desc: 'weixin.qq.com', status: 'questionable', note: '密钥存疑' },
        ],
      },
      logic_soundness: {
        rules: ['当客户数据缺失时报错而不是跳过'],
        contradictions: [],
        undefined_fields: ['customer_tier'],
        hard_stops: ['数据缺失时直接返回错误'],
        score: 'minor_issues',
      },
      output_verifiability: {
        items: [
          { output_name: '日报文件', format: 'PDF', machine_verifiable: true, verification_method: 'file size > 0 且 content-type=application/pdf' },
        ],
      },
      redline: {
        hallucination_risk: 'low',
        risk_reason: '所有数字来自真实数据库，不依赖模型生成',
        hard_stops: ['数据库查询失败时不生成报告'],
        gaps: [],
      },
      maturity: {
        production_connected: false,
        production_details: '',
        real_db_connected: true,
        real_db_details: 'cecelia PostgreSQL',
        tested_rounds: 3,
        real_sample_validated: true,
        honest_about_gaps: true,
        undocumented_assumptions: ['假设客户数据每日更新'],
        score: 'mvp',
      },
    },
    defects: [
      { id: 'H1', severity: 'high', title: '微信API密钥未配置', section_ref: '第3节', description: '密钥存疑', fix: '在.env中配置WX_API_KEY' },
    ],
    model_recommendation: '建议用 claude-sonnet-4-6，成本与精度平衡最优',
  };

  const html = renderReportHtml(newFmtData);

  it('不落入 fallback', () => { expect(html).not.toContain('报告数据不完整'); });
  it('统计条渲染：功能线/依赖缺口/高危缺陷', () => {
    expect(html).toContain('2');
    expect(html).toContain('功能线');
    expect(html).toContain('高危缺陷');
  });
  it('维度1 功能地图：表格行出现', () => {
    expect(html).toContain('日报生成');
    expect(html).toContain('发送通知');
    expect(html).toContain('接通');
  });
  it('维度2 依赖审计：来源状态出现', () => {
    expect(html).toContain('来源明确');
    expect(html).toContain('存疑');
  });
  it('维度3 判定逻辑：规则与未定义字段', () => {
    expect(html).toContain('customer_tier');
  });
  it('维度5 红线：低风险标签', () => {
    expect(html).toContain('低风险');
  });
  it('维度6 成熟度：MVP', () => {
    expect(html).toContain('MVP');
  });
  it('缺陷清单：H1出现', () => {
    expect(html).toContain('H1');
    expect(html).toContain('微信API密钥未配置');
  });
  it('生产选型建议出现', () => {
    expect(html).toContain('claude-sonnet-4-6');
  });
});

describe('validateReportData 对两份真实 fixture 均判定合法（不进入 fallback 的前提条件）', () => {
  it('report_data8-real.json valid', () => {
    const r = validateReportData(realFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('report_interleaved-example.json valid', () => {
    const r = validateReportData(interleavedFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
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

describe('多模型逐线对比表 — model_comparisons 渲染', () => {
  const dataWithComparisons = {
    skill: { name: '测试Skill', area: 'ZenithJoy', line: 'Line 04', ability: '客服' },
    verdict: { level: 'partial', text: '核心可跑，依赖存疑' },
    summary: '核心功能可跑',
    dimensions: {
      functional_map: { rows: [{ no: 1, name: '主流程', trigger: '定时', inputs: 'DB', outputs: '报告', dep_health: 'ok' }] },
      dependency_audit: { items: [] },
      logic_soundness: { rules: [], score: 'sound' },
      output_verifiability: { items: [] },
      redline: { hallucination_risk: 'low', hard_stops: [], gaps: [] },
      maturity: { production_connected: false, tested_rounds: 1, score: 'prototype' },
    },
    model_comparisons: [
      {
        model_id: 'claude-sonnet-4-6',
        label: 'Sonnet 4.6（主评）',
        is_primary: true,
        verdict_level: 'partial',
        verdict_text: '核心可跑，依赖存疑',
        dimension_scores: {
          functional_map: 'ok',
          dependency_audit: 'partial',
          logic_soundness: 'ok',
          output_verifiability: 'ok',
          redline: 'low',
          maturity: 'prototype',
        },
        defects_high: 0,
        defects_total: 1,
      },
      {
        model_id: 'claude-opus-4-8',
        label: 'Opus 4.8（对照）',
        is_primary: false,
        verdict_level: 'fail',
        verdict_text: '依赖审计失败，无法投产',
        dimension_scores: {
          functional_map: 'ok',
          dependency_audit: 'fail',
          logic_soundness: 'ok',
          output_verifiability: 'partial',
          redline: 'medium',
          maturity: 'prototype',
        },
        defects_high: 1,
        defects_total: 3,
      },
    ],
  };

  const html = renderReportHtml(dataWithComparisons);

  it('不落入 fallback', () => {
    expect(html).not.toContain('报告数据不完整');
  });

  it('多模型对比表：表头含两个模型标签', () => {
    expect(html).toContain('Sonnet 4.6（主评）');
    expect(html).toContain('Opus 4.8（对照）');
  });

  it('多模型对比表：各维度行出现', () => {
    expect(html).toContain('功能地图');
    expect(html).toContain('依赖审计');
    expect(html).toContain('逻辑健全');
    expect(html).toContain('输出可验证');
    expect(html).toContain('红线');
    expect(html).toContain('成熟度');
  });

  it('多模型对比表：总裁决行出现', () => {
    expect(html).toContain('总裁决');
  });

  it('多模型对比表：Opus的fail裁决出现', () => {
    expect(html).toContain('还不能用');
  });

  it('有 model_comparisons 时出现 mc-table 容器', () => {
    expect(html).toContain('mc-table');
  });
});
