import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const commanderModules = [
  new URL('../commander-contract.js', import.meta.url),
  new URL('../../routes/harness-commander.js', import.meta.url),
];

describe('Commander Zod compatibility', () => {
  it('uses UUID schemas supported by both Zod 3 and Zod 4 production installs', async () => {
    const sources = await Promise.all(
      commanderModules.map((moduleUrl) => readFile(moduleUrl, 'utf8')),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/\bz\.uuid\s*\(/);
    }
  });
});
