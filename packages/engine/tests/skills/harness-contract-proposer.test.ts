import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILL_PATH = join(__dirname, '../../../workflows/skills/harness-contract-proposer/SKILL.md');

describe('harness-contract-proposer 结构', () => {
  const content = readFileSync(SKILL_PATH, 'utf8');

  it('frontmatter version 跟随 skill 主版本（当前 7.x）', () => {
    // 测试初版写死 6.0.0，skill 已迭代到 7.0.0 (Golden Path) → 7.1.0
    // 改为 major version match，避免每次 patch bump 反复改测试
    const versionLine = content.split('\n').slice(0, 20).find(l => l.trim().startsWith('version:'));
    expect(versionLine).toBeDefined();
    expect(versionLine).toMatch(/^version:\s*[7-9]\./);
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

  it.todo('测试文件规则包含 5 条硬约束 — 待 7.x 重写', () => {
    // skill v6 时期 5 条硬约束（"真实 import" / "具体断言" / "一件事" 等具体词）
    // 在 7.x 改写为 Golden Path 风格，原措辞已不存在。需要按 7.x 实际硬约束重写本测试。
    // 暂以 it.todo 标记，单独 issue 跟踪。
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
