import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = (name) => readFileSync(resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'workflows',
  'skills',
  name,
  'SKILL.md',
), 'utf8');

describe('Harness GAN validation identity protocol', () => {
  it('Proposer late-binds validation identity instead of copying its own attempt', () => {
    const content = skill('harness-contract-proposer');

    expect(content).toContain('GAN authoring identity');
    expect(content).toContain('HARNESS_ATTEMPT_ID');
    expect(content).toContain('CAPABILITY_SNAPSHOT_ID');
    expect(content).toContain('禁止把 Proposer');
  });

  it('Reviewer never asks Proposer to replace contract identity with Reviewer identity', () => {
    const content = skill('harness-contract-reviewer');

    expect(content).toContain('Reviewer task bundle');
    expect(content).toContain('不得作为 validation identity');
    expect(content).toContain('late-bound');
    expect(content).toContain('禁止要求改绑为 Reviewer');
  });
});
