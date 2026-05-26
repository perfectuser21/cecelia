import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';

const SKILL_FILE = 'packages/workflows/skills/harness-generator/SKILL.md';

describe('WS4 — harness-generator SKILL.md 串行化 + 文件名统一 [BEHAVIOR]', () => {
  it('SKILL.md 不含旧文字"并行派发"', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    expect(c).not.toContain('并行派发');
  });

  it('SKILL.md 含新文字"串行派发"', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    expect(c).toContain('串行派发');
  });

  it('SKILL.md 不含 contract-draft.md 旧引用', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    expect(c).not.toContain('contract-draft.md');
  });

  it('SKILL.md 仍含 sprint-contract.md 统一文件名', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    expect(c).toContain('sprint-contract.md');
  });

  it('Step 0.5 区块含 merge gate 或串行相关说明', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    const step05Idx = c.indexOf('Step 0.5');
    expect(step05Idx).toBeGreaterThan(-1);
    const body = c.slice(step05Idx, step05Idx + 800);
    const hasMergeCtx = body.includes('merge') || body.includes('串行') || body.includes('merge gate');
    expect(hasMergeCtx).toBe(true);
  });

  it('文件非空（size > 1000 bytes）', () => {
    const stat = statSync(SKILL_FILE);
    expect(stat.size).toBeGreaterThan(1000);
  });
});
