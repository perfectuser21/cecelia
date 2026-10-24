import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const commanderContractUrl = new URL('../commander-contract.js', import.meta.url);
const commanderModules = [
  commanderContractUrl,
  new URL('../../routes/harness-commander.js', import.meta.url),
];
const rootRequire = createRequire(new URL('../../../../../package.json', import.meta.url));

describe('Commander Zod compatibility', () => {
  it('uses UUID schemas supported by both Zod 3 and Zod 4 production installs', async () => {
    const sources = await Promise.all(
      commanderModules.map((moduleUrl) => readFile(moduleUrl, 'utf8')),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/\bz\.uuid\s*\(/);
    }
  });

  it('imports the Commander contract with an explicit development-only Zod 3 fixture', async () => {
    const zodEntryUrl = pathToFileURL(rootRequire.resolve('zod-v3-compat')).href;
    const source = (await readFile(commanderContractUrl, 'utf8'))
      .replace("from 'zod'", `from '${zodEntryUrl}'`);
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

    expect(rootRequire('zod-v3-compat/package.json').version).toMatch(/^3\./);
    await expect(import(moduleUrl)).resolves.toMatchObject({
      parseCommanderMode: expect.any(Function),
    });
  });
  it('validates Commander modes with the production Zod 4 install', async () => {
    const productionRequire = createRequire(commanderContractUrl);
    expect(productionRequire('zod/package.json').version).toMatch(/^4\./);
    const { parseCommanderMode } = await import(commanderContractUrl.href);
    expect(parseCommanderMode('hybrid')).toBe('hybrid');
    expect(() => parseCommanderMode('invalid-mode')).toThrow();
  });
});
