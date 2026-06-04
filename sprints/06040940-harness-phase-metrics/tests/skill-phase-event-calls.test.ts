import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SKILLS = path.join(REPO_ROOT, 'packages/workflows/skills');
const SKILL_LIST = ['harness-planner', 'harness-contract-proposer', 'harness-generator', 'harness-evaluator', 'harness-report'];

describe('5 个 skill phase-event 首尾调用 + 吞错 [BEHAVIOR]', () => {
  it('5 个 SKILL.md grep phase-event', async () => {
    for (const skill of SKILL_LIST) {
      const src = await fs.promises.readFile(path.join(SKILLS, `${skill}/SKILL.md`), 'utf8');
      expect(src, `${skill} 缺 phase-event 调用`).toMatch(/phase-event/);
    }
  });

  it('proposer SKILL.md 含 phase-event 调用', () => {
    const src = fs.readFileSync(path.join(SKILLS, 'harness-contract-proposer/SKILL.md'), 'utf8');
    expect(src).toMatch(/phase-event/);
  });

  it('generator SKILL.md 含 phase-event 调用', () => {
    const src = fs.readFileSync(path.join(SKILLS, 'harness-generator/SKILL.md'), 'utf8');
    expect(src).toMatch(/phase-event/);
  });

  it('evaluator SKILL.md 含 phase-event 调用', () => {
    const src = fs.readFileSync(path.join(SKILLS, 'harness-evaluator/SKILL.md'), 'utf8');
    expect(src).toMatch(/phase-event/);
  });

  it('reporter，不含 reviewer', () => {
    const src = fs.readFileSync(path.join(SKILLS, 'harness-report/SKILL.md'), 'utf8');
    expect(src).toMatch(/phase-event/);
    expect(src).not.toMatch(/harness-reviewer[^\n]*phase-event/);
  });
});
