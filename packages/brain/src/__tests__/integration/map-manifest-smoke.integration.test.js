import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

describe('Map Manifest 默认安全拒写', () => {
  it('普通PG集成默认不访问SQL或容器边界，完整真实PG正例由real-env-smoke执行', () => {
    const temp = mkdtempSync(join(tmpdir(), 'map-manifest-default-'));
    const marker = join(temp, 'unexpected-operation');
    const boundary = `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'reached'); process.exit(99);\n`;
    for (const command of ['psql', 'docker']) writeFileSync(join(temp, command), boundary, { mode: 0o755 });
    try {
      const result = spawnSync(
        'bash',
        ['packages/brain/scripts/smoke/map-manifest-smoke.sh'],
        {
          cwd: repositoryRoot,
          env: { ...process.env, PATH: `${temp}:${process.env.PATH}`,
            DATABASE_URL: databaseUrl ?? 'postgresql://localhost:9/cecelia_test',
            BRAIN_URL: 'http://127.0.0.1:9', BRAIN_CONTAINER: 'forbidden-default-fixture',
            SMOKE_ALLOW_WRITE: '' },
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
        stdout: expect.stringContaining('需 SMOKE_ALLOW_WRITE=1'),
        stderr: '',
      });
      expect(existsSync(marker), '无授权时必须在容器/SQL/业务操作之前拒绝').toBe(false);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }, 35_000);
});
