import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILL_PATH = join(__dirname, '../../../workflows/skills/harness-generator/SKILL.md');

describe('harness-generator v6.0 结构', () => {
  const content = readFileSync(SKILL_PATH, 'utf8');

  it('frontmatter version 为 6.3.0 (Sprint 1 Working Skeleton 升级)', () => {
    const versionLine = content.split('\n').slice(0, 20).find(l => l.trim().startsWith('version:'));
    expect(versionLine).toBeDefined();
    expect(versionLine).toContain('6.3.0');
  });

  it('明确融入 4 个 superpowers', () => {
    expect(content).toContain('superpowers:test-driven-development');
    expect(content).toContain('superpowers:verification-before-completion');
    expect(content).toContain('superpowers:systematic-debugging');
    expect(content).toContain('superpowers:requesting-code-review');
  });

  it('TDD Red 阶段：commit 1 只含测试文件 + DoD', () => {
    // 必须有 "Red" 关键词在 commit 场景
    expect(content).toMatch(/commit\s*1.*Red|Red.*commit\s*1|\(Red\)/);
    // 必须说明从合同 branch checkout 测试文件
    expect(content).toMatch(/git\s+checkout.*tests|checkout.*CONTRACT_BRANCH.*tests/);
    // 必须说明验证 Red（跑测试看红）
    expect(content).toMatch(/verify.*Red|验证.*Red|看.*红|FAIL/);
  });

  it('TDD Green 阶段：commit 2 含实现', () => {
    expect(content).toMatch(/commit\s*2.*Green|Green.*commit\s*2|\(Green\)/);
    expect(content).toMatch(/实现.*commit|commit.*实现|implementation.*commit/);
  });

  it('Verification 阶段：push 前贴测试证据', () => {
    // verification-before-completion 调用 + 贴 Test Evidence
    expect(content).toMatch(/Test Evidence|测试证据|npm test.*output/);
    expect(content).toMatch(/push.*前.*跑.*测试|测试.*push.*前|实际输出/);
  });

  it('Code Review 阶段：调 subagent 审 diff', () => {
    // requesting-code-review 调用
    expect(content).toContain('requesting-code-review');
    expect(content).toMatch(/subagent|sub-agent|review.*diff/);
  });

  it('Mode 2 (harness_fix) 用 systematic-debugging', () => {
    // Mode 2 章节存在且引用 systematic-debugging
    expect(content).toContain('Mode 2');
    expect(content).toMatch(/harness_fix.*systematic-debugging|systematic-debugging.*harness_fix|CI 失败.*systematic-debugging/s);
  });

  it('保留 CONTRACT IS LAW 精神', () => {
    expect(content).toContain('CONTRACT IS LAW');
    // 5 条禁止事项仍在
    expect(content).toMatch(/禁止自写.*sprint-contract/);
    expect(content).toMatch(/禁止.*合同外/);
    expect(content).toMatch(/禁止.*main 分支/);
  });

  it('新增禁止事项：测试文件 commit 1 后不可改', () => {
    // 测试文件一旦 Red commit 就不许再改（防 Generator 偷改测试让 Green 通过）
    expect(content).toMatch(/测试.*不可改|测试.*不许改|测试.*禁止修改|禁止.*修改.*测试|test.*unchanged|immutable.*test/);
  });

  it('changelog 有 5.0.0 条目说明 superpowers + TDD', () => {
    const fmEnd = content.indexOf('\n---\n', 3);
    const fm = content.slice(0, fmEnd);
    expect(fm).toMatch(/5\.0\.0.*(superpowers|TDD|Red.*Green|两次 commit)/i);
  });
});
