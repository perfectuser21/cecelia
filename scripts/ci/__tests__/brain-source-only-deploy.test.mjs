import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../brain-deploy.sh');
function deploy(packageText, args = []) {
  const root = mkdtempSync(join(tmpdir(), 'brain-source-only-'));
  try {
    for (const path of ['scripts/lib', 'packages/brain', 'bin']) mkdirSync(join(root, path), { recursive: true });
    copyFileSync(script, join(root, 'scripts/brain-deploy.sh'));
    writeFileSync(join(root, 'packages/brain/package.json'), packageText);
    // 第一个真实 source 即记录副作用并停止；被拒候选不得抵达任何 helper。
    writeFileSync(join(root, 'scripts/lib/bluegreen.sh'), 'printf "helper-loaded\\n" >> "$OPERATIONS"\nexit 73\n');
    for (const command of ['docker', 'curl', 'flock', 'launchctl']) {
      writeFileSync(join(root, 'bin', command), '#!/bin/sh\nprintf "external-command\\n" >> "$OPERATIONS"\nexit 74\n', { mode: 0o755 });
    }
    const operations = join(root, 'operations');
    const result = spawnSync('bash', [join(root, 'scripts/brain-deploy.sh'), ...args], {
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, OPERATIONS: operations },
      encoding: 'utf8', timeout: 10000,
    });
    return { ...result, operations: existsSync(operations) ? readFileSync(operations, 'utf8') : '' };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const value of [true, false, null, 0, '', {}, []]) {
  test(`source-only 字段存在即拒绝，值=${JSON.stringify(value)}`, () => {
    const result = deploy(JSON.stringify({ version: '1.445.55', cecelia_source_only: value }));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /SOURCE_ONLY_PRODUCTION_FORBIDDEN/);
    assert.equal(result.operations, '');
  });
}
for (const content of ['{', 'null', '[]']) {
  test(`非法 package 数据失败关闭：${content}`, () => {
    const result = deploy(content);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /BRAIN_RELEASE_PACKAGE_INVALID/);
    assert.equal(result.operations, '');
  });
}
test('dry-run 参数不能让 source-only 抵达 helper', () => {
  const result = deploy('{"version":"1.445.55","cecelia_source_only":true}', ['--dry-run']);
  assert.equal(result.status, 1);
  assert.equal(result.operations, '');
});
test('无标记版本仍进入原部署链，不能无操作假成功', () => {
  const result = deploy('{"version":"1.445.55"}');
  assert.equal(result.status, 73);
  assert.equal(result.operations, 'helper-loaded\n');
});
