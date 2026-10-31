import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../basic-runtime-smoke.mjs', import.meta.url).pathname;

test('迁移之前必须核对DB字段和运行URI一致，错误配置不能抵达迁移程序', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-before-migrate-'));
  try {
    const marker = join(directory, 'migration-reached');
    writeFileSync(join(directory, 'node'), `#!/bin/sh
if [ "$1" = src/migrate.js ]; then
  printf 'reached' > "$MIGRATION_MARKER"
  exit 86
fi
exec "${process.execPath}" "$@"
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [new URL('../run-basic-check.mjs', import.meta.url).pathname, 'brain-integration'], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, MIGRATION_MARKER: marker,
        DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:5432/cecelia_scratch', DB_NAME: 'cecelia', DB_HOST: 'production.example' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(marker), false, '配置不一致时迁移已被调用');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const database of ['cecelia', 'production', 'cecelia_staging']) {
  test(`运行验收拒绝连接非专用 scratch 数据库：${database}`, () => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: `postgresql://ci:ci@127.0.0.1:1/${database}` }, encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /只允许本机专用 cecelia_scratch/);
  });
}

test('即使名字为scratch也拒绝远端数据库', () => {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: 'postgresql://ci:ci@production.example:5432/cecelia_scratch' }, encoding: 'utf8', timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /只允许本机专用 cecelia_scratch/);
});
