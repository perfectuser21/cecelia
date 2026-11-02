import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const runner = resolve(root, 'packages/brain/scripts/smoke-tools/run-smoke-ratchet.sh');

// 私有脚本池直接调用迁移后的生产入口；不启动Brain、不连接数据库或Docker。
for (const [name, childExit, expected, executed] of [
  ['abilities-api-smoke.sh', 0, 0, true],
  ['abilities-api-smoke.sh', 9, 1, true],
  ['unregistered-migration-fixture.sh', 0, 1, false],
  ['inbox-p1-smoke.sh', 0, 0, false],
]) {
  test(`Brain runner保留分类和未授权拒写：${name} exit=${childExit}`, async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'brain-smoke-migration-'));
    try {
      const marker = resolve(temp, 'executed');
      await writeFile(resolve(temp, name), `printf executed > '${marker}'\nexit ${childExit}\n`);
      const result = spawnSync('bash', [runner], {
        cwd: temp, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: '', BASH_ENV: '',
          BRAIN_URL: 'http://127.0.0.1:1', DOCKER_HOST: '', DOCKER_CONTEXT: '' },
      });
      assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
      if (executed) assert.equal(await readFile(marker, 'utf8'), 'executed');
      else await assert.rejects(readFile(marker), { code: 'ENOENT' });
      if (name === 'inbox-p1-smoke.sh') assert.match(result.stdout, /SKIP.*write-guard/);
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}
