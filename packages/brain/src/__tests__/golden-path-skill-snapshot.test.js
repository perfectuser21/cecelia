import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';


const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const syncScript = readFileSync(
  `${repoRoot}/scripts/sync-skills-snapshot.sh`,
  'utf8',
);

const EXPECTED = {
  'golden-path-proposer': {
    version: '1.3.0',
    sha256: 'da2ffa626d0859107879cec71dd7f1532904611f68e9a66645378bba0374b174',
  },
  'golden-path-reviewer': {
    version: '1.3.0',
    sha256: '39715ac05ede9a3f1d49d0ccbf987e89f2d4d49030721189ae4e4865981a40d4',
  },
  'golden-path-mapper': {
    version: '1.2.0',
    sha256: '1c0bf642be71bd3226c3eb7da50a17b896f757bd36b485df7c3e568e8ecff9c6',
  },
  'golden-path-controller': {
    version: '1.1.0',
    sha256: '66c7ba4ae8c03a6eb87af6efa536f5fd77c8f416187b9870480e3ebb8ab3b300',
  },
};

describe('Golden Path skill snapshots from zenithjoy-skills#172', () => {
  it('keeps all four GP skills in the sync allowlist', () => {
    for (const skill of Object.keys(EXPECTED)) {
      expect(syncScript).toMatch(new RegExp(`^  ${skill}$`, 'm'));
    }
  });

  it.each(Object.entries(EXPECTED))(
    'pins %s to the merged SSOT bytes',
    (skill, expected) => {
      const path = `${repoRoot}/packages/workflows/skills/${skill}/SKILL.md`;
      const content = readFileSync(path);
      const text = content.toString('utf8');
      const version = text.match(/^version:\s*(\S+)$/m)?.[1];
      const sha256 = createHash('sha256').update(content).digest('hex');

      expect(version).toBe(expected.version);
      expect(sha256).toBe(expected.sha256);
    },
  );
});
