import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROXY_FILE = join(process.cwd(), 'skills/dev/steps/autonomous-research-proxy.md');
const SKILL_FILE = join(process.cwd(), 'skills/dev/SKILL.md');
const DECISION_FILE = join(process.cwd(), 'skills/engine-decision/SKILL.md');

describe('autonomous-research-proxy 行为规则', () => {
  const content = readFileSync(PROXY_FILE, 'utf8');

  it('触发点清单 Tier 1/2/3 完整', () => {
    ['Tier 1', 'Tier 2', 'Tier 3'].forEach((t) => {
      expect(content).toContain(t);
    });
  });

  it('包含 8 个 Superpowers skill 名', () => {
    [
      'brainstorming',
      'writing-plans',
      'finishing-a-development-branch',
      'using-git-worktrees',
      'subagent-driven-development',
      'executing-plans',
      'systematic-debugging',
      'receiving-code-review',
    ].forEach((s) => expect(content).toContain(s));
  });

  it('Subagent prompt 模板含 5 项 research anchor', () => {
    [
      'Code reality',
      'OKR strategic',
      'Historical decisions',
      'Related Learnings',
      'First-principles',
    ].forEach((anchor) => expect(content).toContain(anchor));
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

  it('与 Step 0.5/0.7 分工说明清晰', () => {
    expect(content).toContain('Step 0.5');
    expect(content).toContain('Step 0.7');
    expect(content).toContain('Enrich');
    expect(content).toContain('Decision Query');
  });
});

describe('SKILL.md 默认加载 autonomous-research-proxy（Phase 1 Round 2 后）', () => {
  const content = readFileSync(SKILL_FILE, 'utf8');

  it('提及 autonomous-research-proxy 文件', () => {
    expect(content).toContain('autonomous-research-proxy');
  });

  it('说明 proxy 角色（Phase 5 后是规则文件，替代/代答 Superpowers 交互点）', () => {
    // Phase 5 改为纯点火链后，SKILL.md 说明 proxy 是"问用户"交互点替代规则
    expect(content).toMatch(/autonomous-research-proxy[\s\S]{0,800}(必读|默认加载|核心|真价值|替代|代答|规则|Tier)/);
  });
});

describe('engine-decision SKILL.md（Phase 5 迁移自 00.7-decision-query.md v1.1.0）', () => {
  const content = readFileSync(DECISION_FILE, 'utf8');

  it('说明 Decisions 为推理输入非硬约束（v1.1.0 重塑精神保留）', () => {
    expect(content.toLowerCase()).toMatch(/推理输入|subagent/);
  });

  it('说明后续 Superpowers 链消费 decisions', () => {
    expect(content.toLowerCase()).toContain('subagent');
  });

  it('包含 TERMINAL IMPERATIVE（Phase 5 要求）', () => {
    expect(content).toContain('TERMINAL IMPERATIVE');
  });
});
