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

  it('imports the Commander contract with the repository Zod 3 runtime', async () => {
    const zodEntryUrl = pathToFileURL(rootRequire.resolve('zod')).href;
    const source = (await readFile(commanderContractUrl, 'utf8'))
      .replace("from 'zod'", `from '${zodEntryUrl}'`);
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

    expect(rootRequire('zod/package.json').version).toMatch(/^3\./);
    await expect(import(moduleUrl)).resolves.toMatchObject({
      parseCommanderMode: expect.any(Function),
    });
  });
});
