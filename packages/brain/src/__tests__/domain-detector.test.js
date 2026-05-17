/**
 * domain-detector.js 单元测试
 *
 * 覆盖：10 个 domain 关键词检测、优先级规则、默认值
 */

import { describe, it, expect } from 'vitest';
import { detectDomain } from '../domain-detector.js';

describe('detectDomain() — 基础 domain 检测', () => {
  it('coding: 检测到代码/开发关键词', () => {
    const result = detectDomain('修复登录 bug，重构 API 接口');
    expect(result.domain).toBe('coding');
    expect(result.owner_role).toBe('cto');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('product: 检测到产品/需求关键词', () => {
    const result = detectDomain('写产品需求 PRD，设计用户体验流程');
    expect(result.domain).toBe('product');
    expect(result.owner_role).toBe('cpo');
  });

  it('growth: 检测到增长/营销关键词', () => {
    const result = detectDomain('制定 SEO 运营推广策略，提升用户增长');
    expect(result.domain).toBe('growth');
    expect(result.owner_role).toBe('cmo');
  });

  it('finance: 检测到财务/预算关键词', () => {
    const result = detectDomain('制定年度预算，分析成本收入报表');
    expect(result.domain).toBe('finance');
    expect(result.owner_role).toBe('cfo');
  });

  it('research: 检测到调研/分析关键词', () => {
    const result = detectDomain('进行市场调查和竞品研究分析');
    expect(result.domain).toBe('research');
    expect(result.owner_role).toBe('vp_research');
  });

  it('quality: 检测到 QA/测试关键词', () => {
    const result = detectDomain('提高测试覆盖率，补充回归测试 vitest');
    expect(result.domain).toBe('quality');
    expect(result.owner_role).toBe('vp_qa');
  });

  it('security: 检测到安全/权限关键词', () => {
    const result = detectDomain('修复认证漏洞，加强权限加密合规');
    expect(result.domain).toBe('security');
    expect(result.owner_role).toBe('cto');
  });

  it('operations: 检测到运维/部署关键词', () => {
    const result = detectDomain('部署 nginx 监控告警，搭建 DevOps 基础设施');
    expect(result.domain).toBe('operations');
    expect(result.owner_role).toBe('coo');
  });

  it('knowledge: 检测到知识/文档关键词', () => {
    const result = detectDomain('整理知识库文档笔记，更新 wiki');
    expect(result.domain).toBe('knowledge');
    expect(result.owner_role).toBe('vp_knowledge');
  });

  it('agent_ops: 检测到 Cecelia/Brain/调度关键词', () => {
    const result = detectDomain('优化 Cecelia Brain 任务调度 dispatch executor');
    expect(result.domain).toBe('agent_ops');
    expect(result.owner_role).toBe('vp_agent_ops');
  });
});

describe('detectDomain() — 优先级规则', () => {
  it('agent_ops 优先于 coding（最高优先级）', () => {
    const result = detectDomain('实现 Brain dispatch 代码，修复 bug，重构 API');
    expect(result.domain).toBe('agent_ops');
  });

  it('agent_ops 优先于 quality', () => {
    const result = detectDomain('给 Brain executor 补充单元测试 vitest coverage');
    expect(result.domain).toBe('agent_ops');
  });

  it('quality 优先于 coding', () => {
    const result = detectDomain('写代码实现 vitest 测试覆盖率 regression');
    expect(result.domain).toBe('quality');
  });

  it('security 优先于 coding', () => {
    const result = detectDomain('实现 auth token 加密模块代码');
    expect(result.domain).toBe('security');
  });

  it('agent_ops 优先于 security', () => {
    const result = detectDomain('Brain dispatch 安全漏洞 permission 修复');
    expect(result.domain).toBe('agent_ops');
  });
});

describe('detectDomain() — 默认值与边界', () => {
  it('无匹配关键词 → 默认 coding', () => {
    const result = detectDomain('hello world');
    expect(result.domain).toBe('coding');
    expect(result.owner_role).toBe('cto');
    expect(result.confidence).toBe(0);
  });

  it('null 输入 → 默认 coding', () => {
    const result = detectDomain(null);
    expect(result.domain).toBe('coding');
    expect(result.owner_role).toBe('cto');
    expect(result.confidence).toBe(0);
  });

  it('undefined 输入 → 默认 coding', () => {
    const result = detectDomain(undefined);
    expect(result.domain).toBe('coding');
    expect(result.confidence).toBe(0);
  });

  it('空字符串 → 默认 coding', () => {
    const result = detectDomain('');
    expect(result.domain).toBe('coding');
    expect(result.confidence).toBe(0);
  });

  it('仅空白字符 → 默认 coding', () => {
    const result = detectDomain('   ');
    expect(result.domain).toBe('coding');
    expect(result.confidence).toBe(0);
  });

  it('非字符串类型 → 默认 coding', () => {
    const result = detectDomain(42);
    expect(result.domain).toBe('coding');
    expect(result.confidence).toBe(0);
  });

  it('返回对象包含 domain、owner_role、confidence 三个字段', () => {
    const result = detectDomain('Cecelia Brain');
    expect(result).toHaveProperty('domain');
    expect(result).toHaveProperty('owner_role');
    expect(result).toHaveProperty('confidence');
  });

  it('confidence 值在 0~1 之间', () => {
    const result = detectDomain('Brain dispatch executor tick planner thalamus cortex');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('detectDomain() — 大小写不敏感', () => {
  it('英文关键词大写也能匹配', () => {
    const result = detectDomain('BRAIN DISPATCH AGENT OKR');
    expect(result.domain).toBe('agent_ops');
  });

  it('混合大小写', () => {
    const result = detectDomain('Vitest Coverage QA Regression');
    expect(result.domain).toBe('quality');
  });
});
