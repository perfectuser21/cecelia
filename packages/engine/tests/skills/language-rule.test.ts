import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const SKILLS_DIR = join(os.homedir(), '.claude', 'skills');
const skillsDirExists = existsSync(SKILLS_DIR);
const CORE_SKILLS = ['dev'];
const LANGUAGE_RULE = 'CRITICAL LANGUAGE RULE';

describe('Skill Language Rule', () => {
  beforeAll(() => {
    if (!skillsDirExists) {
      // @ts-ignore
      return (globalThis as any).__vitest_skip__ = true;
    }
  });

  for (const skill of CORE_SKILLS) {
    const skillFilePath = join(SKILLS_DIR, skill, 'SKILL.md');
    const skillFileExists = existsSync(skillFilePath);

    it.skipIf(!skillsDirExists || !skillFileExists)(`skills/${skill}/SKILL.md 包含中文语言强制规则`, () => {
      const content = readFileSync(skillFilePath, 'utf8');
      expect(content).toContain(LANGUAGE_RULE);
    });

    it.skipIf(!skillsDirExists || !skillFileExists)(`skills/${skill}/SKILL.md 语言规则在文件前 30 行`, () => {
      const lines = readFileSync(skillFilePath, 'utf8').split('\n');
      const ruleLineIndex = lines.findIndex(l => l.includes(LANGUAGE_RULE));
      expect(ruleLineIndex).toBeGreaterThanOrEqual(0);
      expect(ruleLineIndex).toBeLessThan(30);
    });
  }
});
