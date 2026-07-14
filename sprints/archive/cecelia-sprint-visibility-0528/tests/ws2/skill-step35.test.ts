import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SKILL_PATH = resolve(process.cwd(), 'packages/workflows/skills/harness-report/SKILL.md');

function getStep35Content(): string {
  const full = readFileSync(SKILL_PATH, 'utf8');
  const start = full.indexOf('Step 3.5');
  const end = full.indexOf('Step 4', start);
  if (start === -1) return '';
  return full.slice(start, end === -1 ? start + 2000 : end);
}

describe('Workstream 2 — harness-report SKILL.md Step 3.5 修正 [BEHAVIOR]', () => {
  it('SKILL.md 含 "Step 3.5" 字面量', () => {
    const content = readFileSync(SKILL_PATH, 'utf8');
    expect(content).toContain('Step 3.5');
  });

  it('Step 3.5 区间内 sprint-prd.md 类型为 SprintPRD（不是 PRD）', () => {
    const s35 = getStep35Content();
    expect(s35).not.toContain('sprint-prd.md:PRD');
    expect(s35).toContain('SprintPRD');
  });

  it('Step 3.5 区间内含 PrepPRD 类型', () => {
    const s35 = getStep35Content();
    expect(s35).toContain('PrepPRD');
  });

  it('Step 3.5 区间内含 Contract 类型字面量', () => {
    const s35 = getStep35Content();
    expect(s35).toContain('Contract');
  });

  it('Step 3.5 区间内 POST payload 使用 content 字段（非 body）', () => {
    const s35 = getStep35Content();
    expect(s35).not.toContain('"body"');
    expect(s35).toContain('"content"');
  });

  it('Step 3.5 区间内 type 使用 DOC_TYPE 变量（非硬编码 Log）', () => {
    const s35 = getStep35Content();
    expect(s35).not.toMatch(/"type":\s*"Log"/);
    expect(s35).toMatch(/DOC_TYPE|\$DOC_TYPE/);
  });

  it('Step 3.5 区间内 POST payload 含 initiative_id 字段', () => {
    const s35 = getStep35Content();
    expect(s35).toContain('initiative_id');
  });
});
