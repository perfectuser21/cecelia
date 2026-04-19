import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROXY_FILE = join(process.cwd(), 'skills/dev/steps/autonomous-research-proxy.md');
const SKILL_FILE = join(process.cwd(), 'skills/dev/SKILL.md');
const DECISION_FILE = join(process.cwd(), 'skills/dev/steps/00.7-decision-query.md');

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

  it('说明 /dev 必读 proxy（Phase 4 后 autonomous-research-proxy 是核心价值）', () => {
    // Phase 4 改为调 /superpowers:* 后，SKILL.md 仍强调 proxy 必读
    expect(content).toMatch(/autonomous-research-proxy[\s\S]{0,800}(必读|默认加载|Engine (核心|真价值)|替代)/);
  });
});

describe('00.7-decision-query.md v1.1.0 重塑', () => {
  const content = readFileSync(DECISION_FILE, 'utf8');

  it('包含 v1.1.0 说明', () => {
    expect(content).toContain('v1.1.0');
  });

  it('说明改为 Research Subagent 的可选工具', () => {
    expect(content.toLowerCase()).toContain('subagent');
  });
});
