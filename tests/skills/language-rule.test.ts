import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILLS_DIR = join(__dirname, '../../skills');
const CORE_SKILLS = ['dev', 'qa', 'audit', 'okr'];
const LANGUAGE_RULE = 'CRITICAL LANGUAGE RULE';

describe('Skill Language Rule', () => {
  for (const skill of CORE_SKILLS) {
    it(`skills/${skill}/SKILL.md 包含中文语言强制规则`, () => {
      const content = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
      expect(content).toContain(LANGUAGE_RULE);
    });

    it(`skills/${skill}/SKILL.md 语言规则在文件前 30 行`, () => {
      const lines = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8').split('\n');
      const ruleLineIndex = lines.findIndex(l => l.includes(LANGUAGE_RULE));
      expect(ruleLineIndex).toBeGreaterThanOrEqual(0);
      expect(ruleLineIndex).toBeLessThan(30);
    });
  }
});
