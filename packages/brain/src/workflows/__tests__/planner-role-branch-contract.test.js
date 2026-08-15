import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  resolve(here, '../../../../../packages/workflows/skills/harness-planner/SKILL.md'),
  'utf8',
);

describe('Planner role branch contract', () => {
  it('uses the server-owned PLANNER_BRANCH without creating or switching branches', () => {
    expect(skill).toMatch(/git branch --show-current/);
    expect(skill).toMatch(/PLANNER_BRANCH/);
    expect(skill).not.toMatch(/git checkout -b[\s\S]{0,120}harness-prd/);
  });
});
