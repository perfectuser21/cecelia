import { describe, it, expect } from 'vitest';
import { extractOpenclawAgents, extractOpenclawSkills } from '../ops-collector.js';

const CFG = {
  agents: { entries: {
    'work-commander': {
      name: 'work-commander',
      workspace: '/root/clawd-work-commander',
      agentDir: '/root/.openclaw/agents/work-commander/agent',
      model: { primary: 'openai/gpt-5.6-sol', fallbacks: [] },
      skills: ['agentic-workflow-runtime', 'social-leadgen-workflow', 'coding-workflow'],
      identity: { name: 'Work Commander', theme: 'OPC Workflow 总调度官', emoji: '🎛️' },
      subagents: { delegationMode: 'prefer', allowAgents: ['dev'] },
      tools: { alsoAllow: ['sessions_spawn', 'subagents'], deny: ['affine-suyanqing__*'] },
      apiKey: 'SECRET-MUST-NOT-LEAK',
    },
    'curator': { name: 'curator', model: 'sonnet', skills: [] },
  } },
  auth: { token: 'ALSO-SECRET' },
};

describe('extractOpenclawAgents — 详情补厚（刀5）', () => {
  const rows = extractOpenclawAgents(CFG);
  const wc = rows.find((r) => r.name === 'work-commander');

  it('采人设 identity（名/主题/emoji）', () => {
    expect(wc.meta.identity_name).toBe('Work Commander');
    expect(wc.meta.identity_theme).toBe('OPC Workflow 总调度官');
    expect(wc.meta.identity_emoji).toBe('🎛️');
  });

  it('model 对象取 primary；字符串直取', () => {
    expect(wc.meta.model).toBe('openai/gpt-5.6-sol');
    expect(rows.find((r) => r.name === 'curator').meta.model).toBe('sonnet');
  });

  it('采 skills 清单（最小执行单元）', () => {
    expect(wc.meta.skills).toEqual(['agentic-workflow-runtime', 'social-leadgen-workflow', 'coding-workflow']);
    expect(rows.find((r) => r.name === 'curator').meta.skills).toEqual([]);
  });

  it('采 workspace / agentDir（人设文件所在）', () => {
    expect(wc.meta.workspace).toBe('/root/clawd-work-commander');
    expect(wc.meta.agent_dir).toBe('/root/.openclaw/agents/work-commander/agent');
  });

  it('采工具权限（允许/禁止）', () => {
    expect(wc.meta.tools_allow).toEqual(['sessions_spawn', 'subagents']);
    expect(wc.meta.tools_deny).toEqual(['affine-suyanqing__*']);
  });

  it('白名单铁律：凭据绝不入库', () => {
    expect(JSON.stringify(rows)).not.toContain('SECRET');
    expect(wc.meta.apiKey).toBeUndefined();
  });
});

describe('extractOpenclawSkills — skill 是最小单元，与 agent 多对多', () => {
  it('汇总每个 skill 被哪些 agent 使用', () => {
    const skills = extractOpenclawSkills(CFG);
    const s = skills.find((x) => x.name === 'social-leadgen-workflow');
    expect(s.used_by).toEqual(['work-commander']);
    expect(skills.length).toBe(3);       // curator 无 skill
  });

  it('多 agent 共用同一 skill → used_by 多值', () => {
    const cfg = { agents: { entries: {
      a: { skills: ['shared-skill'] }, b: { skills: ['shared-skill'] }, c: { skills: [] },
    } } };
    const s = extractOpenclawSkills(cfg).find((x) => x.name === 'shared-skill');
    expect(s.used_by.sort()).toEqual(['a', 'b']);
  });

  it('无 skill 配置 → 空数组不抛', () => {
    expect(extractOpenclawSkills({ agents: { entries: {} } })).toEqual([]);
    expect(extractOpenclawSkills({})).toEqual([]);
  });
});
