import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SKILL_DIR = join(__dirname, '../../skills/dod-verify');
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md');

describe('dod-verify skill', () => {
  it('SKILL.md exists', () => {
    expect(existsSync(SKILL_FILE)).toBe(true);
  });

  it('SKILL.md contains execution-callback', () => {
    const content = readFileSync(SKILL_FILE, 'utf8');
    expect(content).toContain('execution-callback');
  });

  it('SKILL.md contains PASS/FAIL reporting', () => {
    const content = readFileSync(SKILL_FILE, 'utf8');
    expect(content).toContain('PASS');
    expect(content).toContain('FAIL');
  });

  it('SKILL.md describes independent verification role', () => {
    const content = readFileSync(SKILL_FILE, 'utf8');
    expect(content).toContain('独立');
  });

  it('feature.yaml exists', () => {
    expect(existsSync(join(SKILL_DIR, 'feature.yaml'))).toBe(true);
  });
});
