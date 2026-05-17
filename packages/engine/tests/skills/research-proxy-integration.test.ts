import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROXY_FILE = join(process.cwd(), 'skills/dev/steps/autonomous-research-proxy.md');
const SKILL_FILE = join(process.cwd(), 'skills/dev/SKILL.md');

describe('autonomous-research-proxy 行为规则', () => {
  const content = readFileSync(PROXY_FILE, 'utf8');

  it('触发点清单 Tier 1/2/3 完整', () => {
    ['Tier 1', 'Tier 2', 'Tier 3'].forEach((t) => {
      expect(content).toContain(t);
    });
  });

  it('包含主要 Superpowers skill 名', () => {
    [
      'brainstorming',
      'writing-plans',
      'finishing-a-development-branch',
      'subagent-driven-development',
      'executing-plans',
      'systematic-debugging',
      'receiving-code-review',
    ].forEach((s) => expect(content).toContain(s));
  });

  it('Subagent prompt 模板含 Phase 8.1 数据源排序', () => {
    // Phase 8.1 重构：anchor 从 "Code reality/OKR/Historical decisions/Learnings/First-principles"
    // 改成 "用户的话 > 现有代码 > OKR"，且明确"不读 decisions/learnings"
    [
      '用户的话',
      '现有代码',
      'OKR',
    ].forEach((anchor) => expect(content).toContain(anchor));
    expect(content).toMatch(/不(用|读).{0,20}decisions/);
  });

  it('Model Selection 3 档', () => {
    ['Opus', 'Sonnet', 'Haiku'].forEach((m) => expect(content).toContain(m));
  });

  it('Confidence high 分支 -> 继续', () => {
    expect(content).toMatch(/high[\s\S]{0,100}继续/);
  });

  it('Confidence medium 分支 -> PR body 标注', () => {
    expect(content).toMatch(/medium[\s\S]{0,150}PR body/);
  });

  it('Confidence low 分支 -> 暂停 + 创 Brain task + awaiting_human_decision', () => {
    expect(content).toContain('low');
    expect(content).toContain('Brain task');
    expect(content).toContain('awaiting_human_decision');
  });

  it('Phase 6 新规则：Tier 1 含 enrich-decide（Phase 8.1 移除 decisions/match）', () => {
    expect(content).toContain('enrich-decide');
  });

  it('Phase 5 硬规则：finishing → engine-ship', () => {
    expect(content).toContain('engine-ship');
  });
});

describe('SKILL.md 加载 autonomous-research-proxy 规则 + inline Tier 1 快速参考', () => {
  const content = readFileSync(SKILL_FILE, 'utf8');

  it('提及 autonomous-research-proxy 文件', () => {
    expect(content).toContain('autonomous-research-proxy');
  });

  it('inline Tier 1 核心条款', () => {
    expect(content).toContain('Research Subagent');
    expect(content).toContain('不停下');
  });

  it('TERMINAL IMPERATIVE 指向 engine-worktree', () => {
    expect(content).toContain('engine-worktree');
    expect(content).toContain('TERMINAL IMPERATIVE');
  });
});
