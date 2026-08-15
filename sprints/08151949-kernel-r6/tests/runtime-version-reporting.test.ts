import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const smokeScript = resolve('packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh');
const temporaryDirectories: string[] = [];

async function runSmoke({ version = '1.999.7', schema = '430', authority = 'PASS' } = {}) {
  const fixtureBin = await mkdtemp(join(tmpdir(), 'control-plane-smoke-'));
  temporaryDirectories.push(fixtureBin);

  const curlPath = join(fixtureBin, 'curl');
  const psqlPath = join(fixtureBin, 'psql');
  await writeFile(curlPath, '#!/usr/bin/env bash\nprintf \'{"version":"%s","schema_version":"%s"}\\n\' "$FIXTURE_VERSION" "$FIXTURE_SCHEMA"\n');
  await writeFile(psqlPath, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$FIXTURE_AUTHORITY"\n');
  await Promise.all([chmod(curlPath, 0o755), chmod(psqlPath, 0o755)]);

  return spawnSync('bash', [smokeScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixtureBin}:${process.env.PATH}`,
      DATABASE_URL: 'postgresql://fixture.invalid/cecelia',
      FIXTURE_VERSION: version,
      FIXTURE_SCHEMA: schema,
      FIXTURE_AUTHORITY: authority,
    },
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('control-plane smoke runtime version reporting [BEHAVIOR]', () => {
  it('PASS reports the exact runtime API version instead of a hard-coded version', async () => {
    for (const version of ['1.999.7', '2.0.0']) {
      const result = await runSmoke({ version });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`PASS: Brain ${version} schema 430 control-plane authorities are deployed`);
    }
  });

  it('schema below 430 remains fail-closed without PASS output', async () => {
    const result = await runSmoke({ schema: '429' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('PASS:');
  });

  it('authority-table failure remains fail-closed without PASS output', async () => {
    const result = await runSmoke({ authority: 'FAIL' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('PASS:');
  });
});
