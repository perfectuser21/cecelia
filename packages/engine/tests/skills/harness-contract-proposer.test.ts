import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILL_PATH = join(__dirname, '../../../workflows/skills/harness-contract-proposer/SKILL.md');

describe('harness-contract-proposer v6.0 结构', () => {
  const content = readFileSync(SKILL_PATH, 'utf8');

  it('frontmatter version 为 6.0.0 (Sprint 1 Working Skeleton 升级)', () => {
    const versionLine = content.split('\n').slice(0, 20).find(l => l.trim().startsWith('version:'));
    expect(versionLine).toBeDefined();
    expect(versionLine).toContain('6.0.0');
  });

  it('职责章节包含 3 份产物描述', () => {
    expect(content).toContain('sprint-prd.md');
    expect(content).toContain('contract-dod-ws');
    expect(content).toContain('tests/ws');
    expect(content).toMatch(/\.test\.ts/);
  });

  it('contract-dod-ws 规则明确禁止 [BEHAVIOR] 条目', () => {
    expect(content).toMatch(/(禁止|不允许|禁用|严禁).*\[BEHAVIOR\]|\[BEHAVIOR\].*(禁止|不允许|禁用|严禁)/s);
  });

  it('测试文件规则包含 5 条硬约束', () => {
    expect(content).toContain('真实 import');
    expect(content).toContain('具体断言');
    expect(content).toMatch(/测试名|test name|describe/);
    expect(content).toMatch(/一件事|一个行为|single behavior/);
    expect(content).toMatch(/Red evidence|红证据|本地跑过/);
  });

  it('合同末尾要求 Test Contract 索引表', () => {
    expect(content).toContain('## Test Contract');
    expect(content).toContain('Test File');
    expect(content).toMatch(/预期红|Red|failures/);
  });

  it('产物路径一致：tests/ws{N}/*.test.ts 放在 sprint 目录下', () => {
    expect(content).toMatch(/\$\{SPRINT_DIR\}\/tests\/ws|sprints\/.+\/tests\/ws/);
  });

  it('changelog 有 5.0.0 条目说明产出 .test.ts 文件', () => {
    const fmEnd = content.indexOf('\n---\n', 3);
    const fm = content.slice(0, fmEnd);
    expect(fm).toMatch(/5\.0\.0.*test|5\.0\.0.*\.test\.ts/i);
  });
});
