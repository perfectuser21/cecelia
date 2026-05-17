import { describe, it, expect } from 'vitest';
import { matchDecisions, extractTopicsFromPRD, findBestDecisionMatch, classifyTopicCriticality } from '../routes/decisions.js';

describe('matchDecisions — decisions 匹配核心', () => {
  const fixtureDecisions = [
    { id: 1, topic: '数据库选型', decision: '用 PostgreSQL + pgvector' },
    { id: 2, topic: 'API 认证方式', decision: 'JWT + Refresh Token' },
    { id: 3, topic: '前端状态管理', decision: 'Zustand' },
  ];

  it('场景 1: 全匹配 — 所有 topic 都有历史决策', async () => {
    const prd = '## 数据库选型\n需要选一个向量库.\n## API 认证方式\n用户登录流程.';
    const result = await matchDecisions(prd, [], fixtureDecisions);
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.matched.some((m) => m.decision_topic === '数据库选型')).toBe(true);
    expect(result.matched.some((m) => m.decision_topic === 'API 认证方式')).toBe(true);
  });

  it('场景 2: 部分匹配 — 部分 topic 有决策, 部分缺失', async () => {
    const prd = '## 数据库选型\n这部分有.\n## 日志格式\n这部分没历史决策.';
    const result = await matchDecisions(prd, [], fixtureDecisions);
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('场景 3: 全缺失 — 所有 topic 都没历史决策', async () => {
    const prd = '## 完全陌生的主题\n## 另一个陌生主题';
    const result = await matchDecisions(prd, [], fixtureDecisions);
    expect(result.matched.length).toBe(0);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('classifyTopicCriticality: 架构类 → critical', () => {
    expect(classifyTopicCriticality('数据库架构设计')).toBe('critical');
    expect(classifyTopicCriticality('API security 方案')).toBe('critical');
    expect(classifyTopicCriticality('变量命名风格')).toBe('routine');
  });

  it('extractTopicsFromPRD: 从 ## headers 和关键模式提取', () => {
    const prd = '## 数据库选型\n要用什么 db?';
    const topics = extractTopicsFromPRD(prd);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics).toContain('数据库选型');
  });

  it('空 PRD 返回空结果', async () => {
    const r = await matchDecisions('', [], fixtureDecisions);
    expect(r.matched).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('DB 不可用时返回空结果不崩', async () => {
    const r = await matchDecisions('## 某主题', [], []);
    expect(r.matched).toEqual([]);
    expect(Array.isArray(r.missing)).toBe(true);
  });
});
