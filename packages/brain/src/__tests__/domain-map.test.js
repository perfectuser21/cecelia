/**
 * domain-map.js 单元测试
 *
 * 覆盖：detectDomain, getDomainOwnerRole, DOMAIN_TO_OWNER_ROLE
 */

import { describe, it, expect } from 'vitest';
import { detectDomain, getDomainOwnerRole, DOMAIN_TO_OWNER_ROLE } from '../domain-map.js';

describe('detectDomain', () => {
  it('无文本时返回 coding（默认值）', () => {
    expect(detectDomain('')).toBe('coding');
    expect(detectDomain(null)).toBe('coding');
    expect(detectDomain(undefined)).toBe('coding');
  });

  it('无关键词信号时返回 coding（默认值）', () => {
    expect(detectDomain('完成这项任务')).toBe('coding');
    expect(detectDomain('处理一下这个问题')).toBe('coding');
  });

  it('coding domain — 匹配代码/bug/CI 关键词', () => {
    expect(detectDomain('修复登录 bug')).toBe('coding');
    expect(detectDomain('重构代码模块')).toBe('coding');
    expect(detectDomain('CI 流水线优化')).toBe('coding');
    expect(detectDomain('实现 API 接口')).toBe('coding');
  });

  it('product domain — 匹配产品/需求/PRD 关键词', () => {
    expect(detectDomain('产品需求评审')).toBe('product');
    expect(detectDomain('用户体验优化方案')).toBe('product');
    expect(detectDomain('设计交互流程')).toBe('product');
  });

  it('growth domain — 匹配营销/SEO/增长关键词', () => {
    expect(detectDomain('SEO 关键词优化')).toBe('growth');
    expect(detectDomain('制定用户增长策略')).toBe('growth');
    expect(detectDomain('活动策划方案')).toBe('growth');
  });

  it('finance domain — 匹配财务/预算关键词', () => {
    expect(detectDomain('本月财务报表汇总')).toBe('finance');
    expect(detectDomain('公司预算规划')).toBe('finance');
    expect(detectDomain('ROI 回报核算')).toBe('finance');
  });

  it('research domain — 匹配调研/竞品/分析关键词', () => {
    expect(detectDomain('竞品分析报告')).toBe('research');
    expect(detectDomain('用户访谈结果')).toBe('research');
    expect(detectDomain('市场调查问卷')).toBe('research');
  });

  it('knowledge domain — 匹配文档/知识库关键词', () => {
    expect(detectDomain('更新 README')).toBe('knowledge');
    expect(detectDomain('维护知识库')).toBe('knowledge');
  });

  it('operations domain — 匹配运维/部署/监控关键词', () => {
    expect(detectDomain('配置 docker 容器')).toBe('operations');
    expect(detectDomain('设置监控告警')).toBe('operations');
    expect(detectDomain('nginx 配置优化')).toBe('operations');
  });

  it('security domain — 匹配安全/漏洞/认证关键词', () => {
    expect(detectDomain('修复 XSS 安全漏洞')).toBe('security');
    expect(detectDomain('OAuth 鉴权方案')).toBe('security');
    expect(detectDomain('数据加密处理')).toBe('security');
  });

  it('quality domain — 匹配 QA/测试覆盖/回归关键词', () => {
    expect(detectDomain('提升测试覆盖率')).toBe('quality');
    expect(detectDomain('QA 回归测试')).toBe('quality');
    expect(detectDomain('修复 flaky 测试')).toBe('quality');
  });

  it('agent_ops domain — 匹配 Brain/Cecelia/调度关键词', () => {
    expect(detectDomain('优化 Brain 任务调度')).toBe('agent_ops');
    expect(detectDomain('Cecelia 派发逻辑修复')).toBe('agent_ops');
    expect(detectDomain('LLM prompt 优化')).toBe('agent_ops');
    expect(detectDomain('n8n pipeline 配置')).toBe('agent_ops');
  });

  it('优先级：agent_ops > quality（当文本同时包含两个 domain 关键词）', () => {
    expect(detectDomain('Brain 调度 QA 测试覆盖')).toBe('agent_ops');
  });

  it('优先级：quality > security', () => {
    expect(detectDomain('安全漏洞 QA 回归测试')).toBe('quality');
  });

  it('优先级：security > coding', () => {
    expect(detectDomain('实现 OAuth 安全认证')).toBe('security');
  });
});

describe('getDomainOwnerRole', () => {
  it('所有 10 个 domain 正确映射到 owner_role', () => {
    expect(getDomainOwnerRole('coding')).toBe('cto');
    expect(getDomainOwnerRole('product')).toBe('cpo');
    expect(getDomainOwnerRole('growth')).toBe('cmo');
    expect(getDomainOwnerRole('finance')).toBe('cfo');
    expect(getDomainOwnerRole('research')).toBe('vp_research');
    expect(getDomainOwnerRole('quality')).toBe('vp_qa');
    expect(getDomainOwnerRole('security')).toBe('cto');
    expect(getDomainOwnerRole('operations')).toBe('coo');
    expect(getDomainOwnerRole('knowledge')).toBe('vp_knowledge');
    expect(getDomainOwnerRole('agent_ops')).toBe('vp_agent_ops');
  });

  it('未知 domain 返回 cto（兜底）', () => {
    expect(getDomainOwnerRole('unknown')).toBe('cto');
    expect(getDomainOwnerRole('')).toBe('cto');
    expect(getDomainOwnerRole(null)).toBe('cto');
  });
});

describe('DOMAIN_TO_OWNER_ROLE', () => {
  it('包含全部 10 个 domain', () => {
    const expectedDomains = [
      'coding', 'product', 'growth', 'finance', 'research',
      'quality', 'security', 'operations', 'knowledge', 'agent_ops'
    ];
    for (const domain of expectedDomains) {
      expect(DOMAIN_TO_OWNER_ROLE[domain]).toBeDefined();
    }
  });
});
