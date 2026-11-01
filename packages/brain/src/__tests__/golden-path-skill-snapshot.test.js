import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const syncScript = readFileSync(
  `${repoRoot}/scripts/sync-skills-snapshot.sh`,
  'utf8',
);

const SKILLS = ['capability-proposer', 'capability-reviewer', 'capability-mapper', 'capability-controller'];

describe('Capability (原 Golden Path) skill snapshots from zenithjoy-skills#184', () => {
  it('keeps all four GP skills in the sync allowlist', () => {
    for (const skill of SKILLS) {
      expect(syncScript).toMatch(new RegExp(`^  ${skill}$`, 'm'));
    }
  });
});
