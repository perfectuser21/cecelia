import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const SKILLS_BASE = join(os.homedir(), '.claude', 'skills');
const PROXY_FILE = join(SKILLS_BASE, 'dev', 'steps', 'autonomous-research-proxy.md');
const SKILL_FILE = join(SKILLS_BASE, 'dev', 'SKILL.md');
const filesExist = existsSync(PROXY_FILE) && existsSync(SKILL_FILE);

describe('autonomous-research-proxy 行为规则', () => {
  const content = filesExist ? readFileSync(PROXY_FILE, 'utf8') : '';

  it.skipIf(!filesExist)('触发点清单 Tier 1/2/3 完整', () => {
    ['Tier 1', 'Tier 2', 'Tier 3'].forEach((t) => {
      expect(content).toContain(t);
    });
  });

  it.skipIf(!filesExist)('包含主要 Superpowers skill 名', () => {
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

  it.skipIf(!filesExist)('Subagent prompt 模板含 Phase 8.1 数据源排序', () => {
    // Phase 8.1 重构：anchor 从 "Code reality/OKR/Historical decisions/Learnings/First-principles"
    // 改成 "用户的话 > 现有代码 > OKR"，且明确"不读 decisions/learnings"
    [
      '用户的话',
      '现有代码',
      'OKR',
    ].forEach((anchor) => expect(content).toContain(anchor));
    expect(content).toMatch(/不(用|读).{0,20}decisions/);
  });

  it.skipIf(!filesExist)('Model Selection 3 档', () => {
    ['Opus', 'Sonnet', 'Haiku'].forEach((m) => expect(content).toContain(m));
  });

  it.skipIf(!filesExist)('Confidence high 分支 -> 继续', () => {
    expect(content).toMatch(/high[\s\S]{0,100}继续/);
  });

  it.skipIf(!filesExist)('Confidence medium 分支 -> PR body 标注', () => {
    expect(content).toMatch(/medium[\s\S]{0,150}PR body/);
  });

  it.skipIf(!filesExist)('Confidence low 分支 -> 暂停 + 创 Brain task + awaiting_human_decision', () => {
    expect(content).toContain('low');
    expect(content).toContain('Brain task');
    expect(content).toContain('awaiting_human_decision');
  });

  it.skipIf(!filesExist)('Phase 6 新规则：Tier 1 含 enrich-decide（Phase 8.1 移除 decisions/match）', () => {
    expect(content).toContain('enrich-decide');
  });

  it.skipIf(!filesExist)('Phase 5 硬规则：finishing → engine-ship', () => {
    expect(content).toContain('engine-ship');
  });
});

describe('SKILL.md v19+ 结构验证（PrepPRD 驱动架构）', () => {
  const content = filesExist ? readFileSync(SKILL_FILE, 'utf8') : '';

  it.skipIf(!filesExist)('包含 PrepPRD 三种格式（Bug/小改动/大功能）', () => {
    expect(content).toContain('Bug PrepPRD');
    expect(content).toContain('小改动 PrepPRD');
    expect(content).toContain('大功能 PrepPRD');
  });

  it.skipIf(!filesExist)('包含 Brain DB 10 张表查询', () => {
    expect(content).toContain('journeys');
    expect(content).toContain('journey_steps');
  });

  it.skipIf(!filesExist)('大功能 PrepPRD 含 E2E 测试账号必填段', () => {
    expect(content).toContain('E2E 测试账号');
    expect(content).toContain('engine-worktree');
  });
});
