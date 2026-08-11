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
  'capability-proposer': {
    version: '1.4.0',
    sha256: '3932f1169a6db4a6dcae8fcc4f24a30c2a6176e2e8da45ac45e9a94c58ae84b1',
  },
  'capability-reviewer': {
    version: '1.4.0',
    sha256: 'f0f6adeeab7ad498c8f78831761beddec117cdf021e0ca690a6ca06af5f5b12e',
  },
  'capability-mapper': {
    version: '2.1.0',
    sha256: '7f0ef86ea2065d009c128fe67df5602981e3f91e2dc6d8cdd2e5a8ef079fa223',
  },
  'capability-controller': {
    version: '1.2.0',
    sha256: 'bcd3d112c1cc5a33d9d70b3900b5dc9125c6ea9a595ad677ce8431ed07aafe90',
  },
};

describe('Capability (原 Golden Path) skill snapshots from zenithjoy-skills#184', () => {
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
