import { describe, expect, it } from 'vitest';

import { loadSkillBundle } from '../skill-bundle.js';

// packages/workflows/skills/harness-generator/SKILL.md is the runtime SSOT: it is
// the exact text Kernel ships inside the TaskBundle. Production Attempt
// 3aa00156 obeyed it literally and rebased a frozen blind-comparison candidate
// onto a main that already carried the competing candidate.
describe('harness-generator SKILL frozen baseline doctrine', () => {
  const { content } = loadSkillBundle('harness-generator');
  const preflight = content.slice(
    content.indexOf('### Step 0.5:'),
    content.indexOf('### Step 1:'),
  );

  it('exposes the Step 0.5 pre-flight section', () => {
    expect(preflight).not.toBe('');
  });

  it('never rebases onto origin/main unconditionally', () => {
    const rebaseLine = preflight
      .split('\n')
      .findIndex((line) => line.trim().startsWith('git rebase origin/main'));
    const gateLine = preflight
      .split('\n')
      .findIndex((line) => line.includes('HARNESS_FROZEN_BASELINE'));

    expect(rebaseLine).toBeGreaterThan(-1);
    expect(gateLine).toBeGreaterThan(-1);
    expect(gateLine).toBeLessThan(rebaseLine);
  });

  it('anchors frozen Attempts on the Kernel-injected workspace start SHA', () => {
    expect(preflight).toContain('HARNESS_WORKSPACE_START_SHA');
    expect(preflight).toMatch(
      /git merge-base --is-ancestor "\$HARNESS_WORKSPACE_START_SHA" HEAD/,
    );
  });

  it('forbids importing any other candidate lineage while frozen', () => {
    for (const forbidden of [
      'git fetch origin main',
      'git rebase',
      'git merge',
      'git cherry-pick',
    ]) {
      expect(preflight).toContain(forbidden);
    }
    expect(preflight).toMatch(/禁止[\s\S]{0,400}cherry-pick/);
  });

  it('keeps the latest-main rebase for ordinary dev', () => {
    expect(preflight).toMatch(/git fetch origin main[\s\S]{0,200}git rebase origin\/main/);
  });
});
