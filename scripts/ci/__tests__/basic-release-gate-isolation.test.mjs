import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const guard = resolve(root, 'tests/helpers/release-gate-network-guard.cjs');

for (const inherited of [undefined, 'http://127.0.0.1:5221']) {
  test(`两份真实合同测试不访问${inherited ? '继承Brain地址' : '默认Brain地址'}`, () => {
    const owned = mkdtempSync(resolve(tmpdir(), 'release-gate-sentinel-'));
    try {
      const log = resolve(owned, 'blocked.jsonl');
      const env = { ...process.env, NODE_OPTIONS: `--require=${guard}`, RELEASE_GATE_NETWORK_LOG: log };
      delete env.VITEST;
      delete env.NODE_TEST_CONTEXT;
      delete env.RELEASE_GATE_TEST_ORIGIN;
      if (inherited) env.BRAIN_URL = inherited;
      else delete env.BRAIN_URL;
      const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
        'scripts/__tests__/release-gate.test.mjs',
        'tests/regression/release-gate-rtm/release-gate-contract.test.mjs'],
      { cwd: root, env, encoding: 'utf8', timeout: 20000 });
      assert.equal(child.status, 0, child.stdout + child.stderr);
      const blocked = existsSync(log) ? readFileSync(log, 'utf8') : '';
      assert.equal(blocked, '', '真实合同测试尝试跨越owned网络边界：' + blocked);
      assert.match(child.stdout, /# fail 0/);
      assert.match(child.stdout, /decisions|POST/);
    } finally {
      rmSync(owned, { recursive: true, force: true });
    }
  });
}

test('硬哨兵实际阻断fetch、原生TCP与DNS，不能只靠替换fetch', () => {
  const owned = mkdtempSync(resolve(tmpdir(), 'release-gate-denial-'));
  try {
    const log = resolve(owned, 'blocked.jsonl');
    const env = { ...process.env, RELEASE_GATE_NETWORK_LOG: log };
    delete env.RELEASE_GATE_TEST_ORIGIN;
    const child = spawnSync(process.execPath, ['--require', guard, '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      import dns from 'node:dns';
      assert.throws(() => fetch('http://127.0.0.1:5221/api/brain/decisions', {method:'POST'}), /network_denied/);
      assert.throws(() => new net.Socket().connect({host:'127.0.0.1',port:5221}), /network_denied/);
      assert.throws(() => dns.lookup('example.invalid',()=>{}), /network_denied/);
    `], { env, cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
      [{ kind: 'fetch' }, { kind: 'tcp' }, { kind: 'dns' }]);
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }
});
