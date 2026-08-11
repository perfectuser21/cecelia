import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

describe('Map Manifest scratch smoke', () => {
  it('为临时 scope 配置 repo adapter 后完成激活并清理全部夹具', () => {
    expect(databaseUrl).toBeTruthy();

    const result = spawnSync(
      'bash',
      ['packages/brain/scripts/smoke/map-manifest-smoke.sh'],
      {
        cwd: repositoryRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );

    expect({
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    }).toMatchObject({
      status: 0,
      signal: null,
      stdout: expect.stringContaining('ALL PASS'),
      stderr: '',
    });
  }, 35_000);
});
