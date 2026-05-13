import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B20: harness-planner SKILL.md 含 thin_prd 主题保护', () => {
  const skillPath = resolve(__dirname, '../../../../../packages/workflows/skills/harness-planner/SKILL.md');
  const src = readFileSync(skillPath, 'utf8');

  it('含 Step 0 thin_prd 主题死规则段', () => {
    expect(src).toMatch(/Step 0[\s\S]*thin_prd[\s\S]*主题/i);
  });

  it('明文禁止把 task title 当主题', () => {
    expect(src).toMatch(/禁止.*task title.*主题|task title.*不.*主题/i);
  });

  it('要求 sprint-prd.md 含 thin_prd 关键词字面', () => {
    expect(src).toMatch(/sprint-prd[\s\S]*关键词.*字面|关键词.*字面[\s\S]*sprint-prd/i);
  });
});
